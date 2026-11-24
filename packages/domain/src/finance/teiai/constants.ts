/**
 * Teiai Bank, Debt, Bankruptcy, Escape, CDS, and Thermostat constants.
 * Mirrors `catalogs/teiai.yaml` with integer Pelica and integer basis points.
 */
export const TEIAI_CONSTANTS = {
  // Debt & seed loans
  seedLoanCap: 3_000,
  repayRateBps: 3_000, // 30% income withholding
  skimRateBps: 2_000, // 20% daily bonus skim while in debt
  laborSkimRateBps: 300, // 3% underground labor skim (code behaviour)
  horsePrizeSkimRateBps: 0, // 0%
  debtRatePerDayBps: 100, // 1%/day Toichi simple interest
  debtInterestMaxDays: 10,
  graceDebt: 15_000,
  debtInterestCeiling: 14_999, // GRACE_DEBT - 1
  graceHours: 24,
  bankruptFloor: 10_000,
  blacklistDays: 7,
  seizeRateBps: 5_000, // 50% liquidation rate on unsellable assets
  wealthyAssets: 1_000_000,

  // Overseas escape
  escapeChanceBps: 100, // 1%
  escapeMinDebt: 5_000,
  escapeFineRateBps: 1_000, // 10%
  escapeFineMin: 1_000,
  escapeMaxTries: 2,
  escapeCooldownHours: 24,

  // Fractional reserve bank & trust
  bankMinDeposit: 100,
  reserveRatioBps: 2_000, // 20% cash, 80% loaned
  loanRecoveryPerHourBps: 200, // 2%/hour
  lockDebtRateBps: 500, // 5% of every debtor's debt locked
  trustPremiumPerDayNano: 1_000_000, // 0.001 / day = 0.1%/day
  runWarnRatioBps: 1_500, // 15%
  runDangerRatioBps: 500, // 5%

  // CIR risk-free rate bounds (specified as 72h normal-bond percentage)
  rfMinPctBps: 150, // 1.5%
  rfMaxPctBps: 800, // 8.0%
  rfAlpha: 4.25,
  rfKappaPerDay: 2.0,
  rfSigma: 0.02,

  // CDS
  cdsMinStake: 100,
  cdsMinOddsTenths: 12, // 1.2x
  cdsMaxOddsTenths: 150, // 15.0x
  cdsTermDays: 14,
  cdsSelfCap: 50_000,
  cdsPayoutCapRateBps: 5_000, // 50% of debt_before

  // Frontline thermostat (observation-only in legacy: enforce = false)
  thermostatEnforce: false,
  thermostatCoolDays: 7,
  thermostatMemoryRatio: 4,
  thermostatCapacityMin: 20_000,
  thermostatCoupling: 1.0,
} as const;

export const WEALTHY_ASSETS = TEIAI_CONSTANTS.wealthyAssets;

export type PlayerDebtStatus = 'katagi' | 'underground' | 'bankrupt';
export type PlayerDisplayStatus = 'katagi' | 'wealthy' | 'underground' | 'bankrupt';
export type BankLiquidityLevel = 'safe' | 'warn' | 'danger' | 'frozen';
export type CdsStatus = 'active' | 'paid' | 'void' | 'expired';
export type BankruptcyCause = 'voluntary' | 'forced' | 'escape';
