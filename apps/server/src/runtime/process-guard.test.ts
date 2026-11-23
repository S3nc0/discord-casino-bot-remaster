import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import { installProcessGuards, type GuardedProcess } from './process-guard.ts';

describe('process guards', () => {
  it('R-3: logs unhandled rejections and uncaught exceptions instead of letting them end the process', () => {
    const fake = new EventEmitter();
    const error = vi.fn();
    const off = installProcessGuards({ error } as unknown as Logger, fake as GuardedProcess);
    expect(fake.listenerCount('unhandledRejection')).toBe(1);
    expect(fake.listenerCount('uncaughtException')).toBe(1);

    fake.emit('unhandledRejection', new TypeError('ack is not a function'));
    fake.emit('uncaughtException', new Error('boom'));
    expect(error).toHaveBeenCalledTimes(2);
    expect(error.mock.calls[0]?.[1]).toBe('unhandled rejection');
    expect(error.mock.calls[1]?.[1]).toBe('uncaught exception');

    off();
    expect(fake.listenerCount('unhandledRejection')).toBe(0);
    expect(fake.listenerCount('uncaughtException')).toBe(0);
  });
});
