import type { Clock } from '@casino/shared';
import { SESSION_COOLDOWN_MS } from '@casino/domain/casino';
import { AppError } from '../../runtime/errors.ts';

/**
 * One casino round per player at a time, then a short cooldown. A shared table may hold
 * several of one player's bets in the same round: they share an `owner` and are counted.
 */
export class SessionGuard {
  private readonly active = new Map<string, { owner: string; count: number }>();
  private readonly lastEnd = new Map<string, number>();
  private readonly clock: Clock;

  constructor(clock: Clock) {
    this.clock = clock;
  }

  private key(guildId: string, userId: string): string {
    return `${guildId}:${userId}`;
  }

  acquire(guildId: string, userId: string, owner: string): void {
    const key = this.key(guildId, userId);
    const held = this.active.get(key);
    if (held) {
      if (held.owner !== owner) throw new AppError('game_busy');
      held.count += 1;
      return;
    }
    const wait = SESSION_COOLDOWN_MS - (this.clock.now() - (this.lastEnd.get(key) ?? -Infinity));
    if (wait > 0) throw new AppError('game_busy', { retryAfterMs: Math.ceil(wait) });
    this.active.set(key, { owner, count: 1 });
  }

  /** `cooldown: false` for a round that never started (the bet was refused). */
  release(
    guildId: string,
    userId: string,
    owner: string,
    options: { cooldown?: boolean } = {},
  ): void {
    const key = this.key(guildId, userId);
    const held = this.active.get(key);
    if (!held || held.owner !== owner) return;
    held.count -= 1;
    if (held.count > 0) return;
    this.active.delete(key);
    if (options.cooldown === false) return;
    this.lastEnd.set(key, this.clock.now());
    if (this.lastEnd.size > 1000) {
      const now = this.clock.now();
      for (const [k, at] of this.lastEnd)
        if (now - at > SESSION_COOLDOWN_MS) this.lastEnd.delete(k);
    }
  }

  isBusy(guildId: string, userId: string): boolean {
    return this.active.has(this.key(guildId, userId));
  }

  /** Forget everything (tests, shutdown). */
  clear(): void {
    this.active.clear();
    this.lastEnd.clear();
  }
}
