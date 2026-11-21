import { describe, expect, it, vi } from 'vitest';
import type { DomainEvent } from '@casino/shared';
import { EventBus } from './bus.ts';
import { RateLimiter } from './rate-limit.ts';
import { manualClock } from '@casino/shared';

const event: DomainEvent = {
  type: 'DailyReady',
  guildId: '234567890123456789',
  at: 1,
  userId: '123456789012345678',
} as DomainEvent;

describe('EventBus', () => {
  it('delivers by type and to wildcard subscribers, and unsubscribes', () => {
    const bus = new EventBus();
    const typed = vi.fn();
    const any = vi.fn();
    const other = vi.fn();
    const off = bus.onDomain('DailyReady', typed);
    bus.onAnyDomain(any);
    bus.onDomain('BigWin', other);
    bus.publishDomain(event);
    expect(typed).toHaveBeenCalledWith(event);
    expect(any).toHaveBeenCalledWith(event);
    expect(other).not.toHaveBeenCalled();
    off();
    bus.publishDomain(event);
    expect(typed).toHaveBeenCalledTimes(1);
    expect(any).toHaveBeenCalledTimes(2);
  });

  it('isolates a throwing subscriber', () => {
    const errors: unknown[] = [];
    const bus = new EventBus((e) => errors.push(e));
    const after = vi.fn();
    bus.onAnyDomain(() => {
      throw new Error('subscriber bug');
    });
    bus.onAnyDomain(after);
    expect(() => bus.publishDomain(event)).not.toThrow();
    expect(after).toHaveBeenCalled();
    expect(errors).toHaveLength(1);
  });
});

describe('RateLimiter', () => {
  it('allows up to the limit per window, per key, then resets', () => {
    const clock = manualClock(1000);
    const limiter = new RateLimiter({ limit: 2, windowMs: 1000, clock });
    expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.hit('a').allowed).toBe(true);
    const blocked = limiter.hit('a');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(1000);
    expect(limiter.hit('b').allowed).toBe(true);
    clock.advance(1000);
    expect(limiter.hit('a').allowed).toBe(true);
    limiter.sweep();
    expect(limiter.size).toBe(1); // b's window ended at 2000, a's new one runs to 3000
    clock.advance(1000);
    limiter.sweep();
    expect(limiter.size).toBe(0);
  });
});
