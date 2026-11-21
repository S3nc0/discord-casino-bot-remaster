import type { Clock, DomainEvent, GameId, Rng } from '@casino/shared';
import type { CasinoGame } from '@casino/domain/casino';
import type { Logger } from 'pino';
import type { Store } from '../../db/store.ts';
import type { EconomyService } from '../../economy/economy-service.ts';
import type { EventBus } from '../../runtime/bus.ts';

export type { CasinoGame };

/** Who acts and where from. Chat commands and the Activity use the same services. */
export interface Caller {
  guildId: string;
  userId: string;
  source: 'activity' | 'chat';
  /** Activity instance (shared tables); absent in chat. */
  instanceId?: string;
}

/**
 * Things the casino needs from modules other cards own. Each has a working default (no
 * insurance, no debt, no event, every game on), so the games run before those modules exist.
 */
export interface CasinoPorts {
  /** Guild RTP level of a game (1..6, 3 when untouched). Default: the `rtp_levels` table. */
  rtpLevel(guildId: string, game: CasinoGame): number;
  /** Event bonus boost that applies to a game now: 0.5 = +50 % of the profit. Default 0. */
  eventBoost(guildId: string, game: CasinoGame, nowMs: number): number;
  /** Whether the owner has the game on. Default: no `guild_features_off` row `casino:<game>`. */
  isEnabled(guildId: string, game: CasinoGame): boolean;
  insurance: {
    has(guildId: string, userId: string): boolean;
    /** Called after the refund was paid. */
    consume(guildId: string, userId: string): void;
  };
  debt: {
    /**
     * Part of `income` the player's Teiai debt takes (30 %, 0 without debt). The port records
     * the repayment; the casino posts the matching `debt_withholding` ledger row.
     */
    withhold(guildId: string, userId: string, income: number): number;
    /** A chinchiro multiplier loss the player's cash could not cover. */
    owe(guildId: string, userId: string, amount: number, why: string): void;
  };
  bank: {
    /** The Teiai bank's 3 % share of a loss. */
    lossShare(guildId: string, amount: number, game: CasinoGame): void;
  };
  credit: {
    /**
     * A blackjack double short of cash: borrow `need` from Teiai (posting `loan_borrow`) when
     * allowed and return true. Default false.
     */
    borrowForDouble(guildId: string, userId: string, need: number): boolean;
  };
}

/** A timer the services can schedule; tests drive it by hand. */
export interface Scheduler {
  after(ms: number, fn: () => void): () => void;
}

export interface CasinoDeps {
  store: Store;
  economy: EconomyService;
  bus: EventBus;
  clock: Clock;
  rng: Rng;
  logger: Logger;
  ports?: Partial<CasinoPorts>;
  scheduler?: Scheduler;
}

/** Fired after every settlement, for missions, ranking and stats (B2-B consumes it). */
export interface RoundSettled {
  guildId: string;
  userId: string;
  game: GameId;
  roundId: string;
  stake: number;
  payout: number;
  net: number;
  /** Mission tags: `natural`, `double_win`, `jackpot`, ... */
  tags: string[];
  tier: 'jackpot' | 'super' | 'big' | null;
  jackpot: number;
  at: number;
  source: Caller['source'];
}

export type CasinoDomainEvent = Extract<
  DomainEvent,
  { type: 'GameSettled' | 'BigWin' | 'Jackpot' }
>;

/** What a settlement paid, for the result screens. */
export interface SettlementSummary {
  roundId: string;
  game: CasinoGame;
  stake: number;
  /** Credited for the round: payout + event bonus + insurance. */
  payout: number;
  net: number;
  eventBonus: number;
  insured: number;
  penalty: number;
  /** Penalty the cash could not cover (turned into debt). */
  penaltyShortfall: number;
  /** Debt withholding taken from the income. */
  withheld: number;
  jackpot: number;
  jackpotPool: number;
  balance: number;
  tier: 'jackpot' | 'super' | 'big' | null;
}
