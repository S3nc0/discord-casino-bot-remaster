export interface StockRule {
  max: number;
  /** Units regained per hour. */
  perHour: number;
}

/** Items with a per-user stock that refills over time. */
export const STOCK_RULES: Readonly<Record<string, StockRule>> = {
  labor_drink: { max: 10, perHour: 2 },
};

/** Exact stock after refilling, capped at the maximum. `now` and `updated` in ms. */
export function stockNow(rule: StockRule, stock: number, updatedMs: number, nowMs: number): number {
  return Math.min(rule.max, stock + (Math.max(0, nowMs - updatedMs) / 3_600_000) * rule.perHour);
}

/** Whole units available (a hair of tolerance for float noise). */
export function stockAvailable(exact: number): number {
  return Math.floor(exact + 1e-9);
}

/** When the next unit appears, or null when the stock is full. */
export function nextRefillAt(rule: StockRule, stock: number, nowMs: number): number | null {
  if (stock >= rule.max) return null;
  return nowMs + ((1 - (stock - Math.floor(stock))) / rule.perHour) * 3_600_000;
}
