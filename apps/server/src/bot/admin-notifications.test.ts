import { PermissionFlagsBits, type InteractionReplyOptions } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotifyConfigService } from '../notify/config-service.ts';
import {
  GUILD,
  OTHER_GUILD,
  OTHER_USER,
  USER,
  createTestServer,
  type TestServer,
} from '../runtime/test-kit.ts';
import { createInteractionHandler } from './router.ts';

interface Opts {
  channel?: string;
  threshold?: number;
  personas?: boolean;
  enabled?: boolean;
  guild_id?: string;
}

function mockAdmin(params: {
  userId?: string;
  guildId?: string | null;
  manageGuild?: boolean;
  locale?: string;
  opts?: Opts;
}) {
  const replies: InteractionReplyOptions[] = [];
  const opts = params.opts ?? {};
  const guildId = params.guildId === undefined ? GUILD : params.guildId;
  const interaction = {
    id: 'ix',
    isChatInputCommand: () => true,
    isButton: () => false,
    commandName: 'admin',
    guildId,
    guild: guildId ? { id: guildId, name: 'G', preferredLocale: 'en-US' } : null,
    locale: params.locale ?? 'en-US',
    user: { id: params.userId ?? USER, username: 'u', globalName: null, avatar: null },
    memberPermissions: {
      has: (flag: bigint) =>
        params.manageGuild === true && flag === PermissionFlagsBits.ManageGuild,
    },
    replied: false,
    deferred: false,
    options: {
      getSubcommandGroup: () => null,
      getSubcommand: () => 'notifications',
      getUser: () => null,
      getString: (n: string) => (n === 'guild_id' ? (opts.guild_id ?? null) : null),
      getInteger: (n: string) => (n === 'threshold' ? (opts.threshold ?? null) : null),
      getBoolean: (n: string) =>
        n === 'personas'
          ? (opts.personas ?? null)
          : n === 'enabled'
            ? (opts.enabled ?? null)
            : null,
      getChannel: () => (opts.channel ? { id: opts.channel } : null),
    },
    reply: vi.fn(async (o: InteractionReplyOptions) => {
      replies.push(o);
    }),
    followUp: vi.fn(async (o: InteractionReplyOptions) => {
      replies.push(o);
    }),
  };
  return { interaction, replies };
}

let server: TestServer | null = null;
afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
});

function setup(ownerIds: string[] = []) {
  server = createTestServer();
  const notifyConfig = new NotifyConfigService({
    store: server.store,
    clock: { now: () => 1_800_000_000_000 },
    defaultAnnounceChannelId: '999',
  });
  const handler = createInteractionHandler({
    identity: server.identity,
    economy: server.economy,
    settings: server.settings,
    logger: server.logger,
    ownerIds: new Set(ownerIds),
    allowedGuildIds: server.config.allowedGuildIds,
    requireApproval: server.config.requireApproval,
    notifyConfig,
  });
  return { handler, notifyConfig };
}

function fieldsOf(reply: InteractionReplyOptions): Record<string, string> {
  const json = (
    reply.embeds![0] as { toJSON(): { fields: { name: string; value: string }[] } }
  ).toJSON();
  return Object.fromEntries(json.fields.map((f) => [f.name, f.value]));
}

describe('/admin notifications', () => {
  it('lets a Manage Guild member change channel, threshold and personas', async () => {
    const { handler, notifyConfig } = setup();
    const m = mockAdmin({
      manageGuild: true,
      opts: { channel: '555', threshold: 250_000, personas: false },
    });
    await handler(m.interaction as never);

    const cfg = notifyConfig.getGuildConfig(GUILD);
    expect(cfg.announceChannelId).toBe('555');
    expect(cfg.bigWinThreshold).toBe(250_000);
    expect(cfg.personasEnabled).toBe(false);
    const fields = fieldsOf(m.replies[0]!);
    expect(fields['Announcement Channel']).toBe('<#555>');
    expect(fields['Webhook Personas']).toBe('OFF');
  });

  it('shows the current settings in Japanese without changing anything', async () => {
    const { handler, notifyConfig } = setup();
    const m = mockAdmin({ manageGuild: true, locale: 'ja' });
    await handler(m.interaction as never);
    expect(fieldsOf(m.replies[0]!)['告知チャンネル']).toContain('999');
    expect(notifyConfig.getGuildConfig(GUILD).announceChannelId).toBeNull();
  });

  it('rejects members without Manage Guild and non-owners targeting another guild', async () => {
    const { handler, notifyConfig } = setup();
    const denied = mockAdmin({ manageGuild: false, opts: { threshold: 1 } });
    await handler(denied.interaction as never);
    expect(notifyConfig.getGuildConfig(GUILD).bigWinThreshold).not.toBe(1);

    const cross = mockAdmin({ manageGuild: true, opts: { threshold: 1, guild_id: OTHER_GUILD } });
    await handler(cross.interaction as never);
    expect(notifyConfig.getGuildConfig(OTHER_GUILD).bigWinThreshold).not.toBe(1);
  });

  it('lets an owner configure any guild from a DM and requires guild_id there', async () => {
    const { handler, notifyConfig } = setup([OTHER_USER]);
    const ok = mockAdmin({
      userId: OTHER_USER,
      guildId: null,
      opts: { guild_id: OTHER_GUILD, threshold: 42 },
    });
    await handler(ok.interaction as never);
    expect(notifyConfig.getGuildConfig(OTHER_GUILD).bigWinThreshold).toBe(42);

    const missing = mockAdmin({ userId: OTHER_USER, guildId: null, opts: { threshold: 7 } });
    await handler(missing.interaction as never);
    expect(notifyConfig.getGuildConfig(OTHER_GUILD).bigWinThreshold).toBe(42);

    const nonOwnerDm = mockAdmin({ guildId: null, opts: { guild_id: OTHER_GUILD, threshold: 9 } });
    await handler(nonOwnerDm.interaction as never);
    expect(notifyConfig.getGuildConfig(OTHER_GUILD).bigWinThreshold).toBe(42);
  });
});
