import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type ActionRowBuilder,
  type ButtonBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type InteractionReplyOptions,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type User,
} from 'discord.js';
import type { Logger } from 'pino';
import type { Clock, LanguageSetting, LaunchIntentService, ScreenId } from '@casino/shared';
import { errorMessageKey, formatPelica, t, type Locale } from '@casino/shared/i18n';
import type { IdentityRepo } from '../db/identity.ts';
import type { SettingsRepo } from '../db/settings.ts';
import type { Store } from '../db/store.ts';
import type { EconomyService } from '../economy/economy-service.ts';
import type { FinanceServices } from '../finance/index.ts';
import type { CasinoGames } from '../games/index.ts';
import type { NonCasinoGames } from '../games/progression/index.ts';
import type { NotifyConfigService } from '../notify/config-service.ts';
import {
  buildLaunchActivityRow,
  buildLaunchButtonId,
  parseLaunchButtonId,
} from '../notify/discord-port.ts';
import { botColor } from '../notify/theme.ts';
import { AppError } from '../runtime/errors.ts';
import { handleAdminNotifications } from './admin-notifications.ts';
import { getCommandMeta, getCommandPath, type ResolvedCommandMeta } from './commands.ts';
import { resolveBotLocale } from './locale.ts';
import {
  dispatchChatAutocomplete,
  dispatchChatCommand,
  dispatchChatComponent,
  dispatchChatModal,
} from './chat-dispatch.ts';
import { ruleMessage } from './chat-kit.ts';
import { dispatchWiredCommand } from './wired-commands.ts';

export const OPEN_ACTIVITY_BUTTON_ID = buildLaunchButtonId('home');

export interface BotRouterDeps {
  identity: IdentityRepo;
  economy: EconomyService;
  settings: SettingsRepo;
  logger: Logger;
  ownerIds: ReadonlySet<string>;
  allowedGuildIds: ReadonlySet<string>;
  requireApproval: boolean;
  launchIntents?: LaunchIntentService;
  notifyConfig?: NotifyConfigService;
  store?: Store;
  casino?: CasinoGames;
  finance?: FinanceServices;
  games?: NonCasinoGames;
  /** Game clock (the real one when absent). Owner tools and boards stamp times with it. */
  clock?: Clock;
}

/** Build an "Open in Activity" button row targeting a specific Activity screen. */
export function buildOpenActivityRow(
  locale: Locale,
  screen: ScreenId = 'home',
): ActionRowBuilder<ButtonBuilder> {
  return buildLaunchActivityRow(locale, screen);
}

function displayNameOf(user: Pick<User, 'globalName' | 'username'>): string {
  return user.globalName ?? user.username;
}

function syncCallerProfile(identity: IdentityRepo, user: User): void {
  identity.upsertUser({
    userId: user.id,
    username: user.username,
    globalName: user.globalName ?? null,
    avatar: user.avatar ?? null,
  });
}

function isLanguageSetting(value: string | null): value is LanguageSetting {
  return value === 'auto' || value === 'en' || value === 'ja';
}

function checkGuildAccess(
  deps: BotRouterDeps,
  guildId: string,
  guildName: string | null,
  userId: string,
): void {
  if (deps.ownerIds.has(userId)) return;

  const status = deps.identity.getGuildStatus(guildId);
  if (status === 'denied') {
    throw new AppError('guild_not_allowed');
  }

  if (deps.allowedGuildIds.has(guildId)) {
    return;
  }

  if (deps.requireApproval) {
    if (status === null) {
      deps.identity.ensureGuild(guildId, 'pending', guildName);
    }
    if (status !== 'approved') {
      throw new AppError('guild_pending');
    }
    return;
  }

  if (deps.allowedGuildIds.size > 0) {
    throw new AppError('guild_not_allowed');
  }
}

function checkCommandAccess(
  deps: BotRouterDeps,
  meta: ResolvedCommandMeta,
  interaction: ChatInputCommandInteraction,
): void {
  const isOwner = deps.ownerIds.has(interaction.user.id);

  if (meta.manageGuildOrOwner) {
    if (interaction.guildId === null) {
      if (!isOwner) {
        throw new AppError('forbidden', { reason: 'owner_only' });
      }
    } else if (
      !isOwner &&
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) !== true
    ) {
      throw new AppError('forbidden', { reason: 'manage_guild_or_owner' });
    }
  } else if (meta.ownerOnly && !isOwner) {
    throw new AppError('forbidden', { reason: 'owner_only' });
  }

  if (meta.context === 'dm' && interaction.guildId !== null) {
    throw new AppError('forbidden', { reason: 'dm_only' });
  }
  if (meta.context === 'guild' && interaction.guildId === null) {
    throw new AppError('forbidden', { reason: 'guild_only' });
  }
  if (interaction.guildId !== null && meta.context === 'guild') {
    checkGuildAccess(
      deps,
      interaction.guildId,
      interaction.guild?.name ?? null,
      interaction.user.id,
    );
  }
}

/** Buttons, selects, modals and autocomplete get the same guild gate as slash commands. */
function checkInteractionGuild(
  deps: BotRouterDeps,
  interaction: Pick<Interaction, 'guildId' | 'guild' | 'user'>,
): void {
  if (interaction.guildId === null) return;
  checkGuildAccess(deps, interaction.guildId, interaction.guild?.name ?? null, interaction.user.id);
}

type ComponentOrModal = ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction;

async function sendReply(
  interaction: ChatInputCommandInteraction | ComponentOrModal,
  options: InteractionReplyOptions,
): Promise<void> {
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(options);
    return;
  }
  await interaction.reply(options);
}

async function handleBalance(
  deps: BotRouterDeps,
  interaction: ChatInputCommandInteraction,
  locale: Locale,
): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) throw new AppError('forbidden', { reason: 'guild_only' });

  const target = interaction.options.getUser('member') ?? interaction.user;
  const isSelf = target.id === interaction.user.id;
  syncCallerProfile(deps.identity, interaction.user);

  if (isSelf) {
    deps.economy.ensureMember(guildId, target.id);
  } else if (!deps.economy.hasAccount(guildId, target.id)) {
    const embed = new EmbedBuilder()
      .setColor(botColor('neutral'))
      .setTitle(t(locale, 'bot.balance.title', { name: displayNameOf(target) }))
      .setDescription(t(locale, 'bot.balance.noAccount'));
    await sendReply(interaction, { embeds: [embed] });
    return;
  }

  const balance = deps.economy.getBalance(guildId, target.id);
  const embed = new EmbedBuilder()
    .setColor(botColor('primary'))
    .setTitle(t(locale, 'bot.balance.title', { name: displayNameOf(target) }))
    .addFields({
      name: t(locale, 'shell.balance'),
      value: `**${formatPelica(locale, balance)}**`,
      inline: true,
    });

  await sendReply(interaction, {
    embeds: [embed],
    components: [buildOpenActivityRow(locale, 'home')],
  });
}

async function handleSettings(
  deps: BotRouterDeps,
  interaction: ChatInputCommandInteraction,
  locale: Locale,
): Promise<void> {
  const requestedLanguage = interaction.options.getString('language');
  const current = deps.settings.get(interaction.user.id);

  if (requestedLanguage !== null) {
    if (!isLanguageSetting(requestedLanguage)) {
      throw new AppError('invalid_payload');
    }
    syncCallerProfile(deps.identity, interaction.user);
    const updated = deps.settings.put(interaction.user.id, {
      ...current,
      language: requestedLanguage,
    });
    const nextLocale = resolveBotLocale({
      identity: deps.identity,
      userId: interaction.user.id,
      guildId: interaction.guildId,
      interactionLocale: interaction.locale,
      guildPreferredLocale: interaction.guild?.preferredLocale,
      userLocaleOverride: updated.language === 'auto' ? null : updated.language,
    });
    const embed = new EmbedBuilder()
      .setColor(botColor('success'))
      .setTitle(t(nextLocale, 'settings.title'))
      .setDescription(
        t(nextLocale, 'bot.settings.updated', {
          language: t(nextLocale, `settings.language.${updated.language}`),
          resolved: t(nextLocale, `settings.language.${nextLocale}`),
        }),
      )
      .setFooter({ text: t(nextLocale, 'bot.settings.footer') });
    await sendReply(interaction, {
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(botColor('info'))
    .setTitle(t(locale, 'settings.title'))
    .setDescription(
      t(locale, 'bot.settings.status', {
        language: t(locale, `settings.language.${current.language}`),
        resolved: t(locale, `settings.language.${locale}`),
      }),
    )
    .setFooter({ text: t(locale, 'bot.settings.footer') });

  await sendReply(interaction, {
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleHelp(interaction: ChatInputCommandInteraction, locale: Locale): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(botColor('primary'))
    .setTitle(t(locale, 'bot.help.title'))
    .setDescription(t(locale, 'bot.help.body'))
    .addFields({
      name: t(locale, 'bot.help.commandsTitle'),
      value: t(locale, 'bot.help.commandsList'),
    });

  await sendReply(interaction, {
    embeds: [embed],
    components: [buildOpenActivityRow(locale, 'home')],
    flags: MessageFlags.Ephemeral,
  });
}

async function replyComingSoon(
  interaction: ChatInputCommandInteraction,
  locale: Locale,
  commandPath: string,
): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(botColor('warning'))
    .setTitle(t(locale, 'bot.comingSoon.title'))
    .setDescription(t(locale, 'bot.comingSoon.body', { command: commandPath }));

  await sendReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
}

function localizedErrorMessage(locale: Locale, error: AppError): string {
  if (error.authReason === 'owner_only') return t(locale, 'bot.guard.ownerOnly');
  if (error.authReason === 'dm_only') return t(locale, 'bot.guard.dmOnly');
  if (error.authReason === 'guild_only') return t(locale, 'bot.guard.guildOnly');
  const rule = ruleMessage(locale, error);
  if (rule !== null) return rule;
  return t(locale, errorMessageKey(error.code));
}

async function replyError(
  deps: BotRouterDeps,
  interaction: ChatInputCommandInteraction | ComponentOrModal,
  locale: Locale,
  error: unknown,
  context: { commandPath?: string; customId?: string },
): Promise<void> {
  const message =
    error instanceof AppError ? localizedErrorMessage(locale, error) : t(locale, 'error.internal');

  if (!(error instanceof AppError)) {
    deps.logger.error(
      {
        err: error,
        userId: interaction.user.id,
        guildId: interaction.guildId,
        ...context,
      },
      'bot interaction failed',
    );
  }

  const embed = new EmbedBuilder().setColor(botColor('error')).setDescription(message);
  try {
    await sendReply(interaction, {
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  } catch (replyErr) {
    deps.logger.warn({ err: replyErr, ...context }, 'failed to send bot error reply');
  }
}

async function dispatchChatInput(
  deps: BotRouterDeps,
  interaction: ChatInputCommandInteraction,
  locale: Locale,
): Promise<void> {
  const commandPath = getCommandPath(interaction);
  const meta = getCommandMeta(commandPath);
  if (!meta) {
    const embed = new EmbedBuilder()
      .setColor(botColor('error'))
      .setDescription(t(locale, 'bot.error.unknownCommand'));
    await sendReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  checkCommandAccess(deps, meta, interaction);

  switch (meta.path) {
    case 'pelica balance':
      await handleBalance(deps, interaction, locale);
      return;
    case 'settings':
      await handleSettings(deps, interaction, locale);
      return;
    case 'help':
      await handleHelp(interaction, locale);
      return;
    case 'admin notifications':
      await handleAdminNotifications(deps, interaction, locale, sendReply);
      return;
    default: {
      syncCallerProfile(deps.identity, interaction.user);
      const handled =
        (await dispatchChatCommand({ deps, locale }, meta.path, interaction)) ||
        (await dispatchWiredCommand(deps, meta.path, interaction, locale, sendReply));
      if (!handled) {
        await replyComingSoon(interaction, locale, meta.path);
      }
    }
  }
}

async function dispatchButton(
  deps: BotRouterDeps,
  interaction: ButtonInteraction,
  locale: Locale,
): Promise<void> {
  if (await dispatchChatComponent({ deps, locale }, interaction)) return;
  const screen = parseLaunchButtonId(interaction.customId);
  if (!screen) return;

  if (interaction.guildId === null) {
    const embed = new EmbedBuilder()
      .setColor(botColor('warning'))
      .setDescription(t(locale, 'shell.noGuild'));
    await sendReply(interaction, {
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  syncCallerProfile(deps.identity, interaction.user);
  deps.launchIntents?.create({
    userId: interaction.user.id,
    guildId: interaction.guildId,
    screen,
  });
  await interaction.launchActivity();
}

/** Create the Discord interaction handler for slash commands and bot buttons. */
export function createInteractionHandler(
  deps: BotRouterDeps,
): (interaction: Interaction) => Promise<void> {
  return async (interaction: Interaction): Promise<void> => {
    if (
      !interaction.isChatInputCommand() &&
      !interaction.isButton() &&
      !interaction.isStringSelectMenu() &&
      !interaction.isModalSubmit() &&
      !interaction.isAutocomplete()
    ) {
      return;
    }

    const locale = resolveBotLocale({
      identity: deps.identity,
      userId: interaction.user.id,
      guildId: interaction.guildId,
      interactionLocale: interaction.locale,
      guildPreferredLocale: interaction.guild?.preferredLocale,
    });

    if (interaction.isChatInputCommand()) {
      const commandPath = getCommandPath(interaction);
      try {
        await dispatchChatInput(deps, interaction, locale);
      } catch (error) {
        await replyError(deps, interaction, locale, error, { commandPath });
      }
      return;
    }

    if (interaction.isAutocomplete()) {
      try {
        checkInteractionGuild(deps, interaction);
        await dispatchChatAutocomplete({ deps, locale }, interaction);
      } catch (error) {
        deps.logger.warn({ err: error }, 'autocomplete failed');
        await interaction.respond([]).catch(() => undefined);
      }
      return;
    }

    try {
      checkInteractionGuild(deps, interaction);
      if (interaction.isModalSubmit()) {
        await dispatchChatModal({ deps, locale }, interaction);
      } else if (interaction.isStringSelectMenu()) {
        await dispatchChatComponent({ deps, locale }, interaction);
      } else {
        await dispatchButton(deps, interaction, locale);
      }
    } catch (error) {
      await replyError(deps, interaction, locale, error, { customId: interaction.customId });
    }
  };
}
