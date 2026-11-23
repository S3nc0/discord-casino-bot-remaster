import { manualClock } from '@casino/shared';
import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limit.ts';

describe('RateLimiter', () => {
  it('counts per key inside a window and starts over after it', () => {
    const clock = manualClock(0);
    const limiter = new RateLimiter({ limit: 2, windowMs: 1000, clock });
    expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.hit('a')).toEqual({ allowed: false, retryAfterMs: 1000 });
    expect(limiter.hit('b').allowed).toBe(true);
    clock.advance(1000);
    expect(limiter.hit('a').allowed).toBe(true);
  });

  it('R-12: distinct keys cannot grow the map without bound', () => {
    const clock = manualClock(0);
    const limiter = new RateLimiter({ limit: 5, windowMs: 60_000, clock, maxKeys: 100 });
    for (let i = 0; i < 10_000; i++) limiter.hit(`forged-${i}`);
    expect(limiter.size).toBeLessThanOrEqual(100);
  });

  it('R-12: at the bound it drops expired keys first, then the oldest', () => {
    const clock = manualClock(0);
    const limiter = new RateLimiter({ limit: 5, windowMs: 1000, clock, maxKeys: 3 });
    limiter.hit('old');
    clock.advance(500);
    limiter.hit('b');
    limiter.hit('c');
    clock.advance(600); // `old` expired, b and c still live
    limiter.hit('d');
    expect(limiter.size).toBe(3);
    // `old` went, b and c kept their counts
    for (let i = 0; i < 4; i++) limiter.hit('b');
    expect(limiter.hit('b').allowed).toBe(false);
    limiter.hit('e'); // nothing expired: the oldest live key (b) is dropped
    expect(limiter.size).toBe(3);
  });

  it('R-12: has a default bound', () => {
    const limiter = new RateLimiter({ limit: 1, windowMs: 60_000, clock: manualClock(0) });
    for (let i = 0; i < 20_000; i++) limiter.hit(`k${i}`);
    expect(limiter.size).toBeLessThanOrEqual(10_000);
  });
});
