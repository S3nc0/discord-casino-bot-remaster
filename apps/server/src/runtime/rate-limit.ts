import type { Clock } from '@casino/shared';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

/** Most distinct keys one limiter remembers (a few hundred bytes each: well inside the heap). */
export const DEFAULT_MAX_KEYS = 10_000;

/**
 * Fixed-window counter per key. Cheap and predictable; windows of different keys do not
 * interact. Call `sweep` now and then (or `start`) so idle keys are forgotten.
 */
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly clock: Clock;
  private readonly maxKeys: number;
  private timer: NodeJS.Timeout | undefined;

  constructor(options: { limit: number; windowMs: number; clock: Clock; maxKeys?: number }) {
    this.maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.clock = options.clock;
  }

  hit(key: string): RateLimitResult {
    const now = this.clock.now();
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + this.windowMs };
      if (!this.windows.has(key)) this.makeRoom();
      this.windows.set(key, window);
    }
    window.count += 1;
    if (window.count > this.limit) return { allowed: false, retryAfterMs: window.resetAt - now };
    return { allowed: true, retryAfterMs: 0 };
  }

  /**
   * Keys come from clients (an address, a forged header), so the map is bounded: at the limit
   * the expired keys go first, then the oldest live ones.
   */
  private makeRoom(): void {
    if (this.windows.size < this.maxKeys) return;
    this.sweep();
    for (const key of this.windows.keys()) {
      if (this.windows.size < this.maxKeys) break;
      this.windows.delete(key);
    }
  }

  forget(key: string): void {
    this.windows.delete(key);
  }

  sweep(): void {
    const now = this.clock.now();
    for (const [key, window] of this.windows) if (window.resetAt <= now) this.windows.delete(key);
  }

  get size(): number {
    return this.windows.size;
  }

  /** Sweep on an interval that never keeps the process alive. */
  start(): this {
    this.timer ??= setInterval(() => this.sweep(), Math.max(this.windowMs, 1000)).unref();
    return this;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
