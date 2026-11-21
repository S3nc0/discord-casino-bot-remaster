import { PRICE_SCALE } from '@casino/shared';
import { BPS_SCALE, nanoToRate, truncInt } from '../math.ts';
import { TEIAI_CONSTANTS, type BankLiquidityLevel } from './constants.ts';
import {
  absorbInflow,
  absorbShock,
  type ThermostatConfig,
  DEFAULT_THERMOSTAT_CONFIG,
  type ThermostatState,
} from './thermostat.ts';

/**
 * Split a player trust deposit into liquid reserve cash (20%) and underground loaned pool (80%).
 * Stored in micro-Pelica so exact fractions are preserved across recovery ticks.
 */
export function splitBankDeposit(amount: number): {
  readonly cashDeltaMicros: number;
  readonly loanedDeltaMicros: number;
} {
  const totalMicros = amount * PRICE_SCALE;
  const cashDeltaMicros = Math.round((totalMicros * TEIAI_CONSTANTS.reserveRatioBps) / BPS_SCALE);
  return {
    cashDeltaMicros,
    loanedDeltaMicros: totalMicros - cashDeltaMicros,
  };
}

/**
 * Continuous hourly underground loan recovery:
 *   moved = loaned * (1 - (1 - 0.02)^hours) = loaned * (1 - 0.98^hours)
 * Boundary rounding: nearest integer micro-Pelica.
 */
export function recoverBankLoans(
  cashMicros: number,
  loanedMicros: number,
  elapsedHours: number,
): { readonly cashMicros: number; readonly loanedMicros: number; readonly movedMicros: number } {
  if (elapsedHours <= 0 || loanedMicros <= 0) {
    return { cashMicros, loanedMicros, movedMicros: 0 };
  }
  const keepFactor = (1 - TEIAI_CONSTANTS.loanRecoveryPerHourBps / BPS_SCALE) ** elapsedHours;
  const moved = (loanedMicros / PRICE_SCALE) * (1 - keepFactor);
  const movedMicros = Math.min(loanedMicros, Math.round(moved * PRICE_SCALE));
  return {
    cashMicros: cashMicros + movedMicros,
    loanedMicros: loanedMicros - movedMicros,
    movedMicros,
  };
}

export interface BankMetricsInput {
  readonly cashMicros: number;
  readonly totalDeposits: number;
  readonly totalActiveBonds: number;
  readonly totalDebt: number;
  /** Sum over debtors in grace of min(third_party_cds_claims, 0.50 * debt), in Pelica. */
  readonly graceCdsLocks: number;
}

export interface BankMetrics {
  readonly locksMicros: number;
  readonly availableMicros: number;
  readonly liabilities: number;
  /** Reserve ratio theta = available / liabilities, or null when liabilities === 0. */
  readonly ratio: number | null;
  readonly level: BankLiquidityLevel;
}

/**
 * Compute reserve locks, available cash, liabilities, reserve ratio theta, and bank-run level.
 * Locks = 5% of total debtor debt + grace-period third-party CDS provisions.
 */
export function computeBankMetrics(input: BankMetricsInput): BankMetrics {
  const debtLockMicros = Math.round(
    (Math.max(0, input.totalDebt) * PRICE_SCALE * TEIAI_CONSTANTS.lockDebtRateBps) / BPS_SCALE,
  );
  const locksMicros = debtLockMicros + Math.max(0, input.graceCdsLocks) * PRICE_SCALE;
  const availableMicros = input.cashMicros - locksMicros;
  const liabilities = Math.max(0, input.totalDeposits) + Math.max(0, input.totalActiveBonds);

  if (liabilities <= 0) {
    return { locksMicros, availableMicros, liabilities: 0, ratio: null, level: 'safe' };
  }

  const ratio = availableMicros / PRICE_SCALE / liabilities;
  let level: BankLiquidityLevel;
  if (availableMicros <= 0) {
    level = 'frozen';
  } else if (ratio < TEIAI_CONSTANTS.runDangerRatioBps / BPS_SCALE) {
    level = 'danger';
  } else if (ratio < TEIAI_CONSTANTS.runWarnRatioBps / BPS_SCALE) {
    level = 'warn';
  } else {
    level = 'safe';
  }

  return { locksMicros, availableMicros, liabilities, ratio, level };
}

/**
 * Compute hourly Teiai Trust continuous-compounding interest due:
 *   r_trust = r_f + trust_premium
 *   due = totalDeposits * expm1(r_trust * elapsedHours / 24) + accruedCarry
 * Returns integer Pelica payable (`truncInt(due)`) and fractional carry in micro-Pelica.
 */
export function computeTrustInterestDue(input: {
  readonly totalDeposits: number;
  readonly rfNano: number;
  readonly trustPremiumNano: number;
  readonly elapsedHours: number;
  readonly accruedCarryMicros: number;
}): {
  readonly payablePelica: number;
  readonly nextCarryMicros: number;
  readonly trustRatePerDay: number;
} {
  const trustRatePerDay = nanoToRate(input.rfNano + input.trustPremiumNano);
  if (input.totalDeposits <= 0 || input.elapsedHours <= 0) {
    return {
      payablePelica: 0,
      nextCarryMicros: input.accruedCarryMicros,
      trustRatePerDay,
    };
  }
  const accrued = input.totalDeposits * Math.expm1((trustRatePerDay * input.elapsedHours) / 24);
  const due = accrued + input.accruedCarryMicros / PRICE_SCALE;
  const payablePelica = Math.max(0, truncInt(due));
  const nextCarryMicros = Math.max(0, Math.round((due - payablePelica) * PRICE_SCALE));
  return { payablePelica, nextCarryMicros, trustRatePerDay };
}

/**
 * Distribute trust interest pro-rata across depositors (`floor(paid * amt / total)`).
 * Unallocated integer dust is returned to the caller to credit back to bank cash / carry.
 */
export function distributeTrustInterest(
  paidPelica: number,
  depositors: readonly { readonly userId: string; readonly amount: number }[],
): {
  readonly payouts: readonly { readonly userId: string; readonly amount: number }[];
  readonly totalDistributed: number;
  readonly dust: number;
} {
  const total = depositors.reduce((sum, d) => sum + Math.max(0, d.amount), 0);
  if (paidPelica <= 0 || total <= 0) {
    return { payouts: [], totalDistributed: 0, dust: Math.max(0, paidPelica) };
  }
  const payouts: { userId: string; amount: number }[] = [];
  let totalDistributed = 0;
  for (const d of depositors) {
    if (d.amount <= 0) continue;
    const share = Math.floor((paidPelica * d.amount) / total);
    if (share > 0) {
      payouts.push({ userId: d.userId, amount: share });
      totalDistributed += share;
    }
  }
  return { payouts, totalDistributed, dust: paidPelica - totalDistributed };
}

export interface BankInflowPlan {
  readonly cashDeltaMicros: number;
  readonly thermostat: ThermostatState;
  readonly burnedMicros: number;
}

/**
 * Apply a bank cash inflow through the frontline thermostat.
 * When `enforce === false` (legacy observation mode), full inflow enters cash while thermostat
 * tracks load and theoretical burn.
 */
export function planBankInflow(
  amountPelica: number,
  thermostat: ThermostatState,
  enforce: boolean = TEIAI_CONSTANTS.thermostatEnforce,
  config: ThermostatConfig = DEFAULT_THERMOSTAT_CONFIG,
): BankInflowPlan {
  const gainMicros = Math.max(0, amountPelica) * PRICE_SCALE;
  const step = absorbInflow(thermostat, gainMicros, config);
  return {
    cashDeltaMicros: enforce ? step.netMicros : gainMicros,
    thermostat: step.state,
    burnedMicros: step.absorbedMicros,
  };
}

export interface BankOutflowPlan {
  readonly cashPaidMicros: number;
  readonly trustHaircutPelica: number;
  readonly thermostat: ThermostatState;
  readonly bailedMicros: number;
  readonly excessForKyosaiPelica: number;
}

/**
 * Multi-layer bank payment waterfall (`_outflow_for`):
 * 1. Bank cash (`min(amount, max(cash, 0))`).
 * 2. Teiai Trust first-loss haircut (`useTrust = true`): `min(ceil(shortfall - 1e-9), totalDeposits)`.
 * 3. Frontline thermostat shock absorption (`thermo = true`).
 * 4. Remaining excess loss charged to Kyosai holders (`floor(excess - bailoutCover)`).
 */
export function planBankOutflow(input: {
  readonly amountPelica: number;
  readonly cashMicros: number;
  readonly totalDeposits: number;
  readonly useTrust: boolean;
  readonly useThermostat: boolean;
  readonly thermostat: ThermostatState;
  readonly enforceThermostat?: boolean;
  readonly config?: ThermostatConfig;
}): BankOutflowPlan {
  const amount = Math.max(0, input.amountPelica);
  if (amount <= 0) {
    return {
      cashPaidMicros: 0,
      trustHaircutPelica: 0,
      thermostat: input.thermostat,
      bailedMicros: 0,
      excessForKyosaiPelica: 0,
    };
  }

  const cashAvail = Math.max(0, input.cashMicros);
  const amountMicros = amount * PRICE_SCALE;
  const cashPaidMicros = Math.min(amountMicros, cashAvail);
  const shortfallPelica = (amountMicros - cashPaidMicros) / PRICE_SCALE;

  const trustHaircutPelica =
    input.useTrust && shortfallPelica > 0
      ? Math.min(Math.ceil(shortfallPelica - 1e-9), Math.max(0, input.totalDeposits))
      : 0;

  const excessPelica = Math.max(0, shortfallPelica - trustHaircutPelica);
  const enforce = input.enforceThermostat ?? TEIAI_CONSTANTS.thermostatEnforce;

  let nextThermo = input.thermostat;
  let bailedMicros = 0;
  if (input.useThermostat && excessPelica > 0) {
    const step = absorbShock(
      input.thermostat,
      Math.round(excessPelica * PRICE_SCALE),
      input.config ?? DEFAULT_THERMOSTAT_CONFIG,
    );
    nextThermo = step.state;
    bailedMicros = step.absorbedMicros;
  }

  const coverPelica = enforce ? bailedMicros / PRICE_SCALE : 0;
  const excessForKyosaiPelica = Math.max(0, truncInt(excessPelica - coverPelica));

  return {
    cashPaidMicros,
    trustHaircutPelica,
    thermostat: nextThermo,
    bailedMicros,
    excessForKyosaiPelica,
  };
}

/**
 * Scale every depositor balance under a trust haircut:
 * `newAmount = floor(amt * (1 - take / total))`. Trust balances never go negative.
 */
export function applyTrustHaircut(
  depositors: readonly { readonly userId: string; readonly amount: number }[],
  takePelica: number,
): readonly { readonly userId: string; readonly newAmount: number; readonly cut: number }[] {
  const total = depositors.reduce((sum, d) => sum + Math.max(0, d.amount), 0);
  if (takePelica <= 0 || total <= 0) {
    return depositors.map((d) => ({ userId: d.userId, newAmount: d.amount, cut: 0 }));
  }
  const keepRatio = Math.max(0, 1 - Math.min(takePelica, total) / total);
  return depositors.map((d) => {
    const newAmount = Math.max(0, truncInt(d.amount * keepRatio));
    return { userId: d.userId, newAmount, cut: d.amount - newAmount };
  });
}
