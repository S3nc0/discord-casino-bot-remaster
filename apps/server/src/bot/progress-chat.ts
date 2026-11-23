import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { formatPelica, t, type Locale } from '@casino/shared/i18n';
import {
  CONFIRM_FROM,
  CATALOG,
  isBuyable,
  isUnique,
  itemById,
  type ItemKind,
} from '@casino/domain/shop';
import {
  MAX_CHOICE_LEN,
  MAX_EXPLANATION_LEN,
  MAX_QUESTION_LEN,
  USER_DEFAULT_MINUTES,
} from '@casino/domain/quiz';
import type { NonCasinoGames } from '../games/progression/index.ts';
import { AppError } from '../runtime/errors.ts';
import {
  deleteBoard,
  fetchSendable,
  getBoard,
  boardEmbed,
  netWorthStandings,
  saveBoard,
} from './boards.ts';
import {
  EPHEMERAL,
  activityRow,
  cid,
  embed,
  formatNumber,
  idemKeyOf,
  nowOf,
  reply,
  requireGuild,
  updateMessage,
  type ChatCtx,
  type ComponentInteraction,
  type ParsedCid,
} from './chat-kit.ts';
import { itemLabel } from './shop-items.ts';

function requireGames(ctx: ChatCtx): NonCasinoGames {
  if (!ctx.deps.games) throw new AppError('internal');
  return ctx.deps.games;
}

// ------------------------------------------------------------------ /labor ranking

async function laborRanking(ctx: ChatCtx, interaction: ChatInputCommandInteraction): Promise<void> {
  const { locale } = ctx;
  const games = requireGames(ctx);
  const guildId = requireGuild(interaction);
  const period = interaction.options.getString('period') === 'today' ? 'today' : 'total';
  const ranking = games.work.ranking(guildId, interaction.user.id, period);
  const e = embed(
    'primary',
    t(locale, period === 'today' ? 'bot.labor.rankingToday' : 'bot.labor.rankingTotal'),
  );
  if (ranking.rows.length === 0) {
    e.setDescription(t(locale, 'bot.labor.rankingNone'));
  } else {
    const medals = ['🥇', '🥈', '🥉'];
    const lines = ranking.rows.map(
      (r, i) =>
        `${medals[i] ?? `${i + 1}.`} <@${r.userId}> — **${formatPelica(locale, r.earned)}** (${t(
          locale,
          'bot.labor.clicks',
          { n: formatNumber(locale, r.clicks) },
        )})`,
    );
    if (ranking.self && ranking.self.rank > ranking.rows.length) {
      lines.push(
        '…',
        `${ranking.self.rank}. <@${ranking.self.userId}> — **${formatPelica(locale, ranking.self.earned)}** (${t(
          locale,
          'bot.labor.clicks',
          { n: formatNumber(locale, ranking.self.clicks) },
        )})`,
      );
    }
    e.setDescription(lines.join('\n'));
  }
  await reply(interaction, { embeds: [e], components: [activityRow(locale, 'work')] });
}

// ------------------------------------------------------------------ /pelica leaderboard

async function leaderboard(ctx: ChatCtx, interaction: ChatInputCommandInteraction): Promise<void> {
  const { locale } = ctx;
  const store = ctx.deps.store;
  if (!store) throw new AppError('internal');
  const guildId = requireGuild(interaction);
  const now = nowOf(ctx.deps);

  if (interaction.options.getBoolean('stop') === true) {
    const board = getBoard(store, guildId);
    if (!board) {
      await reply(interaction, {
        embeds: [
          embed('warning', t(locale, 'bot.board.notSetTitle'), t(locale, 'bot.board.notSet')),
        ],
        flags: EPHEMERAL,
      });
      return;
    }
    deleteBoard(store, guildId);
    if (board.messageId !== null) {
      const channel = await fetchSendable(interaction.client, board.channelId, guildId);
      const message = await channel?.messages.fetch(board.messageId).catch(() => null);
      await message?.delete().catch(() => undefined);
    }
    await reply(interaction, {
      embeds: [embed('neutral', t(locale, 'bot.board.stopped'))],
      flags: EPHEMERAL,
    });
    return;
  }

  const channelId = interaction.options.getChannel('channel')?.id ?? interaction.channelId;
  const channel =
    channelId === null ? null : await fetchSendable(interaction.client, channelId, guildId);
  if (channelId === null || !channel) {
    await reply(interaction, {
      embeds: [
        embed(
          'error',
          t(locale, 'bot.board.noPermTitle'),
          t(locale, 'bot.board.noPerm', { channel: channelId === null ? '-' : `<#${channelId}>` }),
        ),
      ],
      flags: EPHEMERAL,
    });
    return;
  }
  const previous = getBoard(store, guildId);
  const posted = await channel.send({
    embeds: [boardEmbed(locale, netWorthStandings(store, guildId), now)],
    allowedMentions: { parse: [] },
  });
  saveBoard(store, { guildId, channelId: channel.id, messageId: posted.id }, now);
  if (previous?.messageId && previous.channelId !== undefined) {
    const old = await fetchSendable(interaction.client, previous.channelId, guildId);
    const message = await old?.messages.fetch(previous.messageId).catch(() => null);
    await message?.delete().catch(() => undefined);
  }
  await reply(interaction, {
    embeds: [
      embed(
        'success',
        t(locale, 'bot.board.setTitle'),
        t(locale, 'bot.board.set', { url: posted.url ?? `<#${channel.id}>`, minutes: 1 }),
      ),
    ],
    flags: EPHEMERAL,
  });
}

// ------------------------------------------------------------------ quiz

const LETTERS = ['A', 'B', 'C', 'D'] as const;

/** `3d`, `2時間`, `90m`, `1日12時間`: units 日/d, 時間/時/h, 分/m. A bare number uses `defaultUnit`. */
export function parseDurationMinutes(raw: string, defaultUnit: 'h' | 'm' = 'h'): number | null {
  const text = raw.normalize('NFKC').replace(/[,\s]/g, '').toLowerCase();
  if (text === '') return null;
  if (/^\d+$/.test(text)) return Number(text) * (defaultUnit === 'h' ? 60 : 1);
  const unitMinutes: Record<string, number> = {
    日: 1440,
    d: 1440,
    時間: 60,
    時: 60,
    h: 60,
    分: 1,
    m: 1,
  };
  const seen = new Set<string>();
  let total = 0;
  let rest = text;
  const re = /^(\d+)(日|d|時間|時|h|分|m)/;
  while (rest.length > 0) {
    const m = re.exec(rest);
    if (!m) return null;
    const unit = m[2] as string;
    const canonical = unitMinutes[unit] === 1440 ? 'd' : unitMinutes[unit] === 60 ? 'h' : 'm';
    if (seen.has(canonical)) return null;
    seen.add(canonical);
    total += Number(m[1]) * (unitMinutes[unit] as number);
    rest = rest.slice(m[0].length);
  }
  return total;
}

export function quizMessage(
  ctx: ChatCtx,
  quiz: {
    id: number;
    question: string;
    choices: string[];
    reward: number;
    expiresAt: number | null;
    authorId: string | null;
  },
  mode: 'ans' | 'pub',
) {
  const { locale } = ctx;
  const e = embed('primary', t(locale, 'bot.quiz.title', { id: quiz.id }));
  const lines = [quiz.question, ''];
  quiz.choices.forEach((c, i) => lines.push(`**${LETTERS[i]}.** ${c}`));
  if (mode === 'pub' && quiz.authorId !== null) {
    lines.push('', t(locale, 'bot.quiz.authorNote', { author: `<@${quiz.authorId}>` }));
  }
  e.setDescription(lines.join('\n')).setFooter({
    text: t(locale, mode === 'pub' ? 'bot.quiz.footerPublic' : 'bot.quiz.footer', {
      reward: formatNumber(locale, quiz.reward),
    }),
  });
  if (quiz.expiresAt !== null) {
    e.addFields({
      name: t(locale, 'bot.quiz.closes'),
      value: `<t:${Math.floor(quiz.expiresAt / 1000)}:R>`,
      inline: true,
    });
  }
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    quiz.choices.map((_c, i) =>
      new ButtonBuilder()
        .setCustomId(cid('qz', mode, quiz.id, i))
        .setLabel(LETTERS[i] as string)
        .setStyle(ButtonStyle.Primary),
    ),
  );
  return { embeds: [e], components: [row] };
}

async function quizPlay(ctx: ChatCtx, interaction: ChatInputCommandInteraction): Promise<void> {
  const { locale } = ctx;
  const games = requireGames(ctx);
  const guildId = requireGuild(interaction);
  ctx.deps.economy.ensureMember(guildId, interaction.user.id);
  const quiz = games.quiz.next(guildId, interaction.user.id);
  if (!quiz) {
    await reply(interaction, {
      embeds: [embed('neutral', t(locale, 'screen.quiz'), t(locale, 'bot.quiz.none'))],
      components: [activityRow(locale, 'quiz')],
      flags: EPHEMERAL,
    });
    return;
  }
  await reply(interaction, { ...quizMessage(ctx, quiz, 'ans'), flags: EPHEMERAL });
}

async function quizAnswer(
  ctx: ChatCtx,
  interaction: ButtonInteraction,
  id: ParsedCid,
): Promise<void> {
  const { locale } = ctx;
  const games = requireGames(ctx);
  const guildId = requireGuild(interaction);
  const quizId = Number(id.args[0]);
  const choice = Number(id.args[1]);
  if (!Number.isInteger(quizId) || !Number.isInteger(choice)) throw new AppError('invalid_payload');
  const res = games.quiz.answer(guildId, interaction.user.id, quizId, choice);
  const lines: string[] = [];
  if (res.correct) {
    lines.push(t(locale, 'bot.quiz.right'));
    if (res.rewardBlocked) lines.push(t(locale, 'bot.quiz.blocked'));
    else lines.push(t(locale, 'bot.quiz.reward', { reward: formatPelica(locale, res.reward) }));
  } else {
    lines.push(t(locale, 'bot.quiz.wrong', { answer: LETTERS[res.answer] ?? '?' }));
    if (res.rewardBlocked) lines.push(t(locale, 'bot.quiz.blocked'));
  }
  if (res.explanation) lines.push('', res.explanation);
  const e = embed(res.correct ? 'success' : 'neutral', t(locale, 'screen.quiz'), lines.join('\n'));
  const payload = { embeds: [e], components: [activityRow(locale, 'quiz')] };
  if (id.action === 'ans') await updateMessage(interaction, payload);
  else await reply(interaction, { ...payload, flags: EPHEMERAL });
}

async function quizPostModal(
  ctx: ChatCtx,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const { locale } = ctx;
  requireGuild(interaction);
  const input = (
    id: string,
    label: string,
    style: TextInputStyle,
    required: boolean,
    maxLength: number,
    placeholder?: string,
  ): ActionRowBuilder<TextInputBuilder> => {
    const field = new TextInputBuilder()
      .setCustomId(id)
      .setLabel(label.slice(0, 45))
      .setStyle(style)
      .setRequired(required)
      .setMaxLength(maxLength);
    if (placeholder) field.setPlaceholder(placeholder.slice(0, 100));
    return new ActionRowBuilder<TextInputBuilder>().addComponents(field);
  };
  const modal = new ModalBuilder()
    .setCustomId(cid('qzp', 'submit'))
    .setTitle(t(locale, 'bot.quiz.modal.title'))
    .addComponents(
      input(
        'question',
        t(locale, 'bot.quiz.modal.question'),
        TextInputStyle.Paragraph,
        true,
        MAX_QUESTION_LEN,
      ),
      input(
        'choices',
        t(locale, 'bot.quiz.modal.choices'),
        TextInputStyle.Paragraph,
        true,
        MAX_CHOICE_LEN * 4 + 8,
        t(locale, 'bot.quiz.modal.choicesHint'),
      ),
      input(
        'explanation',
        t(locale, 'bot.quiz.modal.explanation'),
        TextInputStyle.Paragraph,
        false,
        MAX_EXPLANATION_LEN,
      ),
      input('reward', t(locale, 'bot.quiz.modal.reward'), TextInputStyle.Short, true, 9, '100'),
      input(
        'duration',
        t(locale, 'bot.quiz.modal.duration'),
        TextInputStyle.Short,
        false,
        12,
        t(locale, 'bot.quiz.modal.durationHint'),
      ),
    );
  await interaction.showModal(modal);
}

export async function quizPostSubmit(
  ctx: ChatCtx,
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const games = requireGames(ctx);
  const guildId = requireGuild(interaction);
  const field = (name: string): string => {
    try {
      return interaction.fields.getTextInputValue(name);
    } catch {
      return '';
    }
  };
  const choices = field('choices')
    .split(/\r?\n/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  const reward = Number(field('reward').normalize('NFKC').replace(/,/g, '').trim());
  const rawDuration = field('duration').trim();
  const minutes = rawDuration === '' ? USER_DEFAULT_MINUTES : parseDurationMinutes(rawDuration);
  if (minutes === null || !Number.isInteger(reward)) throw new AppError('invalid_payload');
  const quiz = games.quiz.post({
    guildId,
    authorId: interaction.user.id,
    question: field('question'),
    choices,
    explanation: field('explanation'),
    reward,
    minutes,
  });
  await reply(interaction, { ...quizMessage(ctx, quiz, 'pub'), allowedMentions: { parse: [] } });
}

// ------------------------------------------------------------------ shop

const SHOP_KINDS: readonly ItemKind[] = [
  'title',
  'card_color',
  'card_icon',
  'consumable',
  'racing',
  'skin_dice',
  'skin_table',
  'collection',
  'color_role',
];

function itemsOfKind(kind: ItemKind) {
  return CATALOG.filter((i) => i.kind === kind && isBuyable(i) && i.id !== 'insider_memo');
}

function shopHome(ctx: ChatCtx, guildId: string, userId: string) {
  const { locale } = ctx;
  const balance = ctx.deps.economy.getBalance(guildId, userId);
  const e = embed('primary', t(locale, 'screen.shop'), t(locale, 'bot.shop.intro')).addFields({
    name: t(locale, 'bot.label.balance'),
    value: formatPelica(locale, balance),
    inline: true,
  });
  const buttons = SHOP_KINDS.map((kind) =>
    new ButtonBuilder()
      .setCustomId(cid('shop', 'cat', kind))
      .setLabel(t(locale, `bot.shop.kind.${kind}`))
      .setStyle(ButtonStyle.Secondary),
  );
  buttons.push(
    new ButtonBuilder()
      .setCustomId(cid('shop', 'mkt'))
      .setLabel(t(locale, 'bot.shop.market'))
      .setStyle(ButtonStyle.Danger),
  );
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(i, i + 5)));
  }
  return { embeds: [e], components: rows };
}

function backRow(locale: Locale): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(cid('shop', 'home'))
      .setLabel(t(locale, 'bot.shop.back'))
      .setStyle(ButtonStyle.Secondary),
  );
}

function shopCategory(ctx: ChatCtx, guildId: string, userId: string, kind: ItemKind) {
  const { locale } = ctx;
  const games = requireGames(ctx);
  const items = itemsOfKind(kind);
  const lines = items.map((item) => {
    const owned = games.shop.inventory.qty(guildId, userId, item.id);
    const left = games.shop.available(guildId, userId, item.id);
    const tags = [
      owned > 0 ? (isUnique(item) ? '✅' : `×${owned}`) : '',
      left === null ? '' : t(locale, 'bot.shop.stock', { n: left }),
    ]
      .filter((x) => x !== '')
      .join(' ');
    return `${itemLabel(locale, item.id)} — **${formatPelica(locale, item.price)}** ${tags}`.trim();
  });
  const e = embed(
    'primary',
    t(locale, `bot.shop.kind.${kind}`),
    lines.length === 0 ? t(locale, 'bot.shop.empty') : lines.join('\n'),
  );
  const rows: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [];
  if (items.length > 0) {
    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(cid('shop', 'pick'))
          .setPlaceholder(t(locale, 'bot.shop.pickPlaceholder'))
          .addOptions(
            items.slice(0, 25).map((item) => ({
              label: itemLabel(locale, item.id).slice(0, 100),
              description: formatPelica(locale, item.price).slice(0, 100),
              value: item.id,
            })),
          ),
      ),
    );
  }
  rows.push(
    backRow(locale) as unknown as ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>,
  );
  return { embeds: [e], components: rows };
}

async function shopOpen(ctx: ChatCtx, interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = requireGuild(interaction);
  ctx.deps.economy.ensureMember(guildId, interaction.user.id);
  await reply(interaction, { ...shopHome(ctx, guildId, interaction.user.id), flags: EPHEMERAL });
}

function confirmMessage(ctx: ChatCtx, text: string, okId: string, warn: boolean) {
  const { locale } = ctx;
  const e = embed(warn ? 'warning' : 'primary', t(locale, 'bot.shop.confirmTitle'), text);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(okId)
      .setLabel(t(locale, 'bot.shop.confirmBtn'))
      .setStyle(warn ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(cid('shop', 'home'))
      .setLabel(t(locale, 'common.cancel'))
      .setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [e], components: [row] };
}

async function shopBuy(
  ctx: ChatCtx,
  interaction: ComponentInteraction,
  guildId: string,
  itemId: string,
): Promise<void> {
  const { locale } = ctx;
  const games = requireGames(ctx);
  const res = games.shop.buy({
    guildId,
    userId: interaction.user.id,
    itemId,
    qty: 1,
    idempotencyKey: idemKeyOf(interaction, 'shop'),
  });
  const e = embed(
    'success',
    t(locale, 'bot.shop.bought'),
    t(locale, 'bot.shop.boughtBody', {
      item: itemLabel(locale, itemId),
      price: formatPelica(locale, res.price),
      balance: formatPelica(locale, res.balance),
    }),
  );
  await updateMessage(interaction, { embeds: [e], components: [backRow(locale)] });
}

function marketView(ctx: ChatCtx, guildId: string) {
  const { locale } = ctx;
  const games = requireGames(ctx);
  games.shop.ensureMarketDay(guildId);
  const lots = games.shop.marketLots(guildId);
  const lines = lots.map((lot) => {
    const name = lot.black ? t(locale, 'bot.shop.blackItem') : itemLabel(locale, lot.itemId);
    return t(locale, 'bot.shop.lotLine', {
      id: lot.id,
      name,
      price: formatNumber(locale, lot.price),
      qty: lot.qty,
      expires: `<t:${Math.floor(lot.expiresAt / 1000)}:R>`,
    });
  });
  const e = embed(
    'bank',
    t(locale, 'bot.shop.market'),
    lines.length === 0 ? t(locale, 'bot.shop.marketNone') : lines.join('\n'),
  );
  const rows: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [];
  if (lots.length > 0) {
    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(cid('shop', 'mpick'))
          .setPlaceholder(t(locale, 'bot.shop.pickPlaceholder'))
          .addOptions(
            lots.slice(0, 25).map((lot) => ({
              label: (lot.black
                ? `#${lot.id} ${t(locale, 'bot.shop.blackItem')}`
                : `#${lot.id} ${itemLabel(locale, lot.itemId)}`
              ).slice(0, 100),
              description: formatPelica(locale, lot.price).slice(0, 100),
              value: String(lot.id),
            })),
          ),
      ),
    );
  }
  rows.push(
    backRow(locale) as unknown as ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>,
  );
  return { embeds: [e], components: rows };
}

async function shopMarketBuy(
  ctx: ChatCtx,
  interaction: ComponentInteraction,
  guildId: string,
  lotId: number,
): Promise<void> {
  const { locale } = ctx;
  const games = requireGames(ctx);
  const res = games.shop.buyMarket({
    guildId,
    userId: interaction.user.id,
    lotId,
    idempotencyKey: idemKeyOf(interaction, 'shopm'),
  });
  const lines = [
    t(locale, 'bot.shop.boughtBody', {
      item: itemLabel(locale, res.itemId),
      price: formatPelica(locale, res.price),
      balance: formatPelica(locale, ctx.deps.economy.getBalance(guildId, interaction.user.id)),
    }),
  ];
  const lot = games.shop.marketLots(guildId).find((l) => l.id === lotId);
  void lot;
  lines.push(t(locale, `bot.shop.reveal.${res.revealed}`, { item: itemLabel(locale, res.itemId) }));
  await updateMessage(interaction, {
    embeds: [embed('success', t(locale, 'bot.shop.bought'), lines.join('\n'))],
    components: [backRow(locale)],
  });
}

async function shopComponent(
  ctx: ChatCtx,
  interaction: ComponentInteraction,
  id: ParsedCid,
): Promise<void> {
  const { locale } = ctx;
  const games = requireGames(ctx);
  const guildId = requireGuild(interaction);
  const userId = interaction.user.id;
  const picked = interaction.isStringSelectMenu() ? (interaction.values[0] ?? '') : '';
  switch (id.action) {
    case 'home':
      await updateMessage(interaction, shopHome(ctx, guildId, userId));
      return;
    case 'cat': {
      const kind = id.args[0] as ItemKind;
      if (!SHOP_KINDS.includes(kind)) throw new AppError('invalid_payload');
      await updateMessage(interaction, shopCategory(ctx, guildId, userId, kind));
      return;
    }
    case 'pick': {
      const item = itemById(picked);
      if (!item) throw new AppError('not_found');
      if (item.price >= CONFIRM_FROM) {
        await updateMessage(
          interaction,
          confirmMessage(
            ctx,
            t(locale, 'bot.shop.confirmBody', {
              item: itemLabel(locale, item.id),
              price: formatPelica(locale, item.price),
            }),
            cid('shop', 'ok', item.id),
            false,
          ),
        );
        return;
      }
      await shopBuy(ctx, interaction, guildId, item.id);
      return;
    }
    case 'ok':
      await shopBuy(ctx, interaction, guildId, id.args[0] ?? '');
      return;
    case 'mkt':
      await updateMessage(interaction, marketView(ctx, guildId));
      return;
    case 'mpick': {
      const lotId = Number(picked);
      const lot = games.shop.marketLots(guildId).find((l) => l.id === lotId);
      if (!lot) throw new AppError('not_found');
      if (lot.confirm) {
        const text = lot.black
          ? `${t(locale, 'bot.shop.blackWarn')}\n${t(locale, 'bot.shop.confirmBody', {
              item: t(locale, 'bot.shop.blackItem'),
              price: formatPelica(locale, lot.price),
            })}`
          : t(locale, 'bot.shop.confirmBody', {
              item: itemLabel(locale, lot.itemId),
              price: formatPelica(locale, lot.price),
            });
        await updateMessage(
          interaction,
          confirmMessage(ctx, text, cid('shop', 'mok', lot.id), lot.black),
        );
        return;
      }
      await shopMarketBuy(ctx, interaction, guildId, lot.id);
      return;
    }
    case 'mok':
      await shopMarketBuy(ctx, interaction, guildId, Number(id.args[0]));
      return;
    default:
      throw new AppError('invalid_payload');
  }
}

// ------------------------------------------------------------------ entry points

export async function handleProgressCommand(
  ctx: ChatCtx,
  path: string,
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  switch (path) {
    case 'labor ranking':
      if (!ctx.deps.games) return false;
      await laborRanking(ctx, interaction);
      return true;
    case 'pelica leaderboard':
      if (!ctx.deps.store) return false;
      await leaderboard(ctx, interaction);
      return true;
    case 'quiz play':
      if (!ctx.deps.games) return false;
      await quizPlay(ctx, interaction);
      return true;
    case 'quiz post':
      if (!ctx.deps.games) return false;
      await quizPostModal(ctx, interaction);
      return true;
    case 'shop':
      if (!ctx.deps.games) return false;
      await shopOpen(ctx, interaction);
      return true;
    default:
      return false;
  }
}

export async function handleProgressComponent(
  ctx: ChatCtx,
  interaction: ComponentInteraction,
  id: ParsedCid,
): Promise<boolean> {
  switch (id.namespace) {
    case 'qz':
      if (!interaction.isButton()) return false;
      await quizAnswer(ctx, interaction, id);
      return true;
    case 'shop':
      await shopComponent(ctx, interaction, id);
      return true;
    default:
      return false;
  }
}
