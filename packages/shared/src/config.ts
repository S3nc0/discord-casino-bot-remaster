import { Type, type Static } from 'typebox';

const snowflake = '[0-9]{17,20}';
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const snowflakeList = Type.String({ pattern: `^${snowflake}(,${snowflake})*$` });

/**
 * Environment contract of the server process. `.env` (never committed) must satisfy this;
 * `.env.example` lists every key with a placeholder. The server validates `process.env`
 * against it at start-up and refuses to start on any error.
 */
export const ServerEnv = Type.Object({
  DISCORD_TOKEN: Type.String({ minLength: 1 }),
  DISCORD_CLIENT_ID: Type.String({ pattern: `^${snowflake}$` }),
  DISCORD_CLIENT_SECRET: Type.String({ minLength: 1 }),
  /** Application public key (hex, Developer Portal). Public value; verifies proxy signatures. */
  DISCORD_PUBLIC_KEY: Type.String({ pattern: '^[0-9a-fA-F]{64}$' }),
  ALLOWED_GUILD_IDS: snowflakeList,
  OWNER_IDS: snowflakeList,
  TEST_GUILD_ID: Type.String({ pattern: `^${snowflake}$` }),
  REQUIRE_APPROVAL: Type.Enum(['0', '1']),
  UTC_OFFSET_HOURS: Type.String({ pattern: '^[+-]?(?:[0-9]|1[0-4])$' }),
  SESSION_SECRET: Type.String({ minLength: 32 }),
  PUBLIC_API_ORIGIN: Type.String({ pattern: '^https?://[^/]+$' }),
  ANNOUNCE_CHANNEL_ID: Type.String({ pattern: `^${snowflake}$` }),
  /** `development` disables proxy signature checks (local dev only). Anything else enforces them. */
  NODE_ENV: Type.Optional(Type.Enum(['development', 'test', 'production'])),
  /**
   * `1`/`true`: every `/api` route except `health` and `token`, and the socket upgrade, must
   * carry valid Discord proxy signature headers. Default `0`: headers are verified when
   * present and may be absent (Discord was observed not to sign `POST /api/token`).
   */
  REQUIRE_PROXY_SIGNATURE: Type.Optional(Type.Enum(['0', '1', 'true', 'false'])),
  /** HTTP + Socket.io port. Default `SERVER_ENV_DEFAULTS.PORT`. */
  PORT: Type.Optional(
    Type.String({
      pattern:
        '^(?:[0-9]|[1-9][0-9]{1,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])$',
    }),
  ),
  /**
   * Bind address. Default loopback: the server sits behind the tunnel with `trustProxy` on, so
   * it must not be reachable directly (a direct client could forge `X-Forwarded-For`).
   * Only a container (pi-sim) may need `0.0.0.0`.
   */
  HOST: Type.Optional(
    Type.String({ minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9.:\\[\\]-]+$' }),
  ),
  /**
   * SQLite file of the new server. Relative paths resolve against the working directory.
   * Never the legacy Python bot's `data/casino.db`: that file is only read by the importer.
   */
  DATABASE_PATH: Type.Optional(Type.String({ minLength: 1 })),
  /** Pino level. Default `info`. */
  LOG_LEVEL: Type.Optional(Type.Enum(LOG_LEVELS)),
  /**
   * `1`: start without logging the chat bot in to the Discord gateway (HTTP, Socket.io and
   * jobs still run; notify uses its no-op Discord port). Default `0`. For local dev, CI smoke
   * boots and the pi-sim container, where a second gateway login on the same token must not happen.
   */
  BOT_DISABLED: Type.Optional(Type.Enum(['0', '1'])),
});
export type ServerEnv = Static<typeof ServerEnv>;

/** Defaults for the optional keys (as strings, the way they appear in `process.env`). */
export const SERVER_ENV_DEFAULTS = {
  NODE_ENV: 'production',
  REQUIRE_PROXY_SIGNATURE: '0',
  PORT: '3001',
  HOST: '127.0.0.1',
  DATABASE_PATH: './data/casino.sqlite',
  LOG_LEVEL: 'info',
  BOT_DISABLED: '0',
} as const satisfies Partial<Record<keyof ServerEnv, string>>;

/** Keys that may be left out of `.env`. Everything else is required. */
export const OPTIONAL_SERVER_ENV_KEYS = Object.keys(
  SERVER_ENV_DEFAULTS,
) as (keyof typeof SERVER_ENV_DEFAULTS)[];

export const SERVER_ENV_KEYS = Object.keys(ServerEnv.properties) as (keyof ServerEnv)[];
