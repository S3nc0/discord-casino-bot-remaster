import { pino, type DestinationStream, type Logger } from 'pino';

/**
 * Pino `redact.paths`: credentials never reach the log, whatever the call site passes.
 * The `*.x` forms cover one level of nesting (`body.code`), the bare forms the top level.
 */
export const REDACT_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-discord-proxy-payload"]',
  'headers.authorization',
  'headers.cookie',
  'headers["x-discord-proxy-payload"]',
  '*.code',
  '*.accessToken',
  '*.access_token',
  '*.sessionToken',
  '*.token',
  '*.secret',
  'code',
  'accessToken',
  'access_token',
  'sessionToken',
  'token',
  'secret',
];

const CENSOR = '[REDACTED]';

// `Bearer <anything token-like>`.
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
// Compact JWS (our session tokens, Discord-issued JWTs): header starts with `eyJ` (`{"`).
const JWS = /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g;
// Discord bot token: base64(user id).timestamp.hmac
const BOT_TOKEN = /\b[MNO][A-Za-z0-9_-]{23,27}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,}/g;

// Webhook execute URLs carry the secret token as the last path segment.
const WEBHOOK_URL = /\/webhooks\/(\d+)\/[A-Za-z0-9._-]+/g;

/** Mask token-shaped substrings of a free-form string. */
export function maskSecrets(text: string): string {
  return text
    .replace(BEARER, `Bearer ${CENSOR}`)
    .replace(JWS, CENSOR)
    .replace(BOT_TOKEN, CENSOR)
    .replace(WEBHOOK_URL, `/webhooks/$1/${CENSOR}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function maskValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return maskSecrets(value);
  if (depth <= 0) return value;
  if (Array.isArray(value)) return value.map((item: unknown) => maskValue(item, depth - 1));
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = maskValue(item, depth - 1);
    return out;
  }
  return value;
}

function serializeError(error: unknown): unknown {
  // The standard serializer returns an object with a custom prototype; spread it to a plain one.
  const plain: Record<string, unknown> = { ...pino.stdSerializers.err(error as Error) };
  return maskValue(plain, 4);
}

export interface LoggerOptions {
  level?: string;
  /** Destination for log lines; stdout when omitted. */
  stream?: DestinationStream;
}

/** The process logger: JSON lines, credential paths redacted, token-shaped strings masked. */
export function createLogger(options: LoggerOptions = {}): Logger {
  const config = {
    level: options.level ?? 'info',
    redact: { paths: [...REDACT_PATHS], censor: CENSOR },
    serializers: { err: serializeError },
    hooks: {
      logMethod(args: unknown[], method: (...a: unknown[]) => void) {
        method.apply(
          this,
          args.map((arg) => (arg instanceof Error ? arg : maskValue(arg, 4))),
        );
      },
    },
  };
  return options.stream === undefined ? pino(config) : pino(config, options.stream);
}
