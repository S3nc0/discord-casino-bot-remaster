import {
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type InteractionReplyOptions,
} from 'discord.js';
import { formatPelica, t, type Locale } from '@casino/shared/i18n';
import type { GuildNotifyConfig, NotifyConfigService } from '../notify/config-service.ts';
import { botColor } from '../notify/theme.ts';
import { AppError } from '../runtime/errors.ts';

export interface AdminNotificationsDeps {
  notifyConfig?: NotifyConfigService;
  ownerIds: ReadonlySet<string>;
}

function formatChannelValue(locale: Locale, cfg: GuildNotifyConfig): string {
  if (cfg.announceChannelId) return `<#${cfg.announceChannelId}>`;
  if (cfg.effectiveChannelId) {
    return t(locale, 'bot.admin.notify.channelDefault', { id: cfg.effectiveChannelId });
  }
  return t(locale, 'bot.admin.notify.channelNone');
}

/**
 * `/admin notifications` (`/運営 通知設定`): view or update per-guild announcement channel,
 * big-win threshold, webhook personas, and master announcement toggle via `NotifyConfigService`.
 */
export async function handleAdminNotifications(
  deps: AdminNotificationsDeps,
  interaction: ChatInputCommandInteraction,
  locale: Locale,
  sendReply: (
    interaction: ChatInputCommandInteraction,
    options: InteractionReplyOptions,
  ) => Promise<void>,
): Promise<void> {
  if (!deps.notifyConfig) {
    throw new AppError('internal');
  }

  const isOwner = deps.ownerIds.has(interaction.user.id);
  const guildIdOpt = interaction.options.getString('guild_id')?.trim() || null;

  let targetGuildId: string;
  if (interaction.guildId !== null) {
    if (guildIdOpt !== null && guildIdOpt !== interaction.guildId && !isOwner) {
      throw new AppError('forbidden', { reason: 'owner_only' });
    }
    targetGuildId = guildIdOpt ?? interaction.guildId;
  } else {
    if (!isOwner) {
      throw new AppError('forbidden', { reason: 'owner_only' });
    }
    if (!guildIdOpt || !/^\d+$/.test(guildIdOpt)) {
      throw new AppError('invalid_payload');
    }
    targetGuildId = guildIdOpt;
  }

  const channel = interaction.options.getChannel('channel');
  const threshold = interaction.options.getInteger('threshold');
  const personas = interaction.options.getBoolean('personas');
  const enabled = interaction.options.getBoolean('enabled');

  let updated = false;
  if (channel !== null) {
    deps.notifyConfig.setAnnounceChannel(targetGuildId, channel.id);
    updated = true;
  }
  if (threshold !== null) {
    deps.notifyConfig.setBigWinThreshold(targetGuildId, threshold);
    updated = true;
  }
  if (personas !== null) {
    deps.notifyConfig.setPersonasEnabled(targetGuildId, personas);
    updated = true;
  }
  if (enabled !== null) {
    deps.notifyConfig.setAnnounceEnabled(targetGuildId, enabled);
    updated = true;
  }

  const cfg = deps.notifyConfig.getGuildConfig(targetGuildId);
  const onOff = (value: boolean): string =>
    t(locale, value ? 'bot.admin.notify.on' : 'bot.admin.notify.off');

  const embed = new EmbedBuilder()
    .setColor(botColor(updated ? 'success' : 'info'))
    .setTitle(t(locale, updated ? 'bot.admin.notify.titleUpdated' : 'bot.admin.notify.titleView'))
    .addFields(
      {
        name: t(locale, 'bot.admin.notify.channelLabel'),
        value: formatChannelValue(locale, cfg),
        inline: true,
      },
      {
        name: t(locale, 'bot.admin.notify.enabledLabel'),
        value: onOff(cfg.announceEnabled),
        inline: true,
      },
      {
        name: t(locale, 'bot.admin.notify.thresholdLabel'),
        value: formatPelica(locale, cfg.bigWinThreshold),
        inline: true,
      },
      {
        name: t(locale, 'bot.admin.notify.personasLabel'),
        value: onOff(cfg.personasEnabled),
        inline: true,
      },
      {
        name: t(locale, 'bot.admin.notify.rateLimitLabel'),
        value: t(locale, 'bot.admin.notify.rateLimitValue', { n: cfg.announcePerMinute }),
        inline: true,
      },
    )
    .setFooter({ text: t(locale, 'bot.admin.notify.footer', { id: targetGuildId }) });

  await sendReply(interaction, {
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
  });
}
