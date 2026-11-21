import { MessageFlags, type InteractionReplyOptions, type User } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GUILD, OTHER_USER, USER, createTestServer, type TestServer } from '../runtime/test-kit.ts';
import { parseLaunchButtonId } from '../notify/discord-port.ts';
import { createInteractionHandler, type BotRouterDeps } from './router.ts';

interface Mock {
  interaction: Record<string, unknown>;
  replies: InteractionReplyOptions[];
}

function mockCommand(params: {
  group?: string;
  sub: string;
  integers?: Record<string, number>;
  strings?: Record<string, string>;
  users?: Record<string, User>;
  id?: string;
}): Mock {
  const replies: InteractionReplyOptions[] = [];
  const user = { id: USER, username: 'alice', globalName: 'Alice', avatar: null } as User;
  const interaction = {
    id: params.id ?? 'ix-1',
    isChatInputCommand: () => true,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    isAutocomplete: () => false,
    commandName: params.group ?? params.sub,
    guildId: GUILD,
    guild: { id: GUILD, name: 'Test Guild', preferredLocale: 'en-US' },
    locale: 'en-US',
    user,
    replied: false,
    deferred: false,
    options: {
      getSubcommandGroup: () => null,
      getSubcommand: () => (params.group ? params.sub : null),
      getUser: (name: string) => params.users?.[name] ?? null,
      getString: (name: string) => params.strings?.[name] ?? null,
      getInteger: (name: string) => params.integers?.[name] ?? null,
      getBoolean: () => null,
      getChannel: () => null,
    },
    reply: vi.fn(async (options: InteractionReplyOptions) => {
      interaction.replied = true;
      replies.push(options);
    }),
    followUp: vi.fn(async (options: InteractionReplyOptions) => {
      replies.push(options);
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

function makeHandler(overrides: Partial<BotRouterDeps> = {}) {
  server = createTestServer();
  return createInteractionHandler({
    identity: server.identity,
    economy: server.economy,
    settings: server.settings,
    logger: server.logger,
    ownerIds: server.config.ownerIds,
    allowedGuildIds: server.config.allowedGuildIds,
    requireApproval: server.config.requireApproval,
    launchIntents: server.launchIntents,
    store: server.store,
    casino: server.casino,
    finance: server.finance,
    games: server.games,
    ...overrides,
  });
}

function embedOf(reply: InteractionReplyOptions): Record<string, unknown> {
  return (reply.embeds![0] as { toJSON(): Record<string, unknown> }).toJSON();
}

describe('wired commands', () => {
  it('claims the daily bonus and attaches a LAUNCH_ACTIVITY button for the daily screen', async () => {
    const handler = makeHandler();
    const m = mockCommand({ group: 'pelica', sub: 'daily' });
    await handler(m.interaction as never);

    expect(m.replies).toHaveLength(1);
    const row = (
      m.replies[0]!.components![0] as { toJSON(): { components: { custom_id: string }[] } }
    ).toJSON();
    expect(parseLaunchButtonId(row.components[0]!.custom_id)).toBe('daily');
    expect(embedOf(m.replies[0]!).title).toBeTruthy();

    // Second claim in the same window says it was already claimed (no error, no second credit).
    const again = mockCommand({ group: 'pelica', sub: 'daily', id: 'ix-2' });
    await handler(again.interaction as never);
    expect(String(embedOf(again.replies[0]!).description)).toContain('Already claimed');
  });

  it('plays slots through the casino service with a per-interaction idempotency key', async () => {
    const handler = makeHandler();
    const before = server!.economy.getBalance(GUILD, USER);
    const m = mockCommand({ group: 'casino', sub: 'slots', integers: { bet: 100 }, id: 'slots-1' });
    await handler(m.interaction as never);
    expect(m.replies).toHaveLength(1);
    const after = server!.economy.getBalance(GUILD, USER);
    expect(after).not.toBe(before);

    // Replaying the same interaction id does not charge twice.
    const replay = mockCommand({
      group: 'casino',
      sub: 'slots',
      integers: { bet: 100 },
      id: 'slots-1',
    });
    await handler(replay.interaction as never);
    expect(server!.economy.getBalance(GUILD, USER)).toBe(after);
  });

  it('moves money for /pelica transfer and maps domain errors to app errors', async () => {
    const handler = makeHandler();
    const other = { id: OTHER_USER, username: 'bob', globalName: null, avatar: null } as User;
    const self = mockCommand({
      group: 'pelica',
      sub: 'transfer',
      integers: { amount: 100 },
      users: { member: { id: USER, username: 'alice', globalName: 'Alice', avatar: null } as User },
    });
    await handler(self.interaction as never);
    expect(self.replies[0]!.flags).toBe(MessageFlags.Ephemeral);
    expect(String(embedOf(self.replies[0]!).description)).not.toContain('→');

    const big = mockCommand({
      group: 'pelica',
      sub: 'transfer',
      integers: { amount: 1 },
      users: { member: other },
      id: 'tr-1',
    });
    await handler(big.interaction as never);
    // Brand-new accounts have not played enough games to transfer: refused with a localized error.
    expect(big.replies).toHaveLength(1);
    expect(big.replies[0]!.flags).toBe(MessageFlags.Ephemeral);
  });

  it('falls back to coming soon when the backing service is not provided', async () => {
    const handler = makeHandler({ games: undefined, casino: undefined });
    const m = mockCommand({ group: 'casino', sub: 'slots', integers: { bet: 100 } });
    await handler(m.interaction as never);
    expect(String(embedOf(m.replies[0]!).title)).toContain('Coming');
  });
});
