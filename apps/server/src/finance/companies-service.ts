import { PRICE_SCALE, QUANTITY_SCALE } from '@casino/shared';
import {
  applyDailyUpkeepStep,
  calendarDayDiff,
  COMPANY_CONSTANTS,
  companyChangeKindCost,
  companyDailyOutputMilli,
  companyDailyUpkeep,
  companyDayState,
  companyFoundingCost,
  companyInvested,
  companyStakeCap,
  companyStorageCapMilli,
  companyUpgradeCost,
  companyWithdrawable,
  computeCompanySale,
  computeDividendSplit,
  localDateString,
  produceCompanyStock,
  truncInt,
  validateCompanyName,
  type CompanyDayState,
  type CompanyKindKey,
} from '@casino/domain/finance';
import type { ServiceResult, TeiaiService } from './teiai-service.ts';
import type { FinanceDeps } from './types.ts';

export interface CompanyRow {
  guild_id: string;
  user_id: string;
  name: string;
  kind: CompanyKindKey;
  level: number;
  funds: number;
  stock_milli: number;
  stock_at: number;
  dividend_rate_bps: number;
  unpaid_days: number;
  upkeep_day: string;
  sold_total: number;
  created_at: number;
}

export interface CompanyStateView {
  readonly guildId: string;
  readonly userId: string;
  readonly name: string;
  readonly kind: CompanyKindKey;
  readonly level: number;
  readonly funds: number;
  readonly invested: number;
  readonly upgradeCost: number | null;
  readonly upkeep: number;
  readonly upkeepDay: string;
  readonly unpaidDays: number;
  readonly dailyOutput: number;
  readonly storageCap: number;
  readonly stock: number;
  readonly stockAtMs: number;
  readonly stockValue: number;
  readonly condition: string;
  readonly yieldMult: number;
  readonly price: number;
  readonly budget: number;
  readonly dividendRate: number;
  readonly stakeCap: number;
  readonly stakesTotal: number;
  readonly investors: number;
  readonly withdrawable: number;
  readonly soldTotal: number;
  readonly createdAtMs: number;
}

export interface ShipReport {
  readonly paid: number;
  readonly pinhane: number;
  readonly dividends: number;
  readonly price: number;
  readonly leftStock: number;
}

export interface CompanyBankruptcyNotice {
  readonly guildId: string;
  readonly ownerId: string;
  readonly companyName: string;
  readonly investorIds: readonly string[];
}

export type DayStateResolver = (
  kind: CompanyKindKey,
  guildId: string,
  dayStr: string,
) => CompanyDayState;

export class CompaniesService {
  private readonly deps: FinanceDeps;
  private readonly teiai: TeiaiService;
  private readonly resolveDayState: DayStateResolver;

  constructor(
    deps: FinanceDeps,
    teiai: TeiaiService,
    options: { readonly resolveDayState?: DayStateResolver } = {},
  ) {
    this.deps = deps;
    this.teiai = teiai;
    this.resolveDayState = options.resolveDayState ?? companyDayState;
  }

  private utcOffsetHours(): number {
    return this.deps.utcOffsetHours ?? 9;
  }

  private getRow(guildId: string, userId: string): CompanyRow | null {
    const row = this.deps.store
      .stmt('SELECT * FROM companies WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId) as CompanyRow | undefined;
    return row ?? null;
  }

  private getStakesMap(guildId: string, ownerId: string): Record<string, number> {
    const rows = this.deps.store
      .stmt('SELECT investor_id, amount FROM company_stakes WHERE guild_id = ? AND owner_id = ?')
      .all(guildId, ownerId) as { investor_id: string; amount: number }[];
    const out: Record<string, number> = {};
    for (const r of rows) out[r.investor_id] = r.amount;
    return out;
  }

  private syncStockInTx(row: CompanyRow, nowMs: number): CompanyRow {
    if (nowMs <= row.stock_at) return row;
    const nextStockMilli = produceCompanyStock({
      kind: row.kind,
      level: row.level,
      guildId: row.guild_id,
      currentStockMilli: row.stock_milli,
      fromMs: row.stock_at,
      toMs: nowMs,
      utcOffsetHours: this.utcOffsetHours(),
      resolveDayState: this.resolveDayState,
    });
    this.deps.store
      .stmt(
        'UPDATE companies SET stock_milli = ?, stock_at = ? WHERE guild_id = ? AND user_id = ?',
      )
      .run(nextStockMilli, nowMs, row.guild_id, row.user_id);
    return { ...row, stock_milli: nextStockMilli, stock_at: nowMs };
  }

  getCompanyState(
    guildId: string,
    userId: string,
    nowMs = this.deps.clock.now(),
  ): CompanyStateView | null {
    return this.deps.store.transaction(() => {
      const raw = this.getRow(guildId, userId);
      if (!raw) return null;
      const row = this.syncStockInTx(raw, nowMs);
      const dayStr = localDateString(nowMs, this.utcOffsetHours());
      const daySt = this.resolveDayState(row.kind, guildId, dayStr);
      const stakes = this.getStakesMap(guildId, userId);
      const stakesTotal = Object.values(stakes).reduce((s, v) => s + v, 0);
      const price = daySt.priceMicros / PRICE_SCALE;
      const stock = row.stock_milli / QUANTITY_SCALE;

      return {
        guildId: row.guild_id,
        userId: row.user_id,
        name: row.name,
        kind: row.kind,
        level: row.level,
        funds: row.funds,
        invested: companyInvested(row.level),
        upgradeCost: companyUpgradeCost(row.level),
        upkeep: companyDailyUpkeep(row.level),
        upkeepDay: row.upkeep_day,
        unpaidDays: row.unpaid_days,
        dailyOutput: companyDailyOutputMilli(row.kind, row.level) / QUANTITY_SCALE,
        storageCap: companyStorageCapMilli(row.kind, row.level) / QUANTITY_SCALE,
        stock,
        stockAtMs: row.stock_at,
        stockValue: truncInt(stock * price),
        condition: daySt.condition.key,
        yieldMult: daySt.condition.yieldMultBps / 10_000,
        price,
        budget: this.teiai.getCompanyBuyoutBudget(guildId, nowMs),
        dividendRate: row.dividend_rate_bps / 10_000,
        stakeCap: companyStakeCap(row.level),
        stakesTotal,
        investors: Object.keys(stakes).length,
        withdrawable: companyWithdrawable(row.funds, stakesTotal),
        soldTotal: row.sold_total,
        createdAtMs: row.created_at,
      };
    });
  }

  /** Found a new company (`200,000`: 100k `foundFee` -> Bank, 100k `buildCosts[0]` -> House). */
  foundCompany(
    guildId: string,
    userId: string,
    rawName: string,
    kind: CompanyKindKey,
    nowMs = this.deps.clock.now(),
    idempotencyKey?: string,
  ): ServiceResult<CompanyStateView> {
    const valid = validateCompanyName(rawName);
    if (!valid.ok) return valid;

    return this.deps.store.transaction(() => {
      if (this.teiai.getStatus(guildId, userId) !== 'katagi') {
        return { ok: false, reason: 'company_katagi_only' };
      }
      if (this.getRow(guildId, userId) !== null) {
        return { ok: false, reason: 'company_already_exists' };
      }
      const totalCost = companyFoundingCost();
      if (this.deps.economy.getBalance(guildId, userId) < totalCost) {
        return { ok: false, reason: 'insufficient_funds' };
      }

      this.deps.economy.debit({
        guildId,
        userId,
        amount: totalCost,
        reason: 'company_create',
        refType: 'company',
        refId: kind,
        idempotencyKey,
      });
      // Founding fee (100k) -> Teiai Bank; Lv1 build cost (100k) -> Teiai House Account
      this.teiai.bankIncome(guildId, COMPANY_CONSTANTS.foundFee, { thermo: true, nowMs });
      this.teiai.houseReceive(guildId, COMPANY_CONSTANTS.buildCosts[0] ?? 100_000, { nowMs });

      const today = localDateString(nowMs, this.utcOffsetHours());
      this.deps.store
        .stmt(
          `INSERT INTO companies (
            guild_id, user_id, name, kind, level, funds, stock_milli, stock_at,
            dividend_rate_bps, unpaid_days, upkeep_day, sold_total, created_at
          ) VALUES (?, ?, ?, ?, 1, 0, 0, ?, 0, 0, ?, 0, ?)`,
        )
        .run(guildId, userId, valid.name, kind, nowMs, today, nowMs);

      return { ok: true, data: this.getCompanyState(guildId, userId, nowMs)! };
    });
  }

  /** Owner deposits personal cash into company funds (`company_invest`). */
  ownerInvest(
    guildId: string,
    userId: string,
    amount: number,
    idempotencyKey?: string,
  ): ServiceResult<number> {
    if (!Number.isInteger(amount) || amount <= 0) return { ok: false, reason: 'invalid_amount' };
    return this.deps.store.transaction(() => {
      if (this.teiai.getStatus(guildId, userId) !== 'katagi') {
        return { ok: false, reason: 'company_katagi_only' };
      }
      if (!this.getRow(guildId, userId)) return { ok: false, reason: 'company_not_found' };
      if (this.deps.economy.getBalance(guildId, userId) < amount) {
        return { ok: false, reason: 'insufficient_funds' };
      }
      this.deps.economy.debit({
        guildId,
        userId,
        amount,
        reason: 'company_invest',
        refType: 'company',
        refId: userId,
        idempotencyKey,
      });
      this.deps.store
        .stmt('UPDATE companies SET funds = funds + ? WHERE guild_id = ? AND user_id = ?')
        .run(amount, guildId, userId);
      return { ok: true, data: amount };
    });
  }

  /** Owner withdraws unlocked company funds (`max(0, funds - sum(stakes))`). */
  ownerWithdraw(
    guildId: string,
    userId: string,
    amount: number,
    idempotencyKey?: string,
  ): ServiceResult<number> {
    if (!Number.isInteger(amount) || amount <= 0) return { ok: false, reason: 'invalid_amount' };
    return this.deps.store.transaction(() => {
      const row = this.getRow(guildId, userId);
      if (!row) return { ok: false, reason: 'company_not_found' };
      const stakesTotal = Object.values(this.getStakesMap(guildId, userId)).reduce(
        (s, v) => s + v,
        0,
      );
      const avail = companyWithdrawable(row.funds, stakesTotal);
      if (amount > avail) return { ok: false, reason: 'company_withdraw_locked' };

      this.deps.store
        .stmt('UPDATE companies SET funds = funds - ? WHERE guild_id = ? AND user_id = ?')
        .run(amount, guildId, userId);
      this.deps.economy.credit({
        guildId,
        userId,
        amount,
        reason: 'company_payout',
        refType: 'company',
        refId: userId,
        idempotencyKey,
      });
      return { ok: true, data: amount };
    });
  }

  /** External investor buys non-refundable equity stake (`stakeMin = 1,000`, cap = `2x invested`). */
  stakeInvest(
    guildId: string,
    investorId: string,
    ownerId: string,
    amount: number,
    nowMs = this.deps.clock.now(),
    idempotencyKey?: string,
  ): ServiceResult<{ readonly name: string; readonly amount: number; readonly total: number }> {
    if (investorId === ownerId) return { ok: false, reason: 'company_self_stake_forbidden' };
    if (!Number.isInteger(amount) || amount < COMPANY_CONSTANTS.stakeMin) {
      return { ok: false, reason: 'company_stake_min' };
    }
    return this.deps.store.transaction(() => {
      if (this.teiai.getStatus(guildId, investorId) !== 'katagi') {
        return { ok: false, reason: 'company_katagi_only' };
      }
      const row = this.getRow(guildId, ownerId);
      if (!row) return { ok: false, reason: 'company_not_found' };
      const stakes = this.getStakesMap(guildId, ownerId);
      const stakesTotal = Object.values(stakes).reduce((s, v) => s + v, 0);
      const cap = companyStakeCap(row.level);
      if (stakesTotal + amount > cap) return { ok: false, reason: 'company_stake_cap_exceeded' };
      if (this.deps.economy.getBalance(guildId, investorId) < amount) {
        return { ok: false, reason: 'insufficient_funds' };
      }

      this.deps.economy.debit({
        guildId,
        userId: investorId,
        amount,
        reason: 'company_invest',
        refType: 'company_stake',
        refId: ownerId,
        idempotencyKey,
      });
      this.deps.store
        .stmt('UPDATE companies SET funds = funds + ? WHERE guild_id = ? AND user_id = ?')
        .run(amount, guildId, ownerId);
      this.deps.store
        .stmt(
          `INSERT INTO company_stakes (guild_id, owner_id, investor_id, amount, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (guild_id, owner_id, investor_id) DO UPDATE SET
             amount = amount + excluded.amount,
             updated_at = excluded.updated_at`,
        )
        .run(guildId, ownerId, investorId, amount, nowMs);

      const newTotal = (stakes[investorId] ?? 0) + amount;
      return { ok: true, data: { name: row.name, amount, total: newTotal } };
    });
  }

  /** Set CEO investor dividend rate in basis points (`0..5000`, i.e., `0%..50%`). */
  setDividendRate(
    guildId: string,
    ownerId: string,
    rateBps: number,
  ): ServiceResult<number> {
    if (
      !Number.isInteger(rateBps) ||
      rateBps < 0 ||
      rateBps > COMPANY_CONSTANTS.dividendMaxBps
    ) {
      return { ok: false, reason: 'company_invalid_dividend_rate' };
    }
    return this.deps.store.transaction(() => {
      if (!this.getRow(guildId, ownerId)) return { ok: false, reason: 'company_not_found' };
      this.deps.store
        .stmt('UPDATE companies SET dividend_rate_bps = ? WHERE guild_id = ? AND user_id = ?')
        .run(rateBps, guildId, ownerId);
      return { ok: true, data: rateBps / 10_000 };
    });
  }

  /** Ship warehouse stock against server buyout budget, paying 3% skim & investor dividends. */
  ship(guildId: string, ownerId: string, nowMs = this.deps.clock.now()): ServiceResult<ShipReport> {
    return this.deps.store.transaction(() => {
      const raw = this.getRow(guildId, ownerId);
      if (!raw) return { ok: false, reason: 'company_not_found' };
      const row = this.syncStockInTx(raw, nowMs);
      if (row.stock_milli <= 0) return { ok: false, reason: 'company_no_stock' };

      const dayStr = localDateString(nowMs, this.utcOffsetHours());
      const daySt = this.resolveDayState(row.kind, guildId, dayStr);
      const budget = this.teiai.getCompanyBuyoutBudget(guildId, nowMs);
      if (budget <= 0) return { ok: false, reason: 'company_budget_empty' };

      const sale = computeCompanySale(row.stock_milli, daySt.priceMicros, budget);
      if (sale.paid <= 0) return { ok: false, reason: 'company_sale_too_small' };

      this.teiai.housePayCompanyBuyout(guildId, sale.paid, nowMs);

      const stakes = this.getStakesMap(guildId, ownerId);
      const divShares = computeDividendSplit(sale.paid, row.dividend_rate_bps, stakes);
      let totalDividends = 0;
      for (const [investorId, share] of Object.entries(divShares)) {
        if (share <= 0) continue;
        // Per docs/spec/companies.md:73, company dividends do NOT trigger debt withholding
        this.deps.economy.credit({
          guildId,
          userId: investorId,
          amount: share,
          reason: 'company_dividend',
          refType: 'company',
          refId: ownerId,
        });
        totalDividends += share;
      }

      const netToFunds = sale.paid - totalDividends;
      this.deps.store
        .stmt(
          `UPDATE companies
           SET funds = funds + ?, stock_milli = ?, stock_at = ?, sold_total = sold_total + ?
           WHERE guild_id = ? AND user_id = ?`,
        )
        .run(netToFunds, sale.leftStockMilli, nowMs, sale.paid, guildId, ownerId);

      return {
        ok: true,
        data: {
          paid: sale.paid,
          pinhane: sale.pinhane,
          dividends: totalDividends,
          price: daySt.priceMicros / PRICE_SCALE,
          leftStock: sale.leftStockMilli / QUANTITY_SCALE,
        },
      };
    });
  }

  /** Upgrade facility level from company funds (cost paid to Teiai House Account). */
  upgradeCompany(
    guildId: string,
    ownerId: string,
    nowMs = this.deps.clock.now(),
  ): ServiceResult<number> {
    return this.deps.store.transaction(() => {
      const raw = this.getRow(guildId, ownerId);
      if (!raw) return { ok: false, reason: 'company_not_found' };
      const row = this.syncStockInTx(raw, nowMs);
      const cost = companyUpgradeCost(row.level);
      if (cost === null) return { ok: false, reason: 'company_max_level' };
      if (row.funds < cost) return { ok: false, reason: 'company_insufficient_funds' };

      const nextLevel = row.level + 1;
      this.deps.store
        .stmt('UPDATE companies SET level = ?, funds = funds - ? WHERE guild_id = ? AND user_id = ?')
        .run(nextLevel, cost, guildId, ownerId);
      this.teiai.houseReceive(guildId, cost, { nowMs });
      return { ok: true, data: nextLevel };
    });
  }

  /** Change facility kind (costs 100k from company funds -> House; resets Lv1 and wipes stock). */
  changeKind(
    guildId: string,
    ownerId: string,
    newKind: CompanyKindKey,
    nowMs = this.deps.clock.now(),
  ): ServiceResult<CompanyKindKey> {
    return this.deps.store.transaction(() => {
      const row = this.getRow(guildId, ownerId);
      if (!row) return { ok: false, reason: 'company_not_found' };
      if (row.kind === newKind) return { ok: false, reason: 'company_same_kind' };
      const cost = companyChangeKindCost();
      if (row.funds < cost) return { ok: false, reason: 'company_insufficient_funds' };

      this.deps.store
        .stmt(
          `UPDATE companies
           SET kind = ?, level = 1, funds = funds - ?, stock_milli = 0, stock_at = ?
           WHERE guild_id = ? AND user_id = ?`,
        )
        .run(newKind, cost, nowMs, guildId, ownerId);
      this.teiai.houseReceive(guildId, cost, { nowMs });
      return { ok: true, data: newKind };
    });
  }

  /**
   * Settle production and daily upkeep for every company in `guildId`.
   * 3 consecutive unpaid upkeep days deletes the company, forfeits funds to House, wipes stakes,
   * and publishes `CompanyBankrupt` with `cause: 'upkeep'`.
   */
  settleAll(guildId: string, nowMs = this.deps.clock.now()): CompanyBankruptcyNotice[] {
    return this.deps.store.transaction(() => {
      const today = localDateString(nowMs, this.utcOffsetHours());
      const rows = this.deps.store
        .stmt('SELECT * FROM companies WHERE guild_id = ?')
        .all(guildId) as CompanyRow[];

      const bankruptcies: CompanyBankruptcyNotice[] = [];
      for (const raw of rows) {
        const row = this.syncStockInTx(raw, nowMs);
        const elapsedDays = calendarDayDiff(row.upkeep_day, today);
        if (elapsedDays <= 0) continue;

        const step = applyDailyUpkeepStep({
          funds: row.funds,
          unpaidDays: row.unpaid_days,
          level: row.level,
          elapsedDays,
        });

        if (step.totalUpkeepPaid > 0) {
          this.teiai.houseReceive(guildId, step.totalUpkeepPaid, { nowMs });
        }

        if (step.bankrupt) {
          const stakes = this.getStakesMap(guildId, row.user_id);
          const investorIds = Object.keys(stakes);
          if (step.nextFunds > 0) {
            this.teiai.houseReceive(guildId, step.nextFunds, { nowMs });
          }
          this.deps.store
            .stmt('DELETE FROM company_stakes WHERE guild_id = ? AND owner_id = ?')
            .run(guildId, row.user_id);
          this.deps.store
            .stmt('DELETE FROM companies WHERE guild_id = ? AND user_id = ?')
            .run(guildId, row.user_id);

          bankruptcies.push({
            guildId,
            ownerId: row.user_id,
            companyName: row.name,
            investorIds,
          });

          const bus = this.deps.bus;
          if (bus) {
            this.deps.store.afterCommit(() => {
              bus.publishDomain({
                type: 'CompanyBankrupt',
                guildId,
                at: nowMs,
                ownerId: row.user_id,
                companyName: row.name,
                cause: 'upkeep',
                investorIds,
              });
            });
          }
        } else {
          this.deps.store
            .stmt(
              `UPDATE companies
               SET funds = ?, unpaid_days = ?, upkeep_day = ?
               WHERE guild_id = ? AND user_id = ?`,
            )
            .run(step.nextFunds, step.nextUnpaidDays, today, guildId, row.user_id);
        }
      }

      return bankruptcies;
    });
  }

  /** Forced execution hook (Step 3): seize up to `need` from `company.funds`, leaving facility intact. */
  seizeFunds(guildId: string, ownerId: string, need: number): number {
    if (need <= 0) return 0;
    return this.deps.store.transaction(() => {
      const row = this.getRow(guildId, ownerId);
      if (!row || row.funds <= 0) return 0;
      const take = Math.min(need, row.funds);
      this.deps.store
        .stmt('UPDATE companies SET funds = funds - ? WHERE guild_id = ? AND user_id = ?')
        .run(take, guildId, ownerId);
      return take;
    });
  }

  /**
   * Owner personal bankruptcy hook: dissolves company, wipes stakes, returns remaining `funds`
   * to bankruptcy pool, and publishes `CompanyBankrupt` with `cause: 'owner_bankrupt'`.
   */
  liquidateForBankruptcy(guildId: string, ownerId: string, nowMs = this.deps.clock.now()): number {
    return this.deps.store.transaction(() => {
      const row = this.getRow(guildId, ownerId);
      if (!row) return 0;
      const stakes = this.getStakesMap(guildId, ownerId);
      const investorIds = Object.keys(stakes);

      this.deps.store
        .stmt('DELETE FROM company_stakes WHERE guild_id = ? AND owner_id = ?')
        .run(guildId, ownerId);
      this.deps.store
        .stmt('DELETE FROM companies WHERE guild_id = ? AND user_id = ?')
        .run(guildId, ownerId);

      const bus = this.deps.bus;
      if (bus) {
        this.deps.store.afterCommit(() => {
          bus.publishDomain({
            type: 'CompanyBankrupt',
            guildId,
            at: nowMs,
            ownerId,
            companyName: row.name,
            cause: 'owner_bankrupt',
            investorIds,
          });
        });
      }

      return row.funds;
    });
  }
}
