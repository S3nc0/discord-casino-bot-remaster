import type { Clock } from '@casino/shared';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

/**
 * Fixed-window counter per key. Cheap and predictable; windows of different keys do not
 * interact. Call `sweep` now and then (or `start`) so idle keys are forgotten.
 */
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly clock: Clock;
  private timer: NodeJS.Timeout | undefined;

  constructor(options: { limit: number; windowMs: number; clock: Clock }) {
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.clock = options.clock;
  }

  hit(key: string): RateLimitResult {
    const now = this.clock.now();
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, window);
    }
    window.count += 1;
    if (window.count > this.limit) return { allowed: false, retryAfterMs: window.resetAt - now };
    return { allowed: true, retryAfterMs: 0 };
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
