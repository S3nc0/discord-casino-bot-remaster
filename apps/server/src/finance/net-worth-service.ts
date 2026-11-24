import {
  computeStakeValues,
  companyInvested,
  loanRemaining,
  marginPnl,
  resolveDisplayStatus,
  resolvePlayerStatus,
  spotSellQuote,
  type PlayerDisplayStatus,
  type SymbolKey,
} from '@casino/domain/finance';
import {
  balanceSheet,
  balanceSheetValue,
  emptyParts,
  financialNetWorth,
  rankBalanceSheets,
  type AssetKey,
  type AssetParts,
  type BalanceSheet,
  type BalanceSheetView,
} from '@casino/domain/progression';
import { horseWorth } from '@casino/domain/race';
import { itemById } from '@casino/domain/shop';
import { dormSpent, isRelicId, relicValue, upgradeSpent } from '@casino/domain/work';
import type { Clock } from '@casino/shared';
import type { Store } from '../db/store.ts';

/** What the balance sheet needs from the market and the Teiai bank. */
export interface NetWorthDeps {
  readonly store: Store;
  readonly clock: Clock;
  /** Latest price of every ticker, in micro-Pelica. */
  prices(nowMs: number): Record<SymbolKey, number>;
  /** Value of every open option, per holder (`StocksService.optionValuesByUser`). */
  optionValues(guildId: string, nowMs: number): Map<string, number>;
  /** Toichi interest for every debtor of the guild, written before anything is valued. */
  accrueDebtInterest(guildId: string, nowMs: number): unknown;
}

export interface NetWorthStanding {
  readonly rank: number;
  readonly sheet: BalanceSheet;
  readonly value: number;
  readonly status: PlayerDisplayStatus;
}

export interface NetWorthStandings {
  readonly view: BalanceSheetView;
  /** Top `limit` rows, ranked. */
  readonly rows: readonly NetWorthStanding[];
  /** Every member of the guild with an account. */
  readonly total: number;
}

/** Value of one shop item or relic, and whether it is a relic. Priceless limited items count 0. */
export function itemWorth(itemId: string): { worth: number; relic: boolean } {
  if (isRelicId(itemId)) return { worth: relicValue(itemId), relic: true };
  return { worth: itemById(itemId)?.price ?? 0, relic: false };
}

/**
 * Balance sheet (貸借対照表) of every member of a guild, valued from the tables in one pass: one
 * aggregate query per source, so a guild of any size costs the same ~15 statements.
 *
 * - Current assets: cash, Teiai trust deposit, spot holdings at the sell quote plus margin
 *   positions at `max(0, margin + P&L)`, active bond principal, option values, the unclaimed
 *   labor pot, bids held in escrow (player market and kyosai auctions), P2P loans lent.
 * - Fixed assets: items at shop price, relics at reference value (inventory, waiting in the mine
 *   and listed), horses at `max(0, 30,000 + retirement value)` (owned and listed), the company
 *   (funds + office build cost, split with outside investors), labor tool and dorm upgrades.
 * - Liabilities (stored negative): Teiai debt after accruing Toichi interest, P2P loans owed.
 */
export class NetWorthService {
  private readonly deps: NetWorthDeps;

  constructor(deps: NetWorthDeps) {
    this.deps = deps;
  }

  /** Every member's balance sheet, unsorted. Accrues debt interest first (one write transaction). */
  sheets(guildId: string, nowMs = this.deps.clock.now()): BalanceSheet[] {
    this.deps.accrueDebtInterest(guildId, nowMs);
    const { parts } = this.collect(guildId, nowMs);
    return [...parts].map(([userId, p]) => balanceSheet(userId, p));
  }

  /** Financial net worth (金融純資産) of every member of the guild, from one pass. */
  financialNetWorths(guildId: string, nowMs = this.deps.clock.now()): Map<string, number> {
    this.deps.accrueDebtInterest(guildId, nowMs);
    const { parts } = this.collect(guildId, nowMs);
    const out = new Map<string, number>();
    for (const [userId, p] of parts) out.set(userId, financialNetWorth(p));
    return out;
  }

  /** Display status (`katagi` | `wealthy` | `underground` | `bankrupt`) of every member. */
  displayStatuses(
    guildId: string,
    nowMs = this.deps.clock.now(),
  ): Map<string, PlayerDisplayStatus> {
    this.deps.accrueDebtInterest(guildId, nowMs);
    const collected = this.collect(guildId, nowMs);
    return this.resolveStatuses(collected);
  }

  /** Display status of one member (`katagi` if the member has no account yet). */
  displayStatusOf(
    guildId: string,
    userId: string,
    nowMs = this.deps.clock.now(),
  ): PlayerDisplayStatus {
    return this.displayStatuses(guildId, nowMs).get(userId) ?? 'katagi';
  }

  /** Ranked standings for one view, top `limit` rows. */
  standings(
    guildId: string,
    view: BalanceSheetView = 'net',
    limit = 10,
    nowMs = this.deps.clock.now(),
  ): NetWorthStandings {
    this.deps.accrueDebtInterest(guildId, nowMs);
    const collected = this.collect(guildId, nowMs);
    const statuses = this.resolveStatuses(collected);
    const sheets = [...collected.parts].map(([userId, p]) => balanceSheet(userId, p));
    const ranked = rankBalanceSheets(sheets, view);
    return {
      view,
      total: ranked.length,
      rows: ranked.slice(0, Math.max(0, limit)).map((sheet, i) => ({
        rank: i + 1,
        sheet,
        value: balanceSheetValue(sheet.groups, view),
        status: statuses.get(sheet.userId) ?? 'katagi',
      })),
    };
  }

  /**
   * Standings plus the given member's own row (with rank and field size), from one valuation.
   * `self` is null when the member has no account in the guild.
   */
  standingsWithSelf(
    guildId: string,
    userId: string,
    view: BalanceSheetView = 'net',
    limit = 10,
    nowMs = this.deps.clock.now(),
  ): NetWorthStandings & { readonly self: NetWorthStanding | null } {
    this.deps.accrueDebtInterest(guildId, nowMs);
    const collected = this.collect(guildId, nowMs);
    const statuses = this.resolveStatuses(collected);
    const sheets = [...collected.parts].map(([id, p]) => balanceSheet(id, p));
    const ranked = rankBalanceSheets(sheets, view);
    const at = ranked.findIndex((s) => s.userId === userId);
    const own = ranked[at];
    const row = (sheet: BalanceSheet, i: number): NetWorthStanding => ({
      rank: i + 1,
      sheet,
      value: balanceSheetValue(sheet.groups, view),
      status: statuses.get(sheet.userId) ?? 'katagi',
    });
    return {
      view,
      total: ranked.length,
      rows: ranked.slice(0, Math.max(0, limit)).map(row),
      self: own ? row(own, at) : null,
    };
  }

  // ---------------------------------------------------------------------------------------------

  private resolveStatuses(collected: CollectedGuild): Map<string, PlayerDisplayStatus> {
    const out = new Map<string, PlayerDisplayStatus>();
    for (const [userId, p] of collected.parts) {
      const raw = resolvePlayerStatus({
        debt: -p.debt,
        bankruptAtMs: collected.bankruptAt.get(userId) ?? null,
        hasOverdueLoan: collected.overdueBorrowers.has(userId),
      });
      out.set(userId, resolveDisplayStatus(raw, financialNetWorth(p)));
    }
    return out;
  }

  private collect(guildId: string, nowMs: number): CollectedGuild {
    const { store } = this.deps;
    const parts = new Map<string, AssetParts>();
    const bankruptAt = new Map<string, number | null>();
    const overdueBorrowers = new Set<string>();
    for (const r of store
      .stmt('SELECT user_id FROM guild_members WHERE guild_id = ?')
      .all(guildId) as { user_id: string }[]) {
      parts.set(r.user_id, emptyParts());
    }
    const add = (userId: string | null, key: AssetKey, value: number): void => {
      if (userId === null || value === 0) return;
      const p = parts.get(userId);
      if (p) p[key] += value;
    };
    const addItem = (userId: string, itemId: string, qty: number): void => {
      const { worth, relic } = itemWorth(itemId);
      add(userId, relic ? 'relics' : 'items', worth * qty);
    };

    // Cash and Teiai debt.
    for (const r of store
      .stmt('SELECT user_id, balance FROM balances WHERE guild_id = ?')
      .all(guildId) as { user_id: string; balance: number }[]) {
      add(r.user_id, 'cash', r.balance);
    }
    for (const r of store
      .stmt('SELECT user_id, debt, bankrupt_at FROM bank_accounts WHERE guild_id = ? AND debt > 0')
      .all(guildId) as { user_id: string; debt: number; bankrupt_at: number | null }[]) {
      add(r.user_id, 'debt', -r.debt);
      if (r.bankrupt_at !== null) bankruptAt.set(r.user_id, r.bankrupt_at);
    }

    // Teiai trust deposit.
    for (const r of store
      .stmt('SELECT user_id, amount FROM bank_deposits WHERE guild_id = ? AND amount > 0')
      .all(guildId) as { user_id: string; amount: number }[]) {
      add(r.user_id, 'deposit', r.amount);
    }

    // Stocks and crypto: spot at what a sale would pay now, margin at max(0, margin + P&L).
    const spot = store
      .stmt(
        'SELECT user_id, symbol, units_milli FROM positions_spot WHERE guild_id = ? AND units_milli > 0',
      )
      .all(guildId) as { user_id: string; symbol: SymbolKey; units_milli: number }[];
    const longs = store
      .stmt(
        'SELECT user_id, symbol, units_milli, entry_value_micros, margin FROM positions_long WHERE guild_id = ? AND units_milli > 0',
      )
      .all(guildId) as MarginRow[];
    const shorts = store
      .stmt(
        'SELECT user_id, symbol, units_milli, entry_value_micros, margin FROM positions_short WHERE guild_id = ? AND units_milli > 0',
      )
      .all(guildId) as MarginRow[];
    if (spot.length + longs.length + shorts.length > 0) {
      const prices = this.deps.prices(nowMs);
      for (const r of spot) {
        const price = prices[r.symbol];
        if (price !== undefined)
          add(r.user_id, 'crypto', spotSellQuote(r.units_milli, price).proceeds);
      }
      for (const [side, rows] of [
        ['long', longs],
        ['short', shorts],
      ] as const) {
        for (const r of rows) {
          const price = prices[r.symbol];
          if (price === undefined) continue;
          const pnl = marginPnl(side, r.units_milli, r.entry_value_micros, price);
          add(r.user_id, 'crypto', Math.max(0, Math.floor(r.margin + pnl)));
        }
      }
    }

    // Bonds at principal; options at value.
    for (const r of store
      .stmt(
        "SELECT user_id, SUM(principal) AS total FROM bonds WHERE guild_id = ? AND status = 'active' GROUP BY user_id",
      )
      .all(guildId) as { user_id: string; total: number }[]) {
      add(r.user_id, 'bonds', r.total);
    }
    for (const [userId, value] of this.deps.optionValues(guildId, nowMs)) {
      add(userId, 'options', Math.trunc(value));
    }

    // Underground labor: the pot, relics waiting in the mine, tool and dorm upgrades.
    for (const r of store
      .stmt('SELECT user_id, pick, glove, dorm, pot, relics FROM work_state WHERE guild_id = ?')
      .all(guildId) as WorkRow[]) {
      add(r.user_id, 'pot', r.pot);
      add(r.user_id, 'tools', upgradeSpent(r.pick) + upgradeSpent(r.glove) + dormSpent(r.dorm));
      for (const [itemId, qty] of Object.entries(parseCounts(r.relics))) {
        addItem(r.user_id, itemId, qty);
      }
    }

    // Belongings.
    for (const r of store
      .stmt('SELECT user_id, item_id, qty FROM inventory WHERE guild_id = ? AND qty > 0')
      .all(guildId) as { user_id: string; item_id: string; qty: number }[]) {
      addItem(r.user_id, r.item_id, r.qty);
    }
    for (const r of store
      .stmt(
        'SELECT owner_id, races, wins, places FROM horses WHERE guild_id = ? AND owner_id IS NOT NULL AND retired_at IS NULL',
      )
      .all(guildId) as { owner_id: string; races: number; wins: number; places: number }[]) {
      add(r.owner_id, 'horses', horseWorth(r.races, r.wins, r.places));
    }

    // Player market: a listed item or horse is still the seller's; a held bid is the bidder's.
    for (const r of store
      .stmt(
        `SELECT l.seller_id, l.kind, l.ref, l.qty, l.bid, l.bidder_id,
                h.races AS races, h.wins AS wins, h.places AS places
           FROM marketplace_listings l
           LEFT JOIN horses h ON l.kind = 'horse' AND h.id = CAST(l.ref AS INTEGER)
          WHERE l.guild_id = ? AND l.status = 'active'`,
      )
      .all(guildId) as ListingRow[]) {
      if (r.kind === 'item') addItem(r.seller_id, r.ref, r.qty);
      else if (r.races !== null) {
        add(r.seller_id, 'horses', horseWorth(r.races, r.wins ?? 0, r.places ?? 0));
      }
      if (r.bidder_id !== null && r.bid > 0) add(r.bidder_id, 'escrow', r.bid);
    }
    // Kyosai auctions hold the top bid the same way.
    for (const r of store
      .stmt(
        "SELECT top_bidder_id, top_bid FROM kyosai_auctions WHERE guild_id = ? AND status = 'open' AND top_bid > 0",
      )
      .all(guildId) as { top_bidder_id: string | null; top_bid: number }[]) {
      add(r.top_bidder_id, 'escrow', r.top_bid);
    }

    // P2P loans: what is left to repay is the lender's asset and the borrower's liability.
    for (const r of store
      .stmt(
        "SELECT lender_id, borrower_id, status, principal, rate_bps, term_days, accepted_at, paid FROM loans WHERE guild_id = ? AND status IN ('active', 'overdue')",
      )
      .all(guildId) as LoanRow[]) {
      if (r.status === 'overdue') overdueBorrowers.add(r.borrower_id);
      if (r.accepted_at === null) continue;
      const left = loanRemaining(
        {
          principal: r.principal,
          rateBps: r.rate_bps,
          termDays: r.term_days,
          acceptedAtMs: r.accepted_at,
          paid: r.paid,
        },
        nowMs,
      );
      add(r.lender_id, 'loans_lent', left);
      add(r.borrower_id, 'loans_owed', -left);
    }

    // Companies: funds + office build cost, shared with outside investors without double counting.
    const stakes = new Map<string, Record<string, number>>();
    for (const r of store
      .stmt(
        'SELECT owner_id, investor_id, amount FROM company_stakes WHERE guild_id = ? AND amount > 0',
      )
      .all(guildId) as { owner_id: string; investor_id: string; amount: number }[]) {
      const own = stakes.get(r.owner_id) ?? {};
      own[r.investor_id] = r.amount;
      stakes.set(r.owner_id, own);
    }
    for (const r of store
      .stmt('SELECT user_id, funds, level FROM companies WHERE guild_id = ?')
      .all(guildId) as { user_id: string; funds: number; level: number }[]) {
      const value = computeStakeValues(
        r.funds + companyInvested(r.level),
        stakes.get(r.user_id) ?? {},
      );
      add(r.user_id, 'company', value.ownerValue);
      for (const [investorId, v] of Object.entries(value.investorValues)) {
        add(investorId, 'company', v);
      }
    }
    return { parts, bankruptAt, overdueBorrowers };
  }
}

interface CollectedGuild {
  readonly parts: Map<string, AssetParts>;
  readonly bankruptAt: Map<string, number | null>;
  readonly overdueBorrowers: Set<string>;
}

interface MarginRow {
  user_id: string;
  symbol: SymbolKey;
  units_milli: number;
  entry_value_micros: number;
  margin: number;
}

interface WorkRow {
  user_id: string;
  pick: number;
  glove: number;
  dorm: number;
  pot: number;
  relics: string;
}

interface ListingRow {
  seller_id: string;
  kind: 'item' | 'horse';
  ref: string;
  qty: number;
  bid: number;
  bidder_id: string | null;
  races: number | null;
  wins: number | null;
  places: number | null;
}

interface LoanRow {
  lender_id: string;
  borrower_id: string;
  status: string;
  principal: number;
  rate_bps: number;
  term_days: number;
  accepted_at: number | null;
  paid: number;
}

function parseCounts(json: string): Record<string, number> {
  try {
    const raw = JSON.parse(json || '{}') as unknown;
    if (raw === null || typeof raw !== 'object') return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) out[k] = Math.trunc(n);
    }
    return out;
  } catch {
    return {};
  }
}
