import { PermissionFlagsBits, RESTJSONErrorCodes, Routes } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { manualClock } from '@casino/shared';
import { EventBus } from '../runtime/bus.ts';
import { createLogger } from '../runtime/logger.ts';
import { GUILD, memoryStore, START_MS, USER } from '../runtime/test-kit.ts';
import {
  buildLaunchButtonId,
  createDiscordNotifyPort,
  LEGACY_LAUNCH_BUTTON_ID,
  parseLaunchButtonId,
  type DiscordPortClient,
} from './discord-port.ts';
import { attachNotify } from './index.ts';
import { startNotifyRuntime } from './runtime.ts';

const CHANNEL_ID = '456789012345678901';
const silentLogger = createLogger({ level: 'silent' });

interface FakeChannel {
  guildId?: string;
  send: ReturnType<typeof vi.fn>;
  createWebhook?: ReturnType<typeof vi.fn>;
  permissionsFor?: ReturnType<typeof vi.fn>;
}

interface FakeUser {
  send: ReturnType<typeof vi.fn>;
}

type RestPostFn = DiscordPortClient['rest']['post'];

function makeFakeClient(
  overrides: {
    channels?: Record<string, FakeChannel | null | Error>;
    users?: Record<string, FakeUser | null | Error>;
    cachedGuilds?: Record<string, { preferredLocale?: string | null }>;
    fetchedGuilds?: Record<string, { preferredLocale?: string | null } | Error>;
    restPost?: RestPostFn;
  } = {},
) {
  const restPost = overrides.restPost ?? vi.fn<RestPostFn>(async () => ({ id: 'wh-msg-1' }));
  const channelsFetch = vi.fn(async (id: string) => {
    const entry = overrides.channels?.[id];
    if (entry instanceof Error) throw entry;
    return entry ?? null;
  });
  const usersFetch = vi.fn(async (id: string) => {
    const entry = overrides.users?.[id];
    if (entry instanceof Error) throw entry;
    return entry ?? null;
  });
  const guildsFetch = vi.fn(async (id: string) => {
    const entry = overrides.fetchedGuilds?.[id];
    if (entry instanceof Error) throw entry;
    return entry ?? null;
  });

  const client: DiscordPortClient = {
    user: { id: '999999999999999999' },
    channels: { fetch: channelsFetch },
    users: { fetch: usersFetch },
    guilds: {
      cache: {
        get: (id: string) => overrides.cachedGuilds?.[id],
      },
      fetch: guildsFetch,
    },
    rest: { post: restPost },
  };

  return { client, restPost, channelsFetch, usersFetch, guildsFetch };
}

function apiError(props: {
  code?: number | string;
  status?: number;
  retryAfter?: number;
  message?: string;
}) {
  return Object.assign(new Error(props.message ?? 'discord error'), props);
}

describe('launch button custom IDs', () => {
  it('encodes and parses valid screen IDs and maps legacy button ID to home', () => {
    expect(buildLaunchButtonId('slots')).toBe('launch:slots');
    expect(parseLaunchButtonId('launch:slots')).toBe('slots');
    expect(parseLaunchButtonId(LEGACY_LAUNCH_BUTTON_ID)).toBe('home');
    expect(parseLaunchButtonId('launch:not_a_screen')).toBeNull();
    expect(parseLaunchButtonId('other:slots')).toBeNull();
  });
});

describe('createDiscordNotifyPort', () => {
  it('R-9: channelBelongsToGuild is true only for a channel of that guild', async () => {
    const { client } = makeFakeClient({
      channels: {
        [CHANNEL_ID]: { guildId: GUILD, send: vi.fn() },
        dm: { send: vi.fn() },
        gone: apiError({ code: RESTJSONErrorCodes.UnknownChannel }),
      },
    });
    const port = createDiscordNotifyPort(client);
    expect(await port.channelBelongsToGuild(CHANNEL_ID, GUILD)).toBe(true);
    expect(await port.channelBelongsToGuild(CHANNEL_ID, 'other')).toBe(false);
    expect(await port.channelBelongsToGuild('dm', GUILD)).toBe(false);
    expect(await port.channelBelongsToGuild('gone', GUILD)).toBe(false);
    expect(await port.channelBelongsToGuild('missing', GUILD)).toBe(false);
  });

  it('postToChannel sends embeds, attaches localized launch button when openInActivity is set, and maps errors', async () => {
    const send = vi.fn<(payload: Record<string, unknown>) => Promise<{ id: string }>>(async () => ({
      id: 'msg-42',
    }));
    const { client } = makeFakeClient({
      channels: {
        [CHANNEL_ID]: { send },
        '404': apiError({ code: RESTJSONErrorCodes.UnknownChannel }),
        '403': apiError({ code: RESTJSONErrorCodes.MissingPermissions }),
        '429': apiError({ status: 429, retryAfter: 2.5 }),
      },
    });
    const port = createDiscordNotifyPort(client);

    const ok = await port.postToChannel(CHANNEL_ID, {
      embeds: [{ title: 'Big Win!', description: 'Won 100k' }],
      openInActivity: true,
      activityScreen: 'slots',
      locale: 'ja',
    });
    expect(ok).toEqual({ ok: true, messageId: 'msg-42' });
    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0]?.[0] as unknown as {
      embeds: unknown[];
      components: { components: { custom_id: string; label: string }[] }[];
    };
    expect(payload.embeds).toHaveLength(1);
    expect(payload.components[0]?.components[0]?.custom_id).toBe('launch:slots');
    expect(payload.components[0]?.components[0]?.label).toBe('アクティビティで開く');

    expect(await port.postToChannel('404', { content: 'x' })).toMatchObject({
      ok: false,
      reason: 'unknown_channel',
    });
    expect(await port.postToChannel('403', { content: 'x' })).toMatchObject({
      ok: false,
      reason: 'missing_permissions',
    });
    expect(await port.postToChannel('429', { content: 'x' })).toMatchObject({
      ok: false,
      reason: 'rate_limited',
      retryAfterMs: 2500,
    });
    expect(await port.postToChannel('missing', { content: 'x' })).toMatchObject({
      ok: false,
      reason: 'unknown_channel',
    });
  });

  it('postViaWebhook calls Discord webhook execute route with identity and maps unknown_webhook / 429', async () => {
    const restPost = vi
      .fn()
      .mockResolvedValueOnce({ id: 'wh-101' })
      .mockRejectedValueOnce(apiError({ code: RESTJSONErrorCodes.UnknownWebhook }))
      .mockRejectedValueOnce(apiError({ code: RESTJSONErrorCodes.InvalidWebhookToken }))
      .mockRejectedValueOnce(apiError({ status: 429, retryAfter: 1.2 }));
    const { client } = makeFakeClient({ restPost });
    const port = createDiscordNotifyPort(client);

    const ok = await port.postViaWebhook(
      { webhookId: '111', token: 'secret-tok' },
      { embeds: [{ title: 'Race' }] },
      { name: 'Race Caller', avatarUrl: 'https://api.example.com/race.png' },
    );
    expect(ok).toEqual({ ok: true, messageId: 'wh-101' });
    expect(restPost).toHaveBeenCalledWith(
      Routes.webhook('111', 'secret-tok'),
      expect.objectContaining({
        auth: false,
        body: expect.objectContaining({
          username: 'Race Caller',
          avatar_url: 'https://api.example.com/race.png',
        }),
      }),
    );

    expect(
      await port.postViaWebhook({ webhookId: '111', token: 'secret-tok' }, { content: 'x' }),
    ).toMatchObject({ ok: false, reason: 'unknown_webhook' });
    expect(
      await port.postViaWebhook({ webhookId: '111', token: 'bad-tok' }, { content: 'x' }),
    ).toMatchObject({ ok: false, reason: 'unknown_webhook' });
    expect(
      await port.postViaWebhook({ webhookId: '111', token: 'secret-tok' }, { content: 'x' }),
    ).toMatchObject({ ok: false, reason: 'rate_limited', retryAfterMs: 1200 });
  });

  it('R-10: channel posts and webhook posts never allow mentions', async () => {
    const send = vi.fn<(payload: Record<string, unknown>) => Promise<{ id: string }>>(async () => ({
      id: 'm1',
    }));
    const restPost = vi.fn(async () => ({ id: 'w1' }));
    const { client } = makeFakeClient({ channels: { [CHANNEL_ID]: { send } }, restPost });
    const port = createDiscordNotifyPort(client);
    const content = '@everyone <@&123456789012345678> <@123456789012345678>';

    await port.postToChannel(CHANNEL_ID, { content });
    expect(send.mock.calls[0]?.[0]).toMatchObject({ allowedMentions: { parse: [] } });

    await port.postViaWebhook({ webhookId: '111', token: 'tok' }, { content });
    expect(restPost).toHaveBeenCalledWith(
      Routes.webhook('111', 'tok'),
      expect.objectContaining({
        body: expect.objectContaining({ allowed_mentions: { parse: [] } }),
      }),
    );
  });

  it('createWebhook checks Manage Webhooks permission, creates webhook when allowed, and maps permission/cap errors', async () => {
    const createOk = vi.fn(async () => ({ id: 'wh-1', token: 'tok-1' }));
    const createDenied = vi.fn();
    const createCap = vi.fn(async () => {
      throw apiError({ code: RESTJSONErrorCodes.MaximumNumberOfWebhooksReached });
    });

    const { client } = makeFakeClient({
      channels: {
        allowed: {
          send: vi.fn(),
          createWebhook: createOk,
          permissionsFor: vi.fn(() => ({
            has: (bit: bigint) => bit === PermissionFlagsBits.ManageWebhooks,
          })),
        },
        noPerms: {
          send: vi.fn(),
          createWebhook: createDenied,
          permissionsFor: vi.fn(() => ({ has: () => false })),
        },
        capped: {
          send: vi.fn(),
          createWebhook: createCap,
        },
      },
    });
    const port = createDiscordNotifyPort(client);

    expect(
      await port.createWebhook('allowed', { name: 'Teiai Bank', avatarUrl: 'https://x/a.png' }),
    ).toEqual({
      ok: true,
      webhook: { webhookId: 'wh-1', token: 'tok-1' },
    });

    expect(await port.createWebhook('noPerms', { name: 'Teiai Bank' })).toMatchObject({
      ok: false,
      reason: 'missing_permissions',
    });
    expect(createDenied).not.toHaveBeenCalled();

    expect(await port.createWebhook('capped', { name: 'Teiai Bank' })).toMatchObject({
      ok: false,
      reason: 'unavailable',
    });
  });

  it('sendDm maps 50007 to dm_closed, 10013 to unknown_user, 5xx/network to transient, and omits launch buttons', async () => {
    const okSend = vi.fn<(payload: Record<string, unknown>) => Promise<{ id: string }>>(
      async () => ({ id: 'dm-1' }),
    );
    const closedSend = vi.fn(async () => {
      throw apiError({ code: RESTJSONErrorCodes.CannotSendMessagesToThisUser });
    });
    const transientSend = vi.fn(async () => {
      throw apiError({ status: 503, message: 'service unavailable' });
    });

    const { client } = makeFakeClient({
      users: {
        u1: { send: okSend },
        uClosed: { send: closedSend },
        uTemp: { send: transientSend },
        uMissing: apiError({ code: RESTJSONErrorCodes.UnknownUser }),
      },
    });
    const port = createDiscordNotifyPort(client);

    expect(await port.sendDm('u1', { embeds: [{ title: 'Hi' }], openInActivity: true })).toEqual({
      ok: true,
      messageId: 'dm-1',
    });
    expect(okSend.mock.calls[0]?.[0]).not.toHaveProperty('components');

    expect(await port.sendDm('uClosed', { content: 'hi' })).toMatchObject({
      ok: false,
      reason: 'dm_closed',
    });
    expect(await port.sendDm('uMissing', { content: 'hi' })).toMatchObject({
      ok: false,
      reason: 'unknown_user',
    });
    expect(await port.sendDm('uTemp', { content: 'hi' })).toMatchObject({
      ok: false,
      reason: 'transient',
    });
  });

  it('fetchGuildLocale uses cache first, falls back to fetch, and returns null on error', async () => {
    const { client, guildsFetch } = makeFakeClient({
      cachedGuilds: { gCached: { preferredLocale: 'ja' } },
      fetchedGuilds: {
        gFetched: { preferredLocale: 'en-US' },
        gError: new Error('network'),
      },
    });
    const port = createDiscordNotifyPort(client);

    expect(await port.fetchGuildLocale('gCached')).toBe('ja');
    expect(guildsFetch).not.toHaveBeenCalled();
    expect(await port.fetchGuildLocale('gFetched')).toBe('en-US');
    expect(await port.fetchGuildLocale('gError')).toBeNull();
  });

  it('integrates fallbacks end-to-end: no Manage Webhooks -> channel post; closed DM 50007 -> dm_disabled inbox notice', async () => {
    const store = memoryStore();
    const clock = manualClock(START_MS);
    const bus = new EventBus();
    const channelSend = vi.fn(async () => ({ id: 'fallback-msg' }));
    const dmSend = vi.fn(async () => {
      throw apiError({ code: RESTJSONErrorCodes.CannotSendMessagesToThisUser });
    });

    const { client } = makeFakeClient({
      channels: {
        [CHANNEL_ID]: {
          guildId: GUILD,
          send: channelSend,
          createWebhook: vi.fn(),
          permissionsFor: vi.fn(() => ({ has: () => false })),
        },
      },
      users: {
        [USER]: { send: dmSend },
      },
      cachedGuilds: { [GUILD]: { preferredLocale: 'en-US' } },
    });

    const handle = attachNotify({
      bus,
      store,
      clock,
      logger: silentLogger,
      defaultAnnounceChannelId: CHANNEL_ID,
      port: createDiscordNotifyPort(client),
      batchWindowMs: 0,
      pollIntervalMs: 0,
    });

    handle.config.setPersonasEnabled(GUILD, true);
    handle.config.setUserKindPref(USER, 'horse_foaled', { dm: true });

    // Regular foal (< 205): inbox + opt-in DM only (NO guild announcement).
    // Because USER has closed DMs (50007), DM disables and writes dm_disabled inbox note.
    bus.publishDomain({
      type: 'HorseFoaled',
      guildId: GUILD,
      at: clock.now(),
      userId: USER,
      foalId: 1,
      foalName: 'Pebble',
      parentIds: [2, 3],
      statTotal: 199,
      generation: 1,
      maturesAt: clock.now() + 86_400_000,
    });
    await handle.flush();
    expect(channelSend).not.toHaveBeenCalled();
    expect(dmSend).toHaveBeenCalledTimes(1);
    expect(handle.config.getUserKindPref(USER, 'horse_foaled').dm).toBe(false);

    const inboxRows = store
      .stmt('SELECT kind, payload FROM inbox WHERE user_id = ? ORDER BY id ASC')
      .all(USER) as { kind: string; payload: string }[];
    expect(inboxRows.map((r) => r.kind)).toEqual(['horse_foaled', 'dm_disabled']);
    expect(JSON.parse(inboxRows[1]!.payload)).toMatchObject({
      type: 'DmDisabled',
      reason: 'dm_closed',
      userId: USER,
      guildId: GUILD,
    });

    // Promising foal (>= 205): tries race_caller webhook, lacks Manage Webhooks -> falls back to channel post.
    bus.publishDomain({
      type: 'HorseFoaled',
      guildId: GUILD,
      at: clock.now(),
      userId: USER,
      foalId: 2,
      foalName: 'Eclipse',
      parentIds: [4, 5],
      statTotal: 206,
      generation: 2,
      maturesAt: clock.now() + 86_400_000,
    });
    await handle.flush();
    expect(channelSend).toHaveBeenCalledTimes(1);

    handle.stop();
  });
});

describe('startNotifyRuntime', () => {
  it('uses a no-op port when client is null (BOT_DISABLED=1) and stops cleanly', async () => {
    const store = memoryStore();
    const clock = manualClock(START_MS);
    const bus = new EventBus();

    const runtime = startNotifyRuntime({
      db: store.db,
      bus,
      io: null,
      client: null,
      env: { ANNOUNCE_CHANNEL_ID: CHANNEL_ID },
      logger: silentLogger,
      clock,
      pollIntervalMs: 0,
    });

    bus.publishDomain({
      type: 'DailyReady',
      guildId: GUILD,
      at: clock.now(),
      userId: USER,
    });
    const res = await runtime.flush();
    expect(res.announcements.failed).toBe(0);
    expect(store.stmt('SELECT COUNT(*) AS n FROM inbox WHERE user_id = ?').get(USER)).toEqual({
      n: 1,
    });

    runtime.stop();
    bus.publishDomain({
      type: 'DailyReady',
      guildId: GUILD,
      at: clock.now() + 1,
      userId: USER,
    });
    expect(store.stmt('SELECT COUNT(*) AS n FROM inbox WHERE user_id = ?').get(USER)).toEqual({
      n: 1,
    });
  });
});
