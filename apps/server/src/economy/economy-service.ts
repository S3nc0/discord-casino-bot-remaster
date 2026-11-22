import type { Clock, LedgerReason } from '@casino/shared';
import { isDeltaAllowed, isLedgerReason, LEDGER_REASON_SIGN } from '@casino/shared';
import type { IdentityRepo } from '../db/identity.ts';
import type { Store } from '../db/store.ts';
import type { EventBus } from '../runtime/bus.ts';
import { AppError } from '../runtime/errors.ts';

/** Balance a player gets the first time the server sees them in a guild. */
export const INITIAL_BALANCE = 3000;

const MAX_KEY_LENGTH = 128;
const MAX_REF_LENGTH = 128;
const MAX_META_LENGTH = 4000;

/** One signed balance change for one account (a user in one guild). */
export interface LedgerChange {
  guildId: string;
  userId: string;
  /** Non-zero integer Pelica: positive credits, negative debits. */
  delta: number;
  reason: LedgerReason;
  refType?: string;
  refId?: string;
  /** Same key + same change = the original entry is returned; a different change = `conflict`. */
  idempotencyKey?: string;
  meta?: Record<string, unknown>;
}

export interface LedgerEntry {
  id: number;
  guildId: string;
  userId: string;
  delta: number;
  balanceAfter: number;
  reason: LedgerReason;
  refType: string | null;
  refId: string | null;
  idempotencyKey: string | null;
  createdAt: number;
}

export interface ApplyResult {
  entry: LedgerEntry;
  /** True when the idempotency key had been used before and nothing new was posted. */
  replayed: boolean;
}

export interface EnsureMemberResult {
  /** True when this call created the account (and, unless disabled, granted the start balance). */
  created: boolean;
  balance: number;
}

interface LedgerRow {
  id: number;
  guild_id: string;
  user_id: string;
  delta: number;
  balance_after: number;
  reason: string;
  ref_type: string | null;
  ref_id: string | null;
  idempotency_key: string | null;
  created_at: number;
}

function toEntry(row: LedgerRow): LedgerEntry {
  return {
    id: row.id,
    guildId: row.guild_id,
    userId: row.user_id,
    delta: row.delta,
    balanceAfter: row.balance_after,
    reason: row.reason as LedgerReason,
    refType: row.ref_type,
    refId: row.ref_id,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
  };
}

/**
 * A change whose sign the reason does not allow (a payout that debits, a stake that credits).
 * Code `invalid_payload`, so it surfaces as a client error if user input ever reaches it; in
 * practice it marks a bug in the calling service.
 */
export class LedgerSignError extends AppError {
  readonly reason: LedgerReason;
  readonly delta: number;

  constructor(reason: LedgerReason, delta: number) {
    const required = LEDGER_REASON_SIGN[reason] === 1 ? 'positive' : 'negative';
    super('invalid_payload', { message: `ledger reason ${reason} requires a ${required} delta` });
    this.name = 'LedgerSignError';
    this.reason = reason;
    this.delta = delta;
  }
}

/**
 * The only writer of balances. Every change is one `ledger` row inserted inside a transaction
 * (the database triggers keep `balances` in step and refuse any other write path). Balances are
 * per guild and never go below zero. Events are published after the commit; inside a larger
 * transaction they wait for the outermost commit and vanish on rollback, so callers can
 * combine several changes, game state and an idempotency record in one `store.transaction`.
 */
export class EconomyService {
  private readonly store: Store;
  private readonly identity: IdentityRepo;
  private readonly clock: Clock;
  private readonly bus: EventBus | undefined;

  constructor(options: { store: Store; identity: IdentityRepo; clock: Clock; bus?: EventBus }) {
    this.store = options.store;
    this.identity = options.identity;
    this.clock = options.clock;
    this.bus = options.bus;
  }

  /** Current balance, or 0 for an account that does not exist. */
  getBalance(guildId: string, userId: string): number {
    const row = this.store
      .stmt('SELECT balance FROM balances WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId) as { balance: number } | undefined;
    return row?.balance ?? 0;
  }

  hasAccount(guildId: string, userId: string): boolean {
    return (
      this.store
        .stmt('SELECT 1 FROM guild_members WHERE guild_id = ? AND user_id = ?')
        .get(guildId, userId) !== undefined
    );
  }

  /**
   * Create the account on first sight and grant `INITIAL_BALANCE` (an `initial_grant` ledger
   * row). Safe to call repeatedly. The legacy importer passes `initialGrant: false`.
   */
  ensureMember(
    guildId: string,
    userId: string,
    options: { initialGrant?: boolean } = {},
  ): EnsureMemberResult {
    return this.store.transaction(() => {
      if (this.hasAccount(guildId, userId)) {
        return { created: false, balance: this.getBalance(guildId, userId) };
      }
      this.identity.ensureUser(userId);
      this.identity.ensureGuild(guildId, 'pending');
      this.store
        .stmt('INSERT INTO guild_members (guild_id, user_id, created_at) VALUES (?, ?, ?)')
        .run(guildId, userId, this.clock.now());
      if (options.initialGrant === false) return { created: true, balance: 0 };
      const { entry } = this.post({
        guildId,
        userId,
        delta: INITIAL_BALANCE,
        reason: 'initial_grant',
        idempotencyKey: 'initial_grant',
      });
      return { created: true, balance: entry.balanceAfter };
    });
  }

  /** Post one change. Creates the account (with its start balance) if it does not exist yet. */
  apply(change: LedgerChange): ApplyResult {
    return this.store.transaction(() => {
      this.ensureMember(change.guildId, change.userId);
      return this.post(change);
    });
  }

  /** Post several changes atomically: all of them, or none (and no events). */
  applyAll(changes: readonly LedgerChange[]): ApplyResult[] {
    return this.store.transaction(() => changes.map((change) => this.apply(change)));
  }

  credit(change: Omit<LedgerChange, 'delta'> & { amount: number }): ApplyResult {
    const { amount, ...rest } = change;
    this.assertAmount(amount);
    return this.apply({ ...rest, delta: amount });
  }

  /** Charge the account; throws `insufficient_funds` instead of going below zero. */
  debit(change: Omit<LedgerChange, 'delta'> & { amount: number }): ApplyResult {
    const { amount, ...rest } = change;
    this.assertAmount(amount);
    return this.apply({ ...rest, delta: -amount });
  }

  /** Ledger history of one account, newest first. */
  history(guildId: string, userId: string, limit = 50): LedgerEntry[] {
    const rows = this.store
      .stmt(
        `SELECT id, guild_id, user_id, delta, balance_after, reason, ref_type, ref_id,
                idempotency_key, created_at
         FROM ledger WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?`,
      )
      .all(guildId, userId, Math.max(1, Math.min(limit, 500))) as LedgerRow[];
    return rows.map(toEntry);
  }

  /**
   * One page of an account's history, newest first. `before` is the id of the last row of the
   * previous page; `nextBefore` is the cursor for the next, older page (null at the end).
   */
  historyPage(
    guildId: string,
    userId: string,
    options: { before?: number; limit?: number } = {},
  ): { items: LedgerEntry[]; nextBefore: number | null } {
    const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
    const rows = this.store
      .stmt(
        `SELECT id, guild_id, user_id, delta, balance_after, reason, ref_type, ref_id,
                idempotency_key, created_at
         FROM ledger WHERE guild_id = ? AND user_id = ? AND id < ? ORDER BY id DESC LIMIT ?`,
      )
      .all(guildId, userId, options.before ?? Number.MAX_SAFE_INTEGER, limit + 1) as LedgerRow[];
    const items = rows.slice(0, limit).map(toEntry);
    const last = items[items.length - 1];
    return { items, nextBefore: rows.length > limit && last ? last.id : null };
  }

  private assertAmount(amount: number): void {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new AppError('invalid_payload', { message: 'amount must be a positive integer' });
    }
  }

  // Must run inside a transaction with the account present.
  private post(change: LedgerChange): ApplyResult {
    this.validate(change);
    const { guildId, userId, delta } = change;
    const key = change.idempotencyKey ?? null;

    if (key !== null) {
      const existing = this.store
        .stmt(
          `SELECT id, guild_id, user_id, delta, balance_after, reason, ref_type, ref_id,
                  idempotency_key, created_at
           FROM ledger WHERE guild_id = ? AND user_id = ? AND idempotency_key = ?`,
        )
        .get(guildId, userId, key) as LedgerRow | undefined;
      if (existing) {
        const same =
          existing.delta === delta &&
          existing.reason === change.reason &&
          existing.ref_type === (change.refType ?? null) &&
          existing.ref_id === (change.refId ?? null);
        if (!same) throw new AppError('conflict', { message: 'idempotency key reused' });
        return { entry: toEntry(existing), replayed: true };
      }
    }

    const balance = this.getBalance(guildId, userId);
    const next = balance + delta;
    if (next < 0) throw new AppError('insufficient_funds');
    if (!Number.isSafeInteger(next)) {
      throw new AppError('invalid_payload', { message: 'balance out of range' });
    }

    const createdAt = this.clock.now();
    const result = this.store
      .stmt(
        `INSERT INTO ledger (guild_id, user_id, delta, balance_after, reason, ref_type, ref_id,
                             idempotency_key, meta, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        guildId,
        userId,
        delta,
        next,
        change.reason,
        change.refType ?? null,
        change.refId ?? null,
        key,
        change.meta === undefined ? null : JSON.stringify(change.meta),
        createdAt,
      );
    const entry: LedgerEntry = {
      id: Number(result.lastInsertRowid),
      guildId,
      userId,
      delta,
      balanceAfter: next,
      reason: change.reason,
      refType: change.refType ?? null,
      refId: change.refId ?? null,
      idempotencyKey: key,
      createdAt,
    };

    const bus = this.bus;
    if (bus) {
      this.store.afterCommit(() => {
        bus.publishBalance({
          guildId,
          userId,
          balance: entry.balanceAfter,
          delta,
          reason: entry.reason,
          ledgerId: entry.id,
        });
      });
    }
    return { entry, replayed: false };
  }

  private validate(change: LedgerChange): void {
    const bad = (message: string): never => {
      throw new AppError('invalid_payload', { message });
    };
    if (!Number.isSafeInteger(change.delta) || change.delta === 0)
      bad('delta must be a non-zero integer');
    if (!isLedgerReason(change.reason)) bad('unknown ledger reason');
    if (!isDeltaAllowed(change.reason, change.delta)) {
      throw new LedgerSignError(change.reason, change.delta);
    }
    if (!/^[0-9]{17,20}$/.test(change.guildId) || !/^[0-9]{17,20}$/.test(change.userId)) {
      bad('invalid account id');
    }
    const key = change.idempotencyKey;
    if (key !== undefined && (key.length === 0 || key.length > MAX_KEY_LENGTH))
      bad('bad idempotency key');
    for (const ref of [change.refType, change.refId]) {
      if (ref !== undefined && (ref.length === 0 || ref.length > MAX_REF_LENGTH))
        bad('bad reference');
    }
    if (change.meta !== undefined && JSON.stringify(change.meta).length > MAX_META_LENGTH) {
      bad('meta too large');
    }
  }
}
