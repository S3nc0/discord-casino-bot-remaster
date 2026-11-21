import { PRICE_SCALE, type LedgerReason, type Rng } from '@casino/shared';
import {
  absorbInflow,
  absorbShock,
  accrueDebtInterest,
  autoSeedIfEmpty,
  BASE_RISK_FREE_NANO,
  cdsExpectedPayout,
  cdsOddsTenths,
  cdsSelfCapRoom,
  COMPANY_CONSTANTS,
  computeBankMetrics,
  computeBankruptcyWaterfall,
  computeTrustInterestDue,
  dailyTopupSeed,
  debtWithhold,
  decayThermostat,
  evaluateGraceTransition,
  localDateString,
  manualSeedLoanQuote,
  MS_PER_DAY,
  MS_PER_HOUR,
  nanoToRate,
  rateToNano,
  recoverBankLoans,
  resolvePlayerStatus,
  rfStep,
  rfTarget,
  rollEscapeAttempt,
  settleCdsDefault,
  splitBankDeposit,
  standardNormal,
  TEIAI_CONSTANTS,
  thermostatRoomMicros,
  truncInt,
  type BankLiquidityLevel,
  type PlayerDebtStatus,
} from '@casino/domain/finance';
import type { FinanceDeps, TeiaiCrossHooks } from './types.ts';

export interface BankAccountRow {
  guild_id: string;
  user_id: string;
  debt: number;
  debt_interest_at: number;
  bankrupt_at: number | null;
  grace_until: number | null;
  blacklist_until: number | null;
  escape_tries: number;
  last_escape_at: number;
}

export interface BankReserveRow {
  guild_id: string;
  cash_micros: number;
  loaned_micros: number;
  recovery_at: number;
  trust_at: number;
  trust_accrued_micros: number;
  trust_paid_micros: number;
  trust_premium_nano: number;
  risk_free_nano: number;
  risk_free_at: number;
  excess_unpaid_micros: number;
  kyosai_div_at: number;
  thermo_load_micros: number;
  thermo_cap_micros: number;
  thermo_at: number;
  thermo_burned_micros: number;
  thermo_bailed_micros: number;
  thermo_enforce: number;
}

export interface BankStatusView {
  readonly cash: number;
  readonly loaned: number;
  readonly locks: number;
  readonly available: number;
  readonly deposits: number;
  readonly bonds: number;
  readonly ratio: number | null;
  readonly level: BankLiquidityLevel;
  readonly riskFree: number;
  readonly rfTarget: number;
  readonly trustRate: number;
  readonly trustPremium: number;
  readonly trustPaid: number;
  readonly excessUnpaid: number;
  readonly thermostat: {
    readonly load: number;
    readonly capacity: number;
    readonly room: number;
    readonly burned: number;
    readonly bailed: number;
    readonly enforce: boolean;
  };
}

export interface CdsQuote {
  readonly status: PlayerDebtStatus;
  readonly debt: number;
  readonly grace: boolean;
  readonly oddsTenths: number;
  readonly odds: number;
}

export interface BankruptcyReport {
  readonly forced: boolean;
  readonly escape: boolean;
  readonly seized: number;
  readonly shopValue: number;
  readonly seniorPaid: number;
  readonly juniorPaid: number;
  readonly forgiven: number;
  readonly compressed: number;
  readonly seed: number;
  readonly debt: number;
  readonly cdsPaid: number;
}

export interface EscapeAttemptReport {
  readonly escaped: boolean;
  readonly fine: number;
  readonly debt: number;
  readonly bankrupt: BankruptcyReport | null;
}

export type ServiceResult<T> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly reason: string };

export class TeiaiService {
  private readonly deps: FinanceDeps;
  private hooks: TeiaiCrossHooks = {};

  constructor(deps: FinanceDeps) {
    this.deps = deps;
  }

  /** Wire peer finance service hooks after construction (avoids circular imports). */
  registerHooks(hooks: TeiaiCrossHooks): void {
    this.hooks = { ...this.hooks, ...hooks };
  }

  private utcOffsetHours(): number {
    return this.deps.utcOffsetHours ?? 9;
  }

  // -------------------------------------------------------------------------
  // Bank Reserve, Thermostat, CIR r_f & House Account
  // -------------------------------------------------------------------------

  ensureReserve(guildId: string, nowMs = this.deps.clock.now()): BankReserveRow {
    const existing = this.deps.store
      .stmt('SELECT * FROM bank_reserve WHERE guild_id = ?')
      .get(guildId) as BankReserveRow | undefined;
    if (existing) return existing;

    this.deps.store
      .stmt(
        `INSERT INTO bank_reserve (
          guild_id, recovery_at, risk_free_nano, risk_free_at, thermo_at, thermo_cap_micros
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        guildId,
        nowMs,
        BASE_RISK_FREE_NANO,
        nowMs,
        nowMs,
        TEIAI_CONSTANTS.thermostatCapacityMin * PRICE_SCALE,
      );
    return this.deps.store
      .stmt('SELECT * FROM bank_reserve WHERE guild_id = ?')
      .get(guildId) as BankReserveRow;
  }

  private syncReserveInTx(guildId: string, nowMs: number): BankReserveRow {
    let row = this.ensureReserve(guildId, nowMs);

    // 1. Continuous underground loan recovery
    if (row.recovery_at <= 0) {
      this.deps.store
        .stmt('UPDATE bank_reserve SET recovery_at = ? WHERE guild_id = ?')
        .run(nowMs, guildId);
      row = { ...row, recovery_at: nowMs };
    } else if (nowMs > row.recovery_at && row.loaned_micros > 0) {
      const elapsedHours = (nowMs - row.recovery_at) / MS_PER_HOUR;
      const rec = recoverBankLoans(row.cash_micros, row.loaned_micros, elapsedHours);
      this.deps.store
        .stmt(
          'UPDATE bank_reserve SET cash_micros = ?, loaned_micros = ?, recovery_at = ? WHERE guild_id = ?',
        )
        .run(rec.cashMicros, rec.loanedMicros, nowMs, guildId);
      row = {
        ...row,
        cash_micros: rec.cashMicros,
        loaned_micros: rec.loanedMicros,
        recovery_at: nowMs,
      };
    }

    // 2. Thermostat exponential decay
    if (row.thermo_at <= 0) {
      this.deps.store
        .stmt('UPDATE bank_reserve SET thermo_at = ? WHERE guild_id = ?')
        .run(nowMs, guildId);
      row = { ...row, thermo_at: nowMs };
    } else if (nowMs > row.thermo_at) {
      const days = (nowMs - row.thermo_at) / MS_PER_DAY;
      const decayed = decayThermostat(
        { loadMicros: row.thermo_load_micros, capacityMicros: row.thermo_cap_micros },
        days,
      );
      this.deps.store
        .stmt(
          'UPDATE bank_reserve SET thermo_load_micros = ?, thermo_cap_micros = ?, thermo_at = ? WHERE guild_id = ?',
        )
        .run(decayed.loadMicros, decayed.capacityMicros, nowMs, guildId);
      row = {
        ...row,
        thermo_load_micros: decayed.loadMicros,
        thermo_cap_micros: decayed.capacityMicros,
        thermo_at: nowMs,
      };
    }

    return row;
  }

  getTotalDeposits(guildId: string): number {
    const row = this.deps.store
      .stmt('SELECT COALESCE(SUM(amount), 0) AS total FROM bank_deposits WHERE guild_id = ?')
      .get(guildId) as { total: number };
    return row?.total ?? 0;
  }

  getTotalDebt(guildId: string): number {
    const row = this.deps.store
      .stmt('SELECT COALESCE(SUM(debt), 0) AS total FROM bank_accounts WHERE guild_id = ?')
      .get(guildId) as { total: number };
    return row?.total ?? 0;
  }

  getGraceDebtorCount(guildId: string): number {
    const row = this.deps.store
      .stmt(
        'SELECT COUNT(*) AS cnt FROM bank_accounts WHERE guild_id = ? AND grace_until IS NOT NULL',
      )
      .get(guildId) as { cnt: number };
    return row?.cnt ?? 0;
  }

  getGraceCdsLocks(guildId: string): number {
    const graceRows = this.deps.store
      .stmt(
        'SELECT user_id, debt FROM bank_accounts WHERE guild_id = ? AND grace_until IS NOT NULL AND debt > 0',
      )
      .all(guildId) as { user_id: string; debt: number }[];

    let locks = 0;
    for (const g of graceRows) {
      const cdsRows = this.deps.store
        .stmt(
          `SELECT stake, odds_tenths FROM cds
           WHERE guild_id = ? AND target_id = ? AND buyer_id != target_id AND status = 'open'`,
        )
        .all(guildId, g.user_id) as { stake: number; odds_tenths: number }[];
      const rawClaims = cdsRows.reduce(
        (sum, c) => sum + cdsExpectedPayout(c.stake, c.odds_tenths),
        0,
      );
      const cap = Math.floor((g.debt * TEIAI_CONSTANTS.cdsPayoutCapRateBps) / 10_000);
      locks += Math.min(rawClaims, cap);
    }
    return locks;
  }

  getBankStatus(guildId: string, nowMs = this.deps.clock.now()): BankStatusView {
    return this.deps.store.transaction(() => {
      const row = this.syncReserveInTx(guildId, nowMs);
      const deposits = this.getTotalDeposits(guildId);
      const bonds = this.hooks.getActiveBondPrincipal?.(guildId) ?? 0;
      const totalDebt = this.getTotalDebt(guildId);
      const graceLocks = this.getGraceCdsLocks(guildId);
      const metrics = computeBankMetrics({
        cashMicros: row.cash_micros,
        totalDeposits: deposits,
        totalActiveBonds: bonds,
        totalDebt,
        graceCdsLocks: graceLocks,
      });

      const riskFree = nanoToRate(row.risk_free_nano);
      const trustPremium = nanoToRate(row.trust_premium_nano);
      const target = rfTarget(metrics.ratio);
      const roomMicros = thermostatRoomMicros({
        loadMicros: row.thermo_load_micros,
        capacityMicros: row.thermo_cap_micros,
      });

      return {
        cash: row.cash_micros / PRICE_SCALE,
        loaned: row.loaned_micros / PRICE_SCALE,
        locks: metrics.locksMicros / PRICE_SCALE,
        available: metrics.availableMicros / PRICE_SCALE,
        deposits,
        bonds,
        ratio: metrics.ratio,
        level: metrics.level,
        riskFree,
        rfTarget: target,
        trustRate: riskFree + trustPremium,
        trustPremium,
        trustPaid: row.trust_paid_micros / PRICE_SCALE,
        excessUnpaid: row.excess_unpaid_micros / PRICE_SCALE,
        thermostat: {
          load: row.thermo_load_micros / PRICE_SCALE,
          capacity: row.thermo_cap_micros / PRICE_SCALE,
          room: roomMicros / PRICE_SCALE,
          burned: row.thermo_burned_micros / PRICE_SCALE,
          bailed: row.thermo_bailed_micros / PRICE_SCALE,
          enforce: row.thermo_enforce === 1,
        },
      };
    });
  }

  getRiskFreeRate(guildId: string, nowMs = this.deps.clock.now()): number {
    const row = this.ensureReserve(guildId, nowMs);
    return nanoToRate(row.risk_free_nano);
  }

  setTrustPremiumNano(guildId: string, premiumNano: number, nowMs = this.deps.clock.now()): void {
    this.deps.store.transaction(() => {
      this.ensureReserve(guildId, nowMs);
      this.deps.store
        .stmt('UPDATE bank_reserve SET trust_premium_nano = ? WHERE guild_id = ?')
        .run(premiumNano, guildId);
    });
  }

  /** Advance CIR risk-free rate `r_f` for `guildId`. */
  tickRiskFreeRate(guildId: string, nowMs = this.deps.clock.now(), z?: number): number {
    return this.deps.store.transaction(() => {
      const row = this.syncReserveInTx(guildId, nowMs);
      if (row.risk_free_at <= 0) {
        this.deps.store
          .stmt('UPDATE bank_reserve SET risk_free_at = ? WHERE guild_id = ?')
          .run(nowMs, guildId);
        return nanoToRate(row.risk_free_nano);
      }
      const days = Math.max(0, (nowMs - row.risk_free_at) / MS_PER_DAY);
      if (days <= 0) return nanoToRate(row.risk_free_nano);

      const status = this.getBankStatus(guildId, nowMs);
      const draw = z ?? standardNormal(this.deps.rng);
      const nextRf = rfStep(nanoToRate(row.risk_free_nano), status.ratio, days, draw);
      this.deps.store
        .stmt('UPDATE bank_reserve SET risk_free_nano = ?, risk_free_at = ? WHERE guild_id = ?')
        .run(rateToNano(nextRf), nowMs, guildId);
      return nextRf;
    });
  }

  /** Credit Teiai Bank reserves (fees, CDS stakes, option premiums, kyosai auction proceeds, etc.). */
  bankIncome(
    guildId: string,
    amountPelica: number,
    options: { readonly thermo?: boolean; readonly nowMs?: number } = {},
  ): void {
    if (amountPelica <= 0) return;
    const nowMs = options.nowMs ?? this.deps.clock.now();
    const useThermo = options.thermo ?? true;

    this.deps.store.transaction(() => {
      const row = this.syncReserveInTx(guildId, nowMs);
      let cashAddMicros = amountPelica * PRICE_SCALE;
      let nextLoad = row.thermo_load_micros;
      let nextCap = row.thermo_cap_micros;
      let nextBurned = row.thermo_burned_micros;

      if (useThermo) {
        const res = absorbInflow(
          { loadMicros: row.thermo_load_micros, capacityMicros: row.thermo_cap_micros },
          cashAddMicros,
        );
        nextLoad = res.state.loadMicros;
        nextCap = res.state.capacityMicros;
        nextBurned += res.absorbedMicros;
        if (row.thermo_enforce === 1) {
          cashAddMicros = res.netMicros;
        }
      }

      this.deps.store
        .stmt(
          `UPDATE bank_reserve
           SET cash_micros = cash_micros + ?, thermo_load_micros = ?, thermo_cap_micros = ?,
               thermo_burned_micros = ?, thermo_at = ?
           WHERE guild_id = ?`,
        )
        .run(cashAddMicros, nextLoad, nextCap, nextBurned, nowMs, guildId);
    });
  }

  /**
   * Bank payment waterfall (`_outflow_for`):
   * 1. Bank `cash`
   * 2. Teiai Trust Haircut (`useTrust = true`)
   * 3. Thermostat bailout (when `enforce = true`) + Kyosai excess-loss charge
   */
  bankOutflow(
    guildId: string,
    amountPelica: number,
    options: {
      readonly useTrust?: boolean;
      readonly thermo?: boolean;
      readonly nowMs?: number;
    } = {},
  ): void {
    if (amountPelica <= 0) return;
    const nowMs = options.nowMs ?? this.deps.clock.now();
    const useTrust = options.useTrust ?? true;
    const useThermo = options.thermo ?? true;

    this.deps.store.transaction(() => {
      const row = this.syncReserveInTx(guildId, nowMs);
      const amountMicros = amountPelica * PRICE_SCALE;
      const availCash = Math.max(0, row.cash_micros);
      const cashPayMicros = Math.min(amountMicros, availCash);
      const nextCashMicros = row.cash_micros - cashPayMicros;
      const shortfallMicros = amountMicros - cashPayMicros;

      let trustTakePelica = 0;
      if (shortfallMicros > 0 && useTrust) {
        const totalDeposits = this.getTotalDeposits(guildId);
        if (totalDeposits > 0) {
          const shortfallPelica = Math.ceil(shortfallMicros / PRICE_SCALE - 1e-9);
          trustTakePelica = Math.min(shortfallPelica, totalDeposits);
          if (trustTakePelica > 0) {
            const keepRatio = 1 - trustTakePelica / totalDeposits;
            const depositors = this.deps.store
              .stmt('SELECT user_id, amount FROM bank_deposits WHERE guild_id = ? AND amount > 0')
              .all(guildId) as { user_id: string; amount: number }[];
            for (const dep of depositors) {
              const nextAmt = truncInt(dep.amount * keepRatio);
              this.deps.store
                .stmt(
                  'UPDATE bank_deposits SET amount = ?, updated_at = ? WHERE guild_id = ? AND user_id = ?',
                )
                .run(nextAmt, nowMs, guildId, dep.user_id);
            }
          }
        }
      }

      const excessMicros = Math.max(0, shortfallMicros - trustTakePelica * PRICE_SCALE);
      let nextLoad = row.thermo_load_micros;
      let nextCap = row.thermo_cap_micros;
      let nextBailed = row.thermo_bailed_micros;
      let coverMicros = 0;

      if (excessMicros > 0 && useThermo) {
        const res = absorbShock(
          { loadMicros: row.thermo_load_micros, capacityMicros: row.thermo_cap_micros },
          excessMicros,
        );
        nextLoad = res.state.loadMicros;
        nextCap = res.state.capacityMicros;
        nextBailed += res.absorbedMicros;
        if (row.thermo_enforce === 1) {
          coverMicros = res.absorbedMicros;
        }
      }

      const leftPelica = truncInt(Math.max(0, excessMicros - coverMicros) / PRICE_SCALE);
      let unpaidHouseMicros = 0;
      if (leftPelica > 0) {
        if (this.hooks.chargeKyosaiExcess) {
          const unpaidHouse = this.hooks.chargeKyosaiExcess(guildId, leftPelica, nowMs);
          unpaidHouseMicros = Math.max(0, unpaidHouse) * PRICE_SCALE;
        } else {
          unpaidHouseMicros = leftPelica * PRICE_SCALE;
        }
      }

      this.deps.store
        .stmt(
          `UPDATE bank_reserve
           SET cash_micros = ?, thermo_load_micros = ?, thermo_cap_micros = ?,
               thermo_bailed_micros = ?, excess_unpaid_micros = excess_unpaid_micros + ?, thermo_at = ?
           WHERE guild_id = ?`,
        )
        .run(nextCashMicros, nextLoad, nextCap, nextBailed, unpaidHouseMicros, nowMs, guildId);
    });
  }

  // -------------------------------------------------------------------------
  // Teiai Trust Deposits & Hourly Interest
  // -------------------------------------------------------------------------

  getDeposit(guildId: string, userId: string): number {
    const row = this.deps.store
      .stmt('SELECT amount FROM bank_deposits WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId) as { amount: number } | undefined;
    return row?.amount ?? 0;
  }

  bankDeposit(
    guildId: string,
    userId: string,
    amount: number,
    nowMs = this.deps.clock.now(),
    idempotencyKey?: string,
  ): ServiceResult<number> {
    if (!Number.isInteger(amount) || amount < TEIAI_CONSTANTS.bankMinDeposit) {
      return { ok: false, reason: 'bank_min_deposit' };
    }
    return this.deps.store.transaction(() => {
      const status = this.getStatus(guildId, userId);
      if (status !== 'katagi') {
        return { ok: false, reason: 'bank_debtor_blocked' };
      }
      const bal = this.deps.economy.getBalance(guildId, userId);
      if (bal < amount) {
        return { ok: false, reason: 'insufficient_funds' };
      }

      this.syncReserveInTx(guildId, nowMs);
      this.deps.economy.debit({
        guildId,
        userId,
        amount,
        reason: 'bank_deposit',
        refType: 'teiai_trust',
        idempotencyKey,
      });

      this.deps.store
        .stmt(
          `INSERT INTO bank_deposits (guild_id, user_id, amount, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (guild_id, user_id) DO UPDATE SET
             amount = amount + excluded.amount,
             updated_at = excluded.updated_at`,
        )
        .run(guildId, userId, amount, nowMs);

      const split = splitBankDeposit(amount);
      this.deps.store
        .stmt(
          `UPDATE bank_reserve
           SET cash_micros = cash_micros + ?, loaned_micros = loaned_micros + ?
           WHERE guild_id = ?`,
        )
        .run(split.cashDeltaMicros, split.loanedDeltaMicros, guildId);

      return { ok: true, data: amount };
    });
  }

  bankWithdraw(
    guildId: string,
    userId: string,
    amount: number,
    nowMs = this.deps.clock.now(),
    idempotencyKey?: string,
  ): ServiceResult<number> {
    if (!Number.isInteger(amount) || amount <= 0) {
      return { ok: false, reason: 'invalid_amount' };
    }
    return this.deps.store.transaction(() => {
      const deposited = this.getDeposit(guildId, userId);
      if (deposited < amount) {
        return { ok: false, reason: 'bank_insufficient_deposit' };
      }
      const status = this.getBankStatus(guildId, nowMs);
      const maxWithdraw = Math.max(0, truncInt(status.available));
      if (maxWithdraw < amount) {
        return { ok: false, reason: 'bank_frozen_or_illiquid' };
      }

      this.deps.store
        .stmt(
          'UPDATE bank_deposits SET amount = amount - ?, updated_at = ? WHERE guild_id = ? AND user_id = ?',
        )
        .run(amount, nowMs, guildId, userId);
      this.deps.store
        .stmt('UPDATE bank_reserve SET cash_micros = cash_micros - ? WHERE guild_id = ?')
        .run(amount * PRICE_SCALE, guildId);

      this.deps.economy.credit({
        guildId,
        userId,
        amount,
        reason: 'bank_withdraw',
        refType: 'teiai_trust',
        idempotencyKey,
      });

      return { ok: true, data: amount };
    });
  }

  /**
   * Accrue & distribute hourly Teiai Trust interest.
   * First call initializes `trust_at = nowMs` and returns `0` (matches legacy fixture).
   */
  accrueTrustInterest(guildId: string, nowMs = this.deps.clock.now()): number {
    return this.deps.store.transaction(() => {
      const row = this.syncReserveInTx(guildId, nowMs);
      if (row.trust_at <= 0) {
        this.deps.store
          .stmt('UPDATE bank_reserve SET trust_at = ? WHERE guild_id = ?')
          .run(nowMs, guildId);
        return 0;
      }
      const elapsedHours = (nowMs - row.trust_at) / MS_PER_HOUR;
      if (elapsedHours < 1) return 0;

      const totalDeposits = this.getTotalDeposits(guildId);
      if (totalDeposits <= 0) {
        this.deps.store
          .stmt('UPDATE bank_reserve SET trust_at = ? WHERE guild_id = ?')
          .run(nowMs, guildId);
        return 0;
      }

      const calc = computeTrustInterestDue({
        totalDeposits,
        rfNano: row.risk_free_nano,
        trustPremiumNano: row.trust_premium_nano,
        elapsedHours,
        accruedCarryMicros: row.trust_accrued_micros,
      });

      let distributed = 0;
      if (calc.payablePelica > 0) {
        // Paid from cash -> thermostat/kyosai (NEVER haircuts trust to pay trust)
        this.bankOutflow(guildId, calc.payablePelica, { useTrust: false, thermo: true, nowMs });

        const depositors = this.deps.store
          .stmt('SELECT user_id, amount FROM bank_deposits WHERE guild_id = ? AND amount > 0')
          .all(guildId) as { user_id: string; amount: number }[];
        for (const dep of depositors) {
          const share = Math.floor((calc.payablePelica * dep.amount) / totalDeposits);
          if (share > 0) {
            this.creditWithWithholding(guildId, dep.user_id, share, 'bank_interest', {
              refType: 'teiai_trust',
              nowMs,
            });
            distributed += share;
          }
        }
        const dust = calc.payablePelica - distributed;
        if (dust > 0) {
          this.deps.store
            .stmt('UPDATE bank_reserve SET cash_micros = cash_micros + ? WHERE guild_id = ?')
            .run(dust * PRICE_SCALE, guildId);
        }
        const nextCarryMicros = calc.nextCarryMicros + dust * PRICE_SCALE;
        this.deps.store
          .stmt(
            `UPDATE bank_reserve
             SET trust_at = ?, trust_accrued_micros = ?, trust_paid_micros = trust_paid_micros + ?
             WHERE guild_id = ?`,
          )
          .run(nowMs, nextCarryMicros, distributed * PRICE_SCALE, guildId);
      } else {
        this.deps.store
          .stmt('UPDATE bank_reserve SET trust_at = ?, trust_accrued_micros = ? WHERE guild_id = ?')
          .run(nowMs, calc.nextCarryMicros, guildId);
      }

      return distributed;
    });
  }

  // -------------------------------------------------------------------------
  // Teiai House Account (separate from Bank Reserve; funds company buyouts)
  // -------------------------------------------------------------------------

  private ensureHouseInTx(
    guildId: string,
    nowMs: number,
  ): {
    balance: number;
    skimmed: number;
    grant_day: string;
    grant_used: number;
  } {
    const existing = this.deps.store
      .stmt('SELECT balance, skimmed, grant_day, grant_used FROM house_account WHERE guild_id = ?')
      .get(guildId) as
      { balance: number; skimmed: number; grant_day: string; grant_used: number } | undefined;
    const today = localDateString(nowMs, this.utcOffsetHours());
    if (!existing) {
      this.deps.store
        .stmt(
          'INSERT INTO house_account (guild_id, balance, skimmed, grant_day, grant_used, updated_at) VALUES (?, 0, 0, ?, 0, ?)',
        )
        .run(guildId, today, nowMs);
      return { balance: 0, skimmed: 0, grant_day: today, grant_used: 0 };
    }
    if (existing.grant_day !== today) {
      this.deps.store
        .stmt(
          'UPDATE house_account SET grant_day = ?, grant_used = 0, updated_at = ? WHERE guild_id = ?',
        )
        .run(today, nowMs, guildId);
      return { ...existing, grant_day: today, grant_used: 0 };
    }
    return existing;
  }

  /** Credit Teiai House Account (e.g. company founding/upgrade/upkeep fees or skims). */
  houseReceive(
    guildId: string,
    amount: number,
    options: { readonly isSkim?: boolean; readonly nowMs?: number } = {},
  ): void {
    if (amount <= 0) return;
    const nowMs = options.nowMs ?? this.deps.clock.now();
    this.deps.store.transaction(() => {
      this.ensureHouseInTx(guildId, nowMs);
      this.deps.store
        .stmt(
          `UPDATE house_account
           SET balance = balance + ?, skimmed = skimmed + ?, updated_at = ?
           WHERE guild_id = ?`,
        )
        .run(amount, options.isSkim ? amount : 0, nowMs, guildId);
    });
  }

  /** Available server buyout budget for companies: `house.balance + max(0, 30_000 - grant_used)`. */
  getCompanyBuyoutBudget(guildId: string, nowMs = this.deps.clock.now()): number {
    return this.deps.store.transaction(() => {
      const h = this.ensureHouseInTx(guildId, nowMs);
      const grantLeft = Math.max(0, COMPANY_CONSTANTS.dailyGrant - h.grant_used);
      return h.balance + grantLeft;
    });
  }

  /** Spend from Teiai House Account first, then daily `30,000` grant. Returns actual amount funded. */
  housePayCompanyBuyout(guildId: string, amount: number, nowMs = this.deps.clock.now()): number {
    if (amount <= 0) return 0;
    return this.deps.store.transaction(() => {
      const h = this.ensureHouseInTx(guildId, nowMs);
      const fromHouse = Math.min(h.balance, amount);
      const rem = amount - fromHouse;
      const grantLeft = Math.max(0, COMPANY_CONSTANTS.dailyGrant - h.grant_used);
      const fromGrant = Math.min(grantLeft, rem);
      const paid = fromHouse + fromGrant;
      if (paid > 0) {
        this.deps.store
          .stmt(
            `UPDATE house_account
             SET balance = balance - ?, grant_used = grant_used + ?, updated_at = ?
             WHERE guild_id = ?`,
          )
          .run(fromHouse, fromGrant, nowMs, guildId);
      }
      return paid;
    });
  }

  // -------------------------------------------------------------------------
  // Toichi Debt, Interest, Withholding, Grace, Forced Execution, Escape, Bankruptcy
  // -------------------------------------------------------------------------

  ensureAccount(guildId: string, userId: string): BankAccountRow {
    const existing = this.deps.store
      .stmt('SELECT * FROM bank_accounts WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId) as BankAccountRow | undefined;
    if (existing) return existing;
    this.deps.store
      .stmt('INSERT INTO bank_accounts (guild_id, user_id) VALUES (?, ?)')
      .run(guildId, userId);
    return this.deps.store
      .stmt('SELECT * FROM bank_accounts WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId) as BankAccountRow;
  }

  getDebt(guildId: string, userId: string): number {
    return this.ensureAccount(guildId, userId).debt;
  }

  isInGrace(guildId: string, userId: string): boolean {
    return this.ensureAccount(guildId, userId).grace_until !== null;
  }

  isBlacklistedFromP2pLoans(
    guildId: string,
    userId: string,
    nowMs = this.deps.clock.now(),
  ): boolean {
    const acc = this.ensureAccount(guildId, userId);
    return acc.blacklist_until !== null && acc.blacklist_until > nowMs;
  }

  getStatus(guildId: string, userId: string): PlayerDebtStatus {
    const acc = this.ensureAccount(guildId, userId);
    const hasOverdue = this.hooks.hasOverdueLoan?.(guildId, userId) ?? false;
    return resolvePlayerStatus({
      debt: acc.debt,
      bankruptAtMs: acc.bankrupt_at,
      hasOverdueLoan: hasOverdue,
    });
  }

  /**
   * Synchronize grace timer and bankruptcy-exit blacklist after any debt change.
   * Publishes `BankruptcyGraceStarted` after commit when crossing `debt >= 15,000`.
   */
  private afterDebtChangeInTx(guildId: string, userId: string, nowMs: number): void {
    const acc = this.ensureAccount(guildId, userId);
    const grace = evaluateGraceTransition(acc.debt, acc.grace_until, nowMs);

    let nextBankruptAt = acc.bankrupt_at;
    let nextBlacklistUntil = acc.blacklist_until;
    let nextInterestAt = acc.debt_interest_at;

    if (acc.debt <= 0) {
      nextInterestAt = 0;
      if (acc.bankrupt_at !== null) {
        // Exiting bankrupt status starts 7-day P2P loan borrowing blacklist
        nextBankruptAt = null;
        nextBlacklistUntil = nowMs + TEIAI_CONSTANTS.blacklistDays * MS_PER_DAY;
      }
    } else if (acc.debt_interest_at <= 0) {
      nextInterestAt = nowMs;
    }

    this.deps.store
      .stmt(
        `UPDATE bank_accounts
         SET grace_until = ?, bankrupt_at = ?, blacklist_until = ?, debt_interest_at = ?
         WHERE guild_id = ? AND user_id = ?`,
      )
      .run(
        grace.nextGraceUntilMs,
        nextBankruptAt,
        nextBlacklistUntil,
        nextInterestAt,
        guildId,
        userId,
      );

    if (grace.enteredGrace && grace.nextGraceUntilMs !== null) {
      // Pull back open bids/listings on entering grace
      this.hooks.onGraceOrBankruptcyPullBack?.(guildId, userId, nowMs);
      const bus = this.deps.bus;
      const graceEndsAt = grace.nextGraceUntilMs;
      const debtNow = acc.debt;
      if (bus) {
        this.deps.store.afterCommit(() => {
          bus.publishDomain({
            type: 'BankruptcyGraceStarted',
            guildId,
            at: nowMs,
            userId,
            debt: debtNow,
            graceEndsAt,
          });
        });
      }
    }
  }

  /** Accrue Toichi 1%/day simple interest for a user (capped at 10 days & 14,999 ceiling). */
  accrueDebtInterest(guildId: string, userId: string, nowMs = this.deps.clock.now()): number {
    return this.deps.store.transaction(() => {
      const acc = this.ensureAccount(guildId, userId);
      const res = accrueDebtInterest(acc.debt, acc.debt_interest_at, nowMs);
      if (res.added > 0 || res.nextInterestAtMs !== acc.debt_interest_at) {
        this.deps.store
          .stmt(
            'UPDATE bank_accounts SET debt = ?, debt_interest_at = ? WHERE guild_id = ? AND user_id = ?',
          )
          .run(res.nextDebt, res.nextInterestAtMs, guildId, userId);
      }
      return res.added;
    });
  }

  /** Manual seed loan (`/ペリカ 帝愛`): lends `3,000 - balance`, blocked if bankrupt/in-grace/bal>=3000. */
  borrowSeed(
    guildId: string,
    userId: string,
    nowMs = this.deps.clock.now(),
    idempotencyKey?: string,
  ): ServiceResult<number> {
    return this.deps.store.transaction(() => {
      const acc = this.ensureAccount(guildId, userId);
      const bal = this.deps.economy.getBalance(guildId, userId);
      const quote = manualSeedLoanQuote({
        balance: bal,
        status: this.getStatus(guildId, userId),
        inGrace: acc.grace_until !== null,
      });
      if (!quote.ok) return quote;

      this.deps.economy.credit({
        guildId,
        userId,
        amount: quote.amount,
        reason: 'loan_borrow',
        refType: 'teiai_seed',
        idempotencyKey,
      });
      this.deps.store
        .stmt('UPDATE bank_accounts SET debt = debt + ? WHERE guild_id = ? AND user_id = ?')
        .run(quote.amount, guildId, userId);
      this.afterDebtChangeInTx(guildId, userId, nowMs);
      return { ok: true, data: quote.amount };
    });
  }

  /** Auto-seed on daily claim top-up (`3,000 - balance` when `debt > 0 && balance < 3,000`). */
  topupSeedIfNeeded(guildId: string, userId: string, nowMs = this.deps.clock.now()): number {
    return this.deps.store.transaction(() => {
      const acc = this.ensureAccount(guildId, userId);
      const bal = this.deps.economy.getBalance(guildId, userId);
      const seed = dailyTopupSeed(bal, acc.debt);
      if (seed <= 0) return 0;
      this.deps.economy.credit({
        guildId,
        userId,
        amount: seed,
        reason: 'loan_borrow',
        refType: 'teiai_seed_topup',
      });
      this.deps.store
        .stmt('UPDATE bank_accounts SET debt = debt + ? WHERE guild_id = ? AND user_id = ?')
        .run(seed, guildId, userId);
      this.afterDebtChangeInTx(guildId, userId, nowMs);
      return seed;
    });
  }

  /** Direct debt increase from Kyosai excess-loss shortfall (bypasses forced execution). */
  addDebtFromExcess(
    guildId: string,
    userId: string,
    amount: number,
    nowMs = this.deps.clock.now(),
  ): void {
    if (amount <= 0) return;
    this.deps.store.transaction(() => {
      this.ensureAccount(guildId, userId);
      this.deps.store
        .stmt('UPDATE bank_accounts SET debt = debt + ? WHERE guild_id = ? AND user_id = ?')
        .run(amount, guildId, userId);
      this.afterDebtChangeInTx(guildId, userId, nowMs);
    });
  }

  /**
   * Owner tool (`/admin set-balance` with a negative amount): overwrite the member's Teiai debt.
   * Not a ledger movement; the cash side is posted by the caller.
   */
  adminSetDebt(guildId: string, userId: string, debt: number, nowMs = this.deps.clock.now()): void {
    if (!Number.isInteger(debt) || debt < 0) return;
    this.deps.store.transaction(() => {
      this.ensureAccount(guildId, userId);
      this.deps.store
        .stmt('UPDATE bank_accounts SET debt = ? WHERE guild_id = ? AND user_id = ?')
        .run(debt, guildId, userId);
      this.afterDebtChangeInTx(guildId, userId, nowMs);
    });
  }

  /** Voluntary repayment (`/ペリカ 返済`). */
  repayDebt(
    guildId: string,
    userId: string,
    amount?: number,
    nowMs = this.deps.clock.now(),
    idempotencyKey?: string,
  ): ServiceResult<{ readonly paid: number; readonly remainingDebt: number }> {
    return this.deps.store.transaction(() => {
      const acc = this.ensureAccount(guildId, userId);
      if (acc.debt <= 0) return { ok: false, reason: 'no_debt' };
      const bal = this.deps.economy.getBalance(guildId, userId);
      if (bal <= 0) return { ok: false, reason: 'insufficient_funds' };
      const pay = amount === undefined ? Math.min(acc.debt, bal) : Math.min(amount, acc.debt, bal);
      if (pay <= 0) return { ok: false, reason: 'invalid_amount' };

      this.deps.economy.debit({
        guildId,
        userId,
        amount: pay,
        reason: 'loan_repay',
        refType: 'teiai_debt',
        idempotencyKey,
      });
      this.deps.store
        .stmt('UPDATE bank_accounts SET debt = debt - ? WHERE guild_id = ? AND user_id = ?')
        .run(pay, guildId, userId);
      this.afterDebtChangeInTx(guildId, userId, nowMs);
      const nextDebt = this.getDebt(guildId, userId);
      return { ok: true, data: { paid: pay, remainingDebt: nextDebt } };
    });
  }

  /**
   * Credit eligible income to a player and automatically apply 30% withholding:
   * senior Teiai debt first (`debt_withholding`), remaining budget to overdue P2P loans oldest-first.
   */
  creditWithWithholding(
    guildId: string,
    userId: string,
    grossAmount: number,
    reason: LedgerReason,
    options: {
      readonly refType?: string;
      readonly refId?: string;
      readonly idempotencyKey?: string;
      readonly nowMs?: number;
    } = {},
  ): { readonly credited: number; readonly teiaiWithheld: number; readonly p2pGarnished: number } {
    if (grossAmount <= 0) {
      return { credited: 0, teiaiWithheld: 0, p2pGarnished: 0 };
    }
    const nowMs = options.nowMs ?? this.deps.clock.now();
    return this.deps.store.transaction(() => {
      this.deps.economy.credit({
        guildId,
        userId,
        amount: grossAmount,
        reason,
        refType: options.refType,
        refId: options.refId,
        idempotencyKey: options.idempotencyKey,
      });

      const budget = debtWithhold(grossAmount);
      if (budget <= 0) {
        return { credited: grossAmount, teiaiWithheld: 0, p2pGarnished: 0 };
      }

      const acc = this.ensureAccount(guildId, userId);
      let remainingBudget = budget;
      let teiaiWithheld = 0;

      if (acc.debt > 0) {
        const bal = this.deps.economy.getBalance(guildId, userId);
        teiaiWithheld = Math.min(remainingBudget, acc.debt, bal);
        if (teiaiWithheld > 0) {
          this.deps.economy.debit({
            guildId,
            userId,
            amount: teiaiWithheld,
            reason: 'debt_withholding',
            refType: 'teiai_debt',
          });
          this.deps.store
            .stmt('UPDATE bank_accounts SET debt = debt - ? WHERE guild_id = ? AND user_id = ?')
            .run(teiaiWithheld, guildId, userId);
          this.afterDebtChangeInTx(guildId, userId, nowMs);
          remainingBudget -= teiaiWithheld;
        }
      }

      let p2pGarnished = 0;
      if (remainingBudget > 0 && this.hooks.garnishOverdueLoans) {
        p2pGarnished = this.hooks.garnishOverdueLoans(guildId, userId, remainingBudget, nowMs);
      }

      return { credited: grossAmount, teiaiWithheld, p2pGarnished };
    });
  }

  /**
   * 9-step forced execution seizure (`owe_for`):
   * 1. Cash -> 2. Trust deposit -> 3. Company funds -> 4..7. Margin/Spot/Options/Normal bonds
   * -> 8. Self-CDS coverage -> 9. Remaining shortfall added to Toichi debt + auto-seed + grace check.
   */
  owe(
    guildId: string,
    userId: string,
    need: number,
    options: { readonly refType?: string; readonly nowMs?: number } = {},
  ): { readonly seized: number; readonly selfCdsCovered: number; readonly addedDebt: number } {
    if (need <= 0) return { seized: 0, selfCdsCovered: 0, addedDebt: 0 };
    const nowMs = options.nowMs ?? this.deps.clock.now();

    return this.deps.store.transaction(() => {
      let rem = need;
      let seized = 0;

      // Step 1: Cash
      const cash = this.deps.economy.getBalance(guildId, userId);
      const fromCash = Math.min(rem, cash);
      if (fromCash > 0) {
        this.deps.economy.debit({
          guildId,
          userId,
          amount: fromCash,
          reason: 'debt_seizure',
          refType: options.refType ?? 'forced_execution',
        });
        rem -= fromCash;
        seized += fromCash;
      }

      // Step 2: Teiai Trust deposit (ignores bank freeze/available cash limits)
      if (rem > 0) {
        const dep = this.getDeposit(guildId, userId);
        const fromTrust = Math.min(rem, dep);
        if (fromTrust > 0) {
          this.deps.store
            .stmt(
              'UPDATE bank_deposits SET amount = amount - ?, updated_at = ? WHERE guild_id = ? AND user_id = ?',
            )
            .run(fromTrust, nowMs, guildId, userId);
          rem -= fromTrust;
          seized += fromTrust;
        }
      }

      // Step 3: Company funds (leaves facility intact)
      if (rem > 0 && this.hooks.seizeCompanyFunds) {
        const fromCo = this.hooks.seizeCompanyFunds(guildId, userId, rem, nowMs);
        rem -= fromCo;
        seized += fromCo;
      }

      // Steps 4..7: Margin -> Spot -> Options -> Normal Bonds
      if (rem > 0 && this.hooks.seizeSecurities) {
        const fromSec = this.hooks.seizeSecurities(guildId, userId, rem, nowMs);
        rem -= fromSec;
        seized += fromSec;
      }

      // Step 8: Self-CDS coverage (oldest active self-CDS first, one-shot per contract)
      let selfCdsCovered = 0;
      if (rem > 0) {
        const selfContracts = this.deps.store
          .stmt(
            `SELECT id, stake, odds_tenths FROM cds
             WHERE guild_id = ? AND buyer_id = ? AND target_id = ? AND status = 'open'
             ORDER BY id ASC`,
          )
          .all(guildId, userId, userId) as { id: number; stake: number; odds_tenths: number }[];

        for (const c of selfContracts) {
          if (rem <= 0) break;
          const maxCover = cdsExpectedPayout(c.stake, c.odds_tenths);
          const cover = Math.min(rem, maxCover);
          if (cover > 0) {
            this.bankOutflow(guildId, cover, { useTrust: true, thermo: true, nowMs });
            this.deps.store
              .stmt("UPDATE cds SET status = 'paid', payout = ?, settled_at = ? WHERE id = ?")
              .run(cover, nowMs, c.id);
            rem -= cover;
            selfCdsCovered += cover;
          }
        }
      }

      // Step 9: Remaining shortfall becomes Toichi debt + auto-seed if cash == 0 + grace check
      const addedDebt = rem;
      if (addedDebt > 0) {
        this.ensureAccount(guildId, userId);
        this.deps.store
          .stmt('UPDATE bank_accounts SET debt = debt + ? WHERE guild_id = ? AND user_id = ?')
          .run(addedDebt, guildId, userId);

        const cashNow = this.deps.economy.getBalance(guildId, userId);
        const debtNow = this.getDebt(guildId, userId);
        const seed = autoSeedIfEmpty(cashNow, debtNow);
        if (seed > 0) {
          this.deps.economy.credit({
            guildId,
            userId,
            amount: seed,
            reason: 'loan_borrow',
            refType: 'teiai_auto_seed',
          });
          this.deps.store
            .stmt('UPDATE bank_accounts SET debt = debt + ? WHERE guild_id = ? AND user_id = ?')
            .run(seed, guildId, userId);
        }

        this.afterDebtChangeInTx(guildId, userId, nowMs);
      }

      return { seized, selfCdsCovered, addedDebt };
    });
  }

  /** Overseas escape attempt (`escape_attempt`). */
  escapeAttempt(
    guildId: string,
    userId: string,
    nowMs = this.deps.clock.now(),
    rng: Rng = this.deps.rng,
  ): ServiceResult<EscapeAttemptReport> {
    return this.deps.store.transaction(() => {
      const acc = this.ensureAccount(guildId, userId);
      const roll = rollEscapeAttempt(
        {
          debt: acc.debt,
          status: this.getStatus(guildId, userId),
          escapeTries: acc.escape_tries,
          lastEscapeAtMs: acc.last_escape_at,
          nowMs,
        },
        rng,
      );
      if (!roll.ok) return roll;

      if (roll.escaped) {
        this.deps.store
          .stmt(
            'UPDATE bank_accounts SET escape_tries = ?, last_escape_at = ? WHERE guild_id = ? AND user_id = ?',
          )
          .run(roll.nextTries, nowMs, guildId, userId);
        const bk = this.declareBankruptcy(guildId, userId, {
          forced: false,
          escape: true,
          nowMs,
        });
        return {
          ok: true,
          data: {
            escaped: true,
            fine: 0,
            debt: 0,
            bankrupt: bk.ok ? bk.data : null,
          },
        };
      }

      this.deps.store
        .stmt(
          'UPDATE bank_accounts SET debt = ?, escape_tries = ?, last_escape_at = ? WHERE guild_id = ? AND user_id = ?',
        )
        .run(roll.nextDebt, roll.nextTries, nowMs, guildId, userId);
      this.afterDebtChangeInTx(guildId, userId, nowMs);

      return {
        ok: true,
        data: {
          escaped: false,
          fine: roll.fine,
          debt: roll.nextDebt,
          bankrupt: null,
        },
      };
    });
  }

  /**
   * Execute full bankruptcy sequence (`bankrupt_for`): voluntary, forced (grace expiry), or escape.
   * Follows CODE behaviour: `cdsPayable = forced || inGrace` (escaping while in grace settles CDS).
   * Publishes `BankruptcyDeclared` after commit.
   */
  declareBankruptcy(
    guildId: string,
    userId: string,
    options: { readonly forced?: boolean; readonly escape?: boolean; readonly nowMs?: number } = {},
  ): ServiceResult<BankruptcyReport> {
    const forced = options.forced ?? false;
    const escape = options.escape ?? false;
    const nowMs = options.nowMs ?? this.deps.clock.now();

    return this.deps.store.transaction(() => {
      const acc = this.ensureAccount(guildId, userId);
      const status = this.getStatus(guildId, userId);
      const juniorLoans = this.hooks.listJuniorLoansForBankruptcy?.(guildId, userId, nowMs) ?? [];

      if (status === 'bankrupt') return { ok: false, reason: 'already_bankrupt' };
      if (acc.debt <= 0 && juniorLoans.length === 0) {
        return { ok: false, reason: 'no_debt_to_bankrupt' };
      }

      const debtBefore = acc.debt;
      const inGrace = acc.grace_until !== null;

      // 1. Prep hook: pull back active marketplace listings/bids + Kyosai auction bids
      this.hooks.onGraceOrBankruptcyPullBack?.(guildId, userId, nowMs);

      // 2. Liquidate assets into pool (securities, trust deposit, company, kyosai, external items/horses)
      let extraPool = 0;
      if (this.hooks.liquidateSecuritiesForBankruptcy) {
        extraPool += this.hooks.liquidateSecuritiesForBankruptcy(guildId, userId, nowMs);
      }

      const dep = this.getDeposit(guildId, userId);
      if (dep > 0) {
        this.deps.store
          .stmt(
            'UPDATE bank_deposits SET amount = 0, updated_at = ? WHERE guild_id = ? AND user_id = ?',
          )
          .run(nowMs, guildId, userId);
        this.deps.store
          .stmt('UPDATE bank_reserve SET cash_micros = cash_micros - ? WHERE guild_id = ?')
          .run(dep * PRICE_SCALE, guildId);
        extraPool += dep;
      }

      if (this.hooks.liquidateCompanyForBankruptcy) {
        extraPool += this.hooks.liquidateCompanyForBankruptcy(guildId, userId, nowMs);
      }

      this.hooks.recoverKyosaiOnBankruptcy?.(guildId, userId, nowMs);

      let shopValue = 0;
      if (this.hooks.liquidateExternalAssets) {
        const ext = this.hooks.liquidateExternalAssets(guildId, userId, nowMs);
        extraPool += ext.recovered;
        shopValue = ext.shopValue;
      }

      // 3. Cash + liquidated pool
      const cashBal = this.deps.economy.getBalance(guildId, userId);
      const totalPool = cashBal + extraPool;

      // 4. Waterfall distribution
      const wf = computeBankruptcyWaterfall({
        pool: totalPool,
        teiaiDebt: debtBefore,
        juniorLoans,
        forced,
        inGrace,
        escape,
      });

      // Debit only net cash consumed from wallet (`cashBal - surplusReturned`) so no custom
      // surplus ledger reason is needed, keeping wallet >= 0 and ledger signs exact.
      const cashSeizedNet = Math.max(0, cashBal - wf.surplusReturned);
      if (cashSeizedNet > 0) {
        this.deps.economy.debit({
          guildId,
          userId,
          amount: cashSeizedNet,
          reason: 'bankruptcy_writeoff',
          refType: 'bankruptcy',
        });
      } else if (wf.surplusReturned > cashBal) {
        // Extra pool from non-cash liquidations exceeded all debts; refund surplus via bank_withdraw
        this.deps.economy.credit({
          guildId,
          userId,
          amount: wf.surplusReturned - cashBal,
          reason: 'bank_withdraw',
          refType: 'bankruptcy_surplus',
        });
      }

      // Settle junior P2P loans
      if (this.hooks.applyJuniorLoanSettlements && wf.juniorSettlements.length > 0) {
        this.hooks.applyJuniorLoanSettlements(guildId, wf.juniorSettlements, nowMs);
      }

      // 5. Update debt, bankrupt_at, clear grace_until; grant seed loan if finalDebt > 0 and cash == 0
      const nextBlacklistUntil =
        escape || wf.finalDebt <= 0 ? nowMs + TEIAI_CONSTANTS.blacklistDays * MS_PER_DAY : null;
      const nextBankruptAt = escape || wf.finalDebt <= 0 ? null : nowMs;
      const nextInterestAt = wf.finalDebt > 0 ? nowMs : 0;

      this.deps.store
        .stmt(
          `UPDATE bank_accounts
           SET debt = ?, debt_interest_at = ?, bankrupt_at = ?, grace_until = NULL, blacklist_until = ?
           WHERE guild_id = ? AND user_id = ?`,
        )
        .run(wf.finalDebt, nextInterestAt, nextBankruptAt, nextBlacklistUntil, guildId, userId);

      if (wf.seedLoan > 0) {
        this.deps.economy.credit({
          guildId,
          userId,
          amount: wf.seedLoan,
          reason: 'loan_borrow',
          refType: 'bankruptcy_seed',
        });
      }

      // 6. Settle or void third-party CDS; always void remaining self-CDS
      this.deps.store
        .stmt(
          `UPDATE cds SET status = 'void', settled_at = ?
           WHERE guild_id = ? AND buyer_id = ? AND target_id = ? AND status = 'open'`,
        )
        .run(nowMs, guildId, userId, userId);

      let cdsPaid = 0;
      if (wf.cdsPayable) {
        cdsPaid = this.settleThirdPartyCdsInTx(guildId, userId, debtBefore, nowMs);
      } else {
        this.deps.store
          .stmt(
            `UPDATE cds SET status = 'void', settled_at = ?
             WHERE guild_id = ? AND target_id = ? AND status = 'open'`,
          )
          .run(nowMs, guildId, userId);
      }

      const bus = this.deps.bus;
      const cause: 'voluntary' | 'forced' | 'escape' = escape
        ? 'escape'
        : forced
          ? 'forced'
          : 'voluntary';
      if (bus) {
        this.deps.store.afterCommit(() => {
          bus.publishDomain({
            type: 'BankruptcyDeclared',
            guildId,
            at: nowMs,
            userId,
            cause,
            debtBefore,
            debtAfter: wf.finalDebt,
          });
        });
      }

      return {
        ok: true,
        data: {
          forced,
          escape,
          seized: totalPool,
          shopValue,
          seniorPaid: wf.seniorPaid,
          juniorPaid: wf.juniorPaid,
          forgiven: wf.forgiven,
          compressed: wf.compressed,
          seed: wf.seedLoan,
          debt: wf.finalDebt,
          cdsPaid,
        },
      };
    });
  }

  /** Expire overdue CDS contracts and force-bankrupt any users whose 24h grace period has elapsed. */
  settleExpiredGraceAndCds(
    guildId: string,
    nowMs = this.deps.clock.now(),
  ): {
    readonly expiredCds: number;
    readonly forcedBankruptcies: readonly {
      readonly userId: string;
      readonly report: BankruptcyReport;
    }[];
  } {
    return this.deps.store.transaction(() => {
      const expRes = this.deps.store
        .stmt(
          `UPDATE cds SET status = 'expired', settled_at = ?
           WHERE guild_id = ? AND status = 'open' AND expires_at <= ?`,
        )
        .run(nowMs, guildId, nowMs);

      const dueGrace = this.deps.store
        .stmt(
          `SELECT user_id FROM bank_accounts
           WHERE guild_id = ? AND grace_until IS NOT NULL AND grace_until <= ?`,
        )
        .all(guildId, nowMs) as { user_id: string }[];

      const forcedBankruptcies: { userId: string; report: BankruptcyReport }[] = [];
      for (const row of dueGrace) {
        const res = this.declareBankruptcy(guildId, row.user_id, { forced: true, nowMs });
        if (res.ok) {
          forcedBankruptcies.push({ userId: row.user_id, report: res.data });
        }
      }

      return { expiredCds: expRes.changes, forcedBankruptcies };
    });
  }

  // -------------------------------------------------------------------------
  // Credit Default Swaps (CDS)
  // -------------------------------------------------------------------------

  quoteCds(guildId: string, targetId: string): CdsQuote {
    const acc = this.ensureAccount(guildId, targetId);
    const status = this.getStatus(guildId, targetId);
    const marginRatio = this.hooks.getMarginRatio?.(guildId, targetId) ?? null;
    const oddsTenths = cdsOddsTenths(status, acc.debt, marginRatio);
    return {
      status,
      debt: acc.debt,
      grace: acc.grace_until !== null,
      oddsTenths,
      odds: oddsTenths / 10,
    };
  }

  buyCds(
    guildId: string,
    buyerId: string,
    targetId: string,
    stake: number,
    nowMs = this.deps.clock.now(),
    idempotencyKey?: string,
  ): ServiceResult<{
    readonly contractId: number;
    readonly odds: number;
    readonly oddsTenths: number;
  }> {
    if (!Number.isInteger(stake) || stake < TEIAI_CONSTANTS.cdsMinStake) {
      return { ok: false, reason: 'cds_min_stake' };
    }
    return this.deps.store.transaction(() => {
      if (!this.deps.economy.hasAccount(guildId, targetId)) {
        return { ok: false, reason: 'cds_target_unregistered' };
      }
      const quote = this.quoteCds(guildId, targetId);
      if (quote.status === 'bankrupt') return { ok: false, reason: 'cds_target_bankrupt' };
      if (quote.grace) return { ok: false, reason: 'cds_target_in_grace' };

      // Self-CDS aggregate expected payout cap (50,000)
      if (buyerId === targetId) {
        const existingSelf = this.deps.store
          .stmt(
            `SELECT stake, odds_tenths FROM cds
             WHERE guild_id = ? AND buyer_id = ? AND target_id = ? AND status = 'open'`,
          )
          .all(guildId, buyerId, targetId) as { stake: number; odds_tenths: number }[];
        const currentExpected = existingSelf.reduce(
          (s, c) => s + cdsExpectedPayout(c.stake, c.odds_tenths),
          0,
        );
        const newExpected = cdsExpectedPayout(stake, quote.oddsTenths);
        if (newExpected > cdsSelfCapRoom(currentExpected)) {
          return { ok: false, reason: 'cds_self_cap_exceeded' };
        }
      }

      if (this.deps.economy.getBalance(guildId, buyerId) < stake) {
        return { ok: false, reason: 'insufficient_funds' };
      }

      this.deps.economy.debit({
        guildId,
        userId: buyerId,
        amount: stake,
        reason: 'cds_premium',
        refType: 'cds',
        refId: targetId,
        idempotencyKey,
      });
      this.bankIncome(guildId, stake, { thermo: true, nowMs });

      const expiresAt = nowMs + TEIAI_CONSTANTS.cdsTermDays * MS_PER_DAY;
      const res = this.deps.store
        .stmt(
          `INSERT INTO cds (guild_id, buyer_id, target_id, stake, odds_tenths, status, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`,
        )
        .run(guildId, buyerId, targetId, stake, quote.oddsTenths, nowMs, expiresAt);

      return {
        ok: true,
        data: {
          contractId: Number(res.lastInsertRowid),
          odds: quote.odds,
          oddsTenths: quote.oddsTenths,
        },
      };
    });
  }

  private settleThirdPartyCdsInTx(
    guildId: string,
    targetId: string,
    debtBefore: number,
    nowMs: number,
  ): number {
    const contracts = this.deps.store
      .stmt(
        `SELECT id, buyer_id, stake, odds_tenths FROM cds
         WHERE guild_id = ? AND target_id = ? AND buyer_id != target_id AND status = 'open'
         ORDER BY id ASC`,
      )
      .all(guildId, targetId) as {
      id: number;
      buyer_id: string;
      stake: number;
      odds_tenths: number;
    }[];

    if (contracts.length === 0) return 0;

    const settled = settleCdsDefault(
      contracts.map((c) => ({
        id: c.id,
        buyerId: c.buyer_id,
        stake: c.stake,
        oddsTenths: c.odds_tenths,
      })),
      debtBefore,
    );

    if (settled.totalPaid > 0) {
      this.bankOutflow(guildId, settled.totalPaid, { useTrust: true, thermo: true, nowMs });
    }

    for (const p of settled.payouts) {
      this.deps.store
        .stmt("UPDATE cds SET status = 'paid', payout = ?, settled_at = ? WHERE id = ?")
        .run(p.payout, nowMs, p.contractId);
      if (p.payout > 0) {
        this.creditWithWithholding(guildId, p.buyerId, p.payout, 'cds_payout', {
          refType: 'cds',
          refId: String(p.contractId),
          nowMs,
        });
      }
    }

    return settled.totalPaid;
  }
}
