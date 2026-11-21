import { PRICE_SCALE } from '@casino/shared';
import { TEIAI_CONSTANTS } from './constants.ts';

/**
 * Frontline thermostat state stored in integer micro-Pelica (`PRICE_SCALE = 1_000_000`).
 * Floating-point exponential absorption and decay happen strictly inside this module and are
 * rounded to nearest integer micro-Pelica at the boundary.
 */
export interface ThermostatState {
  /** Signed short-term heat load in micro-Pelica (positive = surplus inflow, negative = shock). */
  readonly loadMicros: number;
  /** Long-term capacity in micro-Pelica (>= capacityMin * PRICE_SCALE). */
  readonly capacityMicros: number;
}

export interface ThermostatConfig {
  readonly coolDays: number;
  readonly memoryRatio: number;
  readonly capacityMin: number;
  readonly coupling: number;
}

export const DEFAULT_THERMOSTAT_CONFIG: ThermostatConfig = {
  coolDays: TEIAI_CONSTANTS.thermostatCoolDays,
  memoryRatio: TEIAI_CONSTANTS.thermostatMemoryRatio,
  capacityMin: TEIAI_CONSTANTS.thermostatCapacityMin,
  coupling: TEIAI_CONSTANTS.thermostatCoupling,
};

export interface ThermostatStepResult {
  readonly state: ThermostatState;
  /** Net amount passing through to the bank vault, in micro-Pelica. */
  readonly netMicros: number;
  /** Amount absorbed (burned on inflow, bailed out on shock), in micro-Pelica. */
  readonly absorbedMicros: number;
}

export function initialThermostatState(
  config: ThermostatConfig = DEFAULT_THERMOSTAT_CONFIG,
): ThermostatState {
  return {
    loadMicros: 0,
    capacityMicros: Math.round(config.capacityMin * PRICE_SCALE),
  };
}

/**
 * Split-invariant absorption curve:
 * `computeNet(amount, load, cap, c) = (max(cap - c * load, 0) / c) * (-expm1(-c * amount / cap))`.
 */
export function computeThermostatNet(
  amount: number,
  load: number,
  capacity: number,
  coupling: number = DEFAULT_THERMOSTAT_CONFIG.coupling,
): number {
  if (amount <= 0 || capacity <= 0) return 0;
  const room = Math.max(capacity - coupling * load, 0);
  if (room <= 0) return 0;
  return (room / coupling) * -Math.expm1((-coupling * amount) / capacity);
}

/** Remaining positive room before saturation, in micro-Pelica. */
export function thermostatRoomMicros(
  state: ThermostatState,
  config: ThermostatConfig = DEFAULT_THERMOSTAT_CONFIG,
): number {
  const cap = state.capacityMicros / PRICE_SCALE;
  const load = state.loadMicros / PRICE_SCALE;
  return Math.round(Math.max(0, cap - config.coupling * load) * PRICE_SCALE);
}

/**
 * Exact closed-form decay over `days >= 0`:
 *   lambda_L = ln(10) / coolDays
 *   lambda_E = lambda_L / memoryRatio
 *   L' = L * exp(-lambda_L * days)
 *   E' = max(E_min, E_min + (E - E_min) * exp(-lambda_E * days) + L * (exp(-lambda_E * days) - exp(-lambda_L * days)))
 * Rounded to nearest integer micro-Pelica at the boundary.
 */
export function decayThermostat(
  state: ThermostatState,
  days: number,
  config: ThermostatConfig = DEFAULT_THERMOSTAT_CONFIG,
): ThermostatState {
  if (days <= 0) return state;
  const lambdaL = Math.LN10 / config.coolDays;
  const lambdaE = lambdaL / config.memoryRatio;
  const fallL = Math.exp(-lambdaL * days);
  const fallE = Math.exp(-lambdaE * days);

  const load = state.loadMicros / PRICE_SCALE;
  const cap = state.capacityMicros / PRICE_SCALE;
  const eMin = config.capacityMin;

  const nextLoad = load * fallL;
  const nextCap = Math.max(eMin, eMin + (cap - eMin) * fallE + load * (fallE - fallL));

  return {
    loadMicros: Math.round(nextLoad * PRICE_SCALE),
    capacityMicros: Math.round(nextCap * PRICE_SCALE),
  };
}

/**
 * Absorb a positive bank inflow (`gainMicros >= 0`).
 * Any negative load is refilled 1:1 first; remaining inflow passes through the split-invariant
 * absorption curve. Boundary rounding: nearest integer micro-Pelica.
 */
export function absorbInflow(
  state: ThermostatState,
  gainMicros: number,
  config: ThermostatConfig = DEFAULT_THERMOSTAT_CONFIG,
): ThermostatStepResult {
  if (gainMicros <= 0) {
    return { state, netMicros: 0, absorbedMicros: 0 };
  }
  const gain = gainMicros / PRICE_SCALE;
  const load = state.loadMicros / PRICE_SCALE;
  const cap = state.capacityMicros / PRICE_SCALE;

  const fill = Math.min(gain, Math.max(-load, 0));
  const loadAfterFill = load + fill;
  const extra = gain - fill;
  const netExtra = computeThermostatNet(extra, Math.max(loadAfterFill, 0), cap, config.coupling);
  const net = fill + netExtra;
  const burn = gain - net;
  const nextLoad = load + net;

  const netRounded = Math.round(net * PRICE_SCALE);
  return {
    state: {
      loadMicros: Math.round(nextLoad * PRICE_SCALE),
      capacityMicros: state.capacityMicros,
    },
    netMicros: netRounded,
    absorbedMicros: Math.round(burn * PRICE_SCALE),
  };
}

/**
 * Absorb a negative bank shock (`lossMicros >= 0`).
 * Any positive load absorbs 1:1 first; remaining shock passes through the symmetric absorption
 * curve. Boundary rounding: nearest integer micro-Pelica.
 */
export function absorbShock(
  state: ThermostatState,
  lossMicros: number,
  config: ThermostatConfig = DEFAULT_THERMOSTAT_CONFIG,
): ThermostatStepResult {
  if (lossMicros <= 0) {
    return { state, netMicros: 0, absorbedMicros: 0 };
  }
  const loss = lossMicros / PRICE_SCALE;
  const load = state.loadMicros / PRICE_SCALE;
  const cap = state.capacityMicros / PRICE_SCALE;

  const covered = Math.min(loss, Math.max(load, 0));
  const loadAfterCover = load - covered;
  const extra = loss - covered;
  const netExtra = computeThermostatNet(extra, Math.max(-loadAfterCover, 0), cap, config.coupling);
  const effective = covered + netExtra;
  const bailout = loss - effective;
  const nextLoad = load - effective;

  const netRounded = Math.round(effective * PRICE_SCALE);
  return {
    state: {
      loadMicros: Math.round(nextLoad * PRICE_SCALE),
      capacityMicros: state.capacityMicros,
    },
    netMicros: netRounded,
    absorbedMicros: Math.round(bailout * PRICE_SCALE),
  };
}
