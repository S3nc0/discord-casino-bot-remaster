import { randomUUID } from 'node:crypto';
import type { RtpProfile } from '@casino/domain/casino';
import { MIN_BET, eventBoostFor, isRtpLevel, settle, winTier } from '@casino/domain/casino';
import type { ManualEvent } from '@casino/domain/casino';
import type { LedgerReason } from '@casino/shared';
import type { Logger } from 'pino';
import { AppError } from '../../runtime/errors.ts';
import type { Store } from '../../db/store.ts';
import type { EconomyService } from '../../economy/economy-service.ts';
import { SessionGuard } from './sessions.ts';
import type {
  CasinoDeps,
  CasinoGame,
  CasinoPorts,
  Caller,
  RoundSettled,
  SettlementSummary,
} from './types.ts';

/** The row of one player round (`game_rounds`). */
export interface RoundRow {
  roundId: string;
  guildId: string;
  userId: string;
  game: CasinoGame;
  /** Escrow held, doubles included. */
  stake: number;
  status: 'open' | 'settled' | 'refunded';
  instanceId: string | null;
  tableRound: string | null;
  source: Caller['source'];
}

interface RoundDbRow {
  round_id: string;
  guild_id: string;
  user_id: string;
  game: CasinoGame;
  stake: number;
  status: 'open' | 'settled' | 'refunded';
  instance_id: string | null;
  table_round: string | null;
}

const toRound = (row: RoundDbRow, source: Caller['source'] = 'activity'): RoundRow => ({
  roundId: row.round_id,
  guildId: row.guild_id,
  userId: row.user_id,
  game: row.game,
  stake: row.stake,
  status: row.status,
  instanceId: row.instance_id,
  tableRound: row.table_round,
  source,
});

export interface SettleSpec {
  /** Gross payout of the game (stake included). */
  payout: number;
  /** Extra owed above the stake (chinchiro multiplier loss). */
  penalty?: number;
  profile: RtpProfile;
  /** The game already applied the RTP level to its payout (pachinko, roulette lines). */
  rtpDone?: boolean;
  tags?: string[];
}

const defaultPorts = (store: Store): CasinoPorts => ({
  rtpLevel: (guildId, game) => {
    const row = store
      .stmt('SELECT level FROM rtp_levels WHERE guild_id = ? AND game = ?')
      .get(guildId, game) as { level: number } | undefined;
    return row?.level ?? 3;
  },
  eventBoost: (guildId, game, nowMs) => {
    const row = store
      .stmt(
        'SELECT game, boost_pct, starts_at, ends_at FROM casino_events WHERE guild_id = ? AND ends_at > ?',
      )
      .get(guildId, nowMs) as
      { game: CasinoGame; boost_pct: number; starts_at: number; ends_at: number } | undefined;
    const manual: ManualEvent | null = row
      ? { game: row.game, boostPct: row.boost_pct, startsAt: row.starts_at, endsAt: row.ends_at }
      : null;
    return eventBoostFor(guildId, game, nowMs, manual);
  },
  isEnabled: (guildId, game) =>
    store
      .stmt('SELECT 1 FROM guild_features_off WHERE guild_id = ? AND feature = ?')
      .get(guildId, `casino:${game}`) === undefined,
  insurance: { has: () => false, consume: () => {} },
  debt: { withhold: () => 0, owe: () => {} },
  bank: { lossShare: () => {} },
  credit: { borrowForDouble: () => false },
});

/**
 * What every game shares: escrow bookkeeping, the settlement pipeline (RTP level, event
 * bonus, insurance, debt withholding, loss shares, jackpot) and the events it emits.
 * Methods that move money run inside the caller's transaction.
 */
export class CasinoCore {
  readonly store: Store;
  readonly economy: EconomyService;
  readonly sessions: SessionGuard;
  readonly ports: CasinoPorts;
  private readonly deps: CasinoDeps;
  private readonly logger: Logger;
  private readonly listeners = new Set<(round: RoundSettled) => void>();

  constructor(deps: CasinoDeps) {
    this.deps = deps;
    this.store = deps.store;
    this.economy = deps.economy;
    this.logger = deps.logger;
    this.sessions = new SessionGuard(deps.clock);
    this.ports = { ...defaultPorts(deps.store), ...deps.ports };
  }

  get now(): number {
    return this.deps.clock.now();
  }

  /** Subscribe to every settled round (missions, ranking, streaks). */
  onSettled(listener: (round: RoundSettled) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  newRoundId(prefix = 'r'): string {
    return `${prefix}_${randomUUID().replaceAll('-', '')}`;
  }

  // ---- validation -------------------------------------------------------------------------

  /** Feature switch and minimum bet, before any money moves. */
  check(caller: Caller, game: CasinoGame, stake: number): void {
    if (!this.ports.isEnabled(caller.guildId, game)) throw new AppError('feature_disabled');
    if (!Number.isSafeInteger(stake) || stake < MIN_BET) {
      throw new AppError('invalid_payload', { message: `minimum bet is ${MIN_BET}` });
    }
  }

  // ---- escrow ----------------------------------------------------------------------------

  /**
   * Take the stake: session lock, `game_stake` debit, open round row. `owner` names what the
   * lock belongs to (the round itself, or a shared table round). On any failure the lock is
   * released and nothing is posted.
   */
  begin(
    caller: Caller,
    game: CasinoGame,
    stake: number,
    options: { owner?: string; tableRound?: string; detail?: unknown; roundId?: string } = {},
  ): RoundRow {
    this.check(caller, game, stake);
    const roundId = options.roundId ?? this.newRoundId(game.slice(0, 2));
    const owner = options.owner ?? roundId;
    this.sessions.acquire(caller.guildId, caller.userId, owner);
    try {
      this.store.transaction(() => {
        this.economy.apply({
          guildId: caller.guildId,
          userId: caller.userId,
          delta: -stake,
          reason: 'game_stake',
          refType: 'round',
          refId: roundId,
          idempotencyKey: `${roundId}:stake`,
          meta: { game },
        });
        this.store
          .stmt(
            `INSERT INTO game_rounds
               (round_id, guild_id, user_id, game, stake, status, instance_id, table_round, detail, created_at)
             VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
          )
          .run(
            roundId,
            caller.guildId,
            caller.userId,
            game,
            stake,
            caller.instanceId ?? null,
            options.tableRound ?? null,
            options.detail === undefined ? null : JSON.stringify(options.detail),
            this.now,
          );
      });
    } catch (error) {
      this.sessions.release(caller.guildId, caller.userId, owner, { cooldown: false });
      throw error;
    }
    return {
      roundId,
      guildId: caller.guildId,
      userId: caller.userId,
      game,
      stake,
      status: 'open',
      instanceId: caller.instanceId ?? null,
      tableRound: options.tableRound ?? null,
      source: caller.source,
    };
  }

  /** More stake on an open round (a blackjack double). Cash only, unless a credit port lends. */
  addStake(round: RoundRow, extra: number, options: { allowCredit?: boolean } = {}): void {
    const { guildId, userId } = round;
    this.store.transaction(() => {
      const balance = this.economy.getBalance(guildId, userId);
      if (balance < extra) {
        const need = extra - balance;
        const lent =
          options.allowCredit === true && this.ports.credit.borrowForDouble(guildId, userId, need);
        if (!lent) throw new AppError('insufficient_funds');
      }
      this.economy.debit({
        guildId,
        userId,
        amount: extra,
        reason: 'game_stake',
        refType: 'round',
        refId: round.roundId,
        idempotencyKey: `${round.roundId}:stake+${round.stake}`,
        meta: { game: round.game, extra: true },
      });
      this.store
        .stmt('UPDATE game_rounds SET stake = stake + ? WHERE round_id = ? AND status = ?')
        .run(extra, round.roundId, 'open');
    });
    round.stake += extra;
  }

  /** Give the stake back (abort, crash recovery). A no-op for a round that is not open. */
  refund(round: RoundRow, owner?: string): boolean {
    const done = this.store.transaction(() => {
      const row = this.store
        .stmt('SELECT status FROM game_rounds WHERE round_id = ?')
        .get(round.roundId) as { status: string } | undefined;
      if (row?.status !== 'open') return false;
      const stake = (
        this.store.stmt('SELECT stake FROM game_rounds WHERE round_id = ?').get(round.roundId) as {
          stake: number;
        }
      ).stake;
      this.economy.credit({
        guildId: round.guildId,
        userId: round.userId,
        amount: stake,
        reason: 'game_refund',
        refType: 'round',
        refId: round.roundId,
        idempotencyKey: `${round.roundId}:refund`,
        meta: { game: round.game },
      });
      this.store
        .stmt("UPDATE game_rounds SET status = 'refunded', settled_at = ? WHERE round_id = ?")
        .run(this.now, round.roundId);
      return true;
    });
    round.status = 'refunded';
    this.sessions.release(round.guildId, round.userId, owner ?? round.roundId);
    return done;
  }

  /** At start-up: any round still open lost its process; return every stake. */
  recoverOpenRounds(): number {
    const rows = this.store
      .stmt(
        `SELECT round_id, guild_id, user_id, game, stake, status, instance_id, table_round
         FROM game_rounds WHERE status = 'open'`,
      )
      .all() as RoundDbRow[];
    let refunded = 0;
    for (const row of rows) {
      try {
        if (this.refund(toRound(row))) refunded += 1;
      } catch (error) {
        this.logger.error({ err: error, roundId: row.round_id }, 'casino round refund failed');
      }
    }
    return refunded;
  }

  loadRound(roundId: string): RoundRow | null {
    const row = this.store
      .stmt(
        `SELECT round_id, guild_id, user_id, game, stake, status, instance_id, table_round
         FROM game_rounds WHERE round_id = ?`,
      )
      .get(roundId) as RoundDbRow | undefined;
    return row ? toRound(row) : null;
  }

  // ---- jackpot and RTP -------------------------------------------------------------------

  jackpotPool(guildId: string): number {
    const row = this.store.stmt('SELECT pool FROM jackpots WHERE guild_id = ?').get(guildId) as
      { pool: number } | undefined;
    return row?.pool ?? 0;
  }

  /** Owner command: set the level of a game in a guild (3 clears the row). */
  setRtpLevel(guildId: string, game: CasinoGame, level: number): void {
    if (!isRtpLevel(level)) throw new AppError('invalid_payload');
    if (level === 3) {
      this.store.stmt('DELETE FROM rtp_levels WHERE guild_id = ? AND game = ?').run(guildId, game);
      return;
    }
    this.store
      .stmt(
        `INSERT INTO rtp_levels (guild_id, game, level, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (guild_id, game) DO UPDATE SET level = excluded.level, updated_at = excluded.updated_at`,
      )
      .run(guildId, game, level, this.now);
  }

  rtpLevel(guildId: string, game: CasinoGame): number {
    return this.ports.rtpLevel(guildId, game);
  }

  // ---- settlement ------------------------------------------------------------------------

  /** Pay out a round. A second call for the same round is refused with `conflict`. */
  settle(round: RoundRow, spec: SettleSpec, owner?: string): SettlementSummary {
    const { guildId, userId, roundId, game } = round;
    const summary = this.store.transaction(() => {
      const row = this.store
        .stmt('SELECT status, stake FROM game_rounds WHERE round_id = ?')
        .get(roundId) as { status: string; stake: number } | undefined;
      if (row?.status !== 'open') throw new AppError('conflict');
      const amount = row.stake;
      const at = this.now;
      const pool = this.jackpotPool(guildId);
      const s = settle(
        {
          amount,
          payout: spec.payout,
          rtpLevel: this.rtpLevel(guildId, game),
          rtpProfile: spec.profile,
          ...(spec.rtpDone === undefined ? {} : { rtpDone: spec.rtpDone }),
          boost: this.ports.eventBoost(guildId, game, at),
          hasInsurance: this.ports.insurance.has(guildId, userId),
          penalty: spec.penalty ?? 0,
          jackpotPool: pool,
        },
        this.deps.rng,
      );
      const post = (
        delta: number,
        reason: LedgerReason,
        key: string,
        meta?: Record<string, unknown>,
      ) =>
        this.economy.apply({
          guildId,
          userId,
          delta,
          reason,
          refType: 'round',
          refId: roundId,
          idempotencyKey: `${roundId}:${key}`,
          ...(meta === undefined ? {} : { meta }),
        });

      const paid = s.payout + s.eventBonus;
      if (paid > 0) post(paid, 'game_payout', 'payout', { game, eventBonus: s.eventBonus });
      if (s.insured > 0) {
        post(s.insured, 'game_insurance_refund', 'insurance', { game });
        this.ports.insurance.consume(guildId, userId);
      }
      let withheld = 0;
      const withhold = (income: number, key: string): void => {
        if (income <= 0) return;
        const take = Math.min(this.ports.debt.withhold(guildId, userId, income), income);
        if (take > 0) {
          post(-take, 'debt_withholding', key, { game });
          withheld += take;
        }
      };
      withhold(s.withholdable, 'withhold');

      let shortfall = 0;
      if (s.penalty > 0) {
        const taken = Math.min(this.economy.getBalance(guildId, userId), s.penalty);
        if (taken > 0) post(-taken, 'game_penalty', 'penalty', { game });
        shortfall = s.penalty - taken;
        if (shortfall > 0) this.ports.debt.owe(guildId, userId, shortfall, `${game}の倍払い`);
      }
      if (s.bankShare > 0) this.ports.bank.lossShare(guildId, s.bankShare, game);

      if (s.jackpotHit) {
        post(s.jackpotAmount, 'jackpot_payout', 'jackpot', { game });
        withhold(s.jackpotAmount, 'jackpot_withhold');
      }
      this.store
        .stmt(
          `INSERT INTO jackpots (guild_id, pool, updated_at) VALUES (?, ?, ?)
           ON CONFLICT (guild_id) DO UPDATE SET pool = excluded.pool, updated_at = excluded.updated_at`,
        )
        .run(guildId, s.jackpotPoolAfter, at);

      const total = s.total;
      const net = s.net;
      this.store
        .stmt(
          `UPDATE game_rounds SET status = 'settled', payout = ?, net = ?, settled_at = ?
           WHERE round_id = ?`,
        )
        .run(total, net, at, roundId);

      const tier = winTier(net, amount);
      const summary: SettlementSummary = {
        roundId,
        game,
        stake: amount,
        payout: total,
        net,
        eventBonus: s.eventBonus,
        insured: s.insured,
        penalty: s.penalty,
        penaltyShortfall: shortfall,
        withheld,
        jackpot: s.jackpotAmount,
        jackpotPool: s.jackpotPoolAfter,
        balance: this.economy.getBalance(guildId, userId),
        tier,
      };
      this.publish(round, summary, spec.tags ?? [], at);
      return summary;
    });
    round.status = 'settled';
    this.sessions.release(guildId, userId, owner ?? round.roundId);
    return summary;
  }

  private publish(round: RoundRow, s: SettlementSummary, tags: string[], at: number): void {
    const { guildId, userId, roundId, game } = round;
    const allTags = s.jackpot > 0 ? [...tags, 'jackpot'] : tags;
    this.store.afterCommit(() => {
      const bus = this.deps.bus;
      bus.publishDomain({
        type: 'GameSettled',
        guildId,
        at,
        userId,
        game,
        roundId,
        stake: s.stake,
        payout: s.payout,
        net: s.net,
        source: round.source,
        ...(round.instanceId === null ? {} : { instanceId: round.instanceId }),
        ...(allTags.length === 0 ? {} : { tags: allTags }),
      });
      if (s.tier !== null) {
        bus.publishDomain({
          type: 'BigWin',
          guildId,
          at,
          userId,
          game,
          roundId,
          payout: s.payout,
          multiplierBps: Math.floor((s.payout * 10_000) / s.stake),
        });
      }
      if (s.jackpot > 0) {
        bus.publishDomain({ type: 'Jackpot', guildId, at, userId, game, amount: s.jackpot });
      }
      const settled: RoundSettled = {
        guildId,
        userId,
        game,
        roundId,
        stake: s.stake,
        payout: s.payout,
        net: s.net,
        tags: allTags,
        tier: s.tier,
        jackpot: s.jackpot,
        at,
        source: round.source,
      };
      for (const listener of this.listeners) {
        try {
          listener(settled);
        } catch (error) {
          this.logger.error({ err: error }, 'casino settled listener failed');
        }
      }
    });
  }
}
