import type { Clock, NotificationKind } from '@casino/shared';
import type { Logger } from 'pino';
import type { Store } from '../db/store.ts';
import type { NotifyConfigService } from './config-service.ts';
import type { InboxWriter } from './inbox-writer.ts';
import { renderDmBatch, type SubscribedDomainEvent } from './messages.ts';
import type { DiscordNotifyPort, DmSendResult } from './ports.ts';
import { defaultEmbedTheme, type EmbedTheme } from './theme.ts';

export const DEFAULT_DM_DIGEST_WINDOW_MS = 3_600_000; // 1 hour
export const DEFAULT_DM_BASE_BACKOFF_MS = 30_000; // 30 s
export const DEFAULT_DM_MAX_BACKOFF_MS = 600_000; // 10 min
export const DEFAULT_DM_MAX_ATTEMPTS = 5;
export const DEFAULT_DM_MAX_DIGEST_ITEMS = 25;
export const DEFAULT_DM_MAX_CLAIM_ROWS = 200;

export interface BackoffOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryAfterMs?: number;
}

/**
 * Pure exponential retry backoff: `baseDelayMs * 2^(attempt - 1)` capped at `maxDelayMs`,
 * floored by any explicit `retryAfterMs` returned by Discord.
 */
export function computeRetryBackoffMs(attempt: number, options: BackoffOptions = {}): number {
  const base = options.baseDelayMs ?? DEFAULT_DM_BASE_BACKOFF_MS;
  const max = options.maxDelayMs ?? DEFAULT_DM_MAX_BACKOFF_MS;
  const exp = Math.max(0, attempt - 1);
  const computed = Math.min(max, base * 2 ** exp);
  if (options.retryAfterMs !== undefined && options.retryAfterMs > computed) {
    return options.retryAfterMs;
  }
  return computed;
}

export interface QueuedDmRow {
  id: number;
  user_id: string;
  guild_id: string;
  kind: NotificationKind;
  payload: string;
  attempts: number;
  next_attempt_at: number;
  created_at: number;
}

export interface DigestGroup {
  userId: string;
  rows: QueuedDmRow[];
}

/**
 * Pure digest grouper: buckets due queue rows by `user_id` in chronological order,
 * capping each batch at `maxItems` (Discord's 25-field embed limit).
 */
export function groupDigestRows(
  rows: readonly QueuedDmRow[],
  maxItems = DEFAULT_DM_MAX_DIGEST_ITEMS,
): DigestGroup[] {
  const ordered = [...rows].sort((a, b) => a.created_at - b.created_at || a.id - b.id);
  const byUser = new Map<string, QueuedDmRow[]>();
  for (const row of ordered) {
    let list = byUser.get(row.user_id);
    if (!list) {
      list = [];
      byUser.set(row.user_id, list);
    }
    if (list.length < maxItems) list.push(row);
  }
  return [...byUser.entries()].map(([userId, userRows]) => ({ userId, rows: userRows }));
}

/** Deterministic dedupe key per `(userId, kind, event)` so duplicate bus emissions don't double-DM. */
export function buildDmDedupeKey(
  userId: string,
  kind: NotificationKind,
  event: SubscribedDomainEvent,
): string {
  switch (event.type) {
    case 'RaceFinished':
      return `${kind}:${event.guildId}:${userId}:race:${event.raceId}`;
    case 'HorseRetired':
      return `${kind}:${event.guildId}:${userId}:horse:${event.horseId}`;
    case 'HorseFoaled':
      return `${kind}:${event.guildId}:${userId}:foal:${event.foalId}`;
    case 'LoanDue':
      return `${kind}:${event.guildId}:${userId}:loan:${event.loanId}:${event.dueAt}`;
    case 'BankruptcyGraceStarted':
      return `${kind}:${event.guildId}:${userId}:grace:${event.graceEndsAt}`;
    case 'DailyReady':
      return `${kind}:${event.guildId}:${userId}:daily:${event.at}`;
    case 'MissionCompleted':
      return `${kind}:${event.guildId}:${userId}:mission:${event.missionId}:${event.at}`;
    case 'OrderFilled':
      return `${kind}:${event.guildId}:${userId}:order:${event.orderId}`;
    case 'MarketplaceOutbid':
      return `${kind}:${event.guildId}:${userId}:listing:${event.listingId}:${event.newBid}`;
    default:
      return `${kind}:${event.guildId}:${userId}:${event.type}:${event.at}`;
  }
}

export type EnqueueDmResult =
  | { enqueued: true; id: number; nextAttemptAt: number }
  | { enqueued: false; reason: 'opted_out' | 'duplicate' };

export interface DmProcessReport {
  sentUsers: number;
  sentItems: number;
  retriedItems: number;
  failedItems: number;
  disabledUsers: number;
  droppedItems: number;
}

export interface DmQueueOptions {
  store: Store;
  port: DiscordNotifyPort;
  configService: NotifyConfigService;
  inboxWriter: InboxWriter;
  clock: Clock;
  logger: Logger;
  theme?: EmbedTheme;
  /** Per-user hourly digest window (ms). Default 1 hour. */
  digestWindowMs?: number;
  /** Initial retry backoff delay (ms). Default 30 s. */
  baseBackoffMs?: number;
  /** Maximum retry backoff delay (ms). Default 10 min. */
  maxBackoffMs?: number;
  /** Maximum delivery attempts before marking `failed`. Default 5. */
  maxAttempts?: number;
  /** Max queued events combined into one digest DM. Default 25. */
  maxDigestItems?: number;
  /** Max due rows loaded and claimed per `processDue` pass; the rest wait for the next. Default 200. */
  maxClaimRows?: number;
}

/**
 * Persistent opt-in DM queue backed by `notification_queue`.
 * - Enforces per-user, per-kind opt-in (`notification_prefs.dm = 1`).
 * - Groups pending notifications into a per-user hourly digest when `user_settings.dm_digest = 1`.
 * - Retries transient failures with exponential backoff.
 * - On closed DMs (`dm_closed`), disables all DMs for that user, drops pending items, and writes
 *   an inbox note explaining why.
 */
export class DmQueue {
  private readonly store: Store;
  private readonly port: DiscordNotifyPort;
  private readonly configService: NotifyConfigService;
  private readonly inboxWriter: InboxWriter;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly theme: EmbedTheme;
  private readonly digestWindowMs: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly maxAttempts: number;
  private readonly maxDigestItems: number;
  private readonly maxClaimRows: number;
  private processing = false;

  constructor(options: DmQueueOptions) {
    this.store = options.store;
    this.port = options.port;
    this.configService = options.configService;
    this.inboxWriter = options.inboxWriter;
    this.clock = options.clock;
    this.logger = options.logger;
    this.theme = options.theme ?? defaultEmbedTheme;
    this.digestWindowMs = options.digestWindowMs ?? DEFAULT_DM_DIGEST_WINDOW_MS;
    this.baseBackoffMs = options.baseBackoffMs ?? DEFAULT_DM_BASE_BACKOFF_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_DM_MAX_BACKOFF_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_DM_MAX_ATTEMPTS;
    this.maxDigestItems = options.maxDigestItems ?? DEFAULT_DM_MAX_DIGEST_ITEMS;
    this.maxClaimRows = options.maxClaimRows ?? DEFAULT_DM_MAX_CLAIM_ROWS;
  }

  /** Reset any rows left in `sending` from a previous process crash back to `pending`. */
  recoverStuckSending(): number {
    const res = this.store
      .stmt("UPDATE notification_queue SET status = 'pending' WHERE status = 'sending'")
      .run();
    return res.changes;
  }

  /** Enqueue a DM for `userId` if they opted in for `kind`. */
  enqueue(userId: string, kind: NotificationKind, event: SubscribedDomainEvent): EnqueueDmResult {
    if (!this.configService.getUserKindPref(userId, kind).dm) {
      return { enqueued: false, reason: 'opted_out' };
    }

    const now = this.clock.now();
    const nextAttemptAt = this.computeInitialSendAt(userId, now);
    const dedupeKey = buildDmDedupeKey(userId, kind, event);

    const info = this.store
      .stmt(
        `INSERT OR IGNORE INTO notification_queue
           (user_id, guild_id, kind, payload, dedupe_key, status, attempts, next_attempt_at, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
      )
      .run(userId, event.guildId, kind, JSON.stringify(event), dedupeKey, nextAttemptAt, now);

    if (info.changes === 0) {
      return { enqueued: false, reason: 'duplicate' };
    }
    return { enqueued: true, id: Number(info.lastInsertRowid), nextAttemptAt };
  }

  /** Deliver all due pending DMs, grouping multiple due items per user into a single digest. */
  async processDue(): Promise<DmProcessReport> {
    const report: DmProcessReport = {
      sentUsers: 0,
      sentItems: 0,
      retriedItems: 0,
      failedItems: 0,
      disabledUsers: 0,
      droppedItems: 0,
    };
    if (this.processing) return report;
    this.processing = true;

    try {
      const now = this.clock.now();
      const groups = this.claimDueGroups(now);

      for (const group of groups) {
        // Re-check per-kind opt-in in case the user opted out while items waited in the digest window.
        const eligible: QueuedDmRow[] = [];
        const optedOut: QueuedDmRow[] = [];
        for (const row of group.rows) {
          if (this.configService.getUserKindPref(group.userId, row.kind).dm) {
            eligible.push(row);
          } else {
            optedOut.push(row);
          }
        }

        if (optedOut.length > 0) {
          this.markDropped(optedOut, 'opted_out');
          report.droppedItems += optedOut.length;
        }
        if (eligible.length === 0) continue;

        const firstRow = eligible[0];
        if (!firstRow) continue;

        const events = eligible.map((row) => JSON.parse(row.payload) as SubscribedDomainEvent);
        const locale = await this.configService.resolveUserLocale(
          group.userId,
          firstRow.guild_id,
          (gid) => this.port.fetchGuildLocale(gid),
        );
        const message = renderDmBatch(locale, events, this.theme);

        let result: DmSendResult;
        try {
          result = await this.port.sendDm(group.userId, message);
        } catch (error) {
          this.logger.warn({ err: error, userId: group.userId }, 'sendDm threw');
          result = { ok: false, reason: 'transient', message: String(error) };
        }

        if (result.ok) {
          this.markSent(eligible, this.clock.now());
          report.sentUsers += 1;
          report.sentItems += eligible.length;
        } else if (result.reason === 'dm_closed') {
          const extraDropped = this.handleClosedDms(group.userId, firstRow.guild_id, eligible);
          report.disabledUsers += 1;
          report.droppedItems += eligible.length + extraDropped;
        } else if (result.reason === 'unknown_user') {
          this.markFailed(eligible, result.message ?? 'unknown_user');
          report.failedItems += eligible.length;
        } else {
          const outcome = this.scheduleRetryOrFail(eligible, result);
          report.retriedItems += outcome.retried;
          report.failedItems += outcome.failed;
        }
      }
    } finally {
      this.processing = false;
    }

    return report;
  }

  private computeInitialSendAt(userId: string, now: number): number {
    if (!this.configService.isUserDmDigestEnabled(userId)) {
      return now;
    }
    const row = this.store
      .stmt(
        "SELECT MAX(sent_at) AS last_sent FROM notification_queue WHERE user_id = ? AND status = 'sent'",
      )
      .get(userId) as { last_sent: number | null };
    if (row.last_sent !== null && row.last_sent + this.digestWindowMs > now) {
      return row.last_sent + this.digestWindowMs;
    }
    return now;
  }

  private claimDueGroups(now: number): DigestGroup[] {
    return this.store.transaction(() => {
      const dueRows = this.store
        .stmt(
          `SELECT id, user_id, guild_id, kind, payload, attempts, next_attempt_at, created_at
           FROM notification_queue
           WHERE status = 'pending' AND next_attempt_at <= ?
           ORDER BY created_at ASC, id ASC
           LIMIT ?`,
        )
        .all(now, this.maxClaimRows) as QueuedDmRow[];

      const groups = groupDigestRows(dueRows, this.maxDigestItems);
      const claim = this.store.stmt(
        "UPDATE notification_queue SET status = 'sending' WHERE id = ?",
      );
      for (const group of groups) {
        for (const row of group.rows) claim.run(row.id);
      }
      return groups;
    });
  }

  private markSent(rows: readonly QueuedDmRow[], sentAt: number): void {
    this.store.transaction(() => {
      const stmt = this.store.stmt(
        `UPDATE notification_queue
         SET status = 'sent', attempts = attempts + 1, sent_at = ?, last_error = NULL
         WHERE id = ?`,
      );
      for (const row of rows) stmt.run(sentAt, row.id);
    });
  }

  private markDropped(rows: readonly QueuedDmRow[], reason: string): void {
    this.store.transaction(() => {
      const stmt = this.store.stmt(
        `UPDATE notification_queue
         SET status = 'dropped', last_error = ?
         WHERE id = ?`,
      );
      for (const row of rows) stmt.run(reason, row.id);
    });
  }

  private markFailed(rows: readonly QueuedDmRow[], error: string): void {
    this.store.transaction(() => {
      const stmt = this.store.stmt(
        `UPDATE notification_queue
         SET status = 'failed', attempts = attempts + 1, last_error = ?
         WHERE id = ?`,
      );
      for (const row of rows) stmt.run(error, row.id);
    });
  }

  private scheduleRetryOrFail(
    rows: readonly QueuedDmRow[],
    result: Extract<DmSendResult, { ok: false }>,
  ): { retried: number; failed: number } {
    const now = this.clock.now();
    const errText = result.message ?? result.reason;
    let retried = 0;
    let failed = 0;

    this.store.transaction(() => {
      const retryStmt = this.store.stmt(
        `UPDATE notification_queue
         SET status = 'pending', attempts = ?, next_attempt_at = ?, last_error = ?
         WHERE id = ?`,
      );
      const failStmt = this.store.stmt(
        `UPDATE notification_queue
         SET status = 'failed', attempts = ?, last_error = ?
         WHERE id = ?`,
      );

      for (const row of rows) {
        const nextAttempt = row.attempts + 1;
        if (nextAttempt >= this.maxAttempts) {
          failStmt.run(nextAttempt, errText, row.id);
          failed += 1;
        } else {
          const delay = computeRetryBackoffMs(nextAttempt, {
            baseDelayMs: this.baseBackoffMs,
            maxDelayMs: this.maxBackoffMs,
            ...(result.retryAfterMs === undefined ? {} : { retryAfterMs: result.retryAfterMs }),
          });
          retryStmt.run(nextAttempt, now + delay, errText, row.id);
          retried += 1;
        }
      }
    });

    return { retried, failed };
  }

  private handleClosedDms(userId: string, guildId: string, rows: readonly QueuedDmRow[]): number {
    this.logger.info(
      { userId, guildId, dropped: rows.length },
      'user has closed DMs; disabling DM notifications and writing inbox note',
    );
    return this.store.transaction(() => {
      const dropRow = this.store.stmt(
        `UPDATE notification_queue
         SET status = 'dropped', attempts = attempts + 1, last_error = 'dm_closed'
         WHERE id = ?`,
      );
      for (const row of rows) dropRow.run(row.id);

      const extra = this.store
        .stmt(
          `UPDATE notification_queue
           SET status = 'dropped', last_error = 'dm_closed'
           WHERE user_id = ? AND status = 'pending'`,
        )
        .run(userId);

      this.configService.disableAllUserDms(userId);
      this.inboxWriter.writeDmDisabledNote(userId, guildId);
      return extra.changes;
    });
  }
}
