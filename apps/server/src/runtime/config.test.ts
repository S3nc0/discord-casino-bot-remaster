import { describe, expect, it } from 'vitest';
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

  it('only NODE_ENV=development switches proxy signatures off', () => {
    expect(loadConfig({ ...valid, NODE_ENV: 'development' }).enforceProxySignatures).toBe(false);
    expect(loadConfig({ ...valid, NODE_ENV: 'test' }).enforceProxySignatures).toBe(true);
    expect(loadConfig({ ...valid, NODE_ENV: 'production' }).enforceProxySignatures).toBe(true);
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
