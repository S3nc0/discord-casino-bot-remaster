import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { manualClock, type SessionClaims } from '@casino/shared';
import { USER, GUILD, INSTANCE, START_MS } from '../runtime/test-kit.ts';
import { signSessionToken, verifySessionToken } from './session-token.ts';
import { SessionService } from './sessions.ts';

const SECRET = 's'.repeat(40);
const NOW = Math.floor(START_MS / 1000);
const claims: SessionClaims = {
  v: 1,
  sub: USER,
  gid: GUILD,
  iid: INSTANCE,
  loc: 'en',
  iat: NOW,
  exp: NOW + 3600,
  jti: 'abcdefghijkl',
};
const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('session token', () => {
  it('round-trips valid claims', () => {
    const result = verifySessionToken(signSessionToken(claims, SECRET), SECRET, NOW + 10);
    expect(result).toEqual({ ok: true, claims });
  });

  it('rejects a wrong secret, a tampered payload and garbage', () => {
    const token = signSessionToken(claims, SECRET);
    expect(verifySessionToken(token, 'other'.repeat(10), NOW)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    const [h, , s] = token.split('.') as [string, string, string];
    const forged = `${h}.${b64({ ...claims, sub: '999999999999999999' })}.${s}`;
    expect(verifySessionToken(forged, SECRET, NOW)).toEqual({ ok: false, reason: 'bad_signature' });
    for (const junk of ['', 'a.b', 'a.b.c.d', 'x'.repeat(5000)]) {
      expect(verifySessionToken(junk, SECRET, NOW).ok).toBe(false);
    }
  });

  it('only accepts the exact HS256 header (no alg=none, no other algorithms)', () => {
    const payload = b64(claims);
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${payload}.`;
    expect(verifySessionToken(none, SECRET, NOW).ok).toBe(false);
    const h512Header = b64({ alg: 'HS512', typ: 'JWT' });
    const sig = createHmac('sha512', SECRET).update(`${h512Header}.${payload}`).digest('base64url');
    expect(verifySessionToken(`${h512Header}.${payload}.${sig}`, SECRET, NOW).ok).toBe(false);
  });

  it('enforces exp and iat', () => {
    const token = signSessionToken(claims, SECRET);
    expect(verifySessionToken(token, SECRET, claims.exp - 1).ok).toBe(true);
    expect(verifySessionToken(token, SECRET, claims.exp)).toEqual({ ok: false, reason: 'expired' });
    expect(verifySessionToken(token, SECRET, NOW - 120)).toEqual({
      ok: false,
      reason: 'not_yet_valid',
    });
  });

  it('rejects correctly signed tokens whose claims break the schema', () => {
    const bad = signSessionToken({ ...claims, sub: 'nope' } as SessionClaims, SECRET);
    expect(verifySessionToken(bad, SECRET, NOW)).toEqual({ ok: false, reason: 'bad_claims' });
  });
});

describe('SessionService', () => {
  const make = () => {
    const clock = manualClock(START_MS);
    return { clock, sessions: new SessionService({ secret: SECRET, clock, ttlSeconds: 60 }) };
  };

  it('issues one-hour tokens by default and unique jti per session', () => {
    const clock = manualClock(START_MS);
    const sessions = new SessionService({ secret: SECRET, clock });
    const a = sessions.issue({ userId: USER, guildId: GUILD, instanceId: INSTANCE, locale: 'ja' });
    const b = sessions.issue({ userId: USER, guildId: GUILD, instanceId: INSTANCE, locale: 'ja' });
    expect(a.claims.exp - a.claims.iat).toBe(3600);
    expect(a.expiresAt).toBe(a.claims.exp * 1000);
    expect(a.claims.jti).not.toBe(b.claims.jti);
    expect(a.claims.loc).toBe('ja');
  });

  it('verifies, expires and revokes', () => {
    const { clock, sessions } = make();
    const issued = sessions.issue({
      userId: USER,
      guildId: GUILD,
      instanceId: INSTANCE,
      locale: 'en',
    });
    expect(sessions.verify(issued.token).ok).toBe(true);
    const seen: string[] = [];
    sessions.onRevoke((jti) => seen.push(jti));
    sessions.revoke(issued.claims);
    expect(sessions.verify(issued.token)).toEqual({ ok: false, reason: 'revoked' });
    expect(seen).toEqual([issued.claims.jti]);

    const other = sessions.issue({
      userId: USER,
      guildId: GUILD,
      instanceId: INSTANCE,
      locale: 'en',
    });
    clock.advance(61_000);
    expect(sessions.verify(other.token)).toEqual({ ok: false, reason: 'expired' });
    expect(sessions.verify('junk')).toEqual({ ok: false, reason: 'invalid' });
  });
});
