import { parseArgs } from 'node:util';
import { REST, Routes, type RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';
import { loadConfig } from '../runtime/config.ts';
import { buildSlashCommands } from './commands.ts';

export const PLACEHOLDER_DISCORD_TOKEN = 'replace-with-bot-token';

export type DeployScope = 'guild' | 'global';

export interface RestPutClient {
  setToken(token: string): unknown;
  put(route: `/${string}`, options: { body: unknown }): Promise<unknown>;
}

export interface DeployCommandsOptions {
  token: string;
  clientId: string;
  scope: DeployScope;
  guildId?: string;
  commands?: readonly RESTPostAPIChatInputApplicationCommandsJSONBody[];
  rest?: RestPutClient;
}

export interface DeployCommandsResult {
  scope: DeployScope;
  route: `/${string}`;
  count: number;
  guildId?: string;
}

function assertValidDeployInputs(options: DeployCommandsOptions): void {
  if (!options.token || options.token === PLACEHOLDER_DISCORD_TOKEN) {
    throw new Error('Cannot deploy commands without a real DISCORD_TOKEN');
  }
  if (!options.clientId) {
    throw new Error('Cannot deploy commands without DISCORD_CLIENT_ID');
  }
  if (options.scope === 'guild' && !options.guildId) {
    throw new Error('Guild-scoped command deployment requires guildId (TEST_GUILD_ID)');
  }
}

/**
 * Push slash commands to Discord via REST PUT (bulk overwrite).
 * Never called automatically on server startup; run explicitly in dev or release scripts.
 */
export async function deployCommands(
  options: DeployCommandsOptions,
): Promise<DeployCommandsResult> {
  assertValidDeployInputs(options);
  const body = options.commands ? [...options.commands] : buildSlashCommands();
  const route =
    options.scope === 'guild'
      ? Routes.applicationGuildCommands(options.clientId, options.guildId!)
      : Routes.applicationCommands(options.clientId);

  const rest = options.rest ?? new REST({ version: '10' });
  rest.setToken(options.token);
  await rest.put(route, { body });

  return {
    scope: options.scope,
    route,
    count: body.length,
    ...(options.scope === 'guild' ? { guildId: options.guildId } : {}),
  };
}

export function deployGuildCommands(
  options: Omit<DeployCommandsOptions, 'scope'> & { guildId: string },
): Promise<DeployCommandsResult> {
  return deployCommands({ ...options, scope: 'guild' });
}

export function deployGlobalCommands(
  options: Omit<DeployCommandsOptions, 'scope' | 'guildId'>,
): Promise<DeployCommandsResult> {
  return deployCommands({ ...options, scope: 'global' });
}

export async function runDeployCli(defaultScope?: DeployScope): Promise<void> {
  const { values } = parseArgs({
    options: {
      scope: { type: 'string' },
      guild: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  });

  const scopeArg = values.scope ?? defaultScope;
  if (scopeArg !== 'guild' && scopeArg !== 'global') {
    console.error('usage: deploy.ts --scope <guild|global> [--guild <id>] [--dry-run]');
    process.exitCode = 2;
    return;
  }

  const commands = buildSlashCommands();
  if (values['dry-run']) {
    console.log(`[dry-run] scope=${scopeArg} commands=${commands.length}`);
    for (const cmd of commands) {
      console.log(`- /${cmd.name} (ja: ${cmd.name_localizations?.ja ?? '-'})`);
    }
    return;
  }

  const config = loadConfig();
  const guildId = values.guild ?? config.testGuildId;
  const result = await deployCommands({
    token: config.discord.token,
    clientId: config.discord.clientId,
    scope: scopeArg,
    guildId,
    commands,
  });

  console.log(
    result.scope === 'guild'
      ? `Deployed ${result.count} commands to guild ${result.guildId} (${result.route})`
      : `Deployed ${result.count} global commands (${result.route})`,
  );
}
