import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PROXY_MAX_SKEW_SECONDS, type ProxySignedRequest } from '@casino/shared';
import { makeProxyKeys } from '../runtime/test-kit.ts';
import { createProxySignatureVerifier } from './proxy-verifier.ts';

const NOW = 1_800_000_000;

function setup() {
  const keys = makeProxyKeys();
  const verifier = createProxySignatureVerifier(keys.publicKeyHex);
  const request = (h: Record<string, string>): ProxySignedRequest => ({
    signature: h['x-signature-ed25519'],
    timestamp: h['x-signature-timestamp'],
    payload: h['x-discord-proxy-payload'],
  });
  const signed = (
    payload: unknown,
    timestamp: string,
    key = keys.privateKey,
  ): ProxySignedRequest => {
    const bytes = Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload));
    return {
      signature: sign(null, bytes, key).toString('hex'),
      timestamp,
      payload: bytes.toString('base64'),
    };
  };
  return { keys, verifier, request, signed };
}

describe('proxy signature verifier', () => {
  it('accepts a genuine request (hex and base64 signatures)', () => {
    const { keys, verifier, request } = setup();
    const headers = keys.headers(NOW);
    const result = verifier.verify(request(headers), NOW);
    expect(result).toMatchObject({ ok: true, payload: { created_at: NOW, expires_at: NOW + 300 } });

    const payload = Buffer.from(headers['x-discord-proxy-payload'] ?? '', 'base64');
    const b64sig = sign(null, payload, keys.privateKey).toString('base64');
    expect(b64sig).toHaveLength(88);
    expect(verifier.verify({ ...request(headers), signature: b64sig }, NOW).ok).toBe(true);
  });

  it('rejects, in order: missing headers', () => {
    const { keys, verifier, request } = setup();
    const h = keys.headers(NOW);
    for (const drop of [
      'x-signature-ed25519',
      'x-signature-timestamp',
      'x-discord-proxy-payload',
    ]) {
      const { [drop]: _removed, ...rest } = h;
      expect(verifier.verify(request(rest), NOW)).toEqual({ ok: false, reason: 'missing_headers' });
    }
  });

  it('rejects a payload that is not ProxyPayload JSON', () => {
    const { verifier, signed } = setup();
    for (const payload of [
      'not json',
      { created_at: 'x', expires_at: 1 },
      { created_at: NOW },
      '[1]',
    ]) {
      expect(verifier.verify(signed(payload, String(NOW)), NOW)).toEqual({
        ok: false,
        reason: 'bad_payload',
      });
    }
    expect(
      verifier.verify(
        { signature: 'a'.repeat(128), timestamp: String(NOW), payload: '!!not base64!!' },
        NOW,
      ),
    ).toEqual({ ok: false, reason: 'bad_payload' });
  });

  it('rejects a timestamp header that differs from created_at', () => {
    const { verifier, signed } = setup();
    const req = signed({ created_at: NOW, expires_at: NOW + 60 }, String(NOW + 1));
    expect(verifier.verify(req, NOW)).toEqual({ ok: false, reason: 'timestamp_mismatch' });
  });

  it('enforces the timestamp window', () => {
    const { verifier, signed } = setup();
    const future = NOW + PROXY_MAX_SKEW_SECONDS + 1;
    expect(
      verifier.verify(signed({ created_at: future, expires_at: future + 60 }, String(future)), NOW),
    ).toEqual({ ok: false, reason: 'not_yet_valid' });
    const edge = NOW + PROXY_MAX_SKEW_SECONDS;
    expect(
      verifier.verify(signed({ created_at: edge, expires_at: edge + 60 }, String(edge)), NOW).ok,
    ).toBe(true);
    expect(
      verifier.verify(signed({ created_at: NOW - 100, expires_at: NOW }, String(NOW - 100)), NOW),
    ).toEqual({ ok: false, reason: 'expired' });
    expect(
      verifier.verify(
        signed({ created_at: NOW - 100, expires_at: NOW + 1 }, String(NOW - 100)),
        NOW,
      ).ok,
    ).toBe(true);
  });

  it('rejects a signature from another key, a tampered payload and malformed signatures', () => {
    const { verifier, signed, keys, request } = setup();
    const stranger = generateKeyPairSync('ed25519').privateKey;
    expect(
      verifier.verify(
        signed({ created_at: NOW, expires_at: NOW + 60 }, String(NOW), stranger),
        NOW,
      ),
    ).toEqual({ ok: false, reason: 'bad_signature' });

    const good = request(keys.headers(NOW));
    const tampered = Buffer.from(
      JSON.stringify({ created_at: NOW, expires_at: NOW + 999 }),
    ).toString('base64');
    expect(verifier.verify({ ...good, payload: tampered }, NOW)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    for (const signature of ['abc', 'z'.repeat(128), 'A'.repeat(88)]) {
      expect(verifier.verify({ ...good, signature }, NOW)).toEqual({
        ok: false,
        reason: 'bad_signature',
      });
    }
  });

  it('refuses a malformed public key', () => {
    expect(() => createProxySignatureVerifier('abcd')).toThrow();
  });
});
