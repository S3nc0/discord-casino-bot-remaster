import {
  LAUNCH_INTENT_TTL_MS,
  type Clock,
  type LaunchIntent,
  type LaunchIntentService,
  type ScreenId,
} from '@casino/shared';
import type { Store } from '../db/store.ts';

/**
 * SQLite-backed `LaunchIntentService`. In-process only: the bot calls `create`, and the
 * authenticated session of the same user and guild calls `consume` (once).
 */
export class SqliteLaunchIntentService implements LaunchIntentService {
  private readonly store: Store;
  private readonly clock: Clock;

  constructor(store: Store, clock: Clock) {
    this.store = store;
    this.clock = clock;
  }

  create(input: { userId: string; guildId: string; screen: ScreenId }): LaunchIntent {
    const now = this.clock.now();
    const expires = now + LAUNCH_INTENT_TTL_MS;
    // A newer intent for the same (guild, user) replaces the old one and clears `consumed_at`.
    this.store
      .stmt(
        `INSERT INTO launch_intents (guild_id, user_id, screen, created_at, expires_at, consumed_at)
         VALUES (?, ?, ?, ?, ?, NULL)
         ON CONFLICT (guild_id, user_id) DO UPDATE SET
           screen = excluded.screen, created_at = excluded.created_at,
           expires_at = excluded.expires_at, consumed_at = NULL`,
      )
      .run(input.guildId, input.userId, input.screen, now, expires);
    return { userId: input.userId, guildId: input.guildId, screen: input.screen, expires };
  }

  consume(userId: string, guildId: string): LaunchIntent | null {
    const now = this.clock.now();
    // One statement: only an unconsumed, unexpired row of exactly this user and guild matches,
    // and marking it consumed is the same step as reading it.
    const row = this.store
      .stmt(
        `UPDATE launch_intents SET consumed_at = ?
         WHERE guild_id = ? AND user_id = ? AND consumed_at IS NULL AND expires_at > ?
         RETURNING screen, expires_at`,
      )
      .get(now, guildId, userId, now) as { screen: ScreenId; expires_at: number } | undefined;
    return row ? { userId, guildId, screen: row.screen, expires: row.expires_at } : null;
  }

  /** Delete expired and consumed rows. Returns how many were removed. */
  purge(): number {
    const now = this.clock.now();
    return this.store
      .stmt('DELETE FROM launch_intents WHERE expires_at <= ? OR consumed_at IS NOT NULL')
      .run(now).changes;
  }
}
