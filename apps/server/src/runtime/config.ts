import { Value } from 'typebox/value';
import { ServerEnv, SERVER_ENV_KEYS } from '@casino/shared';

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  discord: { token: string; clientId: string; clientSecret: string; publicKey: string };
  allowedGuildIds: ReadonlySet<string>;
  ownerIds: ReadonlySet<string>;
  testGuildId: string;
  requireApproval: boolean;
  utcOffsetHours: number;
  sessionSecret: string;
  publicApiOrigin: string;
  announceChannelId: string;
  /** Proxy signatures are enforced everywhere except `NODE_ENV=development`. */
  enforceProxySignatures: boolean;
  // Not part of the shared env contract (see the report): optional process settings.
  port: number;
  host: string;
  databasePath: string;
  logLevel: string;
}

/** Thrown when the environment is invalid. Messages name the keys, never their values. */
export class ConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`invalid environment: ${issues.join('; ')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

function csv(value: string): Set<string> {
  return new Set(value.split(',').filter((part) => part.length > 0));
}

/** Validate `env` against the shared `ServerEnv` contract and derive the typed config. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const candidate: Record<string, string> = {};
  for (const key of SERVER_ENV_KEYS) {
    const value = env[key];
    if (value !== undefined) candidate[key] = value;
  }

  const issues: string[] = [];
  for (const error of Value.Errors(ServerEnv, candidate)) {
    const required = (error.params as { requiredProperties?: string[] }).requiredProperties;
    issues.push(
      required ? `missing ${required.join(', ')}` : `${error.instancePath.slice(1)} is invalid`,
    );
  }

  const port = env.PORT === undefined ? 3001 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) issues.push('PORT is invalid');
  const logLevel = env.LOG_LEVEL ?? 'info';
  if (!LOG_LEVELS.includes(logLevel)) issues.push('LOG_LEVEL is invalid');
  if (issues.length > 0) throw new ConfigError(issues);

  const valid = candidate as unknown as ServerEnv;
  const nodeEnv = valid.NODE_ENV ?? 'production';
  return {
    nodeEnv,
    discord: {
      token: valid.DISCORD_TOKEN,
      clientId: valid.DISCORD_CLIENT_ID,
      clientSecret: valid.DISCORD_CLIENT_SECRET,
      publicKey: valid.DISCORD_PUBLIC_KEY,
    },
    allowedGuildIds: csv(valid.ALLOWED_GUILD_IDS),
    ownerIds: csv(valid.OWNER_IDS),
    testGuildId: valid.TEST_GUILD_ID,
    requireApproval: valid.REQUIRE_APPROVAL === '1',
    utcOffsetHours: Number(valid.UTC_OFFSET_HOURS),
    sessionSecret: valid.SESSION_SECRET,
    publicApiOrigin: valid.PUBLIC_API_ORIGIN,
    announceChannelId: valid.ANNOUNCE_CHANNEL_ID,
    enforceProxySignatures: nodeEnv !== 'development',
    port,
    host: env.HOST ?? '127.0.0.1',
    databasePath: env.DATABASE_PATH ?? 'data/casino.sqlite',
    logLevel,
  };
}
