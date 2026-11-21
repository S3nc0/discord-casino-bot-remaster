import { Type, type Static } from 'typebox';

/**
 * Discord Activity proxy authentication. Every request that reaches the server through the
 * Discord proxy (HTTP calls under `/api` and the Socket.io WebSocket upgrade) carries:
 */
export const PROXY_HEADERS = {
  signature: 'x-signature-ed25519',
  timestamp: 'x-signature-timestamp',
  payload: 'x-discord-proxy-payload',
} as const;

/** Allowed clock skew when checking `created_at` against the server clock. */
export const PROXY_MAX_SKEW_SECONDS = 60;

/**
 * Decoded `x-discord-proxy-payload` (base64 → UTF-8 JSON). Discord documents `created_at`
 * and `expires_at` (Unix seconds); other user-context fields may be present and are ignored.
 */
export const ProxyPayload = Type.Object({
  created_at: Type.Integer({ minimum: 0 }),
  expires_at: Type.Integer({ minimum: 0 }),
});
export type ProxyPayload = Static<typeof ProxyPayload>;

export type ProxyRejection =
  | 'missing_headers'
  | 'bad_payload'
  | 'timestamp_mismatch'
  | 'not_yet_valid'
  | 'expired'
  | 'bad_signature';

export type ProxyVerifyResult =
  { ok: true; payload: ProxyPayload } | { ok: false; reason: ProxyRejection };

/** Header values as received (lower-case names, see PROXY_HEADERS). */
export interface ProxySignedRequest {
  signature: string | undefined;
  timestamp: string | undefined;
  payload: string | undefined;
}

/**
 * Verifier contract (implemented on the server with `node:crypto` Ed25519 and
 * DISCORD_PUBLIC_KEY). In order, reject with:
 * 1. `missing_headers` if any header is absent;
 * 2. `bad_payload` if the payload is not base64 JSON matching `ProxyPayload`;
 * 3. `timestamp_mismatch` if `String(created_at) !== timestamp`;
 * 4. `not_yet_valid` if `created_at > now + PROXY_MAX_SKEW_SECONDS`;
 * 5. `expired` if `expires_at <= now`;
 * 6. `bad_signature` unless the Ed25519 signature over the decoded payload bytes verifies with
 *    the application public key. The signature is accepted hex-encoded (128 chars) or
 *    base64-encoded (88 chars); the length tells them apart.
 */
export interface ProxySignatureVerifier {
  verify(request: ProxySignedRequest, nowSeconds: number): ProxyVerifyResult;
}
