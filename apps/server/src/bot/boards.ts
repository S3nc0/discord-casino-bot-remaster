import type { Client, EmbedBuilder, Message } from 'discord.js';
import { formatPelica, resolveLocale, t, type Locale } from '@casino/shared/i18n';
import type { Logger } from 'pino';
import type { IdentityRepo } from '../db/identity.ts';
import type { Store } from '../db/store.ts';
import { embed } from './chat-kit.ts';

/** How often the live ranking posts are rewritten (docs/spec/economy-core.md §4). */
export const BOARD_INTERVAL_MS = 60_000;
export const BOARD_TOP_N = 10;

export interface NetWorthRow {
  userId: string;
  net: number;
}

/**
 * Net worth ranking of a guild: cash − debt + Teiai trust deposit + the cost basis of spot holdings,
 * active bonds and company funds. Sorted `(-net, user_id)`, top `limit` rows.
 */
export function netWorthStandings(
  store: Store,
  guildId: string,
  limit = BOARD_TOP_N,
): NetWorthRow[] {
  const rows = store
    .stmt(
      `SELECT m.user_id AS user_id,
              COALESCE(b.balance, 0) - COALESCE(a.debt, 0) + COALESCE(d.amount, 0)
              + COALESCE((SELECT SUM(cost) FROM positions_spot s
                           WHERE s.guild_id = m.guild_id AND s.user_id = m.user_id), 0)
              + COALESCE((SELECT SUM(principal) FROM bonds o
                           WHERE o.guild_id = m.guild_id AND o.user_id = m.user_id AND o.status = 'active'), 0)
              + COALESCE((SELECT funds FROM companies c
                           WHERE c.guild_id = m.guild_id AND c.user_id = m.user_id), 0) AS net
         FROM guild_members m
         LEFT JOIN balances b ON b.guild_id = m.guild_id AND b.user_id = m.user_id
         LEFT JOIN bank_accounts a ON a.guild_id = m.guild_id AND a.user_id = m.user_id
         LEFT JOIN bank_deposits d ON d.guild_id = m.guild_id AND d.user_id = m.user_id
        WHERE m.guild_id = ?
        ORDER BY net DESC, m.user_id ASC
        LIMIT ?`,
    )
    .all(guildId, limit) as { user_id: string; net: number }[];
  return rows.map((r) => ({ userId: r.user_id, net: r.net }));
}

export function boardEmbed(
  locale: Locale,
  rows: readonly NetWorthRow[],
  nowMs: number,
): EmbedBuilder {
  const medals = ['🥇', '🥈', '🥉'];
  const lines =
    rows.length === 0
      ? t(locale, 'bot.board.empty')
      : rows
          .map(
            (r, i) =>
              `${medals[i] ?? `${i + 1}.`} <@${r.userId}> — **${formatPelica(locale, r.net)}**`,
          )
          .join('\n');
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
  send(options: { embeds: EmbedBuilder[] }): Promise<Message>;
  messages: { fetch(id: string): Promise<Message> };
}

export async function fetchSendable(
  client: Client,
  channelId: string,
): Promise<SendableChannel | null> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || !('send' in channel) || !('messages' in channel)) {
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
): Promise<void> {
  const channel = await fetchSendable(client, board.channelId);
  if (!channel) {
    deleteBoard(store, board.guildId);
    return;
  }
  const locale = resolveLocale({
    user: null,
    client: null,
    guild: identity.getGuildLocale(board.guildId),
  });
  const embedBuilder = boardEmbed(locale, netWorthStandings(store, board.guildId), nowMs);
  if (board.messageId !== null) {
    const message = await channel.messages.fetch(board.messageId).catch(() => null);
    if (message) {
      await message.edit({ embeds: [embedBuilder] });
      return;
    }
  }
  const posted = await channel.send({ embeds: [embedBuilder] });
  saveBoard(store, { ...board, messageId: posted.id }, nowMs);
}

/** Start the one-minute refresh loop once the client is ready. Returns the stop function. */
export function startBoardRefresh(
  client: Client,
  store: Store,
  identity: Pick<IdentityRepo, 'getGuildLocale'>,
  logger: Logger,
  now: () => number = Date.now,
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
      ).catch((error: unknown) =>
        logger.warn({ err: error, guildId: row.guild_id }, 'leaderboard refresh failed'),
      );
    }
  };
  const timer = setInterval(tick, BOARD_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
