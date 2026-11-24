import {
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type InteractionReplyOptions,
} from 'discord.js';
import { PRICE_SCALE, QUANTITY_SCALE, type ScreenId } from '@casino/shared';
import { formatPelica, t, type Locale } from '@casino/shared/i18n';
import type { ArenaFormat } from '@casino/domain/arena';
import {
  MARKET_SYMBOLS,
  rateToNano,
  type BondKindKey,
  type CompanyKindKey,
  type MarginSide,
  type SymbolKey,
} from '@casino/domain/finance';
import type { Store } from '../db/store.ts';
import type { EconomyService } from '../economy/economy-service.ts';
import type { FinanceServices } from '../finance/index.ts';
import type { ServiceResult } from '../finance/teiai-service.ts';
import type { CasinoGames } from '../games/index.ts';
import type { NonCasinoGames } from '../games/progression/index.ts';
import { buildLaunchActivityRow } from '../notify/discord-port.ts';
import type { PinKind, PostPinService } from '../notify/post-pins.ts';
import { botColor } from '../notify/theme.ts';
import { AppError } from '../runtime/errors.ts';

export interface WiredCommandsDeps {
  economy: EconomyService;
  store?: Store;
  casino?: CasinoGames;
  finance?: FinanceServices;
  games?: NonCasinoGames;
  pins?: PostPinService;
}

export type SendReplyFn = (
  interaction: ChatInputCommandInteraction,
  options: InteractionReplyOptions,
) => Promise<void>;

function formatNumber(locale: Locale, value: number): string {
  return value.toLocaleString(locale === 'ja' ? 'ja-JP' : 'en-US');
}

const SYMBOL_KEYS: ReadonlySet<string> = new Set(MARKET_SYMBOLS.map((s) => s.key));

function isSymbolKey(value: string): value is SymbolKey {
  return SYMBOL_KEYS.has(value);
}

function isMarginSide(value: string): value is MarginSide {
  return value === 'long' || value === 'short';
}

function isBondKind(value: string): value is BondKindKey {
  return value === 'normal' || value === 'junk';
}

function isCompanyKind(value: string): value is CompanyKindKey {
  return value === 'farm' || value === 'mine';
}

function isArenaFormat(value: string): value is ArenaFormat {
  return value === 'duel' || value === 'royale';
}

function unwrapServiceResult<T>(res: ServiceResult<T>): T {
  if (res.ok) return res.data;
  const reason = res.reason;
  const rule = { reason, ...(res.params ? { ruleParams: res.params } : {}) };
  if (reason === 'insufficient_funds') {
    throw new AppError('insufficient_funds');
  }
  if (
    reason.includes('debtor_blocked') ||
    reason.includes('katagi_only') ||
    reason.includes('forbidden') ||
    reason.includes('not_buyer') ||
    reason.includes('not_borrower')
  ) {
    throw new AppError('forbidden', rule);
  }
  if (reason.includes('not_found') || reason === 'no_debt' || reason === 'kyosai_no_open_auction') {
    throw new AppError('not_found', rule);
  }
  if (reason.includes('expired')) {
    throw new AppError('expired', rule);
  }
  if (
    reason.includes('invalid') ||
    reason.includes('min_') ||
    reason.includes('too_small') ||
    reason.includes('too_low') ||
    reason.includes('out_of_range') ||
    reason.includes('self_')
  ) {
    throw new AppError('invalid_payload', rule);
  }
  throw new AppError('conflict', rule);
}

function parseDurationMinutes(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const trimmed = raw.trim().toLowerCase();
  const match = /^(\d+)\s*(m|h|d)?$/.exec(trimmed);
  if (!match) throw new AppError('invalid_payload');
  const value = Number(match[1]);
  const unit = match[2] ?? 'm';
  const mult = unit === 'd' ? 1440 : unit === 'h' ? 60 : 1;
  const minutes = value * mult;
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 10_080) {
    throw new AppError('invalid_payload');
  }
  return minutes;
}

function formatSignedPelica(locale: Locale, amount: number): string {
  const prefix = amount > 0 ? '+' : '';
  return `${prefix}${formatPelica(locale, amount)}`;
}

function replyWithScreen(
  sendReply: SendReplyFn,
  interaction: ChatInputCommandInteraction,
  locale: Locale,
  embed: EmbedBuilder,
  screen: ScreenId,
  ephemeral: boolean,
): Promise<void> {
  return sendReply(interaction, {
    embeds: [embed],
    components: [buildLaunchActivityRow(locale, screen)],
    ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}),
  });
}

/**
 * Pin the public reply of a command that opened a poll or a kyosai motion. The pin is a courtesy:
 * a missing permission, a full pin list or a failed fetch never fails the command.
 */
async function pinReply(
  deps: WiredCommandsDeps,
  interaction: ChatInputCommandInteraction,
  kind: PinKind,
  refId: number,
): Promise<void> {
  if (!deps.pins || !interaction.guildId) return;
  try {
    const message = await interaction.fetchReply();
    await deps.pins.pinPost({
      kind,
      refId,
      guildId: interaction.guildId,
      channelId: message.channelId ?? interaction.channelId ?? '',
      messageId: message.id,
    });
  } catch {
    // Nothing to do: the poll or motion is already created and announced.
  }
}

function requireGuildId(interaction: ChatInputCommandInteraction): string {
  if (!interaction.guildId) {
    throw new AppError('forbidden', { reason: 'guild_only' });
  }
  return interaction.guildId;
}

function idempotencyKeyOf(interaction: ChatInputCommandInteraction): string {
  return `cmd:${interaction.id ?? `${interaction.user.id}:${Date.now()}`}`;
}

/**
 * Attempt to handle a wired Wave 2 slash command via thin calls to existing server services.
 * Returns `true` if handled, or `false` to fall back to the coming-soon reply.
 */
export async function dispatchWiredCommand(
  deps: WiredCommandsDeps,
  commandPath: string,
  interaction: ChatInputCommandInteraction,
  locale: Locale,
  sendReply: SendReplyFn,
): Promise<boolean> {
  const userId = interaction.user.id;
  const idemKey = idempotencyKeyOf(interaction);

  switch (commandPath) {
    // -----------------------------------------------------------------------
    // Economy / Progression / Teiai
    // -----------------------------------------------------------------------
    case 'pelica history': {
      const guildId = requireGuildId(interaction);
      deps.economy.ensureMember(guildId, userId);
      const rows = deps.economy.history(guildId, userId, 10);
      const lines =
        rows.length === 0
          ? t(locale, 'bot.label.noHistory')
          : rows
              .map(
                (r) =>
                  `<t:${Math.floor(r.createdAt / 1000)}:R> \`${r.reason}\` **${formatSignedPelica(locale, r.delta)}** → ${formatPelica(locale, r.balanceAfter)}`,
              )
              .join('\n');
      const embed = new EmbedBuilder()
        .setColor(botColor('info'))
        .setTitle(t(locale, 'screen.history'))
        .setDescription(lines);
      await replyWithScreen(sendReply, interaction, locale, embed, 'history', true);
      return true;
    }

    case 'pelica daily': {
      if (!deps.games) return false;
      const guildId = requireGuildId(interaction);
      const res = deps.games.progression.claimDaily(guildId, userId);
      const status = deps.games.progression.dailyStatus(guildId, userId);
      const embed = new EmbedBuilder().setTitle(t(locale, 'screen.daily'));
      if (!res.ok) {
        embed
          .setColor(botColor('warning'))
          .setDescription(
            `${t(locale, 'bot.label.alreadyClaimed')}\n${t(locale, 'bot.label.nextSlot')}: <t:${Math.floor(status.nextSlotAt / 1000)}:R>`,
          );
      } else {
        const balance = deps.economy.getBalance(guildId, userId);
        embed.setColor(botColor('success')).addFields(
          {
            name: t(locale, 'bot.label.received'),
            value: `**${formatPelica(locale, res.credit - res.repaid)}**`,
            inline: true,
          },
          { name: t(locale, 'bot.label.streak'), value: `${res.streak}`, inline: true },
          {
            name: t(locale, 'bot.label.balance'),
            value: formatPelica(locale, balance),
            inline: true,
          },
        );
      }
      await replyWithScreen(sendReply, interaction, locale, embed, 'daily', false);
      return true;
    }

    case 'pelica missions': {
      if (!deps.games) return false;
      const guildId = requireGuildId(interaction);
      const status = deps.games.progression.missionStatus(guildId, userId);
      const lines =
        status.missions.length === 0
          ? t(locale, 'bot.label.noMissions')
          : status.missions
              .map(
                (m) =>
                  `${m.done ? '✅' : '⬜'} \`${m.mission.id}\` (${m.progress}/${m.mission.target})`,
              )
              .join('\n');
      const embed = new EmbedBuilder()
        .setColor(botColor('info'))
        .setTitle(`${t(locale, 'screen.missions')} (${status.day})`)
        .setDescription(lines);
      await replyWithScreen(sendReply, interaction, locale, embed, 'missions', true);
      return true;
    }

    case 'pelica ranking': {
      if (!deps.games) return false;
      const guildId = requireGuildId(interaction);
      const top = deps.games.progression.weeklyStandings(guildId);
      const targetUser = interaction.options.getUser('member') ?? interaction.user;
      const selfRank = deps.games.progression.weeklyRankOf(guildId, targetUser.id);
      const lines =
        top.length === 0
          ? t(locale, 'bot.label.noRanking')
          : top
              .map(
                (row, i) =>
                  `${i + 1}. <@${row.userId}> — **${formatSignedPelica(locale, row.net)}** (${row.plays})`,
              )
              .join('\n');
      const embed = new EmbedBuilder()
        .setColor(botColor('primary'))
        .setTitle(t(locale, 'screen.ranking'))
        .setDescription(lines);
      if (selfRank) {
        embed.setFooter({
          text: `#${selfRank.rank}/${selfRank.total} · ${formatSignedPelica(locale, selfRank.net)}`,
        });
      }
      await replyWithScreen(sendReply, interaction, locale, embed, 'ranking', false);
      return true;
    }

    case 'pelica transfer': {
      if (!deps.games) return false;
      const guildId = requireGuildId(interaction);
      const recipient = interaction.options.getUser('member', true);
      const amount = interaction.options.getInteger('amount', true);
      const res = deps.games.progression.transfer({
        guildId,
        senderId: userId,
        receiverId: recipient.id,
        amount,
        idempotencyKey: idemKey,
      });
      if (!res.ok) {
        const code = res.error.code;
        if (code === 'transfer_insufficient_balance') throw new AppError('insufficient_funds');
        if (code === 'transfer_self' || code === 'amount_must_be_positive') {
          throw new AppError('invalid_payload', { reason: code });
        }
        throw new AppError('conflict', { reason: code });
      }
      const embed = new EmbedBuilder()
        .setColor(botColor('success'))
        .setTitle(t(locale, 'screen.transfer'))
        .setDescription(`<@${userId}> → <@${recipient.id}>`)
        .addFields(
          {
            name: t(locale, 'bot.label.received'),
            value: formatPelica(locale, res.received),
            inline: true,
          },
          { name: t(locale, 'bot.label.fee'), value: formatPelica(locale, res.fee), inline: true },
          {
            name: t(locale, 'bot.label.balance'),
            value: formatPelica(locale, res.senderBalance),
            inline: true,
          },
        );
      await replyWithScreen(sendReply, interaction, locale, embed, 'transfer', false);
      return true;
    }

    case 'pelica repay': {
      if (!deps.finance) return false;
      const guildId = requireGuildId(interaction);
      deps.economy.ensureMember(guildId, userId);
      const amount = interaction.options.getInteger('amount') ?? undefined;
      const data = unwrapServiceResult(
        deps.finance.teiai.repayDebt(guildId, userId, amount, undefined, idemKey),
      );
      const embed = new EmbedBuilder()
        .setColor(botColor('success'))
        .setTitle(t(locale, 'screen.bank'))
        .addFields(
          {
            name: t(locale, 'bot.label.repaid'),
            value: formatPelica(locale, data.paid),
            inline: true,
          },
          {
            name: t(locale, 'bot.label.debt'),
            value: formatPelica(locale, data.remainingDebt),
            inline: true,
          },
          {
            name: t(locale, 'bot.label.balance'),
            value: formatPelica(locale, deps.economy.getBalance(guildId, userId)),
            inline: true,
          },
        );
      await replyWithScreen(sendReply, interaction, locale, embed, 'bank', true);
      return true;
    }

    case 'pelica bank': {
      if (!deps.finance) return false;
      const guildId = requireGuildId(interaction);
      deps.economy.ensureMember(guildId, userId);
      const bank = deps.finance.teiai.getBankStatus(guildId);
      const debt = deps.finance.teiai.getDebt(guildId, userId);
      const deposit = deps.finance.teiai.getDeposit(guildId, userId);
      const playerStatus = deps.finance.teiai.getStatus(guildId, userId);
      const embed = new EmbedBuilder()
        .setColor(botColor('primary'))
        .setTitle(t(locale, 'screen.bank'))
        .addFields(
          { name: t(locale, 'bot.label.status'), value: `\`${playerStatus}\``, inline: true },
          { name: t(locale, 'bot.label.debt'), value: formatPelica(locale, debt), inline: true },
          {
            name: t(locale, 'bot.label.deposit'),
            value: formatPelica(locale, deposit),
            inline: true,
          },
          {
            name: t(locale, 'bot.label.bankCash'),
            value: formatPelica(locale, bank.cash),
            inline: true,
          },
        );
      await replyWithScreen(sendReply, interaction, locale, embed, 'bank', true);
      return true;
    }

    // -----------------------------------------------------------------------
    // Casino (single-shot thin calls)
    // -----------------------------------------------------------------------
    case 'casino slots': {
      if (!deps.casino) return false;
      const guildId = requireGuildId(interaction);
      deps.economy.ensureMember(guildId, userId);
      const stake = interaction.options.getInteger('bet', true);
      const { response: res } = deps.casino.slots.play(
        { guildId, userId, source: 'chat' },
        { stake, idempotencyKey: idemKey },
      );
      const embed = new EmbedBuilder()
        .setColor(botColor(res.settlement.net >= 0 ? 'success' : 'neutral'))
        .setTitle(t(locale, 'screen.slots'))
        .setDescription(`[ ${res.reels.join(' | ')} ] · **${res.multiplier}x**`)
        .addFields(
          {
            name: t(locale, 'bot.label.payout'),
            value: formatPelica(locale, res.settlement.payout),
            inline: true,
          },
          {
            name: t(locale, 'bot.label.net'),
            value: formatSignedPelica(locale, res.settlement.net),
            inline: true,
          },
          {
            name: t(locale, 'bot.label.balance'),
            value: formatPelica(locale, res.settlement.balance),
            inline: true,
          },
        );
      await replyWithScreen(sendReply, interaction, locale, embed, 'slots', false);
      return true;
    }

    case 'casino pachinko': {
      if (!deps.casino) return false;
      const guildId = requireGuildId(interaction);
      deps.economy.ensureMember(guildId, userId);
      const stake = interaction.options.getInteger('bet', true);
      const sets = interaction.options.getInteger('sets') ?? 1;
      const { response: res } = deps.casino.pachinko.play(
        { guildId, userId, source: 'chat' },
        { stake, sets, idempotencyKey: idemKey },
      );
      const embed = new EmbedBuilder()
        .setColor(botColor(res.settlement.net >= 0 ? 'success' : 'neutral'))
        .setTitle(t(locale, 'screen.pachinko'))
        .setDescription(`${res.sets.length} sets · top ${res.topRound}R`)
        .addFields(
          {
            name: t(locale, 'bot.label.payout'),
            value: formatPelica(locale, res.settlement.payout),
            inline: true,
          },
          {
            name: t(locale, 'bot.label.net'),
            value: formatSignedPelica(locale, res.settlement.net),
            inline: true,
          },
          {
            name: t(locale, 'bot.label.balance'),
            value: formatPelica(locale, res.settlement.balance),
            inline: true,
          },
        );
      await replyWithScreen(sendReply, interaction, locale, embed, 'pachinko', false);
      return true;
    }

    case 'casino roulette': {
      if (!deps.casino) return false;
      const guildId = requireGuildId(interaction);
      deps.economy.ensureMember(guildId, userId);
      const stake = interaction.options.getInteger('bet', true);
      const kind = interaction.options.getString('kind', true);
      const num = interaction.options.getInteger('number');
      const { response: res } = deps.casino.roulette.playSolo(
        { guildId, userId, source: 'chat' },
        {
          stake,
          kind,
          ...(num !== null ? { number: num } : {}),
          idempotencyKey: idemKey,
        },
      );
      const embed = new EmbedBuilder()
        .setColor(botColor(res.win ? 'success' : 'neutral'))
        .setTitle(t(locale, 'screen.roulette'))
        .setDescription(`**${res.result}** (${res.color})`)
        .addFields(
          {
            name: t(locale, 'bot.label.payout'),
            value: formatPelica(locale, res.settlement.payout),
            inline: true,
          },
          {
            name: t(locale, 'bot.label.net'),
            value: formatSignedPelica(locale, res.settlement.net),
            inline: true,
          },
          {
            name: t(locale, 'bot.label.balance'),
            value: formatPelica(locale, res.settlement.balance),
            inline: true,
          },
        );
      await replyWithScreen(sendReply, interaction, locale, embed, 'roulette', false);
      return true;
    }

    // -----------------------------------------------------------------------
    // Non-casino games
    // -----------------------------------------------------------------------
    case 'horse stable': {
      if (!deps.games) return false;
      const guildId = requireGuildId(interaction);
      const horses = deps.games.race.stable(guildId, userId);
      const lines =
        horses.length === 0
          ? t(locale, 'bot.label.noHorses')
          : horses
              .map((h) => {
                const total = h.stats.speed + h.stats.stamina + h.stats.power + h.stats.guts;
                return `#${h.id} **${h.name}** · ${total} (${h.wins}W/${h.races}R)`;
              })
              .join('\n');
      const embed = new EmbedBuilder()
        .setColor(botColor('primary'))
        .setTitle(t(locale, 'screen.horse'))
        .setDescription(lines);
      await replyWithScreen(sendReply, interaction, locale, embed, 'horse', true);
      return true;
    }

    case 'horse card': {
      if (!deps.games || !deps.store) return false;
      const guildId = requireGuildId(interaction);
      deps.games.race.ensureDay(guildId);
      const nextRace = deps.store
        .stmt(
          "SELECT id FROM horse_races WHERE guild_id = ? AND status != 'done' ORDER BY start_at ASC, id ASC LIMIT 1",
        )
        .get(guildId) as { id: number } | undefined;
      const embed = new EmbedBuilder()
        .setColor(botColor('info'))
        .setTitle(t(locale, 'screen.horse'));
      if (!nextRace) {
        embed.setDescription(t(locale, 'bot.label.noRace'));
      } else {
        const card = deps.games.race.card(nextRace.id);
        const lines =
          card.entrants.length === 0
            ? `#${card.race.id} (${card.race.status}) · <t:${Math.floor(card.race.start_at / 1000)}:R>`
            : card.entrants.map((e) => `${e.lane}. **${e.name}** (${e.style})`).join('\n');
        embed.setDescription(`Race #${card.race.id} (${card.race.status})\n${lines}`);
      }
      await replyWithScreen(sendReply, interaction, locale, embed, 'horse', true);
      return true;
    }

    case 'arena tournament': {
      if (!deps.games || !deps.store) return false;
      const guildId = requireGuildId(interaction);
      const rawFmt = interaction.options.getString('format', true);
      if (!isArenaFormat(rawFmt)) throw new AppError('invalid_payload');
      deps.games.arena.ensureToday(guildId);
      const row = deps.store
        .stmt(
          'SELECT id FROM arena_tournaments WHERE guild_id = ? AND format = ? ORDER BY id DESC LIMIT 1',
        )
        .get(guildId, rawFmt) as { id: number } | undefined;
      const embed = new EmbedBuilder()
        .setColor(botColor('primary'))
        .setTitle(t(locale, 'screen.arena'));
      if (!row) {
        embed.setDescription(t(locale, 'bot.label.noTournament'));
      } else {
        const board = deps.games.arena.board(guildId, row.id);
        const lines = board.fighters
          .map((f) => `• **${f.name}** (${(f.oddsHundredths / 100).toFixed(2)}x)`)
          .join('\n');
        const nameOf = (id: number | null): string | undefined =>
          board.fighters.find((f) => f.id === id)?.name;
        const champion = nameOf(board.tournament.champion_id);
        const runnerUp = nameOf(board.tournament.runner_up_id);
        const result = [
          champion ? t(locale, 'bot.arena.champion', { name: champion }) : null,
          runnerUp ? t(locale, 'bot.arena.runnerUp', { name: runnerUp }) : null,
        ].filter((line) => line !== null);
        embed.setDescription(
          [
            `#${board.tournament.id} (${board.tournament.format} · ${board.tournament.status})`,
            lines,
            ...(result.length > 0 ? ['', ...result] : []),
          ].join('\n'),
        );
      }
      await replyWithScreen(sendReply, interaction, locale, embed, 'arena', false);
      return true;
    }

    case 'labor work': {
      if (!deps.games) return false;
      const guildId = requireGuildId(interaction);
      deps.economy.ensureMember(guildId, userId);
      const res = deps.games.work.click(guildId, userId);
      const view = deps.games.work.view(guildId, userId);
      const embed = new EmbedBuilder()
        .setColor(botColor(res.tooFast ? 'warning' : 'success'))
        .setTitle(t(locale, 'screen.work'))
        .setDescription(
          res.tooFast ? t(locale, 'bot.label.workTooFast') : `+${formatPelica(locale, res.pay)}`,
        )
        .addFields(
          {
            name: t(locale, 'bot.label.workPot'),
            value: formatPelica(locale, view.pot),
            inline: true,
          },
          { name: t(locale, 'bot.label.workFatigue'), value: `${view.fatigue}%`, inline: true },
        );
      await replyWithScreen(sendReply, interaction, locale, embed, 'work', false);
      return true;
    }

    case 'poll create': {
      if (!deps.games) return false;
      const guildId = requireGuildId(interaction);
      const title = interaction.options.getString('title', true);
      const minutes = parseDurationMinutes(interaction.options.getString('duration'));
      const poll = deps.games.poll.create({
        guildId,
        creatorId: userId,
        title,
        ...(minutes === undefined ? {} : { minutes }),
      });
      const embed = new EmbedBuilder()
        .setColor(botColor('primary'))
        .setTitle(`${t(locale, 'bot.label.pollCreated')} #${poll.id}`)
        .setDescription(poll.title)
        .addFields({
          name: t(locale, 'bot.label.pollCloses'),
          value: `<t:${Math.floor(poll.closesAt / 1000)}:R>`,
          inline: true,
        });
      await replyWithScreen(sendReply, interaction, locale, embed, 'poll', false);
      await pinReply(deps, interaction, 'poll', poll.id);
      return true;
    }

    case 'quiz withdraw': {
      if (!deps.games) return false;
      const guildId = requireGuildId(interaction);
      const quizId = interaction.options.getInteger('quiz_id', true);
      deps.games.quiz.withdraw(guildId, userId, quizId);
      const embed = new EmbedBuilder()
        .setColor(botColor('success'))
        .setTitle(t(locale, 'screen.quiz'))
        .setDescription(`${t(locale, 'bot.label.quizWithdrawn')} (#${quizId})`);
      await replyWithScreen(sendReply, interaction, locale, embed, 'quiz', true);
      return true;
    }

    // -----------------------------------------------------------------------
    // Finance: Market / Loans / Kyosai / Companies
    // -----------------------------------------------------------------------
    case 'market board': {
      if (!deps.finance) return false;
      requireGuildId(interaction);
      const prices = deps.finance.stocks.getPricesMicros();
      const refs = deps.finance.stocks.getReferencePrices24h();
      const lines = MARKET_SYMBOLS.map((s) => {
        const cur = prices[s.key] / PRICE_SCALE;
        const ref = refs[s.key];
        const chg = ref && ref > 0 ? ((prices[s.key] - ref) / ref) * 100 : 0;
        const sign = chg >= 0 ? '+' : '';
        return `**${s.key.toUpperCase()}**: ${formatNumber(locale, Math.round(cur))} (${sign}${chg.toFixed(1)}%)`;
      }).join('\n');
      const embed = new EmbedBuilder()
        .setColor(botColor('info'))
        .setTitle(t(locale, 'screen.market'))
        .setDescription(lines);
      await replyWithScreen(sendReply, interaction, locale, embed, 'market', true);
      return true;
    }

    case 'market holdings': {
      if (!deps.finance) return false;
      const guildId = requireGuildId(interaction);
      const spots = deps.finance.stocks.getSpotHoldings(guildId, userId);
      const margin = deps.finance.stocks.getPortfolioMarginStatus(guildId, userId);
      const lines =
        spots.length === 0
          ? t(locale, 'bot.label.noHoldings')
          : spots
              .map(
                (s) =>
                  `**${s.symbol.toUpperCase()}**: ${(s.units_milli / QUANTITY_SCALE).toFixed(3)} (${formatPelica(locale, s.cost)})`,
              )
              .join('\n');
      const embed = new EmbedBuilder()
        .setColor(botColor('info'))
        .setTitle(t(locale, 'screen.market'))
        .setDescription(lines);
      if (margin.required > 0) {
        embed.setFooter({
          text: `Margin equity ${formatNumber(locale, Math.round(margin.equity))} / req ${formatNumber(locale, Math.round(margin.required))}`,
        });
      }
      await replyWithScreen(sendReply, interaction, locale, embed, 'market', true);
      return true;
    }

    case 'market order spot': {
      if (!deps.finance) return false;
      const guildId = requireGuildId(interaction);
      deps.economy.ensureMember(guildId, userId);
      const symbol = interaction.options.getString('symbol', true);
      const amount = interaction.options.getInteger('amount', true);
      if (!isSymbolKey(symbol)) throw new AppError('invalid_payload');
      const data = unwrapServiceResult(
        deps.finance.stocks.buySpot(guildId, userId, symbol, amount, undefined, {
          idempotencyKey: idemKey,
        }),
      );
      const embed = new EmbedBuilder()
        .setColor(botColor('success'))
        .setTitle(`${t(locale, 'screen.market')} · ${symbol.toUpperCase()}`)
        .addFields(
          {
            name: t(locale, 'bot.label.units'),
            value: (data.unitsMilli / QUANTITY_SCALE).toFixed(3),
            inline: true,
          },
          { name: t(locale, 'bot.label.fee'), value: formatPelica(locale, data.fee), inline: true },
          {
            name: t(locale, 'bot.label.balance'),
            value: formatPelica(locale, data.balance),
            inline: true,
          },
        );
      await replyWithScreen(sendReply, interaction, locale, embed, 'market', false);
      return true;
    }

    case 'market order margin': {
      if (!deps.finance) return false;
      const guildId = requireGuildId(interaction);
      deps.economy.ensureMember(guildId, userId);
      const symbol = interaction.options.getString('symbol', true);
      const side = interaction.options.getString('side', true);
      const amount = interaction.options.getInteger('amount', true);
      const leverage = interaction.options.getInteger('leverage') ?? 1;
      if (!isSymbolKey(symbol) || !isMarginSide(side)) throw new AppError('invalid_payload');
      const data = unwrapServiceResult(
        deps.finance.stocks.openMargin(
          guildId,
          userId,
          side,
          symbol,
          amount,
          leverage,
          undefined,
          idemKey,
        ),
      );
      const embed = new EmbedBuilder()
        .setColor(botColor('success'))
        .setTitle(
          `${t(locale, 'screen.market')} · ${symbol.toUpperCase()} ${side.toUpperCase()} ${leverage}x`,
        )
        .addFields(
          {
            name: t(locale, 'bot.label.units'),
            value: (data.unitsMilli / QUANTITY_SCALE).toFixed(3),
            inline: true,
          },
          {
            name: t(locale, 'bot.label.price'),
            value: formatPelica(locale, data.margin),
            inline: true,
          },
        );
      await replyWithScreen(sendReply, interaction, locale, embed, 'market', false);
      return true;
    }

    case 'market order call':
    case 'market order put':
    case 'market order pair': {
      if (!deps.finance) return false;
      const guildId = requireGuildId(interaction);
      deps.economy.ensureMember(guildId, userId);
      const symbol = interaction.options.getString('symbol', true);
      const amount = interaction.options.getInteger('amount', true);
      if (!isSymbolKey(symbol)) throw new AppError('invalid_payload');
      const kind =
        commandPath === 'market order call'
          ? 'call'
          : commandPath === 'market order put'
            ? 'put'
            : 'pair';
      const counterpart =
        kind === 'pair' ? interaction.options.getString('counterpart', true) : undefined;
      if (kind === 'pair' && (!counterpart || !isSymbolKey(counterpart))) {
        throw new AppError('invalid_payload');
      }
      const target = kind === 'pair' ? null : interaction.options.getInteger('target');
      const opt = unwrapServiceResult(
        deps.finance.stocks.buyOption({
          guildId,
          userId,
          kind,
          symbol,
          ...(counterpart && isSymbolKey(counterpart) ? { symbolB: counterpart } : {}),
          premium: amount,
          hours: 24,
          ...(target !== null ? { customTargetPct: target } : {}),
          idempotencyKey: idemKey,
        }),
      );
      const embed = new EmbedBuilder()
        .setColor(botColor('success'))
        .setTitle(`${t(locale, 'screen.market')} · ${kind.toUpperCase()} #${opt.id}`)
        .addFields(
          {
            name: t(locale, 'bot.label.price'),
            value: formatPelica(locale, opt.premium),
            inline: true,
          },
          {
            name: t(locale, 'bot.label.balance'),
            value: formatPelica(locale, deps.economy.getBalance(guildId, userId)),
            inline: true,
          },
        );
      await replyWithScreen(sendReply, interaction, locale, embed, 'market', false);
      return true;
    }

    case 'market order bond': {
      if (!deps.finance) return false;
      const guildId = requireGuildId(interaction);
      deps.economy.ensureMember(guildId, userId);
      const kind = interaction.options.getString('kind', true);
      const amount = interaction.options.getInteger('amount', true);
      if (!isBondKind(kind)) throw new AppError('invalid_payload');
      const bond = unwrapServiceResult(
        deps.finance.stocks.buyBond(guildId, userId, kind, amount, undefined, idemKey),
      );
      const embed = new EmbedBuilder()
        .setColor(botColor('success'))
        .setTitle(`${t(locale, 'screen.market')} · Bond #${bond.id}`)
        .addFields(
          {
            name: t(locale, 'bot.label.principal'),
            value: formatPelica(locale, bond.principal),
            inline: true,
          },
          {
            name: t(locale, 'bot.label.rate'),
            value: `${(bond.rate_bps / 100).toFixed(2)}%`,
            inline: true,
          },
        );
      await replyWithScreen(sendReply, interaction, locale, embed, 'market', false);
      return true;
    }

    case 'loan offer': {
      if (!deps.finance) return false;
      const guildId = requireGuildId(interaction);
      deps.economy.ensureMember(guildId, userId);
      const borrower = interaction.options.getUser('member', true);
      const principal = interaction.options.getInteger('principal', true);
      const rate = interaction.options.getNumber('rate', true);
      const termDays = interaction.options.getInteger('days', true);
      const loanId = unwrapServiceResult(
        deps.finance.loans.offerLoan({
          guildId,
          lenderId: userId,
          borrowerId: borrower.id,
          principal,
          rateBps: Math.round(rate * 100),
          termDays,
          ...(interaction.channelId ? { channelId: interaction.channelId } : {}),
        }),
      );
      const embed = new EmbedBuilder()
        .setColor(botColor('primary'))
        .setTitle(t(locale, 'screen.loans'))
        .setDescription(`<@${userId}> → <@${borrower.id}>`)
        .addFields(
          { name: t(locale, 'bot.label.loanId'), value: `#${loanId}`, inline: true },
          {
            name: t(locale, 'bot.label.principal'),
            value: formatPelica(locale, principal),
            inline: true,
          },
          { name: t(locale, 'bot.label.rate'), value: `${rate}%`, inline: true },
          { name: t(locale, 'bot.label.term'), value: `${termDays}d`, inline: true },
        );
      await replyWithScreen(sendReply, interaction, locale, embed, 'loans', false);
      return true;
    }

    case 'loan request': {
      if (!deps.finance) return false;
      const guildId = requireGuildId(interaction);
      deps.economy.ensureMember(guildId, userId);
      const principal = interaction.options.getInteger('principal', true);
      const rate = interaction.options.getNumber('rate', true);
      const termDays = interaction.options.getInteger('days', true);
      const loanId = unwrapServiceResult(
        deps.finance.loans.requestLoan({
          guildId,
          borrowerId: userId,
          principal,
          rateBps: Math.round(rate * 100),
          termDays,
          ...(interaction.channelId ? { channelId: interaction.channelId } : {}),
        }),
      );
      const embed = new EmbedBuilder()
        .setColor(botColor('primary'))
        .setTitle(t(locale, 'screen.loans'))
        .addFields(
          { name: t(locale, 'bot.label.loanId'), value: `#${loanId}`, inline: true },
          {
            name: t(locale, 'bot.label.principal'),
            value: formatPelica(locale, principal),
            inline: true,
          },
          { name: t(locale, 'bot.label.rate'), value: `${rate}%`, inline: true },
          { name: t(locale, 'bot.label.term'), value: `${termDays}d`, inline: true },
        );
      await replyWithScreen(sendReply, interaction, locale, embed, 'loans', false);
      return true;
    }

    case 'loan repay': {
      if (!deps.finance) return false;
      const guildId = requireGuildId(interaction);
      deps.economy.ensureMember(guildId, userId);
      const loanId = interaction.options.getInteger('loan_id', true);
      const amount = interaction.options.getInteger('amount') ?? undefined;
      const paid = unwrapServiceResult(
        deps.finance.loans.repayLoan(guildId, loanId, userId, amount, undefined, idemKey),
      );
      const embed = new EmbedBuilder()
        .setColor(botColor('success'))
        .setTitle(t(locale, 'screen.loans'))
        .addFields(
          { name: t(locale, 'bot.label.loanId'), value: `#${loanId}`, inline: true },
          { name: t(locale, 'bot.label.repaid'), value: formatPelica(locale, paid), inline: true },
          {
            name: t(locale, 'bot.label.balance'),
            value: formatPelica(locale, deps.economy.getBalance(guildId, userId)),
            inline: true,
          },
        );
      await replyWithScreen(sendReply, interaction, locale, embed, 'loans', false);
      return true;
    }

    case 'kyosai status': {
      if (!deps.finance) return false;
      const guildId = requireGuildId(interaction);
      const st = deps.finance.kyosai.getStatus(guildId, userId);
      const embed = new EmbedBuilder()
        .setColor(botColor('primary'))
        .setTitle(t(locale, 'screen.kyosai'))
        .addFields(
          { name: t(locale, 'bot.label.units'), value: `${st.units} / ${st.total}`, inline: true },
          {
            name: t(locale, 'bot.label.payout'),
            value: formatPelica(locale, st.pool),
            inline: true,
          },
          {
            name: t(locale, 'bot.label.rate'),
            value: `${(st.premium * 100).toFixed(3)}%`,
            inline: true,
          },
        );
      await replyWithScreen(sendReply, interaction, locale, embed, 'kyosai', true);
      return true;
    }

    case 'kyosai bid': {
      if (!deps.finance) return false;
      const guildId = requireGuildId(interaction);
      deps.economy.ensureMember(guildId, userId);
      const amount = interaction.options.getInteger('amount', true);
      const auc = unwrapServiceResult(
        deps.finance.kyosai.bidAuction(guildId, userId, amount, undefined, idemKey),
      );
      const embed = new EmbedBuilder()
        .setColor(botColor('success'))
        .setTitle(t(locale, 'screen.kyosai'))
        .addFields(
          { name: t(locale, 'bot.label.units'), value: `${auc.units}`, inline: true },
          {
            name: t(locale, 'bot.label.price'),
            value: formatPelica(locale, auc.top_bid),
            inline: true,
          },
        );
      await replyWithScreen(sendReply, interaction, locale, embed, 'kyosai', true);
      return true;
    }

    case 'kyosai offer': {
      if (!deps.finance) return false;
      const guildId = requireGuildId(interaction);
      const buyer = interaction.options.getUser('member', true);
      const units = interaction.options.getInteger('units', true);
      const price = interaction.options.getInteger('price', true);
      const offerId = unwrapServiceResult(
        deps.finance.kyosai.createOffer(guildId, userId, buyer.id, units, price),
      );
      const embed = new EmbedBuilder()
        .setColor(botColor('primary'))
        .setTitle(t(locale, 'screen.kyosai'))
        .setDescription(`<@${userId}> → <@${buyer.id}>`)
        .addFields(
          { name: t(locale, 'bot.label.offerId'), value: `#${offerId}`, inline: true },
          { name: t(locale, 'bot.label.units'), value: `${units}`, inline: true },
          { name: t(locale, 'bot.label.price'), value: formatPelica(locale, price), inline: true },
        );
      await replyWithScreen(sendReply, interaction, locale, embed, 'kyosai', false);
      return true;
    }

    case 'kyosai accept': {
      if (!deps.finance) return false;
      const guildId = requireGuildId(interaction);
      deps.economy.ensureMember(guildId, userId);
      const offerId = interaction.options.getInteger('offer_id', true);
      const offer = unwrapServiceResult(
        deps.finance.kyosai.acceptOffer(guildId, userId, offerId, undefined, idemKey),
      );
      const embed = new EmbedBuilder()
        .setColor(botColor('success'))
        .setTitle(t(locale, 'screen.kyosai'))
        .addFields(
          { name: t(locale, 'bot.label.offerId'), value: `#${offer.id}`, inline: true },
          { name: t(locale, 'bot.label.units'), value: `${offer.units}`, inline: true },
          {
            name: t(locale, 'bot.label.price'),
            value: formatPelica(locale, offer.price),
            inline: true,
          },
        );
      await replyWithScreen(sendReply, interaction, locale, embed, 'kyosai', false);
      return true;
    }

    case 'kyosai cancel': {
      if (!deps.finance) return false;
      const guildId = requireGuildId(interaction);
      const offerId = interaction.options.getInteger('offer_id', true);
      unwrapServiceResult(deps.finance.kyosai.cancelOffer(guildId, userId, offerId));
      const embed = new EmbedBuilder()
        .setColor(botColor('neutral'))
        .setTitle(t(locale, 'screen.kyosai'))
        .setDescription(`#${offerId}`);
      await replyWithScreen(sendReply, interaction, locale, embed, 'kyosai', true);
      return true;
    }

    case 'kyosai propose': {
      if (!deps.finance) return false;
      const guildId = requireGuildId(interaction);
      const premiumPct = interaction.options.getNumber('premium', true);
      const motion = unwrapServiceResult(
        deps.finance.kyosai.proposeMotion(
          guildId,
          userId,
          rateToNano(premiumPct / 100),
          undefined,
          interaction.channelId ?? undefined,
        ),
      );
      const embed = new EmbedBuilder()
        .setColor(botColor('primary'))
        .setTitle(t(locale, 'screen.kyosai'))
        .addFields(
          { name: t(locale, 'bot.label.motionId'), value: `#${motion.id}`, inline: true },
          { name: t(locale, 'bot.label.rate'), value: `${premiumPct}%`, inline: true },
        );
      await replyWithScreen(sendReply, interaction, locale, embed, 'kyosai', false);
      await pinReply(deps, interaction, 'motion', motion.id);
      return true;
    }

    case 'kyosai vote': {
      if (!deps.finance) return false;
      const guildId = requireGuildId(interaction);
      const choice = interaction.options.getString('choice', true);
      if (choice !== 'yes' && choice !== 'no') throw new AppError('invalid_payload');
      let motionId = interaction.options.getInteger('motion_id');
      if (motionId === null) {
        const st = deps.finance.kyosai.getStatus(guildId, userId);
        motionId = st.motions[0]?.id ?? null;
      }
      if (motionId === null) throw new AppError('not_found');
      unwrapServiceResult(
        deps.finance.kyosai.voteMotion(guildId, userId, motionId, choice === 'yes'),
      );
      const embed = new EmbedBuilder()
        .setColor(botColor('success'))
        .setTitle(t(locale, 'screen.kyosai'))
        .setDescription(`${t(locale, 'bot.label.voteRecorded')} (#${motionId}: ${choice})`);
      await replyWithScreen(sendReply, interaction, locale, embed, 'kyosai', true);
      return true;
    }

    case 'company found': {
      if (!deps.finance) return false;
      const guildId = requireGuildId(interaction);
      deps.economy.ensureMember(guildId, userId);
      const name = interaction.options.getString('name', true);
      const kind = interaction.options.getString('kind', true);
      if (!isCompanyKind(kind)) throw new AppError('invalid_payload');
      const state = unwrapServiceResult(
        deps.finance.companies.foundCompany(guildId, userId, name, kind, undefined, idemKey),
      );
      const embed = new EmbedBuilder()
        .setColor(botColor('success'))
        .setTitle(`${t(locale, 'screen.companies')} · ${state.name}`)
        .addFields(
          { name: t(locale, 'bot.label.companyLevel'), value: `Lv.${state.level}`, inline: true },
          {
            name: t(locale, 'bot.label.companyFunds'),
            value: formatPelica(locale, state.funds),
            inline: true,
          },
        );
      await replyWithScreen(sendReply, interaction, locale, embed, 'companies', false);
      return true;
    }

    case 'company status': {
      if (!deps.finance) return false;
      const guildId = requireGuildId(interaction);
      const state = deps.finance.companies.getCompanyState(guildId, userId);
      const embed = new EmbedBuilder()
        .setColor(botColor('info'))
        .setTitle(t(locale, 'screen.companies'));
      if (!state) {
        embed.setDescription(t(locale, 'bot.label.noCompany'));
      } else {
        embed.setTitle(`${t(locale, 'screen.companies')} · ${state.name}`).addFields(
          { name: t(locale, 'bot.label.companyLevel'), value: `Lv.${state.level}`, inline: true },
          {
            name: t(locale, 'bot.label.companyFunds'),
            value: formatPelica(locale, state.funds),
            inline: true,
          },
          {
            name: t(locale, 'bot.label.companyDividend'),
            value: `${Math.round(state.dividendRate * 100)}%`,
            inline: true,
          },
        );
      }
      await replyWithScreen(sendReply, interaction, locale, embed, 'companies', true);
      return true;
    }

    case 'company invest': {
      if (!deps.finance) return false;
      const guildId = requireGuildId(interaction);
      deps.economy.ensureMember(guildId, userId);
      const owner = interaction.options.getUser('owner', true);
      const amount = interaction.options.getInteger('amount', true);
      const data = unwrapServiceResult(
        deps.finance.companies.stakeInvest(guildId, userId, owner.id, amount, undefined, idemKey),
      );
      const embed = new EmbedBuilder()
        .setColor(botColor('success'))
        .setTitle(`${t(locale, 'screen.companies')} · ${data.name}`)
        .addFields(
          {
            name: t(locale, 'bot.label.price'),
            value: formatPelica(locale, data.amount),
            inline: true,
          },
          {
            name: t(locale, 'bot.label.remaining'),
            value: formatPelica(locale, data.total),
            inline: true,
          },
        );
      await replyWithScreen(sendReply, interaction, locale, embed, 'companies', false);
      return true;
    }

    case 'company dividend': {
      if (!deps.finance) return false;
      const guildId = requireGuildId(interaction);
      const percent = interaction.options.getInteger('percent', true);
      const rate = unwrapServiceResult(
        deps.finance.companies.setDividendRate(guildId, userId, percent * 100),
      );
      const embed = new EmbedBuilder()
        .setColor(botColor('success'))
        .setTitle(t(locale, 'screen.companies'))
        .addFields({
          name: t(locale, 'bot.label.companyDividend'),
          value: `${Math.round(rate * 100)}%`,
          inline: true,
        });
      await replyWithScreen(sendReply, interaction, locale, embed, 'companies', true);
      return true;
    }

    default:
      return false;
  }
}
