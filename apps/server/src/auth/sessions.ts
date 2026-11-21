import { randomBytes } from 'node:crypto';
import type { Clock, SessionClaims } from '@casino/shared';
import { SESSION_TTL_SECONDS } from '@casino/shared';
import type { Locale } from '@casino/shared/i18n';
import { signSessionToken, verifySessionToken } from './session-token.ts';

export interface IssuedSession {
  token: string;
  claims: SessionClaims;
  /** `exp` in epoch ms. */
  expiresAt: number;
}

export type SessionCheck =
  { ok: true; claims: SessionClaims } | { ok: false; reason: 'invalid' | 'expired' | 'revoked' };

/** Issues and verifies our own session tokens; remembers revoked token ids until they expire. */
export class SessionService {
  private readonly secret: string;
  private readonly clock: Clock;
  private readonly ttlSeconds: number;
  /** jti → exp (seconds). Entries are dropped once the token could not verify anyway. */
  private readonly revoked = new Map<string, number>();
  private readonly revokeListeners = new Set<(jti: string) => void>();

  constructor(options: { secret: string; clock: Clock; ttlSeconds?: number }) {
    this.secret = options.secret;
    this.clock = options.clock;
    this.ttlSeconds = options.ttlSeconds ?? SESSION_TTL_SECONDS;
  }

  issue(input: {
    userId: string;
    guildId: string;
    instanceId: string;
    locale: Locale;
  }): IssuedSession {
    const iat = Math.floor(this.clock.now() / 1000);
    const claims: SessionClaims = {
      v: 1,
      sub: input.userId,
      gid: input.guildId,
      iid: input.instanceId,
      loc: input.locale,
      iat,
      exp: iat + this.ttlSeconds,
      jti: randomBytes(16).toString('base64url'),
    };
    return {
      token: signSessionToken(claims, this.secret),
      claims,
      expiresAt: claims.exp * 1000,
    };
  }

  verify(token: string): SessionCheck {
    const nowSeconds = Math.floor(this.clock.now() / 1000);
    const result = verifySessionToken(token, this.secret, nowSeconds);
    if (!result.ok)
      return { ok: false, reason: result.reason === 'expired' ? 'expired' : 'invalid' };
    if (this.isRevoked(result.claims.jti)) return { ok: false, reason: 'revoked' };
    return { ok: true, claims: result.claims };
  }

  /** Revoke one session. Live sockets of that session are told through `onRevoke`. */
  revoke(claims: Pick<SessionClaims, 'jti' | 'exp'>): void {
    this.sweepRevoked();
    this.revoked.set(claims.jti, claims.exp);
    for (const listener of this.revokeListeners) listener(claims.jti);
  }

  isRevoked(jti: string): boolean {
    return this.revoked.has(jti);
  }

  onRevoke(listener: (jti: string) => void): () => void {
    this.revokeListeners.add(listener);
    return () => {
      this.revokeListeners.delete(listener);
    };
  }

  private sweepRevoked(): void {
    const nowSeconds = Math.floor(this.clock.now() / 1000);
    for (const [jti, exp] of this.revoked) if (exp <= nowSeconds) this.revoked.delete(jti);
  }
}
