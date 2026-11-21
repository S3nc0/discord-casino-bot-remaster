import type { Clock, Rng } from '@casino/shared';
import { withholdIncome } from '@casino/domain/progression';
import type { Store } from '../../db/store.ts';
import type { EconomyService } from '../../economy/economy-service.ts';
import type { EventBus } from '../../runtime/bus.ts';
import type { CasinoPorts } from '../casino/types.ts';
import { ArenaService } from '../arena/service.ts';
import { LotteryService } from '../lottery/service.ts';
import { PollService } from '../poll/service.ts';
import { QuizService } from '../quiz/service.ts';
import { RaceService } from '../race/service.ts';
import { ShopService } from '../shop/service.ts';
import { WorkService } from '../work/service.ts';
import type { GamesCtx } from './context.ts';
import type { TeiaiPort } from './ports.ts';
import { ProgressionService } from './service.ts';

/** A scheduled job as data: the runner (not part of this card) calls `run` for every guild. */
export interface GameJob {
  name: string;
  /** Cron expression in the game time zone (`Asia/Tokyo`); six fields when it runs every few seconds. */
  cron: string;
  timezone: 'Asia/Tokyo';
  run(guildId: string): unknown;
}

export interface NonCasinoDeps {
  store: Store;
  economy: EconomyService;
  bus: EventBus;
  clock: Clock;
  rng: Rng;
  /** The Teiai bank and debt module. Use `createMemoryTeiai()` until the finance card provides it. */
  teiai: TeiaiPort;
  /** Game-day offset (the config's `utcOffsetHours`, 9 for JST). */
  offsetHours: number;
}

export interface NonCasinoGames {
  progression: ProgressionService;
  race: RaceService;
  arena: ArenaService;
  work: WorkService;
  quiz: QuizService;
  lottery: LotteryService;
  poll: PollService;
  shop: ShopService;
  jobs: GameJob[];
  /** Subscribe missions, ranking and stats to `GameSettled`. Returns the unsubscribe function. */
  start(): () => void;
  /** Insurance, debt withholding and loss-share ports for `createCasinoGames({ ports })`. */
  casinoPorts(): Pick<CasinoPorts, 'insurance' | 'debt' | 'bank'>;
}

const JST = 'Asia/Tokyo' as const;

export function createNonCasinoGames(deps: NonCasinoDeps): NonCasinoGames {
  const ctx: GamesCtx = { ...deps };
  const progression = new ProgressionService(ctx);
  const race = new RaceService(ctx);
  const arena = new ArenaService(ctx);
  const work = new WorkService(ctx);
  const shop = new ShopService(ctx);
  const quiz = new QuizService(ctx, (g, u) => progression.gamesPlayed(g, u));
  const lottery = new LotteryService(ctx);
  const poll = new PollService(ctx);

  const job = (name: string, cron: string, run: (guildId: string) => unknown): GameJob => ({
    name,
    cron,
    timezone: JST,
    run,
  });
  const jobs: GameJob[] = [
    job('race.ensureDay', '0 0 * * *', (g) => race.ensureDay(g)),
    job('race.tick', '*/5 * * * * *', (g) => race.tick(g)),
    job('arena.ensureToday', '*/30 * * * * *', (g) => arena.ensureToday(g)),
    job('arena.advance', '*/30 * * * * *', (g) => arena.advance(g)),
    job('lottery.drawDue', '*/20 * * * * *', (g) => lottery.drawDue(g)),
    job('poll.closeDue', '0 * * * * *', (g) => poll.closeDue(g)),
    job('quiz.settleExpired', '0 * * * * *', () => quiz.settleExpired()),
    job('weekly.settle', '*/5 * * * *', (g) => progression.settleWeekly(g)),
    job('daily.ready', '0 0,6,12,18 * * *', (g) => progression.announceDailyReady(g)),
    job('shop.ensureMarketDay', '0 9 * * *', (g) => shop.ensureMarketDay(g)),
  ];

  return {
    progression,
    race,
    arena,
    work,
    quiz,
    lottery,
    poll,
    shop,
    jobs,
    start: () => progression.subscribe(),
    casinoPorts: () => ({
      insurance: {
        has: (g, u) => shop.hasInsurance(g, u),
        consume: (g, u) => shop.consumeInsurance(g, u),
      },
      debt: {
        withhold(g, u, income) {
          const amount = withholdIncome(income, deps.teiai.debtOf(g, u));
          if (amount > 0) deps.teiai.repayDebt(g, u, amount);
          return amount;
        },
        owe: (g, u, amount, why) => deps.teiai.addDebt(g, u, amount, why),
      },
      bank: {
        lossShare: (g, amount) =>
          deps.teiai.bankIncome(g, Math.floor((amount * 300) / 10_000), 'casino loss share'),
      },
    }),
  };
}
