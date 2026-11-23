import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { clientIpOf } from './client-ip.ts';

const request = (forwarded: string | undefined, peer = '127.0.0.1'): IncomingMessage =>
  ({
    socket: { remoteAddress: peer },
    headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded },
  }) as unknown as IncomingMessage;

describe('clientIpOf', () => {
  it('ignores X-Forwarded-For unless a proxy is trusted', () => {
    expect(clientIpOf(request('9.9.9.9'), false)).toBe('127.0.0.1');
    expect(clientIpOf(request('9.9.9.9'), 0)).toBe('127.0.0.1');
  });

  it('R-11: with one trusted hop a forged leading entry changes nothing', () => {
    expect(clientIpOf(request('6.6.6.6, 7.7.7.7'), 1)).toBe('7.7.7.7');
    expect(clientIpOf(request('7.7.7.7'), 1)).toBe('7.7.7.7');
    expect(clientIpOf(request(undefined), 1)).toBe('127.0.0.1');
  });

  it('true trusts the whole chain, two hops skip one more entry', () => {
    expect(clientIpOf(request('6.6.6.6, 7.7.7.7'), true)).toBe('6.6.6.6');
    expect(clientIpOf(request('5.5.5.5, 6.6.6.6, 7.7.7.7'), 2)).toBe('6.6.6.6');
  });
});
