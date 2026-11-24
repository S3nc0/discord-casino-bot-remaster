import { GatewayIntentBits, IntentsBitField } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestServer, type TestServer } from '../runtime/test-kit.ts';
import {
  BOT_CACHE_SETTINGS,
  BOT_INTENTS,
  BOT_SWEEPER_OPTIONS,
  createDiscordClient,
  getBotDisabledReason,
  startBot,
} from './client.ts';
import { PLACEHOLDER_DISCORD_TOKEN } from './deploy.ts';

let server: TestServer | null = null;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
});

describe('bot client settings & lifecycle', () => {
  it('uses Guilds intent only with tiny cache limits and sweepers', async () => {
    expect(BOT_INTENTS).toEqual([GatewayIntentBits.Guilds]);
    expect(BOT_CACHE_SETTINGS.GuildMemberManager).toBe(0);
    expect(BOT_CACHE_SETTINGS.PresenceManager).toBe(0);
    expect(BOT_CACHE_SETTINGS.ReactionManager).toBe(0);
    expect(BOT_CACHE_SETTINGS.VoiceStateManager).toBe(0);
    expect(BOT_CACHE_SETTINGS.MessageManager).toBe(10);
    expect(BOT_CACHE_SETTINGS.GuildMessageManager).toBe(10);
    expect(BOT_CACHE_SETTINGS.UserManager).toMatchObject({ maxSize: 100 });
    expect(BOT_SWEEPER_OPTIONS.messages?.interval).toBe(300);
    expect(BOT_SWEEPER_OPTIONS.threads?.interval).toBe(300);
    expect(BOT_SWEEPER_OPTIONS.users?.interval).toBe(600);

    server = createTestServer();
    const client = createDiscordClient({
      identity: server.identity,
      economy: server.economy,
      settings: server.settings,
      logger: server.logger,
      ownerIds: server.config.ownerIds,
      allowedGuildIds: server.config.allowedGuildIds,
      requireApproval: server.config.requireApproval,
    });
    expect(client.options.intents).toBeInstanceOf(IntentsBitField);
    expect((client.options.intents as IntentsBitField).bitfield).toBe(GatewayIntentBits.Guilds);
    await client.destroy();
  });

  it('skips gateway login on BOT_DISABLED=1, missing token, or placeholder token', async () => {
    expect(getBotDisabledReason('real-token', { BOT_DISABLED: '1' })).toBe('BOT_DISABLED=1');
    expect(getBotDisabledReason('', {})).toBe('missing DISCORD_TOKEN');
    expect(getBotDisabledReason(PLACEHOLDER_DISCORD_TOKEN, {})).toBe('placeholder DISCORD_TOKEN');
    expect(getBotDisabledReason('real-token', {})).toBeNull();

    server = createTestServer({ env: { DISCORD_TOKEN: PLACEHOLDER_DISCORD_TOKEN } });
    const clientFactory = vi.fn();
    const handle = await startBot(server, server.config, { env: {}, clientFactory });

    expect(handle.client).toBeNull();
    expect(clientFactory).not.toHaveBeenCalled();
    await expect(handle.close()).resolves.toBeUndefined();
  });

  it('logs in when configured with a real token and destroys cleanly on close', async () => {
    server = createTestServer();
    const fakeClient = {
      login: vi.fn(async () => 'test-bot-token'),
      destroy: vi.fn(async () => {}),
    };
    const handle = await startBot(server, server.config, {
      env: {},
      clientFactory: () => fakeClient as never,
    });

    expect(handle.client).toBe(fakeClient);
    expect(fakeClient.login).toHaveBeenCalledWith('test-bot-token');
    await handle.close();
    await handle.close();
    expect(fakeClient.destroy).toHaveBeenCalledTimes(1);
  });
});
