import { parseArgs } from 'node:util';
import {
  ApplicationCommandType,
  REST,
  Routes,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { loadConfig, type Config } from '../runtime/config.ts';
import { COMMAND_META_BY_PATH, buildSlashCommands } from './commands.ts';

export const PLACEHOLDER_DISCORD_TOKEN = 'replace-with-bot-token';

export type DeployScope = 'guild' | 'global';

/** The slice of discord.js `REST` the deploy uses. Tests pass a fake. */
export interface DeployRestClient {
  setToken(token: string): unknown;
  get(route: `/${string}`): Promise<unknown>;
  put(route: `/${string}`, options: { body: unknown }): Promise<unknown>;
  post(route: `/${string}`, options: { body: unknown }): Promise<unknown>;
}

/** Kept for existing imports; same shape as {@link DeployRestClient}. */
export type RestPutClient = DeployRestClient;

export interface DeployCommandsOptions {
  token: string;
  clientId: string;
  scope: DeployScope;
  guildId?: string;
  commands?: readonly RESTPostAPIChatInputApplicationCommandsJSONBody[];
  /**
   * Commands that must work in a DM with the bot. A guild deploy leaves them out of the guild set
   * and creates or updates them globally, one by one. Defaults to {@link dmRequiredCommandNames}.
   */
  dmCommandNames?: ReadonlySet<string>;
  rest?: DeployRestClient;
}

export interface DeployCommandsResult {
  scope: DeployScope;
  /** The bulk PUT route: the guild route for a guild deploy, the global route otherwise. */
  route: `/${string}`;
  /** Our commands in the bulk PUT body (Entry Point commands not counted). */
  count: number;
  guildId?: string;
  /** Names of our commands in the bulk PUT body. */
  registered: string[];
  /** Global deploy: Activity Entry Point commands carried over unchanged. */
  entryPointsKept: string[];
  /** Guild deploy: DM commands created or updated globally, one by one. */
  globalUpserts: string[];
  /** Guild deploy: commands left out of the guild set because they are already global. */
  skippedAlreadyGlobal: string[];
}

/** Fields Discord accepts for an existing command in a bulk overwrite (PUT) body. */
const PUT_FIELDS = [
  'id',
  'type',
  'name',
  'name_localizations',
  'description',
  'description_localizations',
  'options',
  'default_member_permissions',
  'dm_permission',
  'nsfw',
  'integration_types',
  'contexts',
  'handler',
] as const;

interface ExistingCommand {
  readonly id?: unknown;
  readonly type?: unknown;
  readonly name?: unknown;
  readonly [key: string]: unknown;
}

/**
 * Top-level commands with at least one subcommand that only runs in a DM with the bot. A guild
 * deploy cannot reach DMs, so these are registered globally instead.
 */
export function dmRequiredCommandNames(
  meta: ReadonlyMap<string, { readonly context: string }> = COMMAND_META_BY_PATH,
): Set<string> {
  const names = new Set<string>();
  for (const [path, leaf] of meta) {
    if (leaf.context === 'dm') names.add(path.split(' ')[0]!);
  }
  return names;
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

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchGlobalCommands(
  rest: DeployRestClient,
  route: `/${string}`,
): Promise<ExistingCommand[]> {
  let response: unknown;
  try {
    response = await rest.get(route);
  } catch (error) {
    throw new Error(
      `Could not read the current global commands, so nothing was changed: ${errorText(error)}`,
      { cause: error },
    );
  }
  if (!Array.isArray(response)) {
    throw new Error(
      'Could not read the current global commands (unexpected reply), so nothing was changed',
    );
  }
  return response.filter(
    (item): item is ExistingCommand => typeof item === 'object' && item !== null,
  );
}

function isEntryPoint(command: ExistingCommand): boolean {
  return command.type === ApplicationCommandType.PrimaryEntryPoint;
}

function isChatInput(command: ExistingCommand): boolean {
  // Discord omits `type` for nothing today, but treat a missing type as chat input (its default).
  return command.type === undefined || command.type === ApplicationCommandType.ChatInput;
}

/** Copy an existing Entry Point command for the PUT body: same id and values, PUT fields only. */
export function entryPointPutBody(command: ExistingCommand): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const field of PUT_FIELDS) {
    if (command[field] !== undefined) body[field] = command[field];
  }
  return body;
}

/**
 * Register slash commands with Discord. Never called on server startup; run it from the scripts.
 *
 * - `global`: reads the current global commands first (aborts without writing if that fails), then
 *   bulk-overwrites them with every command plus each Activity Entry Point command, unchanged.
 * - `guild`: reads the global commands, bulk-overwrites the guild with every command except the
 *   DM commands and those already registered globally, then creates or updates each DM command
 *   globally one by one (a single-command POST never touches other global commands).
 */
export async function deployCommands(
  options: DeployCommandsOptions,
): Promise<DeployCommandsResult> {
  assertValidDeployInputs(options);
  const commands = options.commands ? [...options.commands] : buildSlashCommands();
  const globalRoute = Routes.applicationCommands(options.clientId);

  const rest = options.rest ?? new REST({ version: '10' });
  rest.setToken(options.token);
  const existing = await fetchGlobalCommands(rest, globalRoute);

  if (options.scope === 'global') {
    const entryPoints = existing.filter(isEntryPoint);
    const body = [...commands, ...entryPoints.map(entryPointPutBody)];
    await rest.put(globalRoute, { body });
    return {
      scope: 'global',
      route: globalRoute,
      count: commands.length,
      registered: commands.map((cmd) => cmd.name),
      entryPointsKept: entryPoints.map((cmd) => String(cmd.name)),
      globalUpserts: [],
      skippedAlreadyGlobal: [],
    };
  }

  const dmNames = options.dmCommandNames ?? dmRequiredCommandNames();
  const globalChatNames = new Set(existing.filter(isChatInput).map((cmd) => String(cmd.name)));
  const dmCommands = commands.filter((cmd) => dmNames.has(cmd.name));
  const others = commands.filter((cmd) => !dmNames.has(cmd.name));
  const guildSet = others.filter((cmd) => !globalChatNames.has(cmd.name));
  const skipped = others.filter((cmd) => globalChatNames.has(cmd.name));

  const guildRoute = Routes.applicationGuildCommands(options.clientId, options.guildId!);
  await rest.put(guildRoute, { body: guildSet });
  for (const cmd of dmCommands) {
    await rest.post(globalRoute, { body: cmd });
  }

  return {
    scope: 'guild',
    route: guildRoute,
    count: guildSet.length,
    guildId: options.guildId,
    registered: guildSet.map((cmd) => cmd.name),
    entryPointsKept: [],
    globalUpserts: dmCommands.map((cmd) => cmd.name),
    skippedAlreadyGlobal: skipped.map((cmd) => cmd.name),
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

function slashList(names: readonly string[]): string {
  return names.length > 0 ? names.map((name) => `/${name}`).join(', ') : '(none)';
}

/** Human-readable summary of a deploy. Never includes the token. */
export function describeDeployResult(result: DeployCommandsResult): string[] {
  const lines: string[] = [];
  if (result.scope === 'global') {
    lines.push(
      `Global (every server and DMs with the bot): registered ${result.count} commands: ${slashList(result.registered)}`,
    );
    lines.push(
      result.entryPointsKept.length > 0
        ? `Kept the Activity Entry Point command unchanged: ${slashList(result.entryPointsKept)}`
        : 'No Activity Entry Point command was registered, so none was kept.',
    );
    lines.push('Global changes can take up to an hour to show in every server.');
    lines.push(
      'If you ran the guild deploy before, run `pnpm commands:deploy:guild` once more so the test server drops its own copies of these commands (it skips commands that are global).',
    );
    return lines;
  }

  lines.push(
    `Test server (guild ${result.guildId}): registered ${result.count} commands, shown right away: ${slashList(result.registered)}`,
  );
  if (result.globalUpserts.length > 0) {
    lines.push(
      `Global, one by one (needed in DMs with the bot): ${slashList(result.globalUpserts)}. Other global commands and the Activity Entry Point were not touched.`,
    );
    lines.push(
      'Global changes usually show within seconds but can take up to an hour; if a command is missing in the DM, restart Discord with Ctrl+R / Cmd+R.',
    );
  }
  if (result.skippedAlreadyGlobal.length > 0) {
    lines.push(
      `Skipped ${result.skippedAlreadyGlobal.length} commands already registered globally, so they do not show twice: ${slashList(result.skippedAlreadyGlobal)}. Run \`pnpm commands:deploy:global\` to update them.`,
    );
  }
  return lines;
}

export interface RunDeployCliDeps {
  args?: string[];
  loadConfig?: () => Pick<Config, 'discord' | 'testGuildId'>;
  rest?: DeployRestClient;
  log?: (line: string) => void;
  error?: (line: string) => void;
}

export async function runDeployCli(
  defaultScope?: DeployScope,
  deps: RunDeployCliDeps = {},
): Promise<void> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const error = deps.error ?? ((line: string) => console.error(line));
  const { values } = parseArgs({
    ...(deps.args ? { args: deps.args } : {}),
    options: {
      scope: { type: 'string' },
      guild: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  });

  const scopeArg = values.scope ?? defaultScope;
  if (scopeArg !== 'guild' && scopeArg !== 'global') {
    error('usage: deploy.ts --scope <guild|global> [--guild <id>] [--dry-run]');
    process.exitCode = 2;
    return;
  }

  const commands = buildSlashCommands();
  if (values['dry-run']) {
    log(`[dry-run] scope=${scopeArg} commands=${commands.length}`);
    for (const cmd of commands) {
      log(`- /${cmd.name} (ja: ${cmd.name_localizations?.ja ?? '-'})`);
    }
    return;
  }

  const config = (deps.loadConfig ?? loadConfig)();
  const guildId = values.guild ?? config.testGuildId;
  const result = await deployCommands({
    token: config.discord.token,
    clientId: config.discord.clientId,
    scope: scopeArg,
    guildId,
    commands,
    ...(deps.rest ? { rest: deps.rest } : {}),
  });

  for (const line of describeDeployResult(result)) log(line);
}
