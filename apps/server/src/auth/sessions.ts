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
  | { ok: true; claims: SessionClaims }
  | { ok: false; reason: 'invalid' | 'expired' | 'revoked' | 'guild_denied' };

/** Issues and verifies our own session tokens; remembers revoked token ids until they expire. */
export class SessionService {
  private readonly secret: string;
  private readonly clock: Clock;
  private readonly ttlSeconds: number;
  /** jti → exp (seconds). Entries are dropped once the token could not verify anyway. */
  private readonly revoked = new Map<string, number>();
  private readonly revokeListeners = new Set<(jti: string) => void>();
  private readonly guildRevokeListeners = new Set<(guildId: string) => void>();
  private readonly isGuildDenied: (guildId: string) => boolean;

  constructor(options: {
    secret: string;
    clock: Clock;
    ttlSeconds?: number;
    /**
     * Whether the owner denied this guild (`guilds.status = 'denied'`, persisted). Asked on every
     * `verify`, so a revoked guild loses its sessions at once and keeps losing them after a restart.
     */
    isGuildDenied?: (guildId: string) => boolean;
  }) {
    this.isGuildDenied = options.isGuildDenied ?? (() => false);
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
    if (this.guildDenied(result.claims.gid)) return { ok: false, reason: 'guild_denied' };
    return { ok: true, claims: result.claims };
  }

  /** True while the owner has denied this guild. */
  guildDenied(guildId: string): boolean {
    return this.isGuildDenied(guildId);
  }

  /**
   * The bot calls this after it marks a guild `denied` (`/admin server-revoke`): every live socket
   * of the guild is dropped now. HTTP and new handshakes are refused by `verify` from then on, as
   * the denied status itself is what they read.
   */
  revokeGuild(guildId: string): void {
    for (const listener of this.guildRevokeListeners) listener(guildId);
  }

  onRevokeGuild(listener: (guildId: string) => void): () => void {
    this.guildRevokeListeners.add(listener);
    return () => {
      this.guildRevokeListeners.delete(listener);
    };
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
