import {
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type InteractionReplyOptions,
} from 'discord.js';
import { formatPelica, type Locale } from '@casino/shared/i18n';
import type { GuildNotifyConfig, NotifyConfigService } from '../notify/config-service.ts';
import { botColor } from '../notify/theme.ts';
import { AppError } from '../runtime/errors.ts';

// TODO(A1): Merge these `/admin notifications` EN/JA keys into `packages/shared/i18n/{en,ja}.ts`.
const COPY = {
  en: {
    titleView: 'Notification Settings',
    titleUpdated: 'Notification Settings Updated',
    channelLabel: 'Announcement Channel',
    channelDefault: (id: string) => (id ? `<#${id}> (default)` : 'Not configured'),
    channelCustom: (id: string) => `<#${id}>`,
    enabledLabel: 'Announcements',
    thresholdLabel: 'Big-Win Threshold',
    personasLabel: 'Webhook Personas',
    rateLimitLabel: 'Rate Limit',
    rateLimitValue: (n: number) => `${n}/min`,
    on: 'ON',
    off: 'OFF',
    footer: (guildId: string) => `Guild ${guildId}`,
  },
  ja: {
    titleView: '通知設定',
    titleUpdated: '通知設定を更新しました',
    channelLabel: '告知チャンネル',
    channelDefault: (id: string) => (id ? `<#${id}>（既定）` : '未設定'),
    channelCustom: (id: string) => `<#${id}>`,
    enabledLabel: 'サーバー告知',
    thresholdLabel: '大当たり告知基準',
    personasLabel: 'Webhook ペルソナ',
    rateLimitLabel: '投稿上限',
    rateLimitValue: (n: number) => `${n}件/分`,
    on: 'オン',
    off: 'オフ',
    footer: (guildId: string) => `サーバー ${guildId}`,
  },
} as const;

export interface AdminNotificationsDeps {
  notifyConfig?: NotifyConfigService;
  ownerIds: ReadonlySet<string>;
}

function formatChannelValue(locale: Locale, cfg: GuildNotifyConfig): string {
  const c = COPY[locale];
  if (cfg.announceChannelId) return c.channelCustom(cfg.announceChannelId);
  return c.channelDefault(cfg.effectiveChannelId);
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
  const c = COPY[locale];

  const embed = new EmbedBuilder()
    .setColor(botColor(updated ? 'success' : 'info'))
    .setTitle(updated ? c.titleUpdated : c.titleView)
    .addFields(
      { name: c.channelLabel, value: formatChannelValue(locale, cfg), inline: true },
      { name: c.enabledLabel, value: cfg.announceEnabled ? c.on : c.off, inline: true },
      {
        name: c.thresholdLabel,
        value: formatPelica(locale, cfg.bigWinThreshold),
        inline: true,
      },
      { name: c.personasLabel, value: cfg.personasEnabled ? c.on : c.off, inline: true },
      {
        name: c.rateLimitLabel,
        value: c.rateLimitValue(cfg.announcePerMinute),
        inline: true,
      },
    )
    .setFooter({ text: c.footer(targetGuildId) });

  await sendReply(interaction, {
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
  });
}
