import { createHmac, timingSafeEqual } from 'node:crypto';
import { Value } from 'typebox/value';
import { SessionClaims } from '@casino/shared';

const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
/** Tolerated clock skew for `iat` (seconds). */
const MAX_IAT_SKEW_SECONDS = 60;
const MAX_TOKEN_LENGTH = 2048;

export type SessionVerifyResult =
  | { ok: true; claims: SessionClaims }
  | {
      ok: false;
      reason: 'malformed' | 'bad_signature' | 'bad_claims' | 'expired' | 'not_yet_valid';
    };

function mac(secret: string, signingInput: string): Buffer {
  return createHmac('sha256', secret).update(signingInput).digest();
}

/** Compact HS256 JWS over the claims. */
export function signSessionToken(claims: SessionClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signingInput = `${HEADER}.${payload}`;
  return `${signingInput}.${mac(secret, signingInput).toString('base64url')}`;
}

/** Check shape, signature, claims schema and time window. `nowSeconds` is the server clock. */
export function verifySessionToken(
  token: string,
  secret: string,
  nowSeconds: number,
): SessionVerifyResult {
  if (token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: 'malformed' };
  const parts = token.split('.');
  const [header, payload, signature] = parts;
  if (parts.length !== 3 || !header || !payload || !signature) {
    return { ok: false, reason: 'malformed' };
  }
  // Only the exact header we issue is accepted: no `alg` negotiation, no `none`.
  if (header !== HEADER) return { ok: false, reason: 'malformed' };

  const expected = mac(secret, `${header}.${payload}`);
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'bad_claims' };
  }
  if (!Value.Check(SessionClaims, claims)) return { ok: false, reason: 'bad_claims' };
  if (claims.exp <= nowSeconds) return { ok: false, reason: 'expired' };
  if (claims.iat > nowSeconds + MAX_IAT_SKEW_SECONDS) return { ok: false, reason: 'not_yet_valid' };
  return { ok: true, claims };
}
