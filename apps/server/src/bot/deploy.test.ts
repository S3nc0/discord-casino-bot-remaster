import { ApplicationCommandType, Routes } from 'discord.js';
import { afterEach, describe, expect, it } from 'vitest';
import { GUILD } from '../runtime/test-kit.ts';
import { buildSlashCommands } from './commands.ts';
import {
  PLACEHOLDER_DISCORD_TOKEN,
  deployCommands,
  dmRequiredCommandNames,
  runDeployCli,
  type DeployRestClient,
} from './deploy.ts';

const CLIENT_ID = '345678901234567890';
const TOKEN = 'fake-token-for-tests-only';
const GLOBAL_ROUTE = Routes.applicationCommands(CLIENT_ID);
const GUILD_ROUTE = Routes.applicationGuildCommands(CLIENT_ID, GUILD);
const ALL = buildSlashCommands();

const ENTRY_POINT = {
  id: '111111111111111111',
  application_id: CLIENT_ID,
  version: '222222222222222222',
  type: ApplicationCommandType.PrimaryEntryPoint,
  name: 'launch',
  name_localizations: null,
  description: '',
  description_localizations: null,
  default_member_permissions: null,
  dm_permission: true,
  nsfw: false,
  integration_types: [0, 1],
  contexts: [0, 1, 2],
  handler: 2,
};

interface Call {
  method: 'get' | 'put' | 'post';
  route: string;
  body?: unknown;
}

function fakeRest(globalCommands: unknown[] | Error = []): DeployRestClient & {
  calls: Call[];
  token: string;
} {
  const fake = {
    calls: [] as Call[],
    token: '',
    setToken(token: string) {
      fake.token = token;
      return fake;
    },
    async get(route: `/${string}`) {
      fake.calls.push({ method: 'get', route });
      if (globalCommands instanceof Error) throw globalCommands;
      return globalCommands;
    },
    async put(route: `/${string}`, options: { body: unknown }) {
      fake.calls.push({ method: 'put', route, body: options.body });
      return options.body;
    },
    async post(route: `/${string}`, options: { body: unknown }) {
      fake.calls.push({ method: 'post', route, body: options.body });
      return options.body;
    },
  };
  return fake;
}

function names(body: unknown): string[] {
  return (body as { name: string }[]).map((cmd) => cmd.name);
}

const savedExitCode = process.exitCode;
afterEach(() => {
  process.exitCode = savedExitCode;
});

describe('dmRequiredCommandNames', () => {
  it('is admin today (every other command works in a server)', () => {
    expect([...dmRequiredCommandNames()]).toEqual(['admin']);
    expect(ALL.some((cmd) => cmd.name === 'admin')).toBe(true);
  });
});

describe('deployCommands: global', () => {
  it('reads first, then PUTs every command plus the Entry Point, unchanged', async () => {
    const rest = fakeRest([{ ...ALL[0], id: '333', type: 1 }, ENTRY_POINT]);
    const result = await deployCommands({
      token: TOKEN,
      clientId: CLIENT_ID,
      scope: 'global',
      rest,
    });

    expect(rest.token).toBe(TOKEN);
    expect(rest.calls.map((c) => c.method)).toEqual(['get', 'put']);
    expect(rest.calls[0]!.route).toBe(GLOBAL_ROUTE);
    const put = rest.calls[1]!;
    expect(put.route).toBe(GLOBAL_ROUTE);
    const body = put.body as Record<string, unknown>[];
    expect(body).toHaveLength(ALL.length + 1);
    expect(names(body.slice(0, ALL.length))).toEqual(ALL.map((cmd) => cmd.name));
    const { application_id: _app, version: _ver, ...putFields } = ENTRY_POINT;
    expect(body[ALL.length]).toEqual(putFields);

    expect(result.route).toBe(GLOBAL_ROUTE);
    expect(result.count).toBe(ALL.length);
    expect(result.entryPointsKept).toEqual(['launch']);
  });

  it('works when the app has no Entry Point', async () => {
    const rest = fakeRest([]);
    const result = await deployCommands({
      token: TOKEN,
      clientId: CLIENT_ID,
      scope: 'global',
      rest,
    });
    expect(names(rest.calls[1]!.body)).toEqual(ALL.map((cmd) => cmd.name));
    expect(result.entryPointsKept).toEqual([]);
  });

  it('aborts without writing when the GET fails', async () => {
    const rest = fakeRest(new Error('503 Service Unavailable'));
    await expect(
      deployCommands({ token: TOKEN, clientId: CLIENT_ID, scope: 'global', rest }),
    ).rejects.toThrow(/nothing was changed/);
    expect(rest.calls.map((c) => c.method)).toEqual(['get']);
  });

  it('aborts without writing when the GET reply is not a list', async () => {
    const rest = fakeRest();
    rest.get = async (route) => {
      rest.calls.push({ method: 'get', route });
      return { message: 'odd' };
    };
    await expect(
      deployCommands({ token: TOKEN, clientId: CLIENT_ID, scope: 'global', rest }),
    ).rejects.toThrow(/nothing was changed/);
    expect(rest.calls.map((c) => c.method)).toEqual(['get']);
  });
});

describe('deployCommands: guild', () => {
  it('PUTs the guild set without admin and POSTs admin globally', async () => {
    const rest = fakeRest([ENTRY_POINT]);
    const result = await deployCommands({
      token: TOKEN,
      clientId: CLIENT_ID,
      scope: 'guild',
      guildId: GUILD,
      rest,
    });

    expect(rest.calls.map((c) => [c.method, c.route])).toEqual([
      ['get', GLOBAL_ROUTE],
      ['put', GUILD_ROUTE],
      ['post', GLOBAL_ROUTE],
    ]);
    const guildNames = names(rest.calls[1]!.body);
    expect(guildNames).not.toContain('admin');
    expect(guildNames).toEqual(ALL.map((cmd) => cmd.name).filter((name) => name !== 'admin'));
    expect((rest.calls[2]!.body as { name: string }).name).toBe('admin');
    // The global POST is a single command; the Entry Point is never sent or deleted.
    expect(rest.calls.some((c) => c.method === 'put' && c.route === GLOBAL_ROUTE)).toBe(false);

    expect(result.route).toBe(GUILD_ROUTE);
    expect(result.count).toBe(ALL.length - 1);
    expect(result.globalUpserts).toEqual(['admin']);
    expect(result.skippedAlreadyGlobal).toEqual([]);
  });

  it('skips commands already registered globally so the test server never shows them twice', async () => {
    const globalAfterFullDeploy = [
      ...ALL.map((cmd, i) => ({ ...cmd, id: String(1000 + i), type: 1 })),
      ENTRY_POINT,
    ];
    const rest = fakeRest(globalAfterFullDeploy);
    const result = await deployCommands({
      token: TOKEN,
      clientId: CLIENT_ID,
      scope: 'guild',
      guildId: GUILD,
      rest,
    });
    // The guild copies are cleared; admin is still refreshed globally.
    expect(rest.calls[1]).toMatchObject({ method: 'put', route: GUILD_ROUTE, body: [] });
    expect(rest.calls[2]).toMatchObject({ method: 'post', route: GLOBAL_ROUTE });
    expect(result.skippedAlreadyGlobal).toEqual(
      ALL.map((cmd) => cmd.name).filter((name) => name !== 'admin'),
    );
  });

  it('a global context-menu command with the same name does not cause a skip', async () => {
    const rest = fakeRest([{ id: '9', type: ApplicationCommandType.User, name: ALL[0]!.name }]);
    const result = await deployCommands({
      token: TOKEN,
      clientId: CLIENT_ID,
      scope: 'guild',
      guildId: GUILD,
      rest,
    });
    expect(result.skippedAlreadyGlobal).toEqual([]);
  });

  it('aborts without writing when the GET fails', async () => {
    const rest = fakeRest(new Error('timeout'));
    await expect(
      deployCommands({ token: TOKEN, clientId: CLIENT_ID, scope: 'guild', guildId: GUILD, rest }),
    ).rejects.toThrow(/nothing was changed/);
    expect(rest.calls.map((c) => c.method)).toEqual(['get']);
  });
});

describe('deployCommands: input checks', () => {
  it('refuses a placeholder token, a missing client id or a guild deploy without guildId', async () => {
    const rest = fakeRest();
    await expect(
      deployCommands({
        token: PLACEHOLDER_DISCORD_TOKEN,
        clientId: CLIENT_ID,
        scope: 'global',
        rest,
      }),
    ).rejects.toThrow();
    await expect(
      deployCommands({ token: TOKEN, clientId: '', scope: 'global', rest }),
    ).rejects.toThrow();
    await expect(
      deployCommands({ token: TOKEN, clientId: CLIENT_ID, scope: 'guild', rest }),
    ).rejects.toThrow();
    expect(rest.calls).toEqual([]);
  });
});

describe('runDeployCli', () => {
  const config = () => ({
    discord: { token: TOKEN, clientId: CLIENT_ID, clientSecret: 'x', publicKey: 'y' },
    testGuildId: GUILD,
  });

  function capture() {
    const lines: string[] = [];
    return {
      lines,
      log: (line: string) => lines.push(line),
      error: (line: string) => lines.push(line),
    };
  }

  it('dry-run prints the command list and makes no requests', async () => {
    const out = capture();
    const rest = fakeRest();
    let configLoaded = false;
    await runDeployCli('guild', {
      args: ['--dry-run'],
      rest,
      loadConfig: () => {
        configLoaded = true;
        return config();
      },
      ...out,
    });
    expect(out.lines[0]).toBe(`[dry-run] scope=guild commands=${ALL.length}`);
    expect(out.lines.slice(1)).toEqual(
      ALL.map((cmd) => `- /${cmd.name} (ja: ${cmd.name_localizations?.ja ?? '-'})`),
    );
    expect(rest.calls).toEqual([]);
    expect(configLoaded).toBe(false);
  });

  it('guild deploy says what went where and never prints the token', async () => {
    const out = capture();
    const rest = fakeRest([ENTRY_POINT]);
    await runDeployCli('guild', { args: [], rest, loadConfig: config, ...out });
    const text = out.lines.join('\n');
    expect(text).toContain(`Test server (guild ${GUILD}): registered ${ALL.length - 1} commands`);
    expect(text).toContain('Global, one by one (needed in DMs with the bot): /admin');
    expect(text).toContain('up to an hour');
    expect(text).not.toContain(TOKEN);
  });

  it('global deploy reports the kept Entry Point and never prints the token', async () => {
    const out = capture();
    const rest = fakeRest([ENTRY_POINT]);
    await runDeployCli('global', { args: [], rest, loadConfig: config, ...out });
    const text = out.lines.join('\n');
    expect(text).toContain(`registered ${ALL.length} commands`);
    expect(text).toContain('Kept the Activity Entry Point command unchanged: /launch');
    expect(text).toContain('up to an hour');
    expect(text).not.toContain(TOKEN);
  });

  it('a failed GET surfaces an error without the token and without writing', async () => {
    const out = capture();
    const rest = fakeRest(new Error('401 Unauthorized'));
    const error = await runDeployCli('global', {
      args: [],
      rest,
      loadConfig: config,
      ...out,
    }).catch((err: unknown) => err as Error);
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).not.toContain(TOKEN);
    expect(out.lines.join('\n')).not.toContain(TOKEN);
    expect(rest.calls.map((c) => c.method)).toEqual(['get']);
  });

  it('rejects an unknown scope with a usage line', async () => {
    const out = capture();
    await runDeployCli(undefined, { args: ['--scope', 'everywhere'], rest: fakeRest(), ...out });
    expect(out.lines[0]).toMatch(/^usage:/);
    expect(process.exitCode).toBe(2);
  });
});
