import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { formatPelica, t, type Locale } from '@casino/shared/i18n';
import type { TableSnapshot } from '@casino/shared';
import type { blackjack as bj, chinchiro as chin } from '@casino/domain/casino';
import type { BlackjackView } from '../games/casino/blackjack.ts';
import type { ChinchiroView } from '../games/casino/chinchiro.ts';
import type { Caller, CasinoGames } from '../games/index.ts';
import { AppError } from '../runtime/errors.ts';
import {
  EPHEMERAL,
  activityRow,
  cid,
  embed,
  idemKeyOf,
  reply,
  requireGuild,
  signedPelica,
  updateMessage,
  type ChatCtx,
  type ParsedCid,
} from './chat-kit.ts';

const DICE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'] as const;

function diceText(dice: readonly number[]): string {
  return dice.map((d) => DICE_FACES[d - 1] ?? '?').join(' ');
}

function handName(locale: Locale, hand: chin.ChinchiroHand): string {
  switch (hand.kind) {
    case 'arashi':
      return t(locale, 'bot.casino.role.arashi', { v: hand.value });
    case 'me':
      return t(locale, 'bot.casino.role.me', { v: hand.value });
    case 'pinzoro':
      return t(locale, 'bot.casino.role.pinzoro');
    case 'shigoro':
      return t(locale, 'bot.casino.role.shigoro');
    case 'hifumi':
      return t(locale, 'bot.casino.role.hifumi');
    case 'menashi':
      return t(locale, 'bot.casino.role.menashi');
  }
}

function rollLine(locale: Locale, rolls: readonly chin.ChinchiroRoll[]): string {
  return rolls
    .map((r) => `${diceText(r.dice)}　**${handName(locale, r.hand)}**`)
    .join(`\n${t(locale, 'bot.casino.chinchiro.reroll')}\n`);
}

function casinoCaller(
  ctx: ChatCtx,
  interaction: { guildId: string | null; user: { id: string } },
  instanceId?: string,
): Caller {
  void ctx;
  return {
    guildId: requireGuild(interaction),
    userId: interaction.user.id,
    source: 'chat',
    ...(instanceId === undefined ? {} : { instanceId }),
  };
}

function requireCasino(ctx: ChatCtx): CasinoGames {
  if (!ctx.deps.casino) throw new AppError('internal');
  return ctx.deps.casino;
}

// ------------------------------------------------------------------ solo chinchiro

function chinchiroFlavor(locale: Locale, view: ChinchiroView): string {
  const result = view.result;
  if (!result) return '';
  const dealerHand = (view.dealerRolls[view.dealerRolls.length - 1] as chin.ChinchiroRoll).hand;
  const playerLast = view.playerRolls[view.playerRolls.length - 1];
  const playerHand: chin.ChinchiroHand = playerLast?.hand ?? { kind: 'menashi', value: 0 };
  if (result.outcome === 'draw') return t(locale, 'bot.casino.chinchiro.draw');
  if (result.outcome === 'win') {
    return dealerHand.kind === 'hifumi'
      ? t(locale, 'bot.casino.chinchiro.win.dealerHifumi')
      : t(locale, `bot.casino.chinchiro.win.${playerHand.kind}`);
  }
  const base =
    playerHand.kind === 'hifumi'
      ? t(locale, 'bot.casino.chinchiro.lose.hifumi')
      : t(locale, `bot.casino.chinchiro.lose.${dealerHand.kind}`);
  return result.settlement.penaltyShortfall > 0
    ? `${base}\n${t(locale, 'bot.casino.chinchiro.lose.debt')}`
    : base;
}

function chinchiroMessage(ctx: ChatCtx, view: ChinchiroView) {
  const { locale } = ctx;
  const e = embed('primary', t(locale, 'bot.casino.chinchiro.title'));
  const lines: string[] = [
    t(locale, 'bot.casino.chinchiro.bet', { bet: formatPelica(locale, view.stake) }),
  ];
  lines.push(`\n**${t(locale, 'bot.casino.dealer')}**\n${rollLine(locale, view.dealerRolls)}`);
  if (view.playerRolls.length > 0) {
    lines.push(`\n**${t(locale, 'bot.casino.you')}**\n${rollLine(locale, view.playerRolls)}`);
  }
  if (view.status === 'player_turn') {
    lines.push(
      `\n${
        view.playerRolls.length === 0
          ? t(locale, 'bot.casino.chinchiro.prompt.first')
          : t(locale, 'bot.casino.chinchiro.prompt.reroll', { left: view.rollsLeft })
      }`,
    );
    e.setDescription(lines.join('\n'));
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(cid('chi', 'roll', view.roundId))
        .setLabel(t(locale, 'bot.casino.chinchiro.btnRoll'))
        .setStyle(ButtonStyle.Primary),
    );
    return { embeds: [e], components: [row] };
  }
  const result = view.result;
  if (result) {
    lines.push(`\n${chinchiroFlavor(locale, view)}`);
    e.setColor(
      result.outcome === 'win' ? 0x31a63a : result.outcome === 'draw' ? 0x6f7979 : 0xdc3a31,
    );
    e.addFields(
      {
        name: t(locale, 'bot.label.payout'),
        value: formatPelica(locale, result.settlement.payout),
        inline: true,
      },
      {
        name: t(locale, 'bot.label.net'),
        value: signedPelica(locale, result.settlement.net),
        inline: true,
      },
      {
        name: t(locale, 'bot.label.balance'),
        value: formatPelica(locale, result.settlement.balance),
        inline: true,
      },
    );
  }
  e.setDescription(lines.join('\n'));
  return { embeds: [e], components: [activityRow(locale, 'chinchiro')] };
}

async function startChinchiro(
  ctx: ChatCtx,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const casino = requireCasino(ctx);
  const caller = casinoCaller(ctx, interaction);
  ctx.deps.economy.ensureMember(caller.guildId, caller.userId);
  const stake = interaction.options.getInteger('bet', true);
  const { response: view } = casino.chinchiro.start(caller, {
    stake,
    idempotencyKey: idemKeyOf(interaction),
  });
  await reply(interaction, chinchiroMessage(ctx, view));
}

async function rollChinchiro(
  ctx: ChatCtx,
  interaction: ButtonInteraction,
  roundId: string,
): Promise<void> {
  const casino = requireCasino(ctx);
  const caller = casinoCaller(ctx, interaction);
  const { response: view } = casino.chinchiro.roll(caller, {
    roundId,
    idempotencyKey: idemKeyOf(interaction, 'btn'),
  });
  await updateMessage(interaction, chinchiroMessage(ctx, view));
}

// ------------------------------------------------------------------ solo blackjack

function cardText(card: bj.Card | null): string {
  return card === null ? '？' : `${card.rank}${card.suit}`;
}

function blackjackMessage(ctx: ChatCtx, view: BlackjackView, stake: number) {
  const { locale } = ctx;
  const seat = view.seats[0] as BlackjackView['seats'][number];
  const e = embed('primary', t(locale, 'bot.casino.blackjack.title'));
  const dealerLine = `${view.dealer.map(cardText).join(' ')}${
    view.dealerValue === null ? '' : `（${view.dealerValue}）`
  }`;
  const lines = [
    `**${t(locale, 'bot.casino.dealer')}**　${dealerLine}`,
    `**${t(locale, 'bot.casino.you')}**　${seat.cards.map(cardText).join(' ')}（${seat.value}）${
      seat.doubled ? t(locale, 'bot.casino.blackjack.doubledLabel') : ''
    }`,
  ];
  if (view.phase === 'settled' && seat.result && seat.settlement) {
    const result: bj.BlackjackResult = seat.result;
    const dealerBust = view.dealerValue !== null && view.dealerValue > 21;
    lines.push(
      `\n${
        result === 'win' && dealerBust
          ? t(locale, 'bot.casino.blackjack.res.dealerBust')
          : t(locale, `bot.casino.blackjack.res.${result}`)
      }`,
    );
    if (result === 'blackjack') lines.push(t(locale, 'bot.casino.blackjack.flair.blackjack'));
    else if (seat.doubled && result === 'win') {
      lines.push(t(locale, 'bot.casino.blackjack.flair.doubled'));
    } else if (seat.value === 21) lines.push(t(locale, 'bot.casino.blackjack.flair.twentyOne'));
    e.setColor(
      result === 'win' || result === 'blackjack'
        ? 0x31a63a
        : result === 'push'
          ? 0x6f7979
          : 0xdc3a31,
    );
    e.setDescription(lines.join('\n'));
    e.addFields(
      {
        name: t(locale, 'bot.label.payout'),
        value: formatPelica(locale, seat.settlement.payout),
        inline: true,
      },
      {
        name: t(locale, 'bot.label.net'),
        value: signedPelica(locale, seat.settlement.net),
        inline: true,
      },
      {
        name: t(locale, 'bot.label.balance'),
        value: formatPelica(locale, seat.settlement.balance),
        inline: true,
      },
    );
    return { embeds: [e], components: [activityRow(locale, 'blackjack')] };
  }
  lines.push(`\n${t(locale, 'bot.casino.blackjack.prompt', { bet: formatPelica(locale, stake) })}`);
  e.setDescription(lines.join('\n'));
  const canDouble = seat.cards.length === 2 && !seat.doubled;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(cid('bj', 'hit', view.roundId))
      .setLabel(t(locale, 'bot.casino.blackjack.btnHit'))
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(cid('bj', 'stand', view.roundId))
      .setLabel(t(locale, 'bot.casino.blackjack.btnStand'))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(cid('bj', 'double', view.roundId))
      .setLabel(t(locale, 'bot.casino.blackjack.btnDouble'))
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canDouble),
  );
  return { embeds: [e], components: [row] };
}

async function startBlackjack(
  ctx: ChatCtx,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const casino = requireCasino(ctx);
  const caller = casinoCaller(ctx, interaction);
  ctx.deps.economy.ensureMember(caller.guildId, caller.userId);
  const stake = interaction.options.getInteger('bet', true);
  const { response: view } = casino.blackjack.startSolo(caller, {
    stake,
    idempotencyKey: idemKeyOf(interaction),
  });
  await reply(interaction, blackjackMessage(ctx, view, stake));
}

async function blackjackAction(
  ctx: ChatCtx,
  interaction: ButtonInteraction,
  action: string,
  roundId: string,
): Promise<void> {
  const casino = requireCasino(ctx);
  const caller = casinoCaller(ctx, interaction);
  const params = { roundId, idempotencyKey: idemKeyOf(interaction, 'btn') };
  const view = (() => {
    switch (action) {
      case 'hit':
        return casino.blackjack.hit(caller, params).response;
      case 'stand':
        return casino.blackjack.stand(caller, params).response;
      case 'double':
      case 'credit':
        return casino.blackjack.double(caller, { ...params, credit: action === 'credit' }).response;
      default:
        throw new AppError('invalid_payload');
    }
  })();
  const seat = view.seats[0];
  await updateMessage(
    interaction,
    blackjackMessage(ctx, view, seat ? seat.stake / (seat.doubled ? 2 : 1) : 0),
  );
}

/** A double the player's cash cannot cover: offer Teiai credit (spec: blackjack, "Player Actions"). */
async function offerCreditDouble(
  ctx: ChatCtx,
  interaction: ButtonInteraction,
  roundId: string,
): Promise<void> {
  const { locale } = ctx;
  const e = embed(
    'warning',
    t(locale, 'bot.casino.blackjack.credit.title'),
    t(locale, 'bot.casino.blackjack.credit.body'),
  );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(cid('bj', 'credit', roundId))
      .setLabel(t(locale, 'bot.casino.blackjack.credit.btn'))
      .setStyle(ButtonStyle.Danger),
  );
  await reply(interaction, { embeds: [e], components: [row], flags: EPHEMERAL });
}

// ------------------------------------------------------------------ chinchiro table (chat)

interface TableMessage {
  guildId: string;
  edit(options: ReturnType<typeof tableMessage>): Promise<unknown>;
  locale: Locale;
}

/** Live chat tables: the Discord message to rewrite whenever the table's snapshot changes. */
class ChatTables {
  private readonly messages = new Map<string, TableMessage>();

  constructor(casino: CasinoGames, onError: (error: unknown) => void) {
    casino.onTableState((snapshot) => {
      if (snapshot.game !== 'chinchiro' || !snapshot.instanceId.startsWith('chat:')) return;
      const key = `${snapshot.guildId}:${snapshot.instanceId}`;
      const target = this.messages.get(key);
      if (!target) return;
      void target.edit(tableMessage(target.locale, snapshot)).catch(onError);
      if (snapshot.phase === 'idle') this.messages.delete(key);
    });
  }

  track(key: string, message: TableMessage): void {
    this.messages.set(key, message);
  }
}

const chatTables = new WeakMap<CasinoGames, ChatTables>();

function tablesOf(ctx: ChatCtx): ChatTables {
  const casino = requireCasino(ctx);
  let tables = chatTables.get(casino);
  if (!tables) {
    tables = new ChatTables(casino, (error) =>
      ctx.deps.logger.warn({ err: error }, 'chinchiro table message update failed'),
    );
    chatTables.set(casino, tables);
  }
  return tables;
}

interface TableData {
  bet?: number;
  hostId?: string;
  deadline: number | null;
  closedEmpty: boolean;
  dealerRolls?: chin.ChinchiroRoll[];
  hands?: { userId: string; rolls: chin.ChinchiroRoll[] }[];
  verdicts?: {
    userId: string;
    result: chin.ChinchiroResult;
    multiplier: number;
    payout: number;
    net: number;
    settled: boolean;
  }[];
}

function tableMessage(locale: Locale, snapshot: TableSnapshot) {
  const data = snapshot.data as TableData;
  const e = embed('primary', t(locale, 'bot.casino.table.title'));
  const seated = snapshot.seats.filter((s) => s.userId !== null);
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  const lines: string[] = [];
  if (snapshot.phase === 'lobby') {
    lines.push(
      t(locale, 'bot.casino.table.lobby', {
        bet: formatPelica(locale, data.bet ?? 0),
        host: `<@${data.hostId ?? ''}>`,
        closes: data.deadline === null ? '' : `<t:${Math.floor(data.deadline / 1000)}:R>`,
      }),
    );
    lines.push(seated.map((s, i) => `${i + 1}. <@${s.userId}>`).join('\n'));
    const roundId = snapshot.roundId ?? '';
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(cid('cht', 'sit', roundId))
          .setLabel(t(locale, 'bot.casino.table.btnSit'))
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(cid('cht', 'stand', roundId))
          .setLabel(t(locale, 'bot.casino.table.btnStand'))
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(cid('cht', 'begin', roundId))
          .setLabel(t(locale, 'bot.casino.table.btnBegin'))
          .setStyle(ButtonStyle.Success),
      ),
    );
  } else if (snapshot.phase === 'playing' || snapshot.phase === 'result') {
    lines.push(t(locale, 'bot.casino.table.rolling'));
    if (data.dealerRolls) {
      lines.push(
        `\n**${t(locale, 'bot.casino.table.dealer')}**\n${rollLine(locale, data.dealerRolls)}`,
      );
    }
    const verdicts = new Map((data.verdicts ?? []).map((v) => [v.userId, v] as const));
    for (const hand of data.hands ?? []) {
      const verdict = verdicts.get(hand.userId);
      const tag = verdict
        ? ` ${t(locale, `bot.casino.table.verdict.${verdict.result}`)} ${
            verdict.net > 0 ? '+' : ''
          }${formatPelica(locale, verdict.net)}`
        : '';
      lines.push(`\n<@${hand.userId}>${tag}\n${rollLine(locale, hand.rolls)}`);
    }
  } else if (data.closedEmpty) {
    lines.push(t(locale, 'bot.casino.table.empty'));
  } else {
    lines.push(t(locale, 'bot.casino.table.closed'));
  }
  e.setDescription(lines.join('\n'));
  return {
    embeds: [e],
    components: snapshot.phase === 'idle' ? [activityRow(locale, 'chinchiro')] : components,
  };
}

function tableInstance(interaction: { channelId: string | null }): string {
  return `chat:${interaction.channelId ?? 'dm'}`;
}

async function openChinchiroTable(
  ctx: ChatCtx,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const casino = requireCasino(ctx);
  const instanceId = tableInstance(interaction);
  const caller = casinoCaller(ctx, interaction, instanceId);
  ctx.deps.economy.ensureMember(caller.guildId, caller.userId);
  const stake = interaction.options.getInteger('bet', true);
  const tables = tablesOf(ctx);
  casino.chinchiroTable.sit(caller, { stake, idempotencyKey: idemKeyOf(interaction) });
  const snapshot = casino.chinchiroTable.snapshot(caller.guildId, instanceId);
  await reply(interaction, tableMessage(ctx.locale, snapshot));
  tables.track(`${caller.guildId}:${instanceId}`, {
    guildId: caller.guildId,
    locale: ctx.locale,
    edit: (options) => interaction.editReply(options),
  });
}

async function tableButton(
  ctx: ChatCtx,
  interaction: ButtonInteraction,
  action: string,
  roundId: string,
): Promise<void> {
  const casino = requireCasino(ctx);
  const instanceId = tableInstance(interaction);
  const caller = casinoCaller(ctx, interaction, instanceId);
  ctx.deps.economy.ensureMember(caller.guildId, caller.userId);
  const key = idemKeyOf(interaction, 'btn');
  const before = casino.chinchiroTable.snapshot(caller.guildId, instanceId);
  const bet = (before.data as TableData).bet;
  switch (action) {
    case 'sit':
      if (bet === undefined) throw new AppError('conflict');
      casino.chinchiroTable.sit(caller, { stake: bet, roundId, idempotencyKey: key });
      break;
    case 'stand':
      casino.chinchiroTable.stand(caller, { roundId, idempotencyKey: key });
      break;
    case 'begin':
      casino.chinchiroTable.begin(caller, { roundId, idempotencyKey: key });
      break;
    default:
      throw new AppError('invalid_payload');
  }
  const snapshot = casino.chinchiroTable.snapshot(caller.guildId, instanceId);
  await updateMessage(interaction, tableMessage(ctx.locale, snapshot));
}

// ------------------------------------------------------------------ entry points

export async function handleCasinoCommand(
  ctx: ChatCtx,
  path: string,
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  if (!ctx.deps.casino) return false;
  switch (path) {
    case 'casino chinchiro':
      await startChinchiro(ctx, interaction);
      return true;
    case 'casino chinchiro-table':
      await openChinchiroTable(ctx, interaction);
      return true;
    case 'casino blackjack':
      await startBlackjack(ctx, interaction);
      return true;
    default:
      return false;
  }
}

export async function handleCasinoComponent(
  ctx: ChatCtx,
  interaction: ButtonInteraction,
  id: ParsedCid,
): Promise<boolean> {
  const roundId = id.args[0] ?? '';
  switch (id.namespace) {
    case 'chi':
      if (id.action !== 'roll') return false;
      await rollChinchiro(ctx, interaction, roundId);
      return true;
    case 'bj':
      try {
        await blackjackAction(ctx, interaction, id.action, roundId);
      } catch (error) {
        if (
          id.action === 'double' &&
          error instanceof AppError &&
          error.code === 'insufficient_funds'
        ) {
          await offerCreditDouble(ctx, interaction, roundId);
          return true;
        }
        throw error;
      }
      return true;
    case 'cht':
      await tableButton(ctx, interaction, id.action, roundId);
      return true;
    default:
      return false;
  }
}
