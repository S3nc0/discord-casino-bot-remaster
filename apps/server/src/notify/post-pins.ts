import type { Clock } from '@casino/shared';
import type { Client } from 'discord.js';
import type { Logger } from 'pino';
import type { Store } from '../db/store.ts';

/**
 * Pinned posts (docs/spec/polls.md, kyosai.md, lottery.md). A new poll, kyosai motion or raffle
 * post is pinned in its channel and unpinned when the thing ends. Pinning is a courtesy: it needs
 * the Pin Messages permission, a channel under the pin cap and a message that still exists, and
 * none of that may ever break the command or the job that ends the thing. Every failure here is
 * returned or logged (throttled per guild), never thrown.
 */

export type PinKind = 'poll' | 'motion' | 'raffle';

export type PinFailure =
  | 'missing_permissions'
  | 'pin_limit'
  /** The message is already gone (deleted by someone): not an error when unpinning. */
  | 'message_gone'
  | 'channel_gone'
  | 'error';

export type PinOutcome = { ok: true } | { ok: false; reason: PinFailure; message?: string };

/** Discord I/O of the pin feature: implemented over discord.js, faked in tests. */
export interface PostPinPort {
  pin(channelId: string, messageId: string): Promise<PinOutcome>;
  unpin(channelId: string, messageId: string): Promise<PinOutcome>;
}

/** Discord REST error codes this module tells apart. */
const MISSING_ACCESS = 50001;
const MISSING_PERMISSIONS = 50013;
const UNKNOWN_CHANNEL = 10003;
const UNKNOWN_MESSAGE = 10008;
const MAX_PINS = 30003;

function failureOf(error: unknown): PinOutcome {
  const err = (typeof error === 'object' && error !== null ? error : {}) as {
    code?: number | string;
    message?: string;
  };
  const message = err.message ?? String(error);
  switch (err.code) {
    case MISSING_ACCESS:
    case MISSING_PERMISSIONS:
      return { ok: false, reason: 'missing_permissions', message };
    case MAX_PINS:
      return { ok: false, reason: 'pin_limit', message };
    case UNKNOWN_MESSAGE:
      return { ok: false, reason: 'message_gone', message };
    case UNKNOWN_CHANNEL:
      return { ok: false, reason: 'channel_gone', message };
    default:
      return { ok: false, reason: 'error', message };
  }
}

interface PinnableChannel {
  messages: {
    pin(messageId: string, reason?: string): Promise<unknown>;
    unpin(messageId: string, reason?: string): Promise<unknown>;
  };
}

/** Port over a logged-in discord.js client. Uses the current pin endpoints (Pin Messages permission). */
export function createDiscordPinPort(client: Pick<Client, 'channels'>): PostPinPort {
  const run = async (
    channelId: string,
    act: (channel: PinnableChannel) => Promise<unknown>,
  ): Promise<PinOutcome> => {
    try {
      const channel = (await client.channels.fetch(channelId)) as unknown;
      if (!channel || typeof channel !== 'object' || !('messages' in channel)) {
        return { ok: false, reason: 'channel_gone' };
      }
      await act(channel as PinnableChannel);
      return { ok: true };
    } catch (error) {
      return failureOf(error);
    }
  };
  return {
    pin: (channelId, messageId) => run(channelId, (c) => c.messages.pin(messageId)),
    unpin: (channelId, messageId) => run(channelId, (c) => c.messages.unpin(messageId)),
  };
}

/** What `pinPost` did: `skipped` when there is no Discord client, `failed` when the pin was refused. */
export type PinResult = 'pinned' | 'skipped' | 'failed';

export interface PinnedPost {
  kind: PinKind;
  refId: number;
  guildId: string;
  channelId: string;
  messageId: string;
}

interface PinRow {
  kind: PinKind;
  ref_id: number;
  guild_id: string;
  channel_id: string;
  message_id: string;
  tries: number;
}

/** Unpin attempts that hit an unexpected error before the row is dropped anyway. */
const MAX_UNPIN_TRIES = 3;
/** One log line per guild per this long, so a server without the permission does not flood the log. */
export const PIN_LOG_THROTTLE_MS = 600_000;

export interface PostPinServiceDeps {
  store: Store;
  clock: Clock;
  logger: Logger;
}

const KIND_LABEL: Record<PinKind, string> = {
  poll: 'poll',
  motion: 'kyosai motion',
  raffle: 'raffle',
};

/**
 * Keeps the list of posts the bot has pinned (`pinned_posts`) and releases each one once the poll,
 * motion or raffle behind it is no longer open. The Discord port is attached after the bot logs
 * in; without one (`BOT_DISABLED=1`, tests) every call is a quiet no-op.
 */
export class PostPinService {
  private readonly store: Store;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private port: PostPinPort | null = null;
  private readonly lastLog = new Map<string, number>();

  constructor(deps: PostPinServiceDeps) {
    this.store = deps.store;
    this.clock = deps.clock;
    this.logger = deps.logger;
  }

  attach(port: PostPinPort | null): void {
    this.port = port;
  }

  /**
   * Pin a freshly posted message and remember it. A different message already pinned for the same
   * thing (a raffle posted again) is unpinned first. Never throws.
   */
  async pinPost(post: PinnedPost): Promise<PinResult> {
    const port = this.port;
    if (!port) return 'skipped';
    try {
      const old = this.store
        .stmt('SELECT * FROM pinned_posts WHERE kind = ? AND ref_id = ?')
        .get(post.kind, post.refId) as PinRow | undefined;
      if (old && (old.message_id !== post.messageId || old.channel_id !== post.channelId)) {
        await this.release(port, old);
      }
      const outcome = await port.pin(post.channelId, post.messageId);
      if (!outcome.ok) {
        this.logFailure('pin', post, outcome);
        return 'failed';
      }
      this.store
        .stmt(
          `INSERT INTO pinned_posts (kind, ref_id, guild_id, channel_id, message_id, pinned_at, tries)
           VALUES (?, ?, ?, ?, ?, ?, 0)
           ON CONFLICT (kind, ref_id) DO UPDATE SET
             guild_id = excluded.guild_id, channel_id = excluded.channel_id,
             message_id = excluded.message_id, pinned_at = excluded.pinned_at, tries = 0`,
        )
        .run(post.kind, post.refId, post.guildId, post.channelId, post.messageId, this.clock.now());
      return 'pinned';
    } catch (error) {
      this.logFailure('pin', post, { ok: false, reason: 'error', message: String(error) });
      return 'failed';
    }
  }

  /**
   * Job: unpin every post whose poll, motion or raffle is no longer open (closed, drawn, cancelled
   * or gone). Returns how many pins were released. Never throws.
   */
  async sweep(): Promise<number> {
    const port = this.port;
    if (!port) return 0;
    let released = 0;
    try {
      const rows = this.store
        .stmt(
          `SELECT * FROM pinned_posts p WHERE
             (p.kind = 'poll' AND NOT EXISTS
                (SELECT 1 FROM polls x WHERE x.id = p.ref_id AND x.status = 'open'))
          OR (p.kind = 'motion' AND NOT EXISTS
                (SELECT 1 FROM kyosai_motions x WHERE x.id = p.ref_id AND x.status = 'open'))
          OR (p.kind = 'raffle' AND NOT EXISTS
                (SELECT 1 FROM raffles x WHERE x.id = p.ref_id AND x.status = 'open'))`,
        )
        .all() as PinRow[];
      for (const row of rows) {
        if (await this.release(port, row)) released += 1;
      }
    } catch (error) {
      this.logger.warn({ err: error }, 'pin sweep failed');
    }
    return released;
  }

  /** True when the row is gone afterwards. A missing message is silent; other failures are logged. */
  private async release(port: PostPinPort, row: PinRow): Promise<boolean> {
    const post: PinnedPost = {
      kind: row.kind,
      refId: row.ref_id,
      guildId: row.guild_id,
      channelId: row.channel_id,
      messageId: row.message_id,
    };
    let keep = false;
    try {
      const outcome = await port.unpin(row.channel_id, row.message_id);
      if (!outcome.ok && outcome.reason !== 'message_gone' && outcome.reason !== 'channel_gone') {
        this.logFailure('unpin', post, outcome);
        // A permission that is missing now will not come back by itself: stop retrying. Only an
        // unexpected error gets another try on the next sweep.
        keep = outcome.reason === 'error' && row.tries + 1 < MAX_UNPIN_TRIES;
      }
    } catch (error) {
      this.logFailure('unpin', post, { ok: false, reason: 'error', message: String(error) });
      keep = row.tries + 1 < MAX_UNPIN_TRIES;
    }
    if (keep) {
      this.store
        .stmt('UPDATE pinned_posts SET tries = tries + 1 WHERE kind = ? AND ref_id = ?')
        .run(row.kind, row.ref_id);
      return false;
    }
    this.store
      .stmt('DELETE FROM pinned_posts WHERE kind = ? AND ref_id = ?')
      .run(row.kind, row.ref_id);
    return true;
  }

  private logFailure(action: 'pin' | 'unpin', post: PinnedPost, outcome: PinOutcome): void {
    if (outcome.ok) return;
    const now = this.clock.now();
    const last = this.lastLog.get(post.guildId);
    if (last !== undefined && now - last < PIN_LOG_THROTTLE_MS) return;
    this.lastLog.set(post.guildId, now);
    this.logger.warn(
      {
        guildId: post.guildId,
        channelId: post.channelId,
        reason: outcome.reason,
        detail: outcome.message,
      },
      `could not ${action} the ${KIND_LABEL[post.kind]} #${post.refId} post` +
        (outcome.reason === 'missing_permissions'
          ? ' (the bot needs the Pin Messages permission)'
          : ''),
    );
  }
}
