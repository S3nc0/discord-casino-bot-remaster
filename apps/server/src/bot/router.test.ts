import { MessageFlags, type InteractionReplyOptions, type User } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_BALANCE } from '../economy/economy-service.ts';
import {
  GUILD,
  OTHER_GUILD,
  OTHER_USER,
  USER,
  createTestServer,
  type TestServer,
} from '../runtime/test-kit.ts';
import { OPEN_ACTIVITY_BUTTON_ID, createInteractionHandler } from './router.ts';
import { botColor } from './theme.ts';

interface CapturedReply {
  options: InteractionReplyOptions;
}

function makeUser(id: string, username: string, globalName: string | null = null): User {
  return {
    id,
    username,
    globalName,
    avatar: null,
  } as unknown as User;
}

function createMockCommandInteraction(params: {
  commandName: string;
  subcommandGroup?: string | null;
  subcommand?: string | null;
  guildId?: string | null;
  guildPreferredLocale?: string | null;
  locale?: string;
  user?: User;
  users?: Record<string, User | null>;
  strings?: Record<string, string | null>;
}) {
  const replies: CapturedReply[] = [];
  const interaction = {
    isChatInputCommand: () => true,
    isButton: () => false,
    commandName: params.commandName,
    guildId: params.guildId === undefined ? GUILD : params.guildId,
    guild:
      params.guildId === null
        ? null
        : {
            id: params.guildId ?? GUILD,
            name: 'Test Guild',
            preferredLocale: params.guildPreferredLocale ?? 'en-US',
          },
    locale: params.locale ?? 'en-US',
    user: params.user ?? makeUser(USER, 'alice', 'Alice'),
    replied: false,
    deferred: false,
    options: {
      getSubcommandGroup: () => params.subcommandGroup ?? null,
      getSubcommand: () => params.subcommand ?? null,
      getUser: (name: string) => params.users?.[name] ?? null,
      getString: (name: string) => params.strings?.[name] ?? null,
    },
    reply: vi.fn(async (options: InteractionReplyOptions) => {
      interaction.replied = true;
      replies.push({ options });
    }),
    followUp: vi.fn(async (options: InteractionReplyOptions) => {
      replies.push({ options });
    }),
  };
  return { interaction, replies };
}

function createMockButtonInteraction(params: {
  customId: string;
  guildId?: string | null;
  locale?: string;
  user?: User;
}) {
  const replies: CapturedReply[] = [];
  const interaction = {
    isChatInputCommand: () => false,
    isButton: () => true,
    customId: params.customId,
    guildId: params.guildId === undefined ? GUILD : params.guildId,
    guild:
      params.guildId === null
        ? null
        : { id: params.guildId ?? GUILD, name: 'Test Guild', preferredLocale: 'en-US' },
    locale: params.locale ?? 'en-US',
    user: params.user ?? makeUser(USER, 'alice', 'Alice'),
    replied: false,
    deferred: false,
    reply: vi.fn(async (options: InteractionReplyOptions) => {
      interaction.replied = true;
      replies.push({ options });
    }),
    followUp: vi.fn(async (options: InteractionReplyOptions) => {
      replies.push({ options });
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

describe('interaction router', () => {
  it('implements /pelica balance (creates self account, skips creation for missing member, adds Activity button)', async () => {
    server = createTestServer();
    const handler = createInteractionHandler({
      identity: server.identity,
      economy: server.economy,
      settings: server.settings,
      logger: server.logger,
      ownerIds: server.config.ownerIds,
      allowedGuildIds: server.config.allowedGuildIds,
      requireApproval: server.config.requireApproval,
    });

    // Self balance: creates account with 3,000 Pelica and replies publicly with Bitbloom primary + Activity button.
    const self = createMockCommandInteraction({
      commandName: 'pelica',
      subcommand: 'balance',
    });
    await handler(self.interaction as never);

    expect(server.economy.hasAccount(GUILD, USER)).toBe(true);
    expect(server.economy.getBalance(GUILD, USER)).toBe(INITIAL_BALANCE);
    expect(self.replies).toHaveLength(1);
    const selfReply = self.replies[0]!.options;
    expect(selfReply.flags).toBeUndefined();
    const selfEmbed = (selfReply.embeds![0] as { toJSON(): Record<string, unknown> }).toJSON();
    expect(selfEmbed.color).toBe(botColor('primary'));
    expect(selfEmbed.title).toBe("Alice's Balance");
    expect(JSON.stringify(selfEmbed.fields)).toContain('3,000 Pelica');
    expect(selfReply.components).toHaveLength(1);

    // Other member without account: must NOT create an account for OTHER_USER.
    const target = makeUser(OTHER_USER, 'bob', 'Bob');
    const other = createMockCommandInteraction({
      commandName: 'pelica',
      subcommand: 'balance',
      locale: 'ja',
      users: { member: target },
    });
    await handler(other.interaction as never);

    expect(server.economy.hasAccount(GUILD, OTHER_USER)).toBe(false);
    const otherEmbed = (
      other.replies[0]!.options.embeds![0] as { toJSON(): Record<string, unknown> }
    ).toJSON();
    expect(otherEmbed.title).toBe('Bob の残高');
    expect(otherEmbed.description).toBe('まだ口座がありません。');
  });

  it('implements /settings to view and persist language immediately', async () => {
    server = createTestServer();
    const handler = createInteractionHandler({
      identity: server.identity,
      economy: server.economy,
      settings: server.settings,
      logger: server.logger,
      ownerIds: server.config.ownerIds,
      allowedGuildIds: server.config.allowedGuildIds,
      requireApproval: server.config.requireApproval,
    });

    // Update language to Japanese while interaction.locale is en-US; confirmation replies in Japanese immediately.
    const setJa = createMockCommandInteraction({
      commandName: 'settings',
      guildId: null,
      locale: 'en-US',
      strings: { language: 'ja' },
    });
    await handler(setJa.interaction as never);

    expect(server.settings.get(USER).language).toBe('ja');
    expect(setJa.replies[0]!.options.flags).toBe(MessageFlags.Ephemeral);
    const setJaEmbed = (
      setJa.replies[0]!.options.embeds![0] as { toJSON(): Record<string, unknown> }
    ).toJSON();
    expect(setJaEmbed.title).toBe('設定');
    expect(setJaEmbed.description).toContain('言語を **日本語** に変更しました');

    // Viewing settings afterwards uses the saved JA locale even when Discord locale is en-US.
    const view = createMockCommandInteraction({
      commandName: 'settings',
      guildId: null,
      locale: 'en-US',
    });
    await handler(view.interaction as never);

    const viewEmbed = (
      view.replies[0]!.options.embeds![0] as { toJSON(): Record<string, unknown> }
    ).toJSON();
    expect(viewEmbed.description).toContain('言語設定: **日本語**');
  });

  it('implements /help and the Open in Activity placeholder button in user locale', async () => {
    server = createTestServer();
    const handler = createInteractionHandler({
      identity: server.identity,
      economy: server.economy,
      settings: server.settings,
      logger: server.logger,
      ownerIds: server.config.ownerIds,
      allowedGuildIds: server.config.allowedGuildIds,
      requireApproval: server.config.requireApproval,
    });

    const help = createMockCommandInteraction({
      commandName: 'help',
      locale: 'ja',
    });
    await handler(help.interaction as never);

    expect(help.replies[0]!.options.flags).toBe(MessageFlags.Ephemeral);
    expect(help.replies[0]!.options.components).toHaveLength(1);
    const helpEmbed = (
      help.replies[0]!.options.embeds![0] as { toJSON(): Record<string, unknown> }
    ).toJSON();
    expect(helpEmbed.title).toBe('カジノ案内');

    const btn = createMockButtonInteraction({
      customId: OPEN_ACTIVITY_BUTTON_ID,
      locale: 'en-US',
    });
    await handler(btn.interaction as never);

    expect(btn.replies[0]!.options.flags).toBe(MessageFlags.Ephemeral);
    const btnEmbed = (
      btn.replies[0]!.options.embeds![0] as { toJSON(): Record<string, unknown> }
    ).toJSON();
    expect(btnEmbed.description).toBe('Activity launch is coming in the next update.');
  });

  it('answers unimplemented commands with a localized coming soon message', async () => {
    server = createTestServer();
    const handler = createInteractionHandler({
      identity: server.identity,
      economy: server.economy,
      settings: server.settings,
      logger: server.logger,
      ownerIds: server.config.ownerIds,
      allowedGuildIds: server.config.allowedGuildIds,
      requireApproval: server.config.requireApproval,
    });

    const cmd = createMockCommandInteraction({
      commandName: 'casino',
      subcommand: 'chinchiro',
      locale: 'ja',
    });
    await handler(cmd.interaction as never);

    expect(cmd.replies[0]!.options.flags).toBe(MessageFlags.Ephemeral);
    const embed = (
      cmd.replies[0]!.options.embeds![0] as { toJSON(): Record<string, unknown> }
    ).toJSON();
    expect(embed.color).toBe(botColor('warning'));
    expect(embed.title).toBe('準備中');
    expect(embed.description).toBe('`/casino chinchiro` は準備中です。');
  });

  it('enforces owner-only DM gate on /admin and guild/approval gates on guild commands', async () => {
    server = createTestServer({ env: { REQUIRE_APPROVAL: '1' } });
    const handler = createInteractionHandler({
      identity: server.identity,
      economy: server.economy,
      settings: server.settings,
      logger: server.logger,
      ownerIds: server.config.ownerIds,
      allowedGuildIds: server.config.allowedGuildIds,
      requireApproval: server.config.requireApproval,
    });

    // Non-owner invoking /admin in DM -> rejected ephemerally.
    const nonOwnerAdmin = createMockCommandInteraction({
      commandName: 'admin',
      subcommand: 'grant',
      guildId: null,
      user: makeUser(OTHER_USER, 'bob'),
    });
    await handler(nonOwnerAdmin.interaction as never);
    const nonOwnerEmbed = (
      nonOwnerAdmin.replies[0]!.options.embeds![0] as { toJSON(): Record<string, unknown> }
    ).toJSON();
    expect(nonOwnerEmbed.color).toBe(botColor('error'));
    expect(nonOwnerEmbed.description).toBe('Only bot owners can use this command.');

    // Owner invoking /admin inside a guild -> rejected as DM-only.
    const guildAdmin = createMockCommandInteraction({
      commandName: 'admin',
      subcommand: 'grant',
      guildId: GUILD,
      user: makeUser(USER, 'alice'),
    });
    await handler(guildAdmin.interaction as never);
    const guildAdminEmbed = (
      guildAdmin.replies[0]!.options.embeds![0] as { toJSON(): Record<string, unknown> }
    ).toJSON();
    expect(guildAdminEmbed.description).toBe('Use this command in DMs with the bot.');

    // Owner invoking /admin in DM -> passes gate (currently hits coming soon).
    const ownerAdmin = createMockCommandInteraction({
      commandName: 'admin',
      subcommand: 'grant',
      guildId: null,
      user: makeUser(USER, 'alice'),
    });
    await handler(ownerAdmin.interaction as never);
    const ownerAdminEmbed = (
      ownerAdmin.replies[0]!.options.embeds![0] as { toJSON(): Record<string, unknown> }
    ).toJSON();
    expect(ownerAdminEmbed.title).toBe('Coming Soon');

    // Non-owner invoking guild command in DM -> rejected as guild-only.
    const dmPelica = createMockCommandInteraction({
      commandName: 'pelica',
      subcommand: 'balance',
      guildId: null,
      user: makeUser(OTHER_USER, 'bob'),
    });
    await handler(dmPelica.interaction as never);
    const dmPelicaEmbed = (
      dmPelica.replies[0]!.options.embeds![0] as { toJSON(): Record<string, unknown> }
    ).toJSON();
    expect(dmPelicaEmbed.description).toBe('Use this command in a server.');

    // Non-owner in unapproved guild -> guild_pending localized error.
    const pendingGuildCmd = createMockCommandInteraction({
      commandName: 'pelica',
      subcommand: 'balance',
      guildId: OTHER_GUILD,
      user: makeUser(OTHER_USER, 'bob'),
      locale: 'ja',
    });
    await handler(pendingGuildCmd.interaction as never);
    const pendingEmbed = (
      pendingGuildCmd.replies[0]!.options.embeds![0] as { toJSON(): Record<string, unknown> }
    ).toJSON();
    expect(pendingEmbed.description).toBe('このサーバーは承認待ちです。');
  });

  it('catches unexpected errors and replies with a localized internal error message', async () => {
    server = createTestServer();
    const brokenEconomy = {
      ...server.economy,
      ensureMember: () => {
        throw new Error('database exploded');
      },
    } as never;

    const handler = createInteractionHandler({
      identity: server.identity,
      economy: brokenEconomy,
      settings: server.settings,
      logger: server.logger,
      ownerIds: server.config.ownerIds,
      allowedGuildIds: server.config.allowedGuildIds,
      requireApproval: server.config.requireApproval,
    });

    const cmd = createMockCommandInteraction({
      commandName: 'pelica',
      subcommand: 'balance',
      locale: 'ja',
    });
    await handler(cmd.interaction as never);

    expect(cmd.replies[0]!.options.flags).toBe(MessageFlags.Ephemeral);
    const embed = (
      cmd.replies[0]!.options.embeds![0] as { toJSON(): Record<string, unknown> }
    ).toJSON();
    expect(embed.color).toBe(botColor('error'));
    expect(embed.description).toBe('エラーが起きました。もう一度試してください。');
  });
});
