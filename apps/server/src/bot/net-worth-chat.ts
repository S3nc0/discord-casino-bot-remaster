import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type EmbedBuilder,
  type User,
} from 'discord.js';
import type { PlayerDisplayStatus } from '@casino/domain/finance';
import {
  FIXED_KEYS,
  LIABILITY_KEYS,
  LIQUID_KEYS,
  type AssetGroups,
  type AssetKey,
  type BalanceSheet,
} from '@casino/domain/progression';
import { formatPelica, t, type Locale } from '@casino/shared/i18n';
import type { NetWorthService, NetWorthStanding } from '../finance/net-worth-service.ts';
import {
  EPHEMERAL,
  activityRow,
  cid,
  embed,
  formatNumber,
  nowOf,
  reply,
  requireGuild,
  updateMessage,
  type ChatCtx,
  type ComponentInteraction,
  type ParsedCid,
} from './chat-kit.ts';

/** The two net-worth views a player can switch between (`/pelica ranking view:`). */
export type NetWorthChatView = 'net' | 'liquid';
export const NET_WORTH_TOP_N = 10;
const MEDALS = ['🥇', '🥈', '🥉'];

/**
 * Ranking-row status emoji (`docs/teiai.md`: 🟡 / 🟤 / 🔴 next to names; Clean has none).
 */
export function statusEmoji(status: PlayerDisplayStatus): string {
  switch (status) {
    case 'wealthy':
      return '🟡';
    case 'underground':
      return '🟤';
    case 'bankrupt':
      return '🔴';
    case 'katagi':
      return '';
  }
}

/** `（流動 12,345・固定 6,789・負債 1,000）`; groups that are zero are left out, nothing at all → ''. */
export function subtotals(locale: Locale, groups: AssetGroups): string {
  const bits: string[] = [];
  if (groups.liquid !== 0)
    bits.push(t(locale, 'bs.sub.liquid', { n: formatNumber(locale, groups.liquid) }));
  if (groups.fixed !== 0)
    bits.push(t(locale, 'bs.sub.fixed', { n: formatNumber(locale, groups.fixed) }));
  if (groups.liabilities !== 0) {
    bits.push(t(locale, 'bs.sub.liabilities', { n: formatNumber(locale, groups.liabilities) }));
  }
  return bits.length === 0
    ? ''
    : t(locale, 'bs.sub.wrap', { parts: bits.join(t(locale, 'bs.sub.sep')) });
}

/** One ranking line: medal or place, mention, optional status emoji, value in bold, subtotals. */
export function standingLine(locale: Locale, row: NetWorthStanding): string {
  const sub = subtotals(locale, row.sheet.groups);
  const badge = statusEmoji(row.status);
  return `${MEDALS[row.rank - 1] ?? `${row.rank}.`} <@${row.sheet.userId}>${badge ? ` ${badge}` : ''} — **${formatPelica(locale, row.value)}**${sub ? ` ${sub}` : ''}`;
}

export function netWorthRankingEmbed(
  locale: Locale,
  view: NetWorthChatView,
  rows: readonly NetWorthStanding[],
  self: NetWorthStanding | null,
): EmbedBuilder {
  const lines = rows.map((r) => standingLine(locale, r));
  if (self && self.rank > rows.length) lines.push('…', standingLine(locale, self));
  return embed('primary', t(locale, `bot.nw.title.${view}`))
    .setDescription(lines.length === 0 ? t(locale, 'bot.nw.empty') : lines.join('\n'))
    .setFooter({ text: t(locale, `bs.footer.${view}`) });
}

function section(
  locale: Locale,
  sheet: BalanceSheet,
  keys: readonly AssetKey[],
  sign: 1 | -1,
): string {
  const lines = keys
    .filter((k) => sheet.parts[k] !== 0)
    .map((k) => `${t(locale, `bs.part.${k}`)}: ${formatPelica(locale, sign * sheet.parts[k])}`);
  return lines.length === 0 ? t(locale, 'bs.none') : lines.join('\n');
}

/** The balance sheet of one member, grouped as current assets / fixed assets / liabilities. */
export function breakdownEmbed(
  locale: Locale,
  name: string,
  sheet: BalanceSheet | null,
): EmbedBuilder {
  const e = embed('info', t(locale, 'bot.nw.breakdown.title', { name }));
  if (!sheet) return e.setDescription(t(locale, 'bot.nw.breakdown.noAccount'));
  const g = sheet.groups;
  const money = (n: number): string => formatPelica(locale, n);
  return e
    .setDescription(
      [
        `**💧 ${t(locale, 'bs.group.liquid')}**`,
        section(locale, sheet, LIQUID_KEYS, 1),
        '',
        `**🏛️ ${t(locale, 'bs.group.fixed')}**`,
        section(locale, sheet, FIXED_KEYS, 1),
        '',
        `**${t(locale, 'bot.nw.breakdown.gross', { gross: money(g.gross) })}**`,
        '',
        `**📉 ${t(locale, 'bs.group.liabilities')}**`,
        section(locale, sheet, LIABILITY_KEYS, -1),
        `**${t(locale, 'bot.nw.breakdown.liabTotal', { liab: money(g.liabilities) })}**`,
        '',
        `**🧾 ${t(locale, 'bot.nw.breakdown.net', { net: money(g.net) })}**`,
      ].join('\n'),
    )
    .setFooter({ text: t(locale, 'bs.footer.breakdown') });
}

/** 🏆 net / 💧 liquid / 🧾 mine. Only `ownerId` may press them; the active view is disabled. */
export function rankingButtons(
  locale: Locale,
  ownerId: string,
  active: NetWorthChatView | 'mine',
): ActionRowBuilder<ButtonBuilder> {
  const button = (action: NetWorthChatView | 'mine', style: ButtonStyle): ButtonBuilder =>
    new ButtonBuilder()
      .setCustomId(cid('nw', action, ownerId))
      .setLabel(t(locale, `bot.nw.btn.${action}`))
      .setStyle(style)
      .setDisabled(active === action);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    button('net', ButtonStyle.Primary),
    button('liquid', ButtonStyle.Secondary),
    button('mine', ButtonStyle.Secondary),
  );
}

function displayName(user: Pick<User, 'globalName' | 'username'>): string {
  return user.globalName ?? user.username;
}

function service(ctx: ChatCtx): NetWorthService | null {
  return ctx.deps.finance?.netWorth ?? null;
}

function rankingMessage(
  ctx: ChatCtx,
  netWorth: NetWorthService,
  guildId: string,
  ownerId: string,
  view: NetWorthChatView,
) {
  const res = netWorth.standingsWithSelf(guildId, ownerId, view, NET_WORTH_TOP_N, nowOf(ctx.deps));
  return {
    embeds: [netWorthRankingEmbed(ctx.locale, view, res.rows, res.self)],
    components: [rankingButtons(ctx.locale, ownerId, view), activityRow(ctx.locale, 'ranking')],
    allowedMentions: { parse: [] as never[] },
  };
}

function breakdownMessage(
  ctx: ChatCtx,
  netWorth: NetWorthService,
  guildId: string,
  ownerId: string,
  target: Pick<User, 'id' | 'globalName' | 'username'>,
) {
  const sheet =
    netWorth.sheets(guildId, nowOf(ctx.deps)).find((s) => s.userId === target.id) ?? null;
  return {
    embeds: [breakdownEmbed(ctx.locale, displayName(target), sheet)],
    components: [rankingButtons(ctx.locale, ownerId, target.id === ownerId ? 'mine' : 'net')],
    allowedMentions: { parse: [] as never[] },
  };
}

/**
 * `/pelica ranking view:net|liquid` (D2: the default view stays the weekly game ranking, which
 * `wired-commands.ts` answers). With `member`, opens that member's breakdown instead, visible only
 * to the caller.
 */
export async function handleNetWorthCommand(
  ctx: ChatCtx,
  path: string,
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  if (path !== 'pelica ranking') return false;
  const view = interaction.options.getString('view');
  if (view !== 'net' && view !== 'liquid') return false;
  const netWorth = service(ctx);
  if (!netWorth) return false;
  const guildId = requireGuild(interaction);
  const ownerId = interaction.user.id;
  const member = interaction.options.getUser('member');
  await reply(
    interaction,
    member
      ? { ...breakdownMessage(ctx, netWorth, guildId, ownerId, member), flags: EPHEMERAL }
      : rankingMessage(ctx, netWorth, guildId, ownerId, view),
  );
  return true;
}

/** `b:nw:<net|liquid|mine>:<ownerId>`: switch the view in place; others get a private note. */
export async function handleNetWorthComponent(
  ctx: ChatCtx,
  interaction: ComponentInteraction,
  id: ParsedCid,
): Promise<boolean> {
  if (id.namespace !== 'nw' || !interaction.isButton()) return false;
  const netWorth = service(ctx);
  if (!netWorth) return false;
  const button = interaction as ButtonInteraction;
  const ownerId = id.args[0];
  if (ownerId !== button.user.id) {
    await reply(button, { content: t(ctx.locale, 'bot.nw.ownerOnly'), flags: EPHEMERAL });
    return true;
  }
  const guildId = requireGuild(button);
  if (id.action === 'mine') {
    await updateMessage(button, breakdownMessage(ctx, netWorth, guildId, ownerId, button.user));
    return true;
  }
  if (id.action !== 'net' && id.action !== 'liquid') return false;
  await updateMessage(button, rankingMessage(ctx, netWorth, guildId, ownerId, id.action));
  return true;
}
