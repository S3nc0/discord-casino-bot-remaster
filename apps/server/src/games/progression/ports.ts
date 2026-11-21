/**
 * What the games need from the Teiai bank (owned by the finance card). Money that moves inside
 * Teiai (bank cash, house income, debt) is not a ledger movement, so it goes through this port.
 * `createMemoryTeiai` is a complete in-memory implementation for tests and for running the games
 * before the finance module registers the real one.
 */
export interface TeiaiPort {
  /** Teiai debt of a player (interest already accrued by the implementation). */
  debtOf(guildId: string, userId: string): number;
  /** Add debt (a charge the wallet could not cover). `why` is a short log tag. */
  addDebt(guildId: string, userId: string, amount: number, why: string): void;
  /** Reduce debt by an amount that was just withheld from income (the ledger row is posted by the caller). */
  repayDebt(guildId: string, userId: string, amount: number): void;
  /** Cash the bank holds, for prize top-ups and arena subsidies. */
  bankCash(guildId: string): number;
  /** Take cash out of the bank (top-up, subsidy, spectator seeding). */
  drawBankCash(guildId: string, amount: number): void;
  /** Income for the bank (shares of losses, shop revenue, poll rigging fees). */
  bankIncome(guildId: string, amount: number, why: string): void;
  /** Income for the house account (skims). */
  houseIncome(guildId: string, amount: number, why: string): void;
}

export interface MemoryTeiai extends TeiaiPort {
  readonly debts: Map<string, number>;
  readonly bank: Map<string, number>;
  readonly house: Map<string, number>;
  setBank(guildId: string, cash: number): void;
  setDebt(guildId: string, userId: string, debt: number): void;
}

export function createMemoryTeiai(): MemoryTeiai {
  const debts = new Map<string, number>();
  const bank = new Map<string, number>();
  const house = new Map<string, number>();
  const key = (g: string, u: string): string => `${g}:${u}`;
  return {
    debts,
    bank,
    house,
    setBank: (g, cash) => void bank.set(g, cash),
    setDebt: (g, u, debt) => void debts.set(key(g, u), debt),
    debtOf: (g, u) => debts.get(key(g, u)) ?? 0,
    addDebt: (g, u, amount) => void debts.set(key(g, u), (debts.get(key(g, u)) ?? 0) + amount),
    repayDebt: (g, u, amount) =>
      void debts.set(key(g, u), Math.max(0, (debts.get(key(g, u)) ?? 0) - amount)),
    bankCash: (g) => bank.get(g) ?? 0,
    drawBankCash: (g, amount) => void bank.set(g, Math.max(0, (bank.get(g) ?? 0) - amount)),
    bankIncome: (g, amount) => void bank.set(g, (bank.get(g) ?? 0) + amount),
    houseIncome: (g, amount) => void house.set(g, (house.get(g) ?? 0) + amount),
  };
}
