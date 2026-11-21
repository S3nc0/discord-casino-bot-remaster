import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, maskSecrets } from './logger.ts';

const SESSION =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ2IjoxLCJzdWIiOiIxMjM0NTY3ODkwMTIzNDU2NzgifQ.c2lnbmF0dXJlc2lnbmF0dXJl';
// Assembled at run time so the source holds no complete token-shaped literal.
const BOT_TOKEN = ['MTA1NDMyMTA5ODc2NTQzMjEwOQ', 'GabcDe', 'abcdefghijklmnopqrstuvwxyz0'].join('.');

function capture(): {
  lines: () => Record<string, unknown>[];
  log: ReturnType<typeof createLogger>;
} {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, done) {
      chunks.push(chunk.toString());
      done();
    },
  });
  const log = createLogger({ level: 'info', stream });
  return {
    log,
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

describe('logger redaction', () => {
  it('redacts the credential paths', () => {
    const { log, lines } = capture();
    log.info(
      {
        req: {
          headers: {
            authorization: `Bearer ${SESSION}`,
            cookie: 'sid=1',
            'x-discord-proxy-payload': 'cGF5bG9hZA==',
            'x-other': 'visible',
          },
        },
        body: {
          code: 'oauth-code',
          accessToken: 'a1',
          access_token: 'a2',
          sessionToken: 's',
          token: 't',
          secret: 'z',
        },
        token: 'top-level',
      },
      'request',
    );
    const out = JSON.stringify(lines());
    for (const leaked of [
      SESSION,
      'sid=1',
      'cGF5bG9hZA==',
      'oauth-code',
      '"a1"',
      '"a2"',
      '"t"',
      '"z"',
      'top-level',
    ]) {
      expect(out).not.toContain(leaked);
    }
    expect(out).toContain('visible');
    expect(out).toContain('[REDACTED]');
  });

  it('masks Bearer, JWS-shaped and bot-token-shaped strings in messages and values', () => {
    const { log, lines } = capture();
    log.info(`header was Bearer ${SESSION}`);
    log.warn(
      { detail: `leak ${SESSION} and ${BOT_TOKEN}`, nested: { list: [BOT_TOKEN] } },
      'bad ' + BOT_TOKEN,
    );
    log.error({ err: new Error(`failed with Bearer abc.def.ghi and ${SESSION}`) }, 'boom');
    const out = JSON.stringify(lines());
    expect(out).not.toContain(SESSION);
    expect(out).not.toContain(BOT_TOKEN);
    expect(out).not.toContain('abc.def.ghi');
    expect(out).toContain('Bearer [REDACTED]');
  });

  it('leaves ordinary text alone', () => {
    expect(maskSecrets('listening on api.example.com port 3001, guild 234567890123456789')).toBe(
      'listening on api.example.com port 3001, guild 234567890123456789',
    );
  });
});
