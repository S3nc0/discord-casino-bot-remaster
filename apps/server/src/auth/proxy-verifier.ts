import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { Value } from 'typebox/value';
import {
  PROXY_MAX_SKEW_SECONDS,
  ProxyPayload,
  type ProxySignatureVerifier,
  type ProxySignedRequest,
  type ProxyVerifyResult,
} from '@casino/shared';

// DER prefix of an Ed25519 SubjectPublicKeyInfo; the 32 raw key bytes follow.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const MAX_PAYLOAD_HEADER_LENGTH = 4096;
const BASE64 = /^[A-Za-z0-9+/_-]+={0,2}$/;
const HEX = /^[0-9a-fA-F]+$/;

function decodeSignature(signature: string): Buffer | null {
  if (signature.length === 128 && HEX.test(signature)) return Buffer.from(signature, 'hex');
  if (signature.length === 88 && BASE64.test(signature)) {
    const bytes = Buffer.from(signature, 'base64');
    if (bytes.length === 64) return bytes;
  }
  return null;
}

/**
 * Implements the shared `ProxySignatureVerifier` with `node:crypto` Ed25519 and the
 * application public key (`DISCORD_PUBLIC_KEY`, 64 hex chars). Checks run in the contract's
 * order and stop at the first failure.
 */
export function createProxySignatureVerifier(publicKeyHex: string): ProxySignatureVerifier {
  if (!/^[0-9a-fA-F]{64}$/.test(publicKeyHex)) throw new Error('public key must be 64 hex chars');
  const key: KeyObject = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, 'hex')]),
    format: 'der',
    type: 'spki',
  });

  const fail = (
    reason: Extract<ProxyVerifyResult, { ok: false }>['reason'],
  ): ProxyVerifyResult => ({
    ok: false,
    reason,
  });

  return {
    verify(request: ProxySignedRequest, nowSeconds: number): ProxyVerifyResult {
      const { signature, timestamp, payload } = request;
      if (!signature || !timestamp || !payload) return fail('missing_headers');

      if (payload.length > MAX_PAYLOAD_HEADER_LENGTH || !BASE64.test(payload))
        return fail('bad_payload');
      const payloadBytes = Buffer.from(payload, 'base64');
      let parsed: unknown;
      try {
        parsed = JSON.parse(payloadBytes.toString('utf8'));
      } catch {
        return fail('bad_payload');
      }
      if (!Value.Check(ProxyPayload, parsed)) return fail('bad_payload');

      if (String(parsed.created_at) !== timestamp) return fail('timestamp_mismatch');
      if (parsed.created_at > nowSeconds + PROXY_MAX_SKEW_SECONDS) return fail('not_yet_valid');
      if (parsed.expires_at <= nowSeconds) return fail('expired');

      const signatureBytes = decodeSignature(signature);
      if (!signatureBytes) return fail('bad_signature');
      let valid: boolean;
      try {
        valid = verify(null, payloadBytes, key, signatureBytes);
      } catch {
        valid = false;
      }
      return valid ? { ok: true, payload: parsed } : fail('bad_signature');
    },
  };
}
