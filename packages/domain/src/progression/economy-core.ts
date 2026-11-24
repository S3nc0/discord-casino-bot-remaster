import { roundBps } from './time.ts';

/** Start balance per (guild, user), granted once. */
export const INITIAL_BALANCE = 3000;
/** Teiai cut taken from a debtor's daily claim (bps). */
export const SKIM_RATE_BPS = 2000;
/** Share of a debtor's income withheld toward the debt (bps). */
export const REPAY_RATE_BPS = 3000;
/** Teiai cut taken from underground labor collections (bps). */
export const LABOR_SKIM_RATE_BPS = 300;
/** Debt at which the bankruptcy grace period starts. */
export const GRACE_DEBT = 15_000;
/** Net worth from which a debt-free player shows as wealthy. */
export const WEALTHY_ASSETS = 1_000_000;

/**
 * Legacy `AccountCore.apply` floor clamp: a balance never goes below zero. Returns the change
 * that actually happens (0 means nothing is written to the ledger).
 */
export function applyWithFloor(before: number, delta: number): { after: number; actual: number } {
  const after = Math.max(0, before + delta);
  return { after, actual: after - before };
}

/** Amount that must be charged to the player and cannot be: the part the wallet cannot cover. */
export function shortfall(balance: number, charge: number): { paid: number; shortfall: number } {
  const paid = Math.min(Math.max(0, balance), charge);
  return { paid, shortfall: charge - paid };
}

/** Teiai skim of a debtor's daily claim. Charged to the player, so it rounds up. */
export function debtorSkim(amount: number): number {
  return Math.min(amount, Math.ceil((amount * SKIM_RATE_BPS) / 10_000));
}

/** Teiai cut of a labor collection: `round(amount * 0.03)`. */
export function laborSkim(amount: number): number {
  return Math.min(amount, roundBps(amount, LABOR_SKIM_RATE_BPS));
}

/**
 * Debt withholding on income: 30 % of the income (rounded up, it is charged to the player) goes
 * to the debt, never more than the debt itself.
 */
export function withholdIncome(income: number, debt: number): number {
  if (income <= 0 || debt <= 0) return 0;
  return Math.min(debt, income, Math.ceil((income * REPAY_RATE_BPS) / 10_000));
}

export const LIQUID_KEYS = [
  'cash',
  'deposit',
  'crypto',
  'bonds',
  'options',
  'pot',
  'escrow',
  'loans_lent',
] as const;
export const FIXED_KEYS = ['items', 'relics', 'horses', 'company', 'tools'] as const;
export const LIABILITY_KEYS = ['debt', 'loans_owed'] as const;
export type AssetKey =
  (typeof LIQUID_KEYS)[number] | (typeof FIXED_KEYS)[number] | (typeof LIABILITY_KEYS)[number];
export type AssetParts = Record<AssetKey, number>;

export function emptyParts(): AssetParts {
  const parts = {} as AssetParts;
  for (const key of [...LIQUID_KEYS, ...FIXED_KEYS, ...LIABILITY_KEYS]) parts[key] = 0;
  return parts;
}

/** Balance sheet of one player. Liabilities are stored as negatives in `parts`. */
export function assetGroups(parts: AssetParts): {
  liquid: number;
  fixed: number;
  gross: number;
  liabilities: number;
  net: number;
} {
  const sum = (keys: readonly AssetKey[]): number => keys.reduce((acc, k) => acc + parts[k], 0);
  const liquid = sum(LIQUID_KEYS);
  const fixed = sum(FIXED_KEYS);
  const gross = liquid + fixed;
  const liabilities = 0 - sum(LIABILITY_KEYS);
  return { liquid, fixed, gross, liabilities, net: gross - liabilities };
}

/** Every balance-sheet line, in display order: current assets, fixed assets, then liabilities. */
export const PART_KEYS: readonly AssetKey[] = [...LIQUID_KEYS, ...FIXED_KEYS, ...LIABILITY_KEYS];

export type AssetGroups = ReturnType<typeof assetGroups>;

/**
 * Sort keys of the net-worth ranking: `net` (純資産, the default), `liquid` (流動資産) and `gross`
 * (総資産). The board, the balance-card rank and `/pelica ranking view:net` use `net`.
 */
export const BALANCE_SHEET_VIEWS = ['net', 'liquid', 'gross'] as const;
export type BalanceSheetView = (typeof BALANCE_SHEET_VIEWS)[number];

export interface BalanceSheet {
  userId: string;
  parts: AssetParts;
  groups: AssetGroups;
}

export function balanceSheet(userId: string, parts: AssetParts): BalanceSheet {
  return { userId, parts, groups: assetGroups(parts) };
}

export function balanceSheetValue(groups: AssetGroups, view: BalanceSheetView): number {
  return groups[view];
}

/** Snowflakes compare as numbers (shorter is smaller); anything else falls back to text order. */
function compareUserId(a: string, b: string): number {
  if (/^\d+$/.test(a) && /^\d+$/.test(b) && a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `ORDER BY value DESC, user_id ASC` for one view. Returns a new array. */
export function rankBalanceSheets(
  sheets: readonly BalanceSheet[],
  view: BalanceSheetView = 'net',
): BalanceSheet[] {
  return [...sheets].sort(
    (x, y) =>
      balanceSheetValue(y.groups, view) - balanceSheetValue(x.groups, view) ||
      compareUserId(x.userId, y.userId),
  );
}

/**
 * Financial net worth (金融純資産): cash - Teiai debt + valuations of trust deposits, securities
 * and companies. Not a ranking any more; it only decides the 🟡 wealthy badge.
 */
export function netWorth(input: { cash: number; debt: number; valuations: number }): number {
  return input.cash - input.debt + input.valuations;
}

export const PLAYER_STATUSES = ['katagi', 'underground', 'grace', 'bankrupt', 'wealthy'] as const;
export type PlayerStatus = (typeof PLAYER_STATUSES)[number];

/** Social rank. Debt marks an underground laborer; bankruptcy and grace override the rest. */
export function playerStatus(input: {
  debt: number;
  bankrupt: boolean;
  netWorth: number;
}): PlayerStatus {
  if (input.bankrupt) return 'bankrupt';
  if (input.debt >= GRACE_DEBT) return 'grace';
  if (input.debt > 0) return 'underground';
  return input.netWorth >= WEALTHY_ASSETS ? 'wealthy' : 'katagi';
}

export interface LedgerRowView {
  id: number;
  delta: number;
  balanceAfter: number;
  reason: string;
  refType: string | null;
  refId: string | null;
  createdAt: number;
}

export interface HistoryEntry {
  kind: 'game' | 'other';
  reason: string;
  refType: string | null;
  refId: string | null;
  bet: number;
  delta: number;
  balanceAfter: number;
  ts: number;
  rows: number;
}

/**
 * Collapse ledger rows (newest first) into at most `max` entries. Consecutive rows that share a
 * reference (a game's stake, payout and refund; a transfer and its fee) become one entry, like
 * the legacy "賭け: …" / "送金" grouping. Rows without a reference stay as they are.
 */
export function summarizeHistory(rows: readonly LedgerRowView[], max = 12): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (const row of rows) {
    const prev = out[out.length - 1];
    const grouped =
      prev !== undefined &&
      row.refId !== null &&
      prev.refId === row.refId &&
      prev.refType === row.refType;
    if (grouped && prev) {
      prev.delta += row.delta;
      if (row.delta < 0 && prev.kind === 'game') prev.bet += -row.delta;
      prev.rows += 1;
      continue;
    }
    if (out.length >= max) break;
    const isGame = row.refType === 'round' || row.refType === 'race' || row.refType === 'arena';
    out.push({
      kind: isGame ? 'game' : 'other',
      reason: row.reason,
      refType: row.refType,
      refId: row.refId,
      bet: isGame && row.delta < 0 ? -row.delta : 0,
      delta: row.delta,
      balanceAfter: row.balanceAfter,
      ts: row.createdAt,
      rows: 1,
    });
  }
  return out;
}
