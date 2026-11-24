import type { Client, EmbedBuilder, Message } from 'discord.js';
import { resolveLocale, t, type Locale } from '@casino/shared/i18n';
import type { Logger } from 'pino';
import type { IdentityRepo } from '../db/identity.ts';
import type { Store } from '../db/store.ts';
import type { NetWorthService, NetWorthStanding } from '../finance/net-worth-service.ts';
import { embed } from './chat-kit.ts';
import { standingLine } from './net-worth-chat.ts';

/** How often the live ranking posts are rewritten (docs/spec/economy-core.md §4). */
export const BOARD_INTERVAL_MS = 60_000;
export const BOARD_TOP_N = 10;

/**
 * The board's rows: the balance-sheet net worth ranking (純資産 = total assets − liabilities, debt
 * interest accrued first), top `limit`. Empty when the finance services are not wired.
 */
export function boardStandings(
  netWorth: Pick<NetWorthService, 'standings'> | undefined,
  guildId: string,
  nowMs: number,
  limit = BOARD_TOP_N,
): readonly NetWorthStanding[] {
  return netWorth ? netWorth.standings(guildId, 'net', limit, nowMs).rows : [];
}

export function boardEmbed(
  locale: Locale,
  rows: readonly NetWorthStanding[],
  nowMs: number,
): EmbedBuilder {
  const lines =
    rows.length === 0
      ? t(locale, 'bot.board.empty')
      : rows.map((r) => standingLine(locale, r)).join('\n');
  return embed('primary', t(locale, 'bot.board.title'))
    .setDescription(
      `${t(locale, 'bot.board.updated', { ts: Math.floor(nowMs / 1000) })}\n\n${lines}`,
    )
    .setFooter({ text: t(locale, 'bot.board.footer', { minutes: BOARD_INTERVAL_MS / 60_000 }) });
}

export interface BoardRow {
  guildId: string;
  channelId: string;
  messageId: string | null;
}

export function getBoard(store: Store, guildId: string): BoardRow | null {
  const row = store
    .stmt('SELECT guild_id, channel_id, message_id FROM leaderboards WHERE guild_id = ?')
    .get(guildId) as
    { guild_id: string; channel_id: string; message_id: string | null } | undefined;
  return row
    ? { guildId: row.guild_id, channelId: row.channel_id, messageId: row.message_id }
    : null;
}

export function saveBoard(store: Store, board: BoardRow, nowMs: number): void {
  store
    .stmt(
      `INSERT INTO leaderboards (guild_id, channel_id, message_id, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (guild_id) DO UPDATE SET channel_id = excluded.channel_id,
         message_id = excluded.message_id, updated_at = excluded.updated_at`,
    )
    .run(board.guildId, board.channelId, board.messageId, nowMs);
}

export function deleteBoard(store: Store, guildId: string): boolean {
  return store.stmt('DELETE FROM leaderboards WHERE guild_id = ?').run(guildId).changes > 0;
}

interface SendableChannel {
  id: string;
  guildId?: string | null;
  send(options: { embeds: EmbedBuilder[]; allowedMentions?: { parse: never[] } }): Promise<Message>;
  messages: { fetch(id: string): Promise<Message> };
  bulkDelete(ids: readonly string[]): Promise<unknown>;
}

/** `guildId` pins the channel to that guild: a channel of any other guild (or a DM) is `null`. */
export async function fetchSendable(
  client: Client,
  channelId: string,
  guildId?: string,
): Promise<SendableChannel | null> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || !('send' in channel) || !('messages' in channel)) {
    return null;
  }
  if (guildId !== undefined && (!('guildId' in channel) || channel.guildId !== guildId)) {
    return null;
  }
  return channel as unknown as SendableChannel;
}

/** Rewrite one guild's board: edit the message, repost it when it is gone, drop the row when the channel is. */
export async function refreshBoard(
  client: Client,
  store: Store,
  identity: Pick<IdentityRepo, 'getGuildLocale'>,
  board: BoardRow,
  nowMs: number,
  netWorth?: Pick<NetWorthService, 'standings'>,
): Promise<void> {
  const channel = await fetchSendable(client, board.channelId, board.guildId);
  if (!channel) {
    deleteBoard(store, board.guildId);
    return;
  }
  const locale = resolveLocale({
    user: null,
    client: null,
    guild: identity.getGuildLocale(board.guildId),
  });
  const embedBuilder = boardEmbed(locale, boardStandings(netWorth, board.guildId, nowMs), nowMs);
  if (board.messageId !== null) {
    const message = await channel.messages.fetch(board.messageId).catch(() => null);
    if (message) {
      await message.edit({ embeds: [embedBuilder] });
      return;
    }
  }
  const posted = await channel.send({ embeds: [embedBuilder], allowedMentions: { parse: [] } });
  saveBoard(store, { ...board, messageId: posted.id }, nowMs);
}

/** Start the one-minute refresh loop once the client is ready. Returns the stop function. */
export function startBoardRefresh(
  client: Client,
  store: Store,
  identity: Pick<IdentityRepo, 'getGuildLocale'>,
  logger: Logger,
  now: () => number = Date.now,
  netWorth?: Pick<NetWorthService, 'standings'>,
): () => void {
  const tick = (): void => {
    if (!client.isReady()) return;
    const rows = store.stmt('SELECT guild_id, channel_id, message_id FROM leaderboards').all() as {
      guild_id: string;
      channel_id: string;
      message_id: string | null;
    }[];
    for (const row of rows) {
      void refreshBoard(
        client,
        store,
        identity,
        { guildId: row.guild_id, channelId: row.channel_id, messageId: row.message_id },
        now(),
        netWorth,
      ).catch((error: unknown) =>
        logger.warn({ err: error, guildId: row.guild_id }, 'leaderboard refresh failed'),
      );
    }
  };
  const timer = setInterval(tick, BOARD_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
