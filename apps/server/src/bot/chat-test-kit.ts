// Fake Discord interactions for the chat-command tests. Not imported by production code.
import type { InteractionReplyOptions, User } from 'discord.js';
import { vi } from 'vitest';
import {
  GUILD,
  OTHER_USER,
  START_MS,
  USER,
  createTestServer,
  type TestServer,
} from '../runtime/test-kit.ts';
import { createInteractionHandler, type BotRouterDeps } from './router.ts';

export { GUILD, OTHER_USER, USER, createTestServer };

export interface Out {
  kind: 'reply' | 'followUp' | 'update' | 'editReply' | 'modal';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options: any;
}

export function makeUser(id: string, username = 'user', globalName: string | null = null): User {
  return { id, username, globalName, avatar: null } as unknown as User;
}

export interface FakeChannel {
  id: string;
  guildId: string | null;
  sent: unknown[];
  edits: { id: string; options: unknown }[];
  deleted: string[];
  /** One entry per `bulkDelete` call: the ids it was given. */
  bulkDeleted: string[][];
  messages: Map<
    string,
    {
      id: string;
      author: { id: string };
      createdTimestamp: number;
      delete(): Promise<void>;
      edit(o: unknown): Promise<unknown>;
    }
  >;
}

/** A bot message of the fake channel: an id, or an id with its age in ms (default: just posted). */
export type FakeBotMessage = string | { id: string; ageMs: number };

export function fakeChannel(
  id: string,
  botMessages: FakeBotMessage[] = [],
  guildId: string | null = GUILD,
): FakeChannel & Record<string, unknown> {
  const channel = {
    id,
    guildId,
    sent: [] as unknown[],
    edits: [] as { id: string; options: unknown }[],
    deleted: [] as string[],
    bulkDeleted: [] as string[][],
    messages: new Map(),
    isTextBased: () => true,
    send: vi.fn(async (options: unknown) => {
      channel.sent.push(options);
      return {
        id: `msg-${channel.sent.length}`,
        url: `https://discord.test/${id}/${channel.sent.length}`,
      };
    }),
  } as unknown as FakeChannel & Record<string, unknown>;
  const store = channel.messages;
  (channel as Record<string, unknown>).bulkDelete = vi.fn(async (ids: string[]) => {
    channel.bulkDeleted.push([...ids]);
    for (const mid of ids) {
      channel.deleted.push(mid);
      store.delete(mid);
    }
    return new Map(ids.map((mid) => [mid, null]));
  });
  for (const entry of botMessages) {
    const mid = typeof entry === 'string' ? entry : entry.id;
    const ageMs = typeof entry === 'string' ? 0 : entry.ageMs;
    store.set(mid, {
      id: mid,
      author: { id: 'bot' },
      createdTimestamp: START_MS - ageMs,
      delete: async () => {
        channel.deleted.push(mid);
        store.delete(mid);
      },
      edit: async (options: unknown) => {
        channel.edits.push({ id: mid, options });
        return undefined;
      },
    });
  }
  (channel as Record<string, unknown>).messages = {
    fetch: async (arg: string | { limit: number; before?: string }) => {
      if (typeof arg === 'string') {
        const m = store.get(arg);
        if (!m) throw new Error('unknown message');
        return m;
      }
      return new Map(store);
    },
  };
  return channel;
}

export function fakeClient(channels: FakeChannel[] = [], guilds: Record<string, unknown> = {}) {
  const byId = new Map(channels.map((c) => [c.id, c]));
  return {
    user: { id: 'bot' },
    isReady: () => true,
    channels: { fetch: async (id: string) => byId.get(id) ?? null },
    guilds: { cache: new Map(Object.entries(guilds)) },
  };
}

export interface CommandSpec {
  /** `casino`, `pelica`, ... (the top-level command name). */
  name: string;
  group?: string;
  sub?: string;
  id?: string;
  guildId?: string | null;
  channelId?: string | null;
  locale?: string;
  user?: User;
  integers?: Record<string, number>;
  numbers?: Record<string, number>;
  strings?: Record<string, string>;
  booleans?: Record<string, boolean>;
  users?: Record<string, User>;
  channels?: Record<string, { id: string }>;
  attachments?: Record<string, { name: string; url: string; size: number; contentType: string }>;
  client?: ReturnType<typeof fakeClient>;
  manageGuild?: boolean;
}

function baseInteraction(spec: {
  id: string;
  guildId: string | null;
  channelId: string | null;
  locale: string;
  user: User;
  client: ReturnType<typeof fakeClient>;
}) {
  const out: Out[] = [];
  const interaction: Record<string, unknown> & { replied: boolean; deferred: boolean } = {
    id: spec.id,
    guildId: spec.guildId,
    channelId: spec.channelId,
    guild: spec.guildId ? { id: spec.guildId, name: 'Test Guild', preferredLocale: 'en-US' } : null,
    locale: spec.locale,
    user: spec.user,
    client: spec.client,
    replied: false,
    deferred: false,
    memberPermissions: { has: () => true },
    isChatInputCommand: () => false,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    isAutocomplete: () => false,
    reply: vi.fn(async (options: unknown) => {
      interaction.replied = true;
      out.push({ kind: 'reply', options });
    }),
    followUp: vi.fn(async (options: unknown) => {
      out.push({ kind: 'followUp', options });
    }),
    update: vi.fn(async (options: unknown) => {
      interaction.replied = true;
      out.push({ kind: 'update', options });
    }),
    editReply: vi.fn(async (options: unknown) => {
      out.push({ kind: 'editReply', options });
    }),
    fetchReply: vi.fn(async () => ({
      id: `reply-${spec.id}`,
      channelId: spec.channelId ?? 'chan-1',
    })),
    showModal: vi.fn(async (modal: unknown) => {
      interaction.replied = true;
      out.push({ kind: 'modal', options: modal });
    }),
  };
  return { interaction, out };
}

export function command(spec: CommandSpec) {
  const user = spec.user ?? makeUser(USER, 'alice', 'Alice');
  const { interaction, out } = baseInteraction({
    id: spec.id ?? `ix-${Math.random().toString(36).slice(2)}`,
    guildId: spec.guildId === undefined ? GUILD : spec.guildId,
    channelId: spec.channelId === undefined ? 'chan-1' : spec.channelId,
    locale: spec.locale ?? 'en-US',
    user,
    client: spec.client ?? fakeClient(),
  });
  const pick = <T>(
    map: Record<string, T> | undefined,
    name: string,
    required?: boolean,
  ): T | null => {
    const v = map?.[name];
    if (v === undefined) {
      if (required) throw new Error(`missing required option ${name}`);
      return null;
    }
    return v;
  };
  Object.assign(interaction, {
    commandName: spec.name,
    isChatInputCommand: () => true,
    memberPermissions: { has: () => spec.manageGuild ?? false },
    options: {
      getSubcommandGroup: () => spec.group ?? null,
      getSubcommand: () => spec.sub ?? null,
      getUser: (n: string, r?: boolean) => pick(spec.users, n, r),
      getString: (n: string, r?: boolean) => pick(spec.strings, n, r),
      getInteger: (n: string, r?: boolean) => pick(spec.integers, n, r),
      getNumber: (n: string, r?: boolean) => pick(spec.numbers, n, r),
      getBoolean: (n: string) => pick(spec.booleans, n),
      getChannel: (n: string) => pick(spec.channels, n),
      getAttachment: (n: string, r?: boolean) => pick(spec.attachments, n, r),
    },
  });
  return { interaction, out };
}

export function button(
  customId: string,
  spec: Partial<CommandSpec> & { message?: { embeds?: unknown[] } } = {},
) {
  const user = spec.user ?? makeUser(USER, 'alice', 'Alice');
  const { interaction, out } = baseInteraction({
    id: spec.id ?? `bx-${Math.random().toString(36).slice(2)}`,
    guildId: spec.guildId === undefined ? GUILD : spec.guildId,
    channelId: spec.channelId === undefined ? 'chan-1' : spec.channelId,
    locale: spec.locale ?? 'en-US',
    user,
    client: spec.client ?? fakeClient(),
  });
  Object.assign(interaction, {
    customId,
    isButton: () => true,
    launchActivity: vi.fn(),
    ...(spec.message ? { message: spec.message } : {}),
  });
  return { interaction, out };
}

export function select(customId: string, values: string[], spec: Partial<CommandSpec> = {}) {
  const made = button(customId, spec);
  Object.assign(made.interaction, {
    isButton: () => false,
    isStringSelectMenu: () => true,
    values,
  });
  return made;
}

export function modalSubmit(
  customId: string,
  fields: Record<string, string>,
  spec: Partial<CommandSpec> = {},
) {
  const made = button(customId, spec);
  Object.assign(made.interaction, {
    isButton: () => false,
    isModalSubmit: () => true,
    fields: {
      getTextInputValue: (name: string) => {
        if (!(name in fields)) throw new Error(`no field ${name}`);
        return fields[name];
      },
    },
  });
  return made;
}

export function autocomplete(
  commandName: string,
  focused: { name: string; value: string },
  other: Record<string, string> = {},
  spec: Partial<CommandSpec> = {},
) {
  const made = button('', spec);
  const responses: unknown[] = [];
  Object.assign(made.interaction, {
    commandName,
    isButton: () => false,
    isAutocomplete: () => true,
    options: {
      getFocused: () => focused,
      getString: (n: string) => other[n] ?? null,
    },
    respond: vi.fn(async (choices: unknown) => {
      responses.push(choices);
    }),
  });
  return { interaction: made.interaction, responses };
}

export function makeHandler(server: TestServer, overrides: Partial<BotRouterDeps> = {}) {
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
    pins: server.postPins,
    stream: server.stream,
    clock: server.clock,
    ...overrides,
  });
}

export function embedOf(
  options: InteractionReplyOptions | { embeds?: unknown[] },
  index = 0,
): {
  title?: string;
  description?: string;
  fields?: { name: string; value: string }[];
  footer?: { text: string };
} {
  return (options.embeds![index] as { toJSON(): never }).toJSON();
}

export function customIds(options: { components?: unknown[] }): string[] {
  const ids: string[] = [];
  for (const row of options.components ?? []) {
    const json = (row as { toJSON(): { components: { custom_id?: string }[] } }).toJSON();
    for (const c of json.components) if (c.custom_id) ids.push(c.custom_id);
  }
  return ids;
}

export function allText(options: { embeds?: unknown[] }): string {
  return (options.embeds ?? [])
    .map((e) => {
      const j = (e as { toJSON(): never }).toJSON() as {
        title?: string;
        description?: string;
        fields?: { name: string; value: string }[];
      };
      return [j.title, j.description, ...(j.fields ?? []).flatMap((f) => [f.name, f.value])].join(
        '\n',
      );
    })
    .join('\n');
}

export function ledgerReasons(server: TestServer, userId = USER, guildId = GUILD): string[] {
  return server.economy.history(guildId, userId, 100).map((e) => e.reason);
}
