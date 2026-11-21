import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_USER_SETTINGS } from '@casino/shared';
import { createTestServer, GUILD, USER, type TestServer } from '../runtime/test-kit.ts';
import { resolveBotLocale } from './locale.ts';

let server: TestServer | null = null;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
});

describe('resolveBotLocale', () => {
  it('follows priority: user setting -> interaction.locale -> guild locale -> en', () => {
    server = createTestServer();
    server.identity.ensureUser(USER);
    server.identity.ensureGuild(GUILD, 'approved');

    // 1. Default fallback to en when everything is missing/unsupported.
    expect(
      resolveBotLocale({
        identity: server.identity,
        userId: USER,
        guildId: GUILD,
        interactionLocale: 'fr',
        guildPreferredLocale: 'de',
      }),
    ).toBe('en');

    // 2. Discord guild preferredLocale used when user + interaction locales are missing/unsupported.
    expect(
      resolveBotLocale({
        identity: server.identity,
        userId: USER,
        guildId: GUILD,
        interactionLocale: 'es-ES',
        guildPreferredLocale: 'ja',
      }),
    ).toBe('ja');

    // 3. DB guild_config.locale takes precedence over Discord guild preferredLocale.
    server.store.stmt('UPDATE guild_config SET locale = ? WHERE guild_id = ?').run('ja', GUILD);
    expect(
      resolveBotLocale({
        identity: server.identity,
        userId: USER,
        guildId: GUILD,
        interactionLocale: null,
        guildPreferredLocale: 'en-US',
      }),
    ).toBe('ja');

    // 4. interaction.locale overrides guild locale.
    expect(
      resolveBotLocale({
        identity: server.identity,
        userId: USER,
        guildId: GUILD,
        interactionLocale: 'en-GB',
        guildPreferredLocale: 'ja',
      }),
    ).toBe('en');

    // 5. Explicit user setting overrides interaction.locale and guild locale.
    server.settings.put(USER, { ...DEFAULT_USER_SETTINGS, language: 'ja' });
    expect(
      resolveBotLocale({
        identity: server.identity,
        userId: USER,
        guildId: GUILD,
        interactionLocale: 'en-US',
        guildPreferredLocale: 'en-US',
      }),
    ).toBe('ja');

    // 6. Setting language back to 'auto' clears DB override so interaction.locale wins again.
    server.settings.put(USER, { ...DEFAULT_USER_SETTINGS, language: 'auto' });
    expect(
      resolveBotLocale({
        identity: server.identity,
        userId: USER,
        guildId: GUILD,
        interactionLocale: 'en-US',
        guildPreferredLocale: 'ja',
      }),
    ).toBe('en');
  });
});
