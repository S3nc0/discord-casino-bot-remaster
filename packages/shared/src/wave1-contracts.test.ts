import { describe, expect, it } from 'vitest';
import { Value } from 'typebox/value';
import {
  API_ROUTES,
  AUTHORIZE_SCOPES,
  DEFAULT_USER_SETTINGS,
  DISCORD_CDN_PREFIX,
  DISCORD_URL_MAPPINGS,
  InboxPage,
  InboxQuery,
  InboxReadRequest,
  InboxUnread,
  LaunchIntentConsumeRequest,
  LaunchIntentConsumeResponse,
  MeResponse,
  OPTIONAL_SERVER_ENV_KEYS,
  Participants,
  REQUIRED_SERVER_SCOPES,
  SERVER_ENV_DEFAULTS,
  SERVER_ENV_KEYS,
  ServerEnv,
  SettingsUpdateRequest,
  UserSettings,
  avatarUrl,
  defaultAvatarIndex,
} from './index.ts';

const U = '123456789012345678';
const G = '234567890123456789';

// The .env.example file itself is checked against ServerEnv by apps/server/src/runtime/env.test.ts
// (it enumerates SERVER_ENV_KEYS, so it covers every key added here).
const REQUIRED_ENV = {
  DISCORD_TOKEN: 'replace-with-bot-token',
  DISCORD_CLIENT_ID: '000000000000000000',
  DISCORD_CLIENT_SECRET: 'replace-with-client-secret',
  DISCORD_PUBLIC_KEY: '0'.repeat(64),
  ALLOWED_GUILD_IDS: '000000000000000000',
  OWNER_IDS: '000000000000000000',
  TEST_GUILD_ID: '000000000000000000',
  REQUIRE_APPROVAL: '1',
  UTC_OFFSET_HOURS: '9',
  SESSION_SECRET: 'x'.repeat(32),
  PUBLIC_API_ORIGIN: 'https://api.example.com',
  ANNOUNCE_CHANNEL_ID: '000000000000000000',
};

describe('server env contract', () => {
  it('lists the process keys as optional, with defaults', () => {
    expect(SERVER_ENV_KEYS).toEqual(
      expect.arrayContaining(['PORT', 'HOST', 'DATABASE_PATH', 'LOG_LEVEL']),
    );
    expect([...OPTIONAL_SERVER_ENV_KEYS].sort()).toEqual(
      ['DATABASE_PATH', 'HOST', 'LOG_LEVEL', 'NODE_ENV', 'PORT', 'REQUIRE_PROXY_SIGNATURE'].sort(),
    );
    expect(SERVER_ENV_DEFAULTS).toMatchObject({
      PORT: '3001',
      HOST: '127.0.0.1',
      DATABASE_PATH: './data/casino.sqlite',
      LOG_LEVEL: 'info',
    });
    const required = SERVER_ENV_KEYS.filter((k) => !OPTIONAL_SERVER_ENV_KEYS.includes(k as never));
    expect(Object.keys(REQUIRED_ENV).sort()).toEqual([...required].sort());
  });

  it('accepts the env without the optional keys and validates them when set', () => {
    const env = REQUIRED_ENV;
    expect([...Value.Errors(ServerEnv, env)]).toEqual([]);
    expect(Value.Check(ServerEnv, { ...env, ...SERVER_ENV_DEFAULTS })).toBe(true);
    expect(Value.Check(ServerEnv, { ...env, PORT: '65535' })).toBe(true);
    expect(Value.Check(ServerEnv, { ...env, PORT: '65536' })).toBe(false);
    expect(Value.Check(ServerEnv, { ...env, PORT: '3001x' })).toBe(false);
    expect(Value.Check(ServerEnv, { ...env, PORT: '0' })).toBe(true);
    expect(Value.Check(ServerEnv, { ...env, LOG_LEVEL: 'verbose' })).toBe(false);
    expect(Value.Check(ServerEnv, { ...env, HOST: '::1' })).toBe(true);
    expect(Value.Check(ServerEnv, { ...env, HOST: 'a b' })).toBe(false);
    expect(Value.Check(ServerEnv, { ...env, DATABASE_PATH: '' })).toBe(false);
    expect(SERVER_ENV_DEFAULTS.DATABASE_PATH).not.toMatch(/casino\.db$/);
  });
});

describe('user settings', () => {
  it('defaults are valid: auto language, Discord theme, sound on at 30, system motion', () => {
    expect(Value.Check(UserSettings, DEFAULT_USER_SETTINGS)).toBe(true);
    expect(DEFAULT_USER_SETTINGS).toEqual({
      language: 'auto',
      theme: 'discord',
      sound: { enabled: true, sfxVolume: 30, musicVolume: 30 },
      motion: 'system',
    });
  });

  it('rejects out-of-range volume, unknown values and unknown keys', () => {
    const base: UserSettings = {
      ...DEFAULT_USER_SETTINGS,
      sound: { ...DEFAULT_USER_SETTINGS.sound },
    };
    expect(Value.Check(SettingsUpdateRequest, base)).toBe(true);
    expect(
      Value.Check(SettingsUpdateRequest, { ...base, sound: { ...base.sound, sfxVolume: 101 } }),
    ).toBe(false);
    expect(
      Value.Check(SettingsUpdateRequest, { ...base, sound: { ...base.sound, musicVolume: 2.5 } }),
    ).toBe(false);
    expect(Value.Check(SettingsUpdateRequest, { ...base, theme: 'auto' })).toBe(false);
    expect(Value.Check(SettingsUpdateRequest, { ...base, language: 'fr' })).toBe(false);
    expect(Value.Check(SettingsUpdateRequest, { ...base, userId: U })).toBe(false);
    expect(Value.Check(SettingsUpdateRequest, { ...base, motion: 'reduced' })).toBe(true);
    expect(Value.Check(SettingsUpdateRequest, { ...base, motion: false })).toBe(false);
  });
});

describe('http contract', () => {
  it('names every route under /api', () => {
    for (const path of Object.values(API_ROUTES)) expect(path.startsWith('/api/')).toBe(true);
    expect(API_ROUTES.me).toBe('/api/me');
    expect(API_ROUTES.launchIntentConsume).toBe('/api/launch-intent/consume');
  });

  it('MeResponse carries user, guild, balance and locale hints', () => {
    const me = {
      user: { id: U, username: 'pel', globalName: null, avatar: null },
      guild: { id: G, name: 'Casino' },
      instanceId: 'i-1-gc-2',
      balance: 0,
      locale: 'ja',
      localeHints: { setting: 'auto', guild: null },
      expiresAt: 1,
    };
    expect(Value.Check(MeResponse, me)).toBe(true);
    expect(Value.Check(MeResponse, { ...me, balance: -1 })).toBe(false);
    expect(Value.Check(MeResponse, { ...me, localeHints: { setting: 'de', guild: null } })).toBe(
      false,
    );
  });

  it('inbox query takes digit strings only', () => {
    expect(Value.Check(InboxQuery, {})).toBe(true);
    expect(Value.Check(InboxQuery, { before: '42', limit: '50', unread: '1' })).toBe(true);
    expect(Value.Check(InboxQuery, { limit: '51' })).toBe(false);
    expect(Value.Check(InboxQuery, { limit: '0' })).toBe(false);
    expect(Value.Check(InboxQuery, { before: '-1' })).toBe(false);
    expect(Value.Check(InboxQuery, { guildId: G })).toBe(false);
  });

  it('inbox page and read bodies', () => {
    expect(Value.Check(InboxPage, { items: [], unread: 0, nextBefore: null })).toBe(true);
    expect(Value.Check(InboxReadRequest, { ids: [1, 2] })).toBe(true);
    expect(Value.Check(InboxReadRequest, { all: true })).toBe(true);
    expect(Value.Check(InboxReadRequest, { all: false })).toBe(false);
    expect(Value.Check(InboxReadRequest, { ids: [] })).toBe(false);
    expect(Value.Check(InboxReadRequest, { ids: [1], all: true })).toBe(false);
    expect(Value.Check(InboxUnread, { guildId: G, unread: 3 })).toBe(true);
  });

  it('launch intent consume takes no ids from the client', () => {
    expect(Value.Check(LaunchIntentConsumeRequest, {})).toBe(true);
    expect(Value.Check(LaunchIntentConsumeRequest, { userId: U, guildId: G })).toBe(false);
    expect(Value.Check(LaunchIntentConsumeResponse, { launchIntent: null })).toBe(true);
    expect(
      Value.Check(LaunchIntentConsumeResponse, {
        launchIntent: { userId: U, guildId: G, screen: 'slots', expires: 1 },
      }),
    ).toBe(true);
  });
});

describe('socket contract', () => {
  it('instance:participants carries guild, instance and public users', () => {
    expect(
      Value.Check(Participants, {
        guildId: G,
        instanceId: 'i-1',
        users: [{ id: U, username: 'pel', globalName: 'Pel', avatar: 'abc' }],
      }),
    ).toBe(true);
  });
});

describe('auth scopes', () => {
  it('asks for identify, guilds and rpc.activities.write', () => {
    expect([...AUTHORIZE_SCOPES]).toEqual(['identify', 'guilds', 'rpc.activities.write']);
    for (const scope of REQUIRED_SERVER_SCOPES) expect(AUTHORIZE_SCOPES).toContain(scope);
  });
});

describe('avatars through the url mapping', () => {
  it('maps /discord-cdn to the Discord CDN', () => {
    expect(DISCORD_CDN_PREFIX).toBe('/discord-cdn');
    expect(DISCORD_URL_MAPPINGS).toEqual([
      { prefix: '/discord-cdn', target: 'cdn.discordapp.com' },
    ]);
  });

  it('builds avatar urls for custom, animated and default avatars', () => {
    const base = `/.proxy${DISCORD_CDN_PREFIX}`;
    expect(avatarUrl({ id: U, avatar: 'abc' }, { base, size: 64 })).toBe(
      `/.proxy/discord-cdn/avatars/${U}/abc.png?size=64`,
    );
    expect(avatarUrl({ id: U, avatar: 'a_abc' })).toBe(
      `https://cdn.discordapp.com/avatars/${U}/a_abc.gif?size=128`,
    );
    const index = defaultAvatarIndex(U);
    expect(index).toBe(Number((BigInt(U) >> 22n) % 6n));
    expect(avatarUrl({ id: U, avatar: null }, { base })).toBe(
      `/.proxy/discord-cdn/embed/avatars/${index}.png`,
    );
    expect(defaultAvatarIndex('not-a-snowflake')).toBe(0);
  });
});
