import { describe, expect, it } from 'vitest';
import { SERVER_ENV_DEFAULTS } from '@casino/shared';
import { ConfigError, loadConfig } from './config.ts';

const valid = {
  DISCORD_TOKEN: 'tok',
  DISCORD_CLIENT_ID: '345678901234567890',
  DISCORD_CLIENT_SECRET: 'super-secret-value',
  DISCORD_PUBLIC_KEY: 'a'.repeat(64),
  ALLOWED_GUILD_IDS: '234567890123456789,234567890123456780',
  OWNER_IDS: '123456789012345678',
  TEST_GUILD_ID: '234567890123456789',
  REQUIRE_APPROVAL: '1',
  UTC_OFFSET_HOURS: '9',
  SESSION_SECRET: 's'.repeat(32),
  PUBLIC_API_ORIGIN: 'https://api.example.com',
  ANNOUNCE_CHANNEL_ID: '456789012345678901',
};

describe('loadConfig', () => {
  it('parses a valid environment', () => {
    const config = loadConfig({ ...valid, PATH: '/usr/bin' });
    expect(config.allowedGuildIds).toEqual(new Set(['234567890123456789', '234567890123456780']));
    expect(config.requireApproval).toBe(true);
    expect(config.utcOffsetHours).toBe(9);
    expect(config.enforceProxySignatures).toBe(true);
    expect(config.port).toBe(3001);
    expect(config.host).toBe('127.0.0.1');
  });

  it('takes the optional keys from the shared defaults', () => {
    const config = loadConfig(valid);
    expect(config).toMatchObject({
      nodeEnv: SERVER_ENV_DEFAULTS.NODE_ENV,
      port: Number(SERVER_ENV_DEFAULTS.PORT),
      host: SERVER_ENV_DEFAULTS.HOST,
      databasePath: SERVER_ENV_DEFAULTS.DATABASE_PATH,
      logLevel: SERVER_ENV_DEFAULTS.LOG_LEVEL,
    });
    expect(config.databasePath).not.toContain('casino.db');
  });

  it('reads PORT, HOST, DATABASE_PATH and LOG_LEVEL when set, and validates them', () => {
    const config = loadConfig({
      ...valid,
      PORT: '4000',
      HOST: '0.0.0.0',
      DATABASE_PATH: '/var/lib/casino.sqlite',
      LOG_LEVEL: 'debug',
    });
    expect(config).toMatchObject({
      port: 4000,
      host: '0.0.0.0',
      databasePath: '/var/lib/casino.sqlite',
      logLevel: 'debug',
    });
    for (const bad of [
      { PORT: '70000' },
      { PORT: 'x' },
      { HOST: 'a b' },
      { LOG_LEVEL: 'loud' },
      { DATABASE_PATH: '' },
    ]) {
      expect(() => loadConfig({ ...valid, ...bad })).toThrow(ConfigError);
    }
  });

  it('only NODE_ENV=development switches proxy signatures off', () => {
    expect(loadConfig({ ...valid, NODE_ENV: 'development' }).enforceProxySignatures).toBe(false);
    expect(loadConfig({ ...valid, NODE_ENV: 'test' }).enforceProxySignatures).toBe(true);
    expect(loadConfig({ ...valid, NODE_ENV: 'production' }).enforceProxySignatures).toBe(true);
  });

  it('REQUIRE_PROXY_SIGNATURE defaults to off and accepts 1/true', () => {
    expect(loadConfig(valid).requireProxySignature).toBe(false);
    expect(loadConfig({ ...valid, REQUIRE_PROXY_SIGNATURE: '0' }).requireProxySignature).toBe(
      false,
    );
    expect(loadConfig({ ...valid, REQUIRE_PROXY_SIGNATURE: '1' }).requireProxySignature).toBe(true);
    expect(loadConfig({ ...valid, REQUIRE_PROXY_SIGNATURE: 'true' }).requireProxySignature).toBe(
      true,
    );
    expect(() => loadConfig({ ...valid, REQUIRE_PROXY_SIGNATURE: 'maybe' })).toThrow(ConfigError);
  });

  it('names the bad keys and never prints their values', () => {
    const attempt = (): unknown =>
      loadConfig({
        ...valid,
        SESSION_SECRET: 'short-secret-value',
        DISCORD_PUBLIC_KEY: 'nothex',
        PORT: 'x',
      });
    expect(attempt).toThrow(ConfigError);
    try {
      attempt();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('SESSION_SECRET');
      expect(message).toContain('DISCORD_PUBLIC_KEY');
      expect(message).toContain('PORT');
      expect(message).not.toContain('short-secret-value');
    }
  });

  it('reports every missing key', () => {
    try {
      loadConfig({});
      expect.unreachable();
    } catch (error) {
      expect((error as ConfigError).message).toContain('DISCORD_TOKEN');
      expect((error as ConfigError).message).toContain('SESSION_SECRET');
    }
  });
});
