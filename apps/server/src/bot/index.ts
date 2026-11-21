export {
  BOT_CACHE_SETTINGS,
  BOT_INTENTS,
  BOT_SWEEPER_OPTIONS,
  createDiscordClient,
  getBotDisabledReason,
  startBot,
  type BotDisabledReason,
  type BotHandle,
  type CreateBotClientDeps,
  type StartBotOptions,
} from './client.ts';
export {
  COMMAND_META_BY_PATH,
  COMMAND_SPECS,
  buildSlashCommands,
  getCommandMeta,
  getCommandPath,
  type CommandChoiceSpec,
  type CommandContext,
  type CommandGroupNode,
  type CommandLeafMetadata,
  type CommandLeafNode,
  type CommandOptionSpec,
  type ResolvedCommandMeta,
  type SubcommandGroupSpec,
  type SubcommandSpec,
  type TopLevelCommandSpec,
} from './commands.ts';
export {
  PLACEHOLDER_DISCORD_TOKEN,
  deployCommands,
  deployGlobalCommands,
  deployGuildCommands,
  type DeployCommandsOptions,
  type DeployCommandsResult,
  type DeployScope,
  type RestPutClient,
} from './deploy.ts';
export {
  botEn,
  botJa,
  tb,
  type BotLocalMessageKey,
  type BotLocalMessages,
  type BotMessageKey,
} from './i18n.ts';
export { resolveBotLocale, type BotLocaleInput } from './locale.ts';
export {
  OPEN_ACTIVITY_BUTTON_ID,
  buildOpenActivityRow,
  createInteractionHandler,
  type BotRouterDeps,
} from './router.ts';
export { BOT_THEME_COLORS, botColor, type BotColorRole } from './theme.ts';
