import {
  BET_MAX,
  BET_MIN,
  MAX_MS,
  RESULT_TOP_MAX,
  ROUND_AUTO_LOCK_MS,
  ROUND_LABEL_MAX,
  TIP_MESSAGE_MAX,
  TIP_MIN,
  TITLE_MAX,
  VOID_REASON_MAX,
  odds,
  settle as settleRound,
  validTitle,
  validUrl,
  type StreamSettleOutcome,
} from '@casino/domain/stream';
import { planTransfer, withholdIncome } from '@casino/domain/progression';
import {
  STREAM_LIMITS,
  STREAM_SIDES,
  type Clock,
  type DomainEvent,
  type StreamAuditEntry,
  type StreamBetResponse,
  type StreamEndResponse,
  type StreamList,
  type StreamLocation,
  type StreamPayoutLine,
  type StreamRoundView,
  type StreamSettleCause,
  type StreamSettleResponse,
  type StreamSettleResult,
  type StreamSide,
  type StreamStartResponse,
  type StreamTipItem,
  type StreamTipResponse,
  type StreamView,
  type StreamWriteResponse,
} from '@casino/shared';
import type { IdentityRepo } from '../db/identity.ts';
import type { Store } from '../db/store.ts';
import type { EconomyService } from '../economy/economy-service.ts';
import { IdempotencyStore } from '../games/casino/idempotency.ts';
import { GameRuleError } from '../games/progression/context.ts';
import type { TeiaiPort } from '../games/progression/ports.ts';
import type { EventBus } from '../runtime/bus.ts';
import { AppError } from '../runtime/errors.ts';

/** The player acting: always the session user (Activity) or the interaction user (chat). */
export interface StreamActor {
  guildId: string;
  userId: string;
}

/** What the tip rules need from the transfer service (shared daily cap, games played). */
export interface StreamTransferRules {
  gamesPlayed(guildId: string, userId: string): number;
  /** Principal sent today, from `transfer_out` rows: tips and transfers share the cap. */
  sentToday(guildId: string, userId: string): number;
}

export interface StreamServiceDeps {
  store: Store;
  economy: EconomyService;
  identity: IdentityRepo;
  clock: Clock;
  bus: EventBus;
  teiai: TeiaiPort;
  transfers: StreamTransferRules;
}

/**
 * A change of one stream, published after commit. The chat bot hooks its debounced panel edit
 * here (`onChange`); the Activity gets the domain events in the stream room instead.
 */
export interface StreamChange {
  guildId: string;
  streamId: number;
  kind: 'started' | 'tip' | 'bet' | 'round' | 'ended' | 'panel';
}

export type TipPreview =
  | {
      ok: true;
      amount: number;
      fee: number;
      total: number;
      needsConfirm: boolean;
      receiverWithheld: number;
    }
  | { ok: false; rule: string; params: Record<string, string | number> };

export interface OwnerVoidResult {
  guildId: string;
  streamId: number;
  roundId: number;
  label: string;
  result: StreamSettleResult;
  /** Pelica given back in total. */
  refunded: number;
}

interface StreamRow {
  id: number;
  guild_id: string;
  streamer_id: string;
  title: string;
  url: string | null;
  channel_id: string | null;
  message_id: string | null;
  voice_channel_id: string | null;
  started_at: number;
  ends_at: number;
  ended_at: number | null;
  tips: number;
  tip_count: number;
  status: 'live' | 'ended';
}

interface RoundRow {
  id: number;
  stream_id: number;
  guild_id: string;
  label: string;
  status: 'open' | 'locked' | 'win' | 'lose' | 'void';
  created_at: number;
  auto_lock_at: number;
  locked_at: number | null;
  settled_at: number | null;
}

interface BetRow {
  user_id: string;
  side: StreamSide;
  amount: number;
}

interface AuditRow {
  round_id: number;
  stream_id: number;
  guild_id: string;
  streamer_id: string;
  label: string;
  opened_at: number;
  locked_at: number | null;
  ended_at: number;
  outcome: 'win' | 'lose' | 'void';
  cause: StreamSettleCause;
  actor_id: string | null;
  reason: string | null;
  bettors: number;
  win_total: number;
  lose_total: number;
  rake: number;
  refunded: number;
  top: string;
}

const rule = (
  code: string,
  params: Record<string, string | number> = {},
  error: ConstructorParameters<typeof GameRuleError>[2] = 'conflict',
): GameRuleError => new GameRuleError(code, params, error);

/** The `guild_features_off` key of the stream panel (owner switch `/admin feature off stream`). */
export const STREAM_FEATURE = 'stream';

/**
 * The stream panel (docs/spec/stream.md). One service, two thin clients: the Activity routes and
 * the chat bot call these methods with the session or interaction user as the actor. Every write
 * runs once per idempotency key inside one transaction; settle, void and end are guarded by the
 * row status in that transaction, so a double click, a stale menu and the 1-minute job pay once.
 * The database is the only state, except the last tips shown in the feed.
 */
export class StreamService {
  private readonly deps: StreamServiceDeps;
  private readonly idem: IdempotencyStore;
  /** Newest last, at most `recentTipsMax` per stream. Lost on restart (spec §3). */
  private readonly tips = new Map<number, StreamTipItem[]>();
  private readonly listeners = new Set<(change: StreamChange) => void>();

  constructor(deps: StreamServiceDeps) {
    this.deps = deps;
    this.idem = new IdempotencyStore(deps.store, deps.clock);
  }

  // ------------------------------------------------------------------ hooks and reads

  /** Listen to every committed change (for the chat panel's debounced edit). */
  onChange(listener: (change: StreamChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Whether the owner left the feature on. Off blocks `start`, `tip` and `bet` only. */
  isEnabled(guildId: string): boolean {
    return !this.deps.store
      .stmt('SELECT 1 FROM guild_features_off WHERE guild_id = ? AND feature = ?')
      .get(guildId, STREAM_FEATURE);
  }

  /** The caller's view of one stream of their guild (live or ended), or `not_found`. */
  view(actor: StreamActor, streamId: number): StreamView {
    const s = this.streamRow(actor.guildId, streamId);
    if (!s) throw rule('stream_ended', {}, 'not_found');
    return this.toView(s, actor.userId);
  }

  /** The view of a live stream of the guild, or null (the socket join uses this). */
  liveView(actor: StreamActor, streamId: number): StreamView | null {
    const s = this.streamRow(actor.guildId, streamId);
    return s && s.status === 'live' ? this.toView(s, actor.userId) : null;
  }

  /** Live streams of the guild, newest first, and the caller's own. */
  list(actor: StreamActor): StreamList {
    const now = this.deps.clock.now();
    const rows = this.deps.store
      .stmt(
        `SELECT * FROM streams WHERE guild_id = ? AND status = 'live' ORDER BY started_at DESC, id DESC LIMIT 100`,
      )
      .all(actor.guildId) as StreamRow[];
    return {
      now,
      streams: rows.map((s) => {
        const round = this.activeRound(s.id);
        const who = this.person(s.streamer_id);
        return {
          id: s.id,
          streamerId: s.streamer_id,
          streamerName: who.name,
          streamerAvatar: who.avatar,
          title: s.title,
          startedAt: s.started_at,
          tips: s.tips,
          roundStatus: round ? this.effective(round, now) : null,
        };
      }),
      mine: rows.find((s) => s.streamer_id === actor.userId)?.id ?? null,
    };
  }

  /** The chat panel message of a stream, for the bot's edits. */
  panel(
    guildId: string,
    streamId: number,
  ): { channelId: string | null; messageId: string | null; status: 'live' | 'ended' } | null {
    const s = this.streamRow(guildId, streamId);
    return s ? { channelId: s.channel_id, messageId: s.message_id, status: s.status } : null;
  }

  /** Record the chat panel message once the bot has posted it. */
  attachPanel(guildId: string, streamId: number, channelId: string, messageId: string): void {
    const { store } = this.deps;
    store.transaction(() => {
      store
        .stmt('UPDATE streams SET channel_id = ?, message_id = ? WHERE id = ? AND guild_id = ?')
        .run(channelId, messageId, streamId, guildId);
      this.changed(guildId, streamId, 'panel');
    });
  }

  /** Owner audit log of the guild, newest first (never sent to the Activity). */
  audit(guildId: string, limit = 20): StreamAuditEntry[] {
    const rows = this.deps.store
      .stmt(
        'SELECT * FROM stream_round_audit WHERE guild_id = ? ORDER BY ended_at DESC, round_id DESC LIMIT ?',
      )
      .all(guildId, Math.max(1, Math.min(100, limit))) as AuditRow[];
    return rows.map(toAudit);
  }

  /** The audit row of one round, or null while it is undecided. */
  auditOf(guildId: string, roundId: number): StreamAuditEntry | null {
    const row = this.deps.store
      .stmt('SELECT * FROM stream_round_audit WHERE guild_id = ? AND round_id = ?')
      .get(guildId, roundId) as AuditRow | undefined;
    return row ? toAudit(row) : null;
  }

  /** What a tip would cost, or the rule that refuses it (the confirm step of both clients). */
  previewTip(actor: StreamActor, streamId: number, amount: number): TipPreview {
    try {
      const s = this.liveStream(actor.guildId, streamId);
      this.tipChecks(actor, s, amount);
      const plan = this.planTip(actor, s, amount);
      if (!plan.ok) {
        const refusal = tipRefusal(plan.error);
        return { ok: false, rule: refusal.rule, params: refusal.params };
      }
      return {
        ok: true,
        amount: plan.amount,
        fee: plan.fee,
        total: plan.amount + plan.fee,
        needsConfirm: plan.needsConfirm,
        receiverWithheld: plan.receiverWithheld,
      };
    } catch (error) {
      if (error instanceof GameRuleError) {
        return { ok: false, rule: error.rule, params: error.params };
      }
      if (error instanceof AppError) return { ok: false, rule: error.code, params: {} };
      throw error;
    }
  }

  // ------------------------------------------------------------------ writes

  /**
   * Open a panel. `channelId` is the chat channel of the panel (chat) or null (Activity);
   * `location` is the voice channel the server verified for the Activity instance, never input.
   */
  start(
    actor: StreamActor,
    input: {
      title: string;
      url?: string | null;
      channelId?: string | null;
      location?: { channelId: string } | null;
      idempotencyKey: string;
    },
  ): StreamStartResponse {
    const { title, url } = input;
    return this.write(actor, input.idempotencyKey, 'stream.start', { title, url }, () => {
      const { store, economy, clock } = this.deps;
      if (!this.isEnabled(actor.guildId)) throw new AppError('feature_disabled');
      const t = input.title.trim();
      if (!validTitle(t)) throw rule('stream_bad_title', { max: TITLE_MAX }, 'invalid_payload');
      const u = (input.url ?? '').trim();
      if (u !== '' && !validUrl(u)) throw rule('stream_bad_url', {}, 'invalid_payload');
      // Upstream creates the streamer's account when it is missing.
      economy.ensureMember(actor.guildId, actor.userId);
      if (this.liveOf(actor.guildId, actor.userId)) throw rule('stream_already_live');
      const now = clock.now();
      const id = Number(
        store
          .stmt(
            `INSERT INTO streams (guild_id, streamer_id, title, url, channel_id, voice_channel_id, started_at, ends_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            actor.guildId,
            actor.userId,
            t,
            u === '' ? null : u,
            input.channelId ?? null,
            input.location?.channelId ?? null,
            now,
            now + MAX_MS,
          ).lastInsertRowid,
      );
      this.emit({
        type: 'StreamStarted',
        guildId: actor.guildId,
        at: now,
        streamId: id,
        streamerId: actor.userId,
        title: t,
        url: u === '' ? null : u,
        channelId: input.channelId ?? null,
      });
      this.changed(actor.guildId, id, 'started');
      return { streamId: id, extra: {} };
    });
  }

  /**
   * A super chat: a transfer to the streamer with the transfer rules (fee on top, 20,000 a day
   * shared with transfers, 3 games played, no debt), `ref_type = 'stream'`.
   */
  tip(
    actor: StreamActor,
    input: { streamId: number; amount: number; message?: string; idempotencyKey: string },
  ): StreamTipResponse {
    const { streamId, amount } = input;
    const message = input.message ?? '';
    const key = input.idempotencyKey;
    return this.write(actor, key, 'stream.tip', { streamId, amount, message }, () => {
      const { store, economy, clock, teiai } = this.deps;
      const s = this.liveStream(actor.guildId, streamId);
      if (!this.isEnabled(actor.guildId)) throw new AppError('feature_disabled');
      this.tipChecks(actor, s, amount);
      if (message.length > TIP_MESSAGE_MAX) throw new AppError('invalid_payload');
      economy.ensureMember(actor.guildId, actor.userId);
      const plan = this.planTip(actor, s, amount);
      if (!plan.ok) {
        const refusal = tipRefusal(plan.error);
        throw rule(refusal.rule, refusal.params, refusal.code);
      }
      const ref = { refType: 'stream', refId: String(s.id) } as const;
      economy.debit({
        guildId: actor.guildId,
        userId: actor.userId,
        amount: plan.amount,
        reason: 'transfer_out',
        ...ref,
        idempotencyKey: `${key}:out`,
      });
      economy.debit({
        guildId: actor.guildId,
        userId: actor.userId,
        amount: plan.fee,
        reason: 'transfer_fee',
        ...ref,
        idempotencyKey: `${key}:fee`,
      });
      // In the streamer's account: scoped by the tipper, so two tippers' keys never collide.
      const inKey = `stream:${actor.userId}:${key}:in`;
      economy.credit({
        guildId: actor.guildId,
        userId: s.streamer_id,
        amount: plan.amount,
        reason: 'transfer_in',
        ...ref,
        idempotencyKey: inKey,
      });
      const withheld = withholdIncome(plan.amount, teiai.debtOf(actor.guildId, s.streamer_id));
      if (withheld > 0) {
        economy.debit({
          guildId: actor.guildId,
          userId: s.streamer_id,
          amount: withheld,
          reason: 'debt_withholding',
          ...ref,
          idempotencyKey: `${inKey}:w`,
        });
        teiai.repayDebt(actor.guildId, s.streamer_id, withheld);
      }
      store
        .stmt('UPDATE streams SET tips = tips + ?, tip_count = tip_count + 1 WHERE id = ?')
        .run(plan.amount, s.id);
      const now = clock.now();
      const tipper = this.person(actor.userId);
      store.afterCommit(() => {
        const feed = this.tips.get(s.id) ?? [];
        feed.push({
          tipperId: actor.userId,
          tipperName: tipper.name,
          amount: plan.amount,
          message,
          at: now,
        });
        while (feed.length > STREAM_LIMITS.recentTipsMax) feed.shift();
        this.tips.set(s.id, feed);
      });
      this.emit({
        type: 'StreamTipped',
        guildId: actor.guildId,
        at: now,
        streamId: s.id,
        streamerId: s.streamer_id,
        tipperId: actor.userId,
        amount: plan.amount,
        fee: plan.fee,
        message,
        tips: s.tips + plan.amount,
        tipCount: s.tip_count + 1,
      });
      this.changed(actor.guildId, s.id, 'tip');
      return {
        streamId: s.id,
        extra: {
          amount: plan.amount,
          fee: plan.fee,
          received: plan.amount - withheld,
          withheld,
        },
      };
    });
  }

  /** Open a round (streamer only). Works while the feature is off, so escrow can always be released. */
  openRound(
    actor: StreamActor,
    input: { streamId: number; label?: string; idempotencyKey: string },
  ): StreamWriteResponse {
    const { streamId } = input;
    const label = (input.label ?? '').trim();
    return this.write(actor, input.idempotencyKey, 'stream.open', { streamId, label }, () => {
      const { store, clock } = this.deps;
      const s = this.streamerStream(actor, streamId);
      if (this.activeRound(s.id)) throw rule('stream_round_active');
      if (label.length > ROUND_LABEL_MAX) {
        throw rule('stream_bad_label', { max: ROUND_LABEL_MAX }, 'invalid_payload');
      }
      const now = clock.now();
      const autoLockAt = now + ROUND_AUTO_LOCK_MS;
      const roundId = Number(
        store
          .stmt(
            `INSERT INTO stream_rounds (stream_id, guild_id, label, created_at, auto_lock_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(s.id, s.guild_id, label, now, autoLockAt).lastInsertRowid,
      );
      this.emit({
        type: 'StreamRoundOpened',
        guildId: s.guild_id,
        at: now,
        streamId: s.id,
        streamerId: s.streamer_id,
        roundId,
        label,
        autoLockAt,
      });
      this.changed(s.guild_id, s.id, 'round');
      return { streamId: s.id, extra: {} };
    });
  }

  /**
   * Bet on the active round. The stake is escrowed at once (`stream_bet`); checks in the spec's
   * order, all before any row is written.
   */
  bet(
    actor: StreamActor,
    input: {
      streamId: number;
      roundId: number;
      side: StreamSide;
      amount: number;
      idempotencyKey: string;
    },
  ): StreamBetResponse {
    const { streamId, roundId, side, amount } = input;
    const key = input.idempotencyKey;
    return this.write(actor, key, 'stream.bet', { streamId, roundId, side, amount }, () => {
      const { store, economy, clock, teiai } = this.deps;
      const now = clock.now();
      const s = this.liveStream(actor.guildId, streamId);
      if (!this.isEnabled(actor.guildId)) throw new AppError('feature_disabled');
      const round = this.activeRound(s.id);
      if (!round || this.effective(round, now) !== 'open') throw rule('stream_no_open_round');
      if (round.id !== roundId) throw rule('stream_round_changed');
      if (actor.userId === s.streamer_id) throw rule('stream_self_bet', {}, 'forbidden');
      if (!(STREAM_SIDES as readonly string[]).includes(side)) {
        throw rule('stream_bad_side', {}, 'invalid_payload');
      }
      if (teiai.debtOf(actor.guildId, actor.userId) > 0) throw rule('stream_debt');
      if (!Number.isSafeInteger(amount) || amount < BET_MIN) {
        throw rule('stream_bet_min', { min: BET_MIN }, 'invalid_payload');
      }
      const mine = this.betOf(round.id, actor.userId);
      if (mine && mine.side !== side) throw rule('stream_other_side');
      const already = mine?.amount ?? 0;
      if (already + amount > BET_MAX) throw rule('stream_bet_max', { max: BET_MAX, already });
      economy.ensureMember(actor.guildId, actor.userId);
      const balance = economy.getBalance(actor.guildId, actor.userId);
      if (balance < amount) throw new AppError('insufficient_funds');
      economy.debit({
        guildId: actor.guildId,
        userId: actor.userId,
        amount,
        reason: 'stream_bet',
        refType: 'stream_round',
        refId: String(round.id),
        idempotencyKey: `${key}:bet`,
      });
      store
        .stmt(
          `INSERT INTO stream_bets (round_id, guild_id, user_id, side, amount) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (round_id, user_id) DO UPDATE SET amount = amount + excluded.amount`,
        )
        .run(round.id, actor.guildId, actor.userId, side, amount);
      const totals = this.totals(round.id);
      this.emit({
        type: 'StreamBetPlaced',
        guildId: actor.guildId,
        at: now,
        streamId: s.id,
        roundId: round.id,
        side,
        ...totals,
      });
      this.changed(actor.guildId, s.id, 'bet');
      return { streamId: s.id, extra: { side, total: already + amount } };
    });
  }

  /** Close the bets early (streamer only; they close by themselves at `autoLockAt`). */
  lock(
    actor: StreamActor,
    input: { streamId: number; roundId: number; idempotencyKey: string },
  ): StreamWriteResponse {
    const { streamId, roundId } = input;
    return this.write(actor, input.idempotencyKey, 'stream.lock', { streamId, roundId }, () => {
      const { store, clock } = this.deps;
      const now = clock.now();
      const s = this.streamerStream(actor, streamId);
      const round = this.pick(s, roundId, 'lock');
      if (this.effective(round, now) !== 'open') throw rule('stream_no_open_round');
      const changed = store
        .stmt(
          `UPDATE stream_rounds SET status = 'locked', locked_at = ? WHERE id = ? AND status = 'open'`,
        )
        .run(now, round.id).changes;
      if (changed !== 1) throw rule('stream_no_open_round');
      this.emit({
        type: 'StreamRoundLocked',
        guildId: s.guild_id,
        at: now,
        streamId: s.id,
        streamerId: s.streamer_id,
        roundId: round.id,
        cause: 'streamer',
      });
      this.changed(s.guild_id, s.id, 'round');
      return { streamId: s.id, extra: {} };
    });
  }

  /** Declare win or lose (streamer only). Only from `locked` (decision D3-1). */
  settle(
    actor: StreamActor,
    input: { streamId: number; roundId: number; winner: StreamSide; idempotencyKey: string },
  ): StreamSettleResponse {
    const { streamId, roundId, winner } = input;
    const request = { streamId, roundId, winner };
    return this.write(actor, input.idempotencyKey, 'stream.settle', request, () => {
      const now = this.deps.clock.now();
      const s = this.streamerStream(actor, streamId);
      const round = this.pick(s, roundId, 'settle');
      if (this.effective(round, now) === 'open') throw rule('stream_not_locked');
      if (!(STREAM_SIDES as readonly string[]).includes(winner)) {
        throw rule('stream_bad_side', {}, 'invalid_payload');
      }
      const result = this.finish(s, round, winner, 'streamer', actor.userId, null);
      return { streamId: s.id, extra: { result } };
    });
  }

  /** Void the active round (streamer only, open or locked): everyone gets their stake back. */
  voidRound(
    actor: StreamActor,
    input: { streamId: number; roundId: number; idempotencyKey: string },
  ): StreamSettleResponse {
    const { streamId, roundId } = input;
    return this.write(actor, input.idempotencyKey, 'stream.void', { streamId, roundId }, () => {
      const s = this.streamerStream(actor, streamId);
      const round = this.pick(s, roundId, 'void');
      const result = this.finish(s, round, 'void', 'streamer', actor.userId, null);
      return { streamId: s.id, extra: { result } };
    });
  }

  /** End the stream (streamer only). An undecided round is voided first, in the same transaction. */
  end(actor: StreamActor, input: { streamId: number; idempotencyKey: string }): StreamEndResponse {
    const { streamId } = input;
    return this.write(actor, input.idempotencyKey, 'stream.end', { streamId }, () => {
      const s = this.streamerStream(actor, streamId);
      const voided = this.close(s, 'streamer', actor.userId);
      return { streamId: s.id, extra: { voided } };
    });
  }

  /**
   * `/admin stream-void`: the owner voids a round with a reason. `target` is `stream:<id>` (that
   * stream's active round), `round:<id>` or a bare round id. Works while the feature is off.
   */
  ownerVoid(input: {
    guildId: string;
    ownerId: string;
    target: string;
    reason: string;
  }): OwnerVoidResult {
    const { store } = this.deps;
    const reason = input.reason.trim();
    if (reason.length < 1 || reason.length > VOID_REASON_MAX) {
      throw rule('stream_void_reason', { max: VOID_REASON_MAX }, 'invalid_payload');
    }
    return store.transaction(() => {
      const target = input.target.trim();
      const streamMatch = /^stream:(\d{1,15})$/i.exec(target);
      const roundMatch = /^(?:round:)?(\d{1,15})$/i.exec(target);
      let round: RoundRow | undefined;
      if (streamMatch) {
        const s = this.streamRow(input.guildId, Number(streamMatch[1]));
        round = s ? this.activeRound(s.id) : undefined;
        if (!round) throw rule('stream_void_target', {}, 'not_found');
      } else if (roundMatch) {
        round = store
          .stmt('SELECT * FROM stream_rounds WHERE id = ? AND guild_id = ?')
          .get(Number(roundMatch[1]), input.guildId) as RoundRow | undefined;
        if (!round) throw rule('stream_void_target', {}, 'not_found');
        if (round.status === 'win' || round.status === 'lose') throw rule('stream_round_settled');
        if (round.status === 'void') throw rule('stream_no_round');
      } else {
        throw rule('stream_void_target', {}, 'not_found');
      }
      const s = this.streamRow(input.guildId, round.stream_id) as StreamRow;
      const result = this.finish(s, round, 'void', 'owner', input.ownerId, reason);
      const refunded = this.deps.store
        .stmt(`SELECT COALESCE(SUM(amount), 0) AS n FROM stream_bets WHERE round_id = ?`)
        .get(round.id) as { n: number };
      return {
        guildId: input.guildId,
        streamId: s.id,
        roundId: round.id,
        label: round.label,
        result,
        refunded: refunded.n,
      };
    });
  }

  // ------------------------------------------------------------------ jobs

  /** Job `stream.lockDue`: persist the lock of open rounds past `autoLockAt`. */
  lockDue(guildId: string): number {
    const { store, clock } = this.deps;
    const now = clock.now();
    const due = store
      .stmt(
        `SELECT r.*, s.streamer_id AS streamer_id FROM stream_rounds r JOIN streams s ON s.id = r.stream_id
         WHERE r.guild_id = ? AND r.status = 'open' AND r.auto_lock_at <= ? ORDER BY r.id`,
      )
      .all(guildId, now) as (RoundRow & { streamer_id: string })[];
    let locked = 0;
    for (const round of due) {
      store.transaction(() => {
        const changed = store
          .stmt(
            `UPDATE stream_rounds SET status = 'locked', locked_at = auto_lock_at WHERE id = ? AND status = 'open'`,
          )
          .run(round.id).changes;
        if (changed !== 1) return;
        locked += 1;
        this.emit({
          type: 'StreamRoundLocked',
          guildId,
          at: now,
          streamId: round.stream_id,
          streamerId: round.streamer_id,
          roundId: round.id,
          cause: 'auto',
        });
        this.changed(guildId, round.stream_id, 'round');
      });
    }
    return locked;
  }

  /**
   * Job `stream.closeDue`: end every live stream past `endsAt` (its round is voided first,
   * `cause: timeout`). One stream failing never stops the others; the next tick retries it.
   */
  closeDue(guildId: string, onError?: (error: unknown, streamId: number) => void): number {
    const { store, clock } = this.deps;
    const due = store
      .stmt(
        `SELECT * FROM streams WHERE guild_id = ? AND status = 'live' AND ends_at <= ? ORDER BY id`,
      )
      .all(guildId, clock.now()) as StreamRow[];
    let closed = 0;
    for (const s of due) {
      try {
        store.transaction(() => this.close(s, 'timeout', null));
        closed += 1;
      } catch (error) {
        if (!onError) throw error;
        onError(error, s.id);
      }
    }
    return closed;
  }

  // ------------------------------------------------------------------ internals

  /**
   * Run `fn` once per key; the stored response holds only what the write produced, and the
   * answer adds the balance and the stream as they are now (the contract's `written`).
   */
  private write<E extends object>(
    actor: StreamActor,
    key: string,
    scope: string,
    request: unknown,
    fn: () => { streamId: number; extra: E },
  ): E & { replayed: boolean; balance: number; stream: StreamView } {
    const { response, replayed } = this.idem.run(actor, key, scope, request, fn);
    return {
      ...response.extra,
      replayed,
      balance: this.deps.economy.getBalance(actor.guildId, actor.userId),
      stream: this.view(actor, response.streamId),
    };
  }

  /** End a live stream: void its undecided round, then mark it ended. Inside a transaction. */
  private close(
    s: StreamRow,
    cause: 'streamer' | 'timeout',
    actorId: string | null,
  ): StreamSettleResult | null {
    const { store, clock } = this.deps;
    const now = clock.now();
    const round = this.activeRound(s.id);
    const voided = round
      ? this.finish(
          s,
          round,
          'void',
          cause === 'streamer' ? 'stream_end' : 'timeout',
          actorId,
          null,
        )
      : null;
    const changed = store
      .stmt(`UPDATE streams SET status = 'ended', ended_at = ? WHERE id = ? AND status = 'live'`)
      .run(now, s.id).changes;
    if (changed !== 1) throw rule('stream_ended');
    store.afterCommit(() => this.tips.delete(s.id));
    this.emit({
      type: 'StreamEnded',
      guildId: s.guild_id,
      at: now,
      streamId: s.id,
      streamerId: s.streamer_id,
      cause,
      tips: s.tips,
      tipCount: s.tip_count,
    });
    this.changed(s.guild_id, s.id, 'ended');
    return voided;
  }

  /**
   * Pay or refund a round, inside the caller's transaction: the status change (guarded, so it
   * happens once), every payout or refund row, the rake to the Teiai bank, the audit row.
   */
  private finish(
    s: StreamRow,
    round: RoundRow,
    outcome: StreamSettleOutcome,
    cause: StreamSettleCause,
    actorId: string | null,
    reason: string | null,
  ): StreamSettleResult {
    const { store, economy, clock, teiai } = this.deps;
    const now = clock.now();
    const lockedAt =
      round.locked_at ??
      (round.status === 'open' && now >= round.auto_lock_at ? round.auto_lock_at : null);
    const changed = store
      .stmt(
        `UPDATE stream_rounds SET status = ?, settled_at = ?, locked_at = ?
         WHERE id = ? AND status IN ('open', 'locked')`,
      )
      .run(outcome, now, lockedAt, round.id).changes;
    if (changed !== 1) throw rule('stream_no_round');
    const bets = store
      .stmt('SELECT user_id, side, amount FROM stream_bets WHERE round_id = ? ORDER BY user_id')
      .all(round.id) as BetRow[];
    const r = settleRound(
      bets.map((b) => ({ userId: b.user_id, side: b.side, amount: b.amount })),
      outcome,
    );
    const ref = { refType: 'stream_round', refId: String(round.id) } as const;
    for (const p of r.payouts) {
      const key = `stream_round:${round.id}:${r.refunded ? 'refund' : 'payout'}`;
      economy.credit({
        guildId: s.guild_id,
        userId: p.userId,
        amount: p.amount,
        reason: r.refunded ? 'stream_refund' : 'stream_payout',
        ...ref,
        idempotencyKey: key,
      });
      // Only the profit is income: the stake part of a payout is never withheld.
      const profit = p.amount - p.stake;
      const withheld = withholdIncome(profit, teiai.debtOf(s.guild_id, p.userId));
      if (withheld > 0) {
        economy.debit({
          guildId: s.guild_id,
          userId: p.userId,
          amount: withheld,
          reason: 'debt_withholding',
          ...ref,
          idempotencyKey: `${key}:w`,
        });
        teiai.repayDebt(s.guild_id, p.userId, withheld);
      }
    }
    const take = r.rake + r.dust;
    if (take > 0) teiai.bankIncome(s.guild_id, take, 'stream rake');
    const top: StreamPayoutLine[] = r.payouts
      .slice(0, RESULT_TOP_MAX)
      .map((p) => ({ userId: p.userId, amount: p.amount }));
    const result: StreamSettleResult = {
      roundId: round.id,
      label: round.label,
      outcome,
      refunded: r.refunded,
      cause,
      bettors: r.bettors,
      winTotal: r.winTotal,
      loseTotal: r.loseTotal,
      rake: take,
      payoutCount: r.payouts.length,
      payouts: top,
    };
    store
      .stmt(
        `INSERT INTO stream_round_audit
           (round_id, stream_id, guild_id, streamer_id, label, opened_at, locked_at, ended_at,
            outcome, cause, actor_id, reason, bettors, win_total, lose_total, rake, refunded, top)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        round.id,
        s.id,
        s.guild_id,
        s.streamer_id,
        round.label,
        round.created_at,
        lockedAt,
        now,
        outcome,
        cause,
        actorId,
        reason,
        r.bettors,
        r.winTotal,
        r.loseTotal,
        take,
        r.refunded ? 1 : 0,
        JSON.stringify(r.refunded ? [] : top),
      );
    this.emit({
      type: 'StreamRoundSettled',
      guildId: s.guild_id,
      at: now,
      streamId: s.id,
      streamerId: s.streamer_id,
      result,
    });
    this.changed(s.guild_id, s.id, 'round');
    return result;
  }

  private tipChecks(actor: StreamActor, s: StreamRow, amount: number): void {
    if (actor.userId === s.streamer_id) throw rule('stream_self_tip', {}, 'forbidden');
    if (!Number.isSafeInteger(amount) || amount < TIP_MIN) {
      throw rule('stream_tip_min', { min: TIP_MIN }, 'invalid_payload');
    }
  }

  private planTip(actor: StreamActor, s: StreamRow, amount: number) {
    const { economy, teiai, transfers } = this.deps;
    return planTransfer({
      senderId: actor.userId,
      receiverId: s.streamer_id,
      amount,
      senderGames: transfers.gamesPlayed(actor.guildId, actor.userId),
      sentToday: transfers.sentToday(actor.guildId, actor.userId),
      senderDebt: teiai.debtOf(actor.guildId, actor.userId),
      senderBalance: economy.getBalance(actor.guildId, actor.userId),
      receiverDebt: teiai.debtOf(actor.guildId, s.streamer_id),
    });
  }

  /** The round a streamer action names: the active one, or the rule that explains why not. */
  private pick(s: StreamRow, roundId: number, action: 'lock' | 'settle' | 'void'): RoundRow {
    const active = this.activeRound(s.id);
    if (active && active.id === roundId) return active;
    if (action === 'void') {
      const named = this.deps.store
        .stmt('SELECT status FROM stream_rounds WHERE id = ? AND stream_id = ?')
        .get(roundId, s.id) as { status: RoundRow['status'] } | undefined;
      if (named && (named.status === 'win' || named.status === 'lose')) {
        throw rule('stream_round_settled');
      }
    }
    if (!active) throw rule('stream_no_round');
    throw rule('stream_round_changed');
  }

  /** `open` past `autoLockAt` counts as locked everywhere, to the second (spec §4). */
  private effective(round: RoundRow, now: number): RoundRow['status'] {
    return round.status === 'open' && now >= round.auto_lock_at ? 'locked' : round.status;
  }

  private streamRow(guildId: string, streamId: number): StreamRow | undefined {
    return this.deps.store
      .stmt('SELECT * FROM streams WHERE id = ? AND guild_id = ?')
      .get(streamId, guildId) as StreamRow | undefined;
  }

  private liveStream(guildId: string, streamId: number): StreamRow {
    const s = this.streamRow(guildId, streamId);
    if (!s) throw rule('stream_ended', {}, 'not_found');
    if (s.status !== 'live') throw rule('stream_ended');
    return s;
  }

  /** A live stream of the actor's guild that the actor streams. */
  private streamerStream(actor: StreamActor, streamId: number): StreamRow {
    const s = this.streamRow(actor.guildId, streamId);
    if (!s) throw rule('stream_ended', {}, 'not_found');
    if (s.streamer_id !== actor.userId) throw rule('stream_not_streamer', {}, 'forbidden');
    if (s.status !== 'live') throw rule('stream_ended');
    return s;
  }

  private liveOf(guildId: string, userId: string): StreamRow | undefined {
    return this.deps.store
      .stmt(`SELECT * FROM streams WHERE guild_id = ? AND streamer_id = ? AND status = 'live'`)
      .get(guildId, userId) as StreamRow | undefined;
  }

  private activeRound(streamId: number): RoundRow | undefined {
    return this.deps.store
      .stmt(`SELECT * FROM stream_rounds WHERE stream_id = ? AND status IN ('open', 'locked')`)
      .get(streamId) as RoundRow | undefined;
  }

  private betOf(roundId: number, userId: string): BetRow | undefined {
    return this.deps.store
      .stmt('SELECT user_id, side, amount FROM stream_bets WHERE round_id = ? AND user_id = ?')
      .get(roundId, userId) as BetRow | undefined;
  }

  private totals(roundId: number): { winTotal: number; loseTotal: number; bettors: number } {
    const row = this.deps.store
      .stmt(
        `SELECT COALESCE(SUM(CASE WHEN side = 'win' THEN amount END), 0) AS win,
                COALESCE(SUM(CASE WHEN side = 'lose' THEN amount END), 0) AS lose,
                COUNT(*) AS n
         FROM stream_bets WHERE round_id = ?`,
      )
      .get(roundId) as { win: number; lose: number; n: number };
    return { winTotal: row.win, loseTotal: row.lose, bettors: row.n };
  }

  private person(userId: string): { name: string; avatar: string | null } {
    const user = this.deps.identity.getUser(userId);
    const name = (user?.globalName || user?.username || `…${userId.slice(-4)}`).slice(0, 80);
    const avatar = user?.avatar && user.avatar.length <= 64 ? user.avatar : null;
    return { name, avatar };
  }

  private toView(s: StreamRow, userId: string): StreamView {
    const now = this.deps.clock.now();
    const round = s.status === 'live' ? this.activeRound(s.id) : undefined;
    let roundView: StreamRoundView | null = null;
    let bet: StreamView['me']['bet'] = null;
    let betRoom = 0;
    if (round) {
      const t = this.totals(round.id);
      const status = this.effective(round, now) === 'open' ? 'open' : 'locked';
      roundView = {
        id: round.id,
        label: round.label,
        status,
        openedAt: round.created_at,
        autoLockAt: round.auto_lock_at,
        lockedAt: round.locked_at ?? (status === 'locked' ? round.auto_lock_at : null),
        winTotal: t.winTotal,
        loseTotal: t.loseTotal,
        bettors: t.bettors,
        winOddsBps: odds(t.winTotal, t.loseTotal, 'win'),
        loseOddsBps: odds(t.winTotal, t.loseTotal, 'lose'),
      };
      const mine = this.betOf(round.id, userId);
      bet = mine ? { side: mine.side, amount: mine.amount } : null;
      if (status === 'open' && userId !== s.streamer_id) {
        betRoom = Math.max(0, BET_MAX - (mine?.amount ?? 0));
      }
    }
    const streamer = this.person(s.streamer_id);
    return {
      now,
      id: s.id,
      streamerId: s.streamer_id,
      streamerName: streamer.name,
      streamerAvatar: streamer.avatar,
      title: s.title,
      url: s.url,
      channelId: s.channel_id,
      location: s.voice_channel_id
        ? ({ channelId: s.voice_channel_id, source: 'activity' } satisfies StreamLocation)
        : null,
      status: s.status,
      startedAt: s.started_at,
      endsAt: s.ends_at,
      endedAt: s.ended_at,
      tips: s.tips,
      tipCount: s.tip_count,
      round: roundView,
      recentTips: [...(this.tips.get(s.id) ?? [])].reverse(),
      me: {
        isStreamer: userId === s.streamer_id,
        balance: this.deps.economy.getBalance(s.guild_id, userId),
        bet,
        betRoom,
      },
    };
  }

  private emit(event: DomainEvent): void {
    this.deps.store.afterCommit(() => this.deps.bus.publishDomain(event));
  }

  private changed(guildId: string, streamId: number, kind: StreamChange['kind']): void {
    this.deps.store.afterCommit(() => {
      for (const listener of this.listeners) listener({ guildId, streamId, kind });
    });
  }
}

/** Transfer refusals keep their `screen.life.rule.*` names; debt is the stream's own rule. */
function tipRefusal(error: { code: string; params: Record<string, number> }): {
  rule: string;
  params: Record<string, string | number>;
  code: 'conflict' | 'insufficient_funds';
} {
  if (error.code === 'debt_blocks') return { rule: 'stream_debt', params: {}, code: 'conflict' };
  return {
    rule: error.code,
    params: error.params,
    code: error.code === 'transfer_insufficient_balance' ? 'insufficient_funds' : 'conflict',
  };
}

function toAudit(row: AuditRow): StreamAuditEntry {
  return {
    roundId: row.round_id,
    streamId: row.stream_id,
    guildId: row.guild_id,
    streamerId: row.streamer_id,
    label: row.label,
    openedAt: row.opened_at,
    lockedAt: row.locked_at,
    endedAt: row.ended_at,
    outcome: row.outcome,
    cause: row.cause,
    actorId: row.actor_id,
    reason: row.reason,
    bettors: row.bettors,
    winTotal: row.win_total,
    loseTotal: row.lose_total,
    rake: row.rake,
    refunded: row.refunded === 1,
    top: JSON.parse(row.top) as StreamPayoutLine[],
  };
}
