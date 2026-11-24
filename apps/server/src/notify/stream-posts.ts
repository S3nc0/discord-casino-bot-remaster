import {
  STREAM_LIMITS,
  STREAM_PANEL_COLOR_LIVE,
  streamTipColor,
  type Clock,
  type DomainEventOf,
  type StreamSettleResult,
} from '@casino/shared';
import { formatPelica, t, type Locale, type MessageKey } from '@casino/shared/i18n';
import type { Logger } from 'pino';
import type { Store } from '../db/store.ts';
import type { EventBus } from '../runtime/bus.ts';
import type { GuildRateLimiter } from './announcer.ts';
import type { NotifyConfigService } from './config-service.ts';
import type { ChannelMessage, DiscordNotifyPort } from './ports.ts';
import { defaultEmbedTheme, type EmbedTheme } from './theme.ts';

/** The stream events that become a post in the panel's channel. */
export const STREAM_POST_EVENT_TYPES = [
  'StreamTipped',
  'StreamRoundOpened',
  'StreamRoundLocked',
  'StreamRoundSettled',
] as const;
export type StreamPostEvent = DomainEventOf<(typeof STREAM_POST_EVENT_TYPES)[number]>;

interface StreamInfo {
  title: string;
  channelId: string | null;
}

interface QueuedPost {
  channelId: string;
  build(locale: Locale): ChannelMessage;
}

export interface StreamPostsOptions {
  store: Store;
  configService: NotifyConfigService;
  port: DiscordNotifyPort;
  /** The announcer's limiter: stream posts share the guild's `announce_per_minute` budget. */
  rateLimiter: GuildRateLimiter;
  clock: Clock;
  logger: Logger;
  theme?: EmbedTheme;
  /** Posts kept per guild while the budget is spent; the oldest are dropped. Default 50. */
  maxQueuedPerGuild?: number;
}

const amountOf = (locale: Locale, amount: number): string =>
  new Intl.NumberFormat(locale === 'ja' ? 'ja-JP' : 'en-US').format(amount);

/**
 * Chat posts of the stream panel (docs/spec/stream.md §3, §6, §7): the tip card, the round
 * opened and auto-locked notices and the result, in the panel's channel. Nothing mentions anyone
 * (the port sends `allowed_mentions: { parse: [] }`); every post goes through the guild rate
 * limiter. The panel message itself is edited by the chat bot (it hooks `StreamService.onChange`
 * and debounces), so nothing here touches it. A stream without a chat channel posts nothing.
 */
export class StreamPosts {
  private readonly options: StreamPostsOptions;
  private readonly theme: EmbedTheme;
  private readonly queues = new Map<string, QueuedPost[]>();

  constructor(options: StreamPostsOptions) {
    this.options = options;
    this.theme = options.theme ?? defaultEmbedTheme;
  }

  /** Subscribe to the bus; returns the unsubscribe. */
  attach(bus: EventBus): () => void {
    const offs = STREAM_POST_EVENT_TYPES.map((type) =>
      bus.onDomain(type, (event) => this.enqueue(event as StreamPostEvent)),
    );
    return () => {
      for (const off of offs) off();
    };
  }

  /** Posts waiting for the guild's budget (tests and diagnostics). */
  pending(guildId: string): number {
    return this.queues.get(guildId)?.length ?? 0;
  }

  enqueue(event: StreamPostEvent): void {
    const info = this.stream(event.streamId);
    if (!info?.channelId) return;
    const build = this.builder(event, info);
    if (!build) return;
    const queue = this.queues.get(event.guildId) ?? [];
    queue.push({ channelId: info.channelId, build });
    const max = this.options.maxQueuedPerGuild ?? 50;
    while (queue.length > max) queue.shift();
    this.queues.set(event.guildId, queue);
  }

  /** Post what the guilds' budgets allow, oldest first. Returns how many were posted. */
  async flushDue(): Promise<number> {
    const { configService, port, rateLimiter, clock, logger } = this.options;
    let posted = 0;
    for (const [guildId, queue] of [...this.queues]) {
      const limit = configService.getGuildConfig(guildId).announcePerMinute;
      while (queue.length > 0) {
        if (!rateLimiter.tryConsume(guildId, limit, clock.now()).allowed) break;
        const next = queue.shift() as QueuedPost;
        const locale = await configService.resolveGuildLocale(guildId, (g) =>
          port.fetchGuildLocale(g),
        );
        const result = await port.postToChannel(next.channelId, next.build(locale));
        if (result.ok) {
          posted += 1;
          continue;
        }
        if (result.reason === 'rate_limited') {
          queue.unshift(next);
          rateLimiter.applyBackoff(guildId, clock.now() + (result.retryAfterMs ?? 5_000));
          break;
        }
        logger.warn(
          { guildId, channelId: next.channelId, reason: result.reason },
          'stream post failed',
        );
      }
      if (queue.length === 0) this.queues.delete(guildId);
    }
    return posted;
  }

  private stream(streamId: number): StreamInfo | null {
    const row = this.options.store
      .stmt('SELECT title, channel_id FROM streams WHERE id = ?')
      .get(streamId) as { title: string; channel_id: string | null } | undefined;
    return row ? { title: row.title, channelId: row.channel_id } : null;
  }

  private label(locale: Locale, label: string): string {
    return label === '' ? t(locale, 'screen.stream.round.default') : label;
  }

  private roundLabel(roundId: number): string {
    const row = this.options.store
      .stmt('SELECT label FROM stream_rounds WHERE id = ?')
      .get(roundId) as { label: string } | undefined;
    return row?.label ?? '';
  }

  private builder(event: StreamPostEvent, info: StreamInfo): QueuedPost['build'] | null {
    switch (event.type) {
      case 'StreamTipped': {
        const name = this.name(event.tipperId);
        return (locale) => ({
          embeds: [
            {
              title: t(locale, 'bot.stream.tip.author', {
                name,
                amount: amountOf(locale, event.amount),
              }),
              ...(event.message === '' ? {} : { description: event.message }),
              color: streamTipColor(event.amount),
            },
          ],
        });
      }
      case 'StreamRoundOpened':
        return (locale) => ({
          embeds: [
            {
              title: t(locale, 'bot.stream.round.openedTitle', {
                label: this.label(locale, event.label),
              }),
              description: t(locale, 'bot.stream.round.openedBody', {
                streamer: `<@${event.streamerId}>`,
                time: `<t:${Math.floor(event.autoLockAt / 1000)}:R>`,
              }),
              color: STREAM_PANEL_COLOR_LIVE,
            },
          ],
        });
      case 'StreamRoundLocked': {
        if (event.cause !== 'auto') return null;
        const label = this.roundLabel(event.roundId);
        return (locale) => ({
          content: t(locale, 'bot.stream.round.autoLocked', {
            label: this.label(locale, label),
            minutes: STREAM_LIMITS.roundAutoLockMs / 60_000,
          }),
        });
      }
      case 'StreamRoundSettled': {
        const reason =
          event.result.cause === 'owner'
            ? ((
                this.options.store
                  .stmt('SELECT reason FROM stream_round_audit WHERE round_id = ?')
                  .get(event.result.roundId) as { reason: string | null } | undefined
              )?.reason ?? null)
            : null;
        return (locale) => ({
          embeds: [
            {
              title: t(locale, 'bot.stream.result.title', { title: info.title }),
              description: resultLines(locale, event.result, reason).join('\n'),
              color: this.theme.color(event.result.refunded ? 'neutral' : 'gold'),
            },
          ],
        });
      }
    }
  }

  private name(userId: string): string {
    const row = this.options.store
      .stmt('SELECT global_name, username FROM users WHERE user_id = ?')
      .get(userId) as { global_name: string | null; username: string } | undefined;
    return (row?.global_name || row?.username || `…${userId.slice(-4)}`).slice(0, 80);
  }
}

/** The result post's lines (spec §6): head, top payouts, the rest, Teiai's take, the owner's reason. */
export function resultLines(
  locale: Locale,
  result: StreamSettleResult,
  ownerReason: string | null,
): string[] {
  const lines: string[] = [];
  const sideKey = `screen.stream.side.${result.outcome}` as MessageKey;
  if (result.outcome === 'void') lines.push(t(locale, 'bot.stream.result.headVoid'));
  else {
    lines.push(t(locale, 'bot.stream.result.headSide', { side: t(locale, sideKey) }));
    if (result.refunded) lines.push(t(locale, 'bot.stream.result.refunded'));
  }
  if (!result.refunded) {
    for (const p of result.payouts) {
      lines.push(`<@${p.userId}> **${formatPelica(locale, p.amount)}**`);
    }
    const more = result.payoutCount - result.payouts.length;
    if (more > 0) lines.push(t(locale, 'bot.stream.result.more', { count: more }));
    lines.push(t(locale, 'bot.stream.result.rake', { amount: formatPelica(locale, result.rake) }));
  }
  const winners = result.outcome === 'win' ? result.winTotal : result.loseTotal;
  if (result.outcome !== 'void' && winners === 0)
    lines.push(t(locale, 'bot.stream.result.noWinner'));
  if (ownerReason !== null) {
    lines.push(t(locale, 'bot.stream.result.ownerVoid', { reason: ownerReason }));
  }
  return lines;
}
