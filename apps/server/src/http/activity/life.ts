import type { FastifyInstance } from 'fastify';
import {
  LIFE_ROUTES,
  LotBuyRequest,
  LotteryJoinRequest,
  NetWorthQuery,
  PollCreateRequest,
  PollVoteRequest,
  QuizAnswerRequest,
  QuizPostRequest,
  QuizWithdrawRequest,
  ShopBuyRequest,
  ShopColorRoleRequest,
  TransferMembersQuery,
  TransferPreviewRequest,
  TransferSendRequest,
  WorkClickRequest,
  WorkCollectRequest,
  WorkDismissRequest,
  WorkDrinkRequest,
  WorkHireRequest,
  WorkMergeRequest,
  WorkRankingQuery,
  WorkRenewRequest,
  WorkUpgradeRequest,
  type Clock,
  type LotteryView,
  type MissionsView,
  type NetWorthView,
  type PollItem,
  type PollsView,
  type QuizItem,
  type QuizView,
  type RankingView,
  type ShopView,
  type TransferPreview,
  type TransferView,
  type WorkRanking,
  type WorkView,
} from '@casino/shared';
import {
  dayStartMs,
  isoDate,
  LABOR_SKIM_RATE_BPS,
  LEGACY_GAME_NAMES,
  localDayNumber,
  MISSION_COMPLETE_BONUS,
  MISSION_MIN_BET,
  planTransfer,
  TRANSFER_CONFIRM_FROM,
  TRANSFER_DAILY_LIMIT,
  TRANSFER_FEE_RATE_BPS,
  TRANSFER_MAX_AMOUNT,
  TRANSFER_MIN_GAMES,
  weekId,
  weekStartDay,
  WEEKLY_MIN_PLAYS,
} from '@casino/domain/progression';
import {
  clickPay,
  DORM_MAX,
  dormCost,
  MAX_CLICKS_PER_DAY,
  MAX_LEVEL,
  MERGE_COUNT,
  relicBuffs,
  STAR_MAX,
  upgradeCost,
  WORKERS,
  WORKER_KINDS,
} from '@casino/domain/work';
import {
  DAILY_LIMIT,
  MAX_CHOICE_LEN,
  MAX_EXPLANATION_LEN,
  MAX_QUESTION_LEN,
  MIN_GAMES_FOR_REWARD,
  OPEN_LIMIT,
  USER_DEFAULT_MINUTES,
  USER_MAX_MINUTES,
  USER_MIN_MINUTES,
} from '@casino/domain/quiz';
import { MIN_ENTRANTS, SHOWN_ENTRANTS } from '@casino/domain/lottery';
import {
  DEFAULT_MINUTES as POLL_DEFAULT_MINUTES,
  MAX_MINUTES as POLL_MAX_MINUTES,
  MAX_OPEN_PER_USER,
  TITLE_MAX,
  verdict,
} from '@casino/domain/poll';
import {
  CATALOG,
  colorRoleName,
  CONFIRM_FROM,
  isBuyable,
  isUnique,
  needsConfirm,
} from '@casino/domain/shop';
import type { SessionService } from '../../auth/sessions.ts';
import type { IdentityRepo } from '../../db/identity.ts';
import type { Store } from '../../db/store.ts';
import type { EconomyService } from '../../economy/economy-service.ts';
import type { NetWorthService } from '../../finance/net-worth-service.ts';
import { GameRuleError } from '../../games/progression/context.ts';
import type { NonCasinoGames, TeiaiPort } from '../../games/progression/index.ts';
import { noticeOf } from '../../games/shop/color-roles.ts';
import { LifeKit } from './life-support.ts';

export interface LifeRouteDeps {
  sessions: SessionService;
  identity: IdentityRepo;
  economy: EconomyService;
  store: Store;
  clock: Clock;
  games: NonCasinoGames;
  teiai: TeiaiPort;
  /** Game-day offset in hours (the config's `utcOffsetHours`). */
  offsetHours: number;
  /** Balance-sheet valuation for the net-worth tabs; without it the route is not registered. */
  netWorth?: NetWorthService;
}

const GAME_BY_LEGACY_NAME = new Map<string, string>(
  Object.entries(LEGACY_GAME_NAMES).map(([id, name]) => [name, id]),
);

/**
 * Activity routes of the "life" slice (labor, quiz, lottery, polls, shop, missions, ranking,
 * transfer). Everything calls the existing game services; this file only adapts them to the
 * wire contracts in `@casino/shared` (`LIFE_ROUTES`).
 */
export function registerLifeRoutes(app: FastifyInstance, deps: LifeRouteDeps): void {
  const { games, economy, identity, clock, teiai } = deps;
  const kit = new LifeKit({
    sessions: deps.sessions,
    store: deps.store,
    economy,
    clock,
  });

  const nameOf = (userId: string): string => {
    const user = identity.getUser(userId);
    return (user?.globalName || user?.username || `…${userId.slice(-4)}`).slice(0, 80);
  };
  const dayNo = (): number => localDayNumber(clock.now(), deps.offsetHours);

  // ------------------------------------------------------------------ labor

  const workView = (guildId: string, userId: string): WorkView => {
    const v = games.work.view(guildId, userId);
    const inventory = games.shop.inventory.all(guildId, userId);
    const held: Record<string, number> = {};
    for (const [id, qty] of inventory) if (id.startsWith('relic_')) held[id] = qty;
    return {
      now: clock.now(),
      balance: economy.getBalance(guildId, userId),
      pick: v.pick,
      glove: v.glove,
      dorm: v.dorm,
      slots: v.slots,
      fatigue: v.fatigue,
      clicks: v.clicks,
      dayClicks: v.dayClicks,
      dayCap: MAX_CLICKS_PER_DAY,
      clickPay: clickPay(v.pick, v.fatigue),
      pot: v.pot,
      terrain: v.terrain,
      upgrade: {
        pick: v.pick >= MAX_LEVEL ? null : upgradeCost(v.pick),
        glove: v.glove >= MAX_LEVEL ? null : upgradeCost(v.glove),
        dorm: v.dorm >= DORM_MAX ? null : dormCost(v.dorm),
      },
      maxLevel: MAX_LEVEL,
      dormMax: DORM_MAX,
      workers: v.workers,
      hire: WORKER_KINDS.map((kind) => ({
        kind,
        fee: WORKERS[kind].fee,
        hourly: WORKERS[kind].rate,
      })),
      ores: v.ores,
      relics: v.relics,
      held,
      buffs: relicBuffs(inventory),
      mergeCount: MERGE_COUNT,
      starMax: STAR_MAX,
      drinks: games.shop.inventory.qty(guildId, userId, 'labor_drink'),
      skimBps: LABOR_SKIM_RATE_BPS,
    };
  };

  app.register((life, _options, done) => {
    kit.install(life);

    life.get(LIFE_ROUTES.work, (request) =>
      kit.read(request, (w) => workView(w.guildId, w.userId)),
    );

    life.post(LIFE_ROUTES.workClick, (request) =>
      kit.write(request, 'work.click', WorkClickRequest, (w) => {
        const r = games.work.click(w.guildId, w.userId);
        return {
          tooFast: r.tooFast,
          pay: r.pay,
          crit: r.crit,
          combo: r.combo,
          ore: r.ore,
          capped: r.capped,
          fatigue: r.fatigue,
        };
      }),
    );

    life.post(LIFE_ROUTES.workCollect, (request) =>
      kit.write(request, 'work.collect', WorkCollectRequest, (w) => {
        const r = games.work.collect(w.guildId, w.userId);
        return {
          amount: r.amount,
          skimmed: r.skimmed,
          withheld: r.withheld,
          net: r.net,
          ores: r.ores,
          relics: r.relics,
        };
      }),
    );

    life.post(LIFE_ROUTES.workDrink, (request) =>
      kit.write(request, 'work.drink', WorkDrinkRequest, (w) => ({
        fatigue: games.work.drink(w.guildId, w.userId),
      })),
    );

    life.post(LIFE_ROUTES.workUpgrade, (request) =>
      kit.write(request, 'work.upgrade', WorkUpgradeRequest, (w, body) => ({
        level:
          body.tool === 'dorm'
            ? games.work.upgradeDorm(w.guildId, w.userId)
            : games.work.upgrade(w.guildId, w.userId, body.tool),
      })),
    );

    life.post(LIFE_ROUTES.workHire, (request) =>
      kit.write(request, 'work.hire', WorkHireRequest, (w, body) => ({
        workerId: games.work.hire(w.guildId, w.userId, body.kind),
      })),
    );

    life.post(LIFE_ROUTES.workDismiss, (request) =>
      kit.write(request, 'work.dismiss', WorkDismissRequest, (w, body) => {
        games.work.dismiss(w.guildId, w.userId, body.kind);
        return {};
      }),
    );

    life.post(LIFE_ROUTES.workRenew, (request) =>
      kit.write(request, 'work.renew', WorkRenewRequest, (w, body) => {
        games.work.setRenew(w.guildId, w.userId, body.renew);
        return {};
      }),
    );

    life.post(LIFE_ROUTES.workMerge, (request) =>
      kit.write(request, 'work.merge', WorkMergeRequest, (w, body) => ({
        itemId: games.work.mergeRelic(w.guildId, w.userId, body.itemId),
      })),
    );

    life.get(LIFE_ROUTES.workRanking, (request) =>
      kit.readQuery(request, WorkRankingQuery, (w, query): WorkRanking => {
        const period = query.period ?? 'total';
        const r = games.work.ranking(w.guildId, w.userId, period, 10);
        const row = (x: { userId: string; clicks: number; earned: number }, rank: number) => ({
          rank,
          userId: x.userId,
          name: nameOf(x.userId),
          clicks: x.clicks,
          earned: x.earned,
        });
        return {
          period,
          rows: r.rows.map((x, i) => row(x, i + 1)),
          self: r.self ? row(r.self, r.self.rank) : null,
          total: r.total,
        };
      }),
    );

    // ---------------------------------------------------------------- quiz

    life.get(LIFE_ROUTES.quiz, (request) =>
      kit.read(request, (w): QuizView => {
        const next = games.quiz.next(w.guildId, w.userId);
        const item: QuizItem | null = next
          ? {
              id: next.id,
              question: next.question,
              choices: next.choices,
              reward: next.reward,
              expiresAt: next.expiresAt,
              authorName: next.authorId === null ? null : nameOf(next.authorId),
            }
          : null;
        return {
          now: clock.now(),
          balance: economy.getBalance(w.guildId, w.userId),
          next: item,
          mine: games.quiz.authored(w.guildId, w.userId).map((q) => ({
            id: q.id,
            question: q.question,
            reward: q.reward,
            expiresAt: q.expiresAt,
            answers: q.answers,
            correct: q.correct,
            earned: q.earned,
          })),
          limits: {
            openLimit: OPEN_LIMIT,
            dailyLimit: DAILY_LIMIT,
            minGames: MIN_GAMES_FOR_REWARD,
            questionMax: MAX_QUESTION_LEN,
            choiceMax: MAX_CHOICE_LEN,
            explanationMax: MAX_EXPLANATION_LEN,
            minMinutes: USER_MIN_MINUTES,
            maxMinutes: USER_MAX_MINUTES,
            defaultMinutes: USER_DEFAULT_MINUTES,
          },
          gamesPlayed: games.progression.gamesPlayed(w.guildId, w.userId),
        };
      }),
    );

    life.post(LIFE_ROUTES.quizAnswer, (request) =>
      kit.write(request, 'quiz.answer', QuizAnswerRequest, (w, body) => {
        const r = games.quiz.answer(w.guildId, w.userId, body.quizId, body.choice);
        return {
          correct: r.correct,
          answer: r.answer,
          explanation: r.explanation,
          reward: r.reward,
          rewardBlocked: r.rewardBlocked,
        };
      }),
    );

    life.post(LIFE_ROUTES.quizPost, (request) =>
      kit.write(request, 'quiz.post', QuizPostRequest, (w, body) => ({
        quizId: games.quiz.post({
          guildId: w.guildId,
          authorId: w.userId,
          question: body.question,
          choices: body.choices,
          reward: body.reward,
          ...(body.explanation === undefined ? {} : { explanation: body.explanation }),
          ...(body.minutes === undefined ? {} : { minutes: body.minutes }),
        }).id,
      })),
    );

    life.post(LIFE_ROUTES.quizWithdraw, (request) =>
      kit.write(request, 'quiz.withdraw', QuizWithdrawRequest, (w, body) => {
        games.quiz.withdraw(w.guildId, w.userId, body.quizId);
        return {};
      }),
    );

    // ---------------------------------------------------------------- lottery

    life.get(LIFE_ROUTES.lottery, (request) =>
      kit.read(request, (w): LotteryView => {
        const cur = games.lottery.current(w.guildId);
        const last = games.lottery.latestEnded(w.guildId);
        return {
          now: clock.now(),
          balance: economy.getBalance(w.guildId, w.userId),
          current: cur
            ? {
                id: cur.id,
                hostName: nameOf(cur.host_id),
                fee: cur.fee,
                closesAt: cur.closes_at,
                pot: cur.fee * cur.entrants.length,
                entrantCount: cur.entrants.length,
                entrants: cur.entrants.slice(0, SHOWN_ENTRANTS).map(nameOf),
                joined: cur.entrants.includes(w.userId),
              }
            : null,
          last: last
            ? {
                id: last.id,
                outcome: last.winner_id === null ? 'refunded' : 'won',
                cancelled: last.status === 'cancelled',
                winnerName: last.winner_id === null ? null : nameOf(last.winner_id),
                iWon: last.winner_id === w.userId,
                iEntered: last.entrants.includes(w.userId),
                prize: last.prize,
                fee: last.fee,
                entrantCount: last.entrants.length,
              }
            : null,
          minEntrants: MIN_ENTRANTS,
        };
      }),
    );

    life.post(LIFE_ROUTES.lotteryJoin, (request) =>
      kit.write(request, 'lottery.join', LotteryJoinRequest, (w, body) => {
        games.lottery.join(w.guildId, w.userId, body.raffleId);
        return {};
      }),
    );

    // ---------------------------------------------------------------- polls

    const pollItem = (
      p: NonNullable<ReturnType<typeof games.poll.get>>,
      userId: string,
    ): PollItem => {
      const vote = games.poll.voteOf(p.id, userId);
      return {
        id: p.id,
        creatorName: nameOf(p.creatorId),
        mine: p.creatorId === userId,
        title: p.title,
        closesAt: p.closesAt,
        status: p.status,
        yes: p.yes,
        no: p.no,
        voters: p.voters,
        myVote: vote === null ? null : vote ? 'yes' : 'no',
        verdict: verdict(p),
      };
    };

    life.get(LIFE_ROUTES.polls, (request) =>
      kit.read(request, (w): PollsView => {
        // Close polls whose time is up before showing them (the job does it once a minute).
        games.poll.closeDue(w.guildId);
        return {
          now: clock.now(),
          polls: games.poll.list(w.guildId, 20).map((p) => pollItem(p, w.userId)),
          limits: {
            titleMax: TITLE_MAX,
            defaultMinutes: POLL_DEFAULT_MINUTES,
            maxMinutes: POLL_MAX_MINUTES,
            maxOpen: MAX_OPEN_PER_USER,
          },
        };
      }),
    );

    life.post(LIFE_ROUTES.pollCreate, (request) =>
      kit.write(request, 'poll.create', PollCreateRequest, (w, body) => ({
        poll: pollItem(
          games.poll.create({
            guildId: w.guildId,
            creatorId: w.userId,
            title: body.title,
            ...(body.minutes === undefined ? {} : { minutes: body.minutes }),
          }),
          w.userId,
        ),
      })),
    );

    life.post(LIFE_ROUTES.pollVote, (request) =>
      kit.write(request, 'poll.vote', PollVoteRequest, (w, body) => ({
        poll: pollItem(games.poll.vote(w.guildId, w.userId, body.pollId, body.yes), w.userId),
      })),
    );

    // ---------------------------------------------------------------- shop

    life.get(LIFE_ROUTES.shop, (request) =>
      kit.read(request, (w): ShopView => {
        // The daily plan is made by a job at 09:00; make sure a fresh guild has one too.
        games.shop.ensureMarketDay(w.guildId);
        const inventory = games.shop.inventory;
        return {
          now: clock.now(),
          balance: economy.getBalance(w.guildId, w.userId),
          debt: teiai.debtOf(w.guildId, w.userId),
          confirmFrom: CONFIRM_FROM,
          items: CATALOG.filter(isBuyable)
            // The insider memo is switched off in the Activity as in the chat shop.
            .filter((item) => item.id !== 'insider_memo')
            .map((item) => ({
              id: item.id,
              kind: item.kind as ShopView['items'][number]['kind'],
              price: item.price,
              owned: inventory.qty(w.guildId, w.userId, item.id),
              available: games.shop.available(w.guildId, w.userId, item.id),
              unique: isUnique(item),
              confirm: needsConfirm(item),
            })),
          market: games.shop.marketLots(w.guildId).map((lot) => ({
            id: lot.id,
            itemId: lot.itemId,
            black: lot.black,
            mode: lot.mode,
            qty: lot.qty,
            price: lot.price,
            expiresAt: lot.expiresAt,
            confirm: lot.confirm,
          })),
          seized: games.shop.seizedLots(w.guildId),
          colorRole: games.shop.colorRoles.equipped(w.guildId, w.userId),
        };
      }),
    );

    // Wear or take off a name colour. The choice commits first; the Discord role is applied after
    // the commit (waiting a few seconds at most) and any reason it is not shown comes back as
    // `notice`. A replayed key answers the stored response without touching Discord again.
    life.post(LIFE_ROUTES.shopColorRole, async (request) => {
      const res = kit.write(request, 'shop.colorRole', ShopColorRoleRequest, (w, body) => {
        games.shop.equip(w.guildId, w.userId, 'color_role', body.itemId);
        return { colorRole: body.itemId };
      });
      if (res.replayed) return res;
      const { guildId, userId } = kit.who(request);
      const notice = noticeOf(await games.shop.colorRoles.syncNow(guildId, userId, 4000));
      const roleName = res.colorRole === null ? null : colorRoleName(res.colorRole);
      return {
        ...res,
        colorRole: games.shop.colorRoles.equipped(guildId, userId),
        ...(notice === null ? {} : { notice }),
        ...(notice === 'name_taken' && roleName !== null ? { roleName } : {}),
      };
    });

    life.post(LIFE_ROUTES.shopBuy, (request) =>
      kit.write(request, 'shop.buy', ShopBuyRequest, (w, body) => {
        const r = games.shop.buy({
          guildId: w.guildId,
          userId: w.userId,
          itemId: body.itemId,
          idempotencyKey: body.idempotencyKey,
          ...(body.qty === undefined ? {} : { qty: body.qty }),
        });
        return { itemId: body.itemId, price: r.price };
      }),
    );

    life.post(LIFE_ROUTES.shopMarketBuy, (request) =>
      kit.write(request, 'shop.market', LotBuyRequest, (w, body) => {
        const r = games.shop.buyMarket({
          guildId: w.guildId,
          userId: w.userId,
          lotId: body.lotId,
          idempotencyKey: body.idempotencyKey,
        });
        return { itemId: r.itemId, price: r.price, revealed: r.revealed };
      }),
    );

    life.post(LIFE_ROUTES.shopSeizedBuy, (request) =>
      kit.write(request, 'shop.seized', LotBuyRequest, (w, body) => {
        const lot = games.shop.seizedLots(w.guildId).find((l) => l.id === body.lotId);
        if (!lot) throw new GameRuleError('lot_gone', {}, 'not_found');
        const r = games.shop.buySeized({
          guildId: w.guildId,
          userId: w.userId,
          lotId: body.lotId,
          idempotencyKey: body.idempotencyKey,
        });
        return { itemId: lot.itemId, price: r.price };
      }),
    );

    // ---------------------------------------------------------------- missions

    life.get(LIFE_ROUTES.missions, (request) =>
      kit.read(request, (w): MissionsView => {
        const status = games.progression.missionStatus(w.guildId, w.userId);
        const state = games.progression.playState(w.guildId, w.userId);
        return {
          now: clock.now(),
          day: status.day,
          resetAt: dayStartMs(dayNo() + 1, deps.offsetHours),
          missions: status.missions.map(({ mission, progress, done }) => ({
            id: mission.id,
            kind: mission.kind,
            target: mission.target,
            reward: mission.reward,
            progress: Math.min(progress, mission.target),
            done,
            game: mission.game === null ? null : (GAME_BY_LEGACY_NAME.get(mission.game) ?? null),
            tag: mission.tag,
          })),
          bonus: MISSION_COMPLETE_BONUS,
          minBet: MISSION_MIN_BET,
          winStreak: state.winStreak,
          bestStreak: state.bestStreak,
        };
      }),
    );

    // ---------------------------------------------------------------- weekly ranking

    life.get(LIFE_ROUTES.ranking, (request) =>
      kit.read(request, (w): RankingView => {
        const today = dayNo();
        const week = weekId(today);
        const rows = games.progression.weeklyStandings(w.guildId, week, 10);
        const self = games.progression.weeklyRankOf(w.guildId, w.userId, week);
        const champion = games.progression.lastChampion(w.guildId);
        const statuses = deps.netWorth?.displayStatuses(w.guildId, clock.now());
        return {
          now: clock.now(),
          week,
          weekEnd: isoDate(weekStartDay(today) + 6),
          endsAt: dayStartMs(weekStartDay(today) + 7, deps.offsetHours),
          rows: rows.map((r, i) => ({
            rank: i + 1,
            userId: r.userId,
            name: nameOf(r.userId),
            net: r.net,
            plays: r.plays,
            qualified: r.net > 0 && r.plays >= WEEKLY_MIN_PLAYS,
            ...(statuses ? { status: statuses.get(r.userId) ?? 'katagi' } : {}),
          })),
          self,
          minPlays: WEEKLY_MIN_PLAYS,
          champion: champion
            ? {
                userId: champion.userId,
                name: nameOf(champion.userId),
                week: champion.week,
                net: champion.net,
                wins: champion.wins,
              }
            : null,
          ...(statuses ? { selfStatus: statuses.get(w.userId) ?? 'katagi' } : {}),
        };
      }),
    );

    // ---------------------------------------------------------------- net worth ranking

    const netWorth = deps.netWorth;
    if (netWorth) {
      life.get(LIFE_ROUTES.netWorth, (request) =>
        kit.readQuery(request, NetWorthQuery, (w, query): NetWorthView => {
          const view = query.view ?? 'net';
          const res = netWorth.standingsWithSelf(w.guildId, w.userId, view, 10, clock.now());
          return {
            now: clock.now(),
            view,
            total: res.total,
            rows: res.rows.map((r) => ({
              rank: r.rank,
              userId: r.sheet.userId,
              name: nameOf(r.sheet.userId),
              value: r.value,
              groups: r.sheet.groups,
              status: r.status,
            })),
            self: res.self
              ? {
                  rank: res.self.rank,
                  value: res.self.value,
                  groups: res.self.sheet.groups,
                  parts: res.self.sheet.parts,
                  status: res.self.status,
                }
              : null,
          };
        }),
      );
    }

    // ---------------------------------------------------------------- transfer

    life.get(LIFE_ROUTES.transfer, (request) =>
      kit.read(request, (w): TransferView => ({
        now: clock.now(),
        balance: economy.getBalance(w.guildId, w.userId),
        debt: teiai.debtOf(w.guildId, w.userId),
        gamesPlayed: games.progression.gamesPlayed(w.guildId, w.userId),
        minGames: TRANSFER_MIN_GAMES,
        sentToday: games.progression.sentToday(w.guildId, w.userId),
        dailyLimit: TRANSFER_DAILY_LIMIT,
        feeBps: TRANSFER_FEE_RATE_BPS,
        confirmFrom: TRANSFER_CONFIRM_FROM,
        maxAmount: TRANSFER_MAX_AMOUNT,
      })),
    );

    life.get(LIFE_ROUTES.transferMembers, (request) =>
      kit.readQuery(request, TransferMembersQuery, (w, query) => ({
        members: identity.searchMembers(w.guildId, query.q ?? '', w.userId, 20).map((u) => ({
          userId: u.userId,
          name: (u.globalName || u.username || `…${u.userId.slice(-4)}`).slice(0, 80),
          avatar: u.avatar,
        })),
      })),
    );

    // The legacy chat command creates an account for any receiver it is given; the Activity
    // only sends to people the server has already seen in this guild.
    const planFor = (
      w: { guildId: string; userId: string },
      receiverId: string,
      amount: number,
    ): ReturnType<typeof planTransfer> => {
      return planTransfer({
        senderId: w.userId,
        receiverId,
        amount,
        senderGames: games.progression.gamesPlayed(w.guildId, w.userId),
        sentToday: games.progression.sentToday(w.guildId, w.userId),
        senderDebt: teiai.debtOf(w.guildId, w.userId),
        senderBalance: economy.getBalance(w.guildId, w.userId),
        receiverDebt: teiai.debtOf(w.guildId, receiverId),
      });
    };

    life.post(LIFE_ROUTES.transferPreview, (request) =>
      kit.preview(request, TransferPreviewRequest, (w, body): TransferPreview => {
        if (!economy.hasAccount(w.guildId, body.receiverId)) {
          return { ok: false, rule: 'transfer_unknown_member', params: {} };
        }
        const plan = planFor(w, body.receiverId, body.amount);
        if (!plan.ok) return { ok: false, rule: plan.error.code, params: plan.error.params };
        return {
          ok: true,
          amount: plan.amount,
          fee: plan.fee,
          total: plan.amount + plan.fee,
          needsConfirm: plan.needsConfirm,
          receiverWithheld: plan.receiverWithheld,
        };
      }),
    );

    life.post(LIFE_ROUTES.transferSend, (request) =>
      kit.write(request, 'transfer.send', TransferSendRequest, (w, body) => {
        if (!economy.hasAccount(w.guildId, body.receiverId)) {
          throw new GameRuleError('transfer_unknown_member', {}, 'not_found');
        }
        const r = games.progression.transfer({
          guildId: w.guildId,
          senderId: w.userId,
          receiverId: body.receiverId,
          amount: body.amount,
          idempotencyKey: body.idempotencyKey,
        });
        if (!r.ok) {
          throw new GameRuleError(
            r.error.code,
            r.error.params,
            r.error.code === 'transfer_insufficient_balance' ? 'insufficient_funds' : 'conflict',
          );
        }
        return { amount: r.amount, fee: r.fee, received: r.received, withheld: r.withheld };
      }),
    );

    done();
  });
}
