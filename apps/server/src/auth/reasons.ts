import type { ProxyRejection } from '@casino/shared';
import { AppError } from '../runtime/errors.ts';

/**
 * Stable reason codes for every 401/403 on the auth path. One warn log line carries one of
 * these (field `reason`), so an operator can grep the cause without secrets in the log.
 */
export const REASONS = {
  proxySignatureMissing: 'proxy_signature_missing',
  proxySignatureInvalid: 'proxy_signature_invalid',
  proxyPayloadInvalid: 'proxy_payload_invalid',
  timestampSkew: 'timestamp_skew',
  proxyExpired: 'proxy_expired',
  bearerMissing: 'bearer_missing',
  sessionInvalid: 'session_invalid',
  sessionRevoked: 'session_revoked',
  sessionExpired: 'session_expired',
  guildNotAllowed: 'guild_not_allowed',
  guildPending: 'guild_pending',
  guildDenied: 'guild_denied',
  scopeMissing: 'scope_missing',
  userNotInGuild: 'user_not_in_guild',
  instanceMismatch: 'instance_mismatch',
  socketAuthFailed: 'socket_auth_failed',
} as const;

const PROXY_REASONS: Record<ProxyRejection, string> = {
  missing_headers: REASONS.proxySignatureMissing,
  bad_payload: REASONS.proxyPayloadInvalid,
  timestamp_mismatch: REASONS.timestampSkew,
  not_yet_valid: REASONS.timestampSkew,
  expired: REASONS.proxyExpired,
  bad_signature: REASONS.proxySignatureInvalid,
};

export const proxyReason = (rejection: ProxyRejection): string => PROXY_REASONS[rejection];

/** Which of the three proxy headers are absent (names only, never values). */
export function missingProxyHeaders(request: {
  signature: string | undefined;
  timestamp: string | undefined;
  payload: string | undefined;
}): string[] {
  const missing: string[] = [];
  if (!request.signature) missing.push('x-signature-ed25519');
  if (!request.timestamp) missing.push('x-signature-timestamp');
  if (!request.payload) missing.push('x-discord-proxy-payload');
  return missing;
}

/** The step of the Discord round trip that failed, with Discord's HTTP status when it said no. */
export function discordStepReason(step: string, status: number | undefined): string {
  return `${step}_failed:${status ?? 'network'}`;
}

/** Why `SessionService.verify` said no, as the stable reason code. */
export const SESSION_FAILURE_REASON = {
  expired: REASONS.sessionExpired,
  revoked: REASONS.sessionRevoked,
  invalid: REASONS.sessionInvalid,
  guild_denied: REASONS.guildDenied,
} as const;

/** The refusal for a session that did not verify. */
export function sessionError(reason: keyof typeof SESSION_FAILURE_REASON): AppError {
  const options = { reason: SESSION_FAILURE_REASON[reason] };
  if (reason === 'expired') return new AppError('expired', options);
  if (reason === 'guild_denied') return new AppError('guild_not_allowed', options);
  return new AppError('unauthorized', options);
}
