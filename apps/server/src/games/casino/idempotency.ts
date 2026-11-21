import { createHash } from 'node:crypto';
import type { Clock } from '@casino/shared';
import type { Store } from '../../db/store.ts';
import { AppError } from '../../runtime/errors.ts';

const TTL_MS = 24 * 60 * 60 * 1000;

interface KeyRow {
  request_hash: string;
  status: 'pending' | 'done';
  response: string | null;
}

export const hashRequest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

/**
 * First response per (guild, user, key), stored in the same transaction as the money change.
 * A repeat returns the stored response; the same key with a different body is `conflict`.
 */
export class IdempotencyStore {
  private readonly store: Store;
  private readonly clock: Clock;

  constructor(store: Store, clock: Clock) {
    this.store = store;
    this.clock = clock;
  }

  /**
   * Run `fn` once per key. `fn` runs inside the transaction that records the key, so a
   * failure (insufficient funds, a rule) leaves no key behind and the client can retry.
   */
  run<T>(
    who: { guildId: string; userId: string },
    key: string | undefined,
    scope: string,
    request: unknown,
    fn: () => T,
  ): { response: T; replayed: boolean } {
    if (key === undefined) return { response: this.store.transaction(fn), replayed: false };
    const hash = hashRequest({ scope, request });
    return this.store.transaction(() => {
      const row = this.store
        .stmt(
          'SELECT request_hash, status, response FROM idempotency_keys WHERE guild_id = ? AND user_id = ? AND key = ?',
        )
        .get(who.guildId, who.userId, key) as KeyRow | undefined;
      if (row) {
        if (row.request_hash !== hash) throw new AppError('conflict');
        if (row.status !== 'done' || row.response === null) throw new AppError('in_flight');
        return { response: JSON.parse(row.response) as T, replayed: true };
      }
      const now = this.clock.now();
      this.store
        .stmt(
          `INSERT INTO idempotency_keys
             (guild_id, user_id, key, scope, request_hash, status, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
        )
        .run(who.guildId, who.userId, key, scope, hash, now, now + TTL_MS);
      const response = fn();
      this.store
        .stmt(
          `UPDATE idempotency_keys SET status = 'done', response = ?
           WHERE guild_id = ? AND user_id = ? AND key = ?`,
        )
        .run(JSON.stringify(response ?? null), who.guildId, who.userId, key);
      return { response, replayed: false };
    });
  }

  /** Drop expired keys. */
  purge(): number {
    return Number(
      this.store.stmt('DELETE FROM idempotency_keys WHERE expires_at <= ?').run(this.clock.now())
        .changes,
    );
  }
}
