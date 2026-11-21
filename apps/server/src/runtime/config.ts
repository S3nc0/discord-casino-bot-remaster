import { Value } from 'typebox/value';
import { SERVER_ENV_DEFAULTS, SERVER_ENV_KEYS, ServerEnv, type LogLevel } from '@casino/shared';

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
  /** Missing proxy signature headers are refused (health and token excepted). */
  requireProxySignature: boolean;
  port: number;
  host: string;
  databasePath: string;
  logLevel: LogLevel;
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

  if (issues.length > 0) throw new ConfigError(issues);

  const valid = candidate as unknown as ServerEnv;
  const nodeEnv = valid.NODE_ENV ?? SERVER_ENV_DEFAULTS.NODE_ENV;
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
    requireProxySignature: ['1', 'true'].includes(
      valid.REQUIRE_PROXY_SIGNATURE ?? SERVER_ENV_DEFAULTS.REQUIRE_PROXY_SIGNATURE,
    ),
    port: Number(valid.PORT ?? SERVER_ENV_DEFAULTS.PORT),
    host: valid.HOST ?? SERVER_ENV_DEFAULTS.HOST,
    databasePath: valid.DATABASE_PATH ?? SERVER_ENV_DEFAULTS.DATABASE_PATH,
    logLevel: valid.LOG_LEVEL ?? SERVER_ENV_DEFAULTS.LOG_LEVEL,
  };
}
