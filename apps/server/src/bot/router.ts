import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type InteractionReplyOptions,
  type User,
} from 'discord.js';
import type { Logger } from 'pino';
import type { LanguageSetting } from '@casino/shared';
import { errorMessageKey, formatPelica, type Locale } from '@casino/shared/i18n';
import type { IdentityRepo } from '../db/identity.ts';
import type { SettingsRepo } from '../db/settings.ts';
import type { EconomyService } from '../economy/economy-service.ts';
import { AppError } from '../runtime/errors.ts';
import { getCommandMeta, getCommandPath, type ResolvedCommandMeta } from './commands.ts';
import { tb } from './i18n.ts';
import { resolveBotLocale } from './locale.ts';
import { botColor } from './theme.ts';

export const OPEN_ACTIVITY_BUTTON_ID = 'bot:open-activity';

export interface BotRouterDeps {
  identity: IdentityRepo;
  economy: EconomyService;
  settings: SettingsRepo;
  logger: Logger;
  ownerIds: ReadonlySet<string>;
  allowedGuildIds: ReadonlySet<string>;
  requireApproval: boolean;
}

/** Build the placeholder button row; B4b replaces this with LAUNCH_ACTIVITY. */
export function buildOpenActivityRow(locale: Locale): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(OPEN_ACTIVITY_BUTTON_ID)
      .setLabel(tb(locale, 'launch.openInActivity'))
      .setStyle(ButtonStyle.Primary),
  );
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
  if (meta.ownerOnly && !deps.ownerIds.has(interaction.user.id)) {
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

async function sendReply(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
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
      .setTitle(tb(locale, 'bot.balance.title', { name: displayNameOf(target) }))
      .setDescription(tb(locale, 'bot.balance.noAccount'));
    await sendReply(interaction, { embeds: [embed] });
    return;
  }

  const balance = deps.economy.getBalance(guildId, target.id);
  const embed = new EmbedBuilder()
    .setColor(botColor('primary'))
    .setTitle(tb(locale, 'bot.balance.title', { name: displayNameOf(target) }))
    .addFields({
      name: tb(locale, 'shell.balance'),
      value: `**${formatPelica(locale, balance)}**`,
      inline: true,
    });

  await sendReply(interaction, {
    embeds: [embed],
    components: [buildOpenActivityRow(locale)],
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
      .setTitle(tb(nextLocale, 'settings.title'))
      .setDescription(
        tb(nextLocale, 'bot.settings.updated', {
          language: tb(nextLocale, `settings.language.${updated.language}`),
          resolved: tb(nextLocale, `settings.language.${nextLocale}`),
        }),
      )
      .setFooter({ text: tb(nextLocale, 'bot.settings.footer') });
    await sendReply(interaction, {
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(botColor('info'))
    .setTitle(tb(locale, 'settings.title'))
    .setDescription(
      tb(locale, 'bot.settings.status', {
        language: tb(locale, `settings.language.${current.language}`),
        resolved: tb(locale, `settings.language.${locale}`),
      }),
    )
    .setFooter({ text: tb(locale, 'bot.settings.footer') });

  await sendReply(interaction, {
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleHelp(interaction: ChatInputCommandInteraction, locale: Locale): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(botColor('primary'))
    .setTitle(tb(locale, 'bot.help.title'))
    .setDescription(tb(locale, 'bot.help.body'))
    .addFields({
      name: tb(locale, 'bot.help.commandsTitle'),
      value: tb(locale, 'bot.help.commandsList'),
    });

  await sendReply(interaction, {
    embeds: [embed],
    components: [buildOpenActivityRow(locale)],
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
    .setTitle(tb(locale, 'bot.comingSoon.title'))
    .setDescription(tb(locale, 'bot.comingSoon.body', { command: commandPath }));

  await sendReply(interaction, {
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
  });
}

function localizedErrorMessage(locale: Locale, error: AppError): string {
  if (error.authReason === 'owner_only') return tb(locale, 'bot.guard.ownerOnly');
  if (error.authReason === 'dm_only') return tb(locale, 'bot.guard.dmOnly');
  if (error.authReason === 'guild_only') return tb(locale, 'bot.guard.guildOnly');
  return tb(locale, errorMessageKey(error.code));
}

async function replyError(
  deps: BotRouterDeps,
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  locale: Locale,
  error: unknown,
  context: { commandPath?: string; customId?: string },
): Promise<void> {
  const message =
    error instanceof AppError ? localizedErrorMessage(locale, error) : tb(locale, 'error.internal');

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
      .setDescription(tb(locale, 'bot.error.unknownCommand'));
    await sendReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  checkCommandAccess(deps, meta, interaction);

  // Single command dispatch switch: wiring future B2/B3 services is a one-line change per case.
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
    default:
      await replyComingSoon(interaction, locale, meta.path);
  }
}

async function dispatchButton(interaction: ButtonInteraction, locale: Locale): Promise<void> {
  if (interaction.customId === OPEN_ACTIVITY_BUTTON_ID) {
    const embed = new EmbedBuilder()
      .setColor(botColor('info'))
      .setDescription(tb(locale, 'bot.activity.placeholder'));
    await sendReply(interaction, {
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  }
}

/** Create the Discord interaction handler for slash commands and bot buttons. */
export function createInteractionHandler(
  deps: BotRouterDeps,
): (interaction: Interaction) => Promise<void> {
  return async (interaction: Interaction): Promise<void> => {
    if (!interaction.isChatInputCommand() && !interaction.isButton()) return;

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

    try {
      await dispatchButton(interaction, locale);
    } catch (error) {
      await replyError(deps, interaction, locale, error, { customId: interaction.customId });
    }
  };
}
