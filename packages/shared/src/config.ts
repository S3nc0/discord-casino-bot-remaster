import { Type, type Static } from 'typebox';

const snowflake = '[0-9]{17,20}';
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
});
export type ServerEnv = Static<typeof ServerEnv>;

export const SERVER_ENV_KEYS = Object.keys(ServerEnv.properties) as (keyof ServerEnv)[];
