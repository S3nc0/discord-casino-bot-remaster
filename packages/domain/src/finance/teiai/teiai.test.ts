import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSeededRng, PRICE_SCALE } from '@casino/shared';
import { describe, expect, it } from 'vitest';
import {
  absorbInflow,
  absorbShock,
  accrueDebtInterest,
  cdsExpectedPayout,
  cdsOddsTenths,
  computeBankMetrics,
  computeBankruptcyWaterfall,
  computeTrustInterestDue,
  dailySkim,
  debtWithhold,
  decayThermostat,
  evaluateGraceTransition,
  laborSkim,
  manualSeedLoanQuote,
  planForcedExecution,
  recoverBankLoans,
  rollEscapeAttempt,
  settleCdsDefault,
  splitBankDeposit,
  TEIAI_CONSTANTS,
} from './index.ts';

const ROOT = resolve(fileURLToPath(new URL('../../../../..', import.meta.url)));

interface TeiaiFixture {
  readonly domain_math: {
    readonly skim_1000: number;
    readonly labor_skim_1000: number;
    readonly withhold_1000: number;
    readonly cds_odds: {
      readonly katagi_0: number;
      readonly laborer_8000: number;
      readonly laborer_20000: number;
      readonly wealthy_0: number;
    };
  };
  readonly thermostat: {
    readonly after_inflow_20k: {
      readonly state: { readonly load: number; readonly capacity: number };
      readonly net: number;
      readonly absorbed: number;
    };
    readonly after_shock_30k: {
      readonly state: { readonly load: number; readonly capacity: number };
      readonly net: number;
      readonly absorbed: number;
    };
    readonly after_decay_2d: { readonly load: number; readonly capacity: number };
  };
}

const fixture = JSON.parse(
  readFileSync(resolve(ROOT, 'tests/fixtures/legacy/teiai/bank_debt.json'), 'utf8'),
) as TeiaiFixture;

describe('teiai domain parity', () => {
  it('matches legacy skim, labor_skim, withhold, and cds_odds', () => {
    expect(dailySkim(1_000)).toBe(fixture.domain_math.skim_1000);
    expect(laborSkim(1_000)).toBe(fixture.domain_math.labor_skim_1000);
    expect(debtWithhold(1_000)).toBe(fixture.domain_math.withhold_1000);

    // Note: legacy fixture passed Japanese strings ('カタギ', '地下労働者', '富豪') to cds_odds,
    // hitting the non-'katagi' branch for 'カタギ' and '富豪' (0.85 / 0.25 = 3.4).
    expect(cdsOddsTenths('カタギ', 0, null) / 10).toBe(fixture.domain_math.cds_odds.katagi_0);
    expect(cdsOddsTenths('地下労働者', 8_000, null) / 10).toBe(
      fixture.domain_math.cds_odds.laborer_8000,
    );
    expect(cdsOddsTenths('地下労働者', 20_000, 0.3) / 10).toBe(
      fixture.domain_math.cds_odds.laborer_20000,
    );
    expect(cdsOddsTenths('富豪', 0, null) / 10).toBe(fixture.domain_math.cds_odds.wealthy_0);

    // Canonical English 'katagi' status yields 15.0x cap (0.85 / 0.04 = 21.25 -> clamped to 15.0).
    expect(cdsOddsTenths('katagi', 0, null)).toBe(150);
    // Underground debtor with 10,000 debt (from db_flow.cds_quote): r = 0.25 + 0.5*(10/15) = 0.5833 -> 0.85/r = 1.457 -> 1.5x
    expect(cdsOddsTenths('underground', 10_000, null)).toBe(15);
  });

  it('matches legacy thermostat absorb_inflow, absorb_shock, and decay to 1e-6 Pelica', () => {
    const st0 = { loadMicros: 0, capacityMicros: 100_000 * PRICE_SCALE };
    const inRes = absorbInflow(st0, 20_000 * PRICE_SCALE);
    expect(inRes.netMicros / PRICE_SCALE).toBeCloseTo(fixture.thermostat.after_inflow_20k.net, 6);
    expect(inRes.absorbedMicros / PRICE_SCALE).toBeCloseTo(
      fixture.thermostat.after_inflow_20k.absorbed,
      6,
    );
    expect(inRes.state.loadMicros / PRICE_SCALE).toBeCloseTo(
      fixture.thermostat.after_inflow_20k.state.load,
      6,
    );
    expect(inRes.state.capacityMicros / PRICE_SCALE).toBeCloseTo(
      fixture.thermostat.after_inflow_20k.state.capacity,
      6,
    );

    const shRes = absorbShock(inRes.state, 30_000 * PRICE_SCALE);
    expect(shRes.netMicros / PRICE_SCALE).toBeCloseTo(fixture.thermostat.after_shock_30k.net, 6);
    expect(shRes.absorbedMicros / PRICE_SCALE).toBeCloseTo(
      fixture.thermostat.after_shock_30k.absorbed,
      6,
    );
    expect(shRes.state.loadMicros / PRICE_SCALE).toBeCloseTo(
      fixture.thermostat.after_shock_30k.state.load,
      6,
    );
    expect(shRes.state.capacityMicros / PRICE_SCALE).toBeCloseTo(
      fixture.thermostat.after_shock_30k.state.capacity,
      6,
    );

    const decayed = decayThermostat(shRes.state, 2.0);
    // Stored in integer micro-Pelica (1e-6 Pelica quantization between steps)
    expect(
      Math.abs(decayed.loadMicros / PRICE_SCALE - fixture.thermostat.after_decay_2d.load),
    ).toBeLessThanOrEqual(1e-6);
    expect(
      Math.abs(decayed.capacityMicros / PRICE_SCALE - fixture.thermostat.after_decay_2d.capacity),
    ).toBeLessThanOrEqual(1e-6);
  });

  it('enforces debt interest 14,999 ceiling and 10-day catchup cap', () => {
    const baseMs = 1_736_121_600_000;
    // Already above ceiling (19,000) -> 0 added
    expect(accrueDebtInterest(19_000, baseMs, baseMs + 3 * 86_400_000).added).toBe(0);
    // Just below ceiling (14,950) -> capped at 49 so debt stays <= 14,999
    const capped = accrueDebtInterest(14_950, baseMs, baseMs + 5 * 86_400_000);
    expect(capped.added).toBe(49);
    expect(capped.nextDebt).toBe(TEIAI_CONSTANTS.debtInterestCeiling);
    // 30 days elapsed on 5,000 debt -> max 10 days = 500
    const maxCap = accrueDebtInterest(5_000, baseMs, baseMs + 30 * 86_400_000);
    expect(maxCap.daysCounted).toBe(10);
    expect(maxCap.added).toBe(500);
    expect(maxCap.nextInterestAtMs).toBe(baseMs + 30 * 86_400_000);
  });

  it('handles grace transitions, escape attempts, forced execution, and bankruptcy waterfall', () => {
    const baseMs = 1_736_121_600_000;
    const enter = evaluateGraceTransition(15_000, null, baseMs);
    expect(enter.enteredGrace).toBe(true);
    expect(enter.nextGraceUntilMs).toBe(baseMs + 24 * 3_600_000);

    const exit = evaluateGraceTransition(14_999, enter.nextGraceUntilMs, baseMs + 60_000);
    expect(exit.exitedGrace).toBe(true);
    expect(exit.nextGraceUntilMs).toBeNull();

    // Manual seed quote
    expect(manualSeedLoanQuote({ balance: 0, status: 'katagi', inGrace: false })).toEqual({
      ok: true,
      amount: 3_000,
    });
    expect(manualSeedLoanQuote({ balance: 1_000, status: 'underground', inGrace: true }).ok).toBe(
      false,
    );

    // Escape attempt failure adds max(1000, 10% of debt)
    const rng = createSeededRng(42);
    const esc = rollEscapeAttempt(
      {
        debt: 19_000,
        status: 'underground',
        escapeTries: 0,
        lastEscapeAtMs: 0,
        nowMs: baseMs,
      },
      rng,
    );
    expect(esc.ok).toBe(true);
    if (esc.ok && !esc.escaped) {
      expect(esc.fine).toBe(1_900);
      expect(esc.nextDebt).toBe(20_900);
    }

    // Bankruptcy waterfall + CODE behaviour: escaping while already in grace pays third-party CDS
    const wfGraceEscape = computeBankruptcyWaterfall({
      pool: 3_000,
      teiaiDebt: 20_900,
      juniorLoans: [],
      forced: false,
      inGrace: true,
      escape: true,
    });
    expect(wfGraceEscape.cdsPayable).toBe(true);
    expect(wfGraceEscape.finalDebt).toBe(0);

    // Forced bankruptcy matching fixture db_flow.forced_bankruptcy
    const wfForced = computeBankruptcyWaterfall({
      pool: 3_000,
      teiaiDebt: 20_900,
      juniorLoans: [],
      forced: true,
      inGrace: true,
      escape: false,
    });
    expect(wfForced.seniorPaid).toBe(3_000);
    expect(wfForced.compressed).toBe(7_900);
    expect(wfForced.seedLoan).toBe(3_000);
    expect(wfForced.finalDebt).toBe(13_000);
    expect(wfForced.cdsPayable).toBe(true);

    // CDS settlement cap (50% of debtBefore)
    const cdsRes = settleCdsDefault(
      [{ id: 1, buyerId: 'u3', stake: 5_000, oddsTenths: 15 }],
      20_900,
    );
    expect(cdsExpectedPayout(5_000, 15)).toBe(7_500);
    expect(cdsRes.totalPaid).toBe(7_500);

    // Forced execution 9-step seizure ordering
    const exec = planForcedExecution({
      need: 10_000,
      cash: 1_000,
      trustDeposit: 2_000,
      companyFunds: 1_500,
      marginLiquidatable: 500,
      spotLiquidatable: 1_000,
      optionLiquidatable: 500,
      normalBondLiquidatable: 1_000,
      selfCdsCoverage: 500,
    });
    expect(exec.fromCash).toBe(1_000);
    expect(exec.fromTrust).toBe(2_000);
    expect(exec.fromCompanyFunds).toBe(1_500);
    expect(exec.fromSelfCds).toBe(500);
    expect(exec.addedDebt).toBe(2_000);
  });

  it('computes reserve splits, recovery, liquidity metrics, and trust interest accurately', () => {
    const split = splitBankDeposit(40_000);
    expect(split.cashDeltaMicros).toBe(8_000 * PRICE_SCALE);
    expect(split.loanedDeltaMicros).toBe(32_000 * PRICE_SCALE);

    const metrics = computeBankMetrics({
      cashMicros: split.cashDeltaMicros,
      totalDeposits: 40_000,
      totalActiveBonds: 0,
      totalDebt: 0,
      graceCdsLocks: 0,
    });
    expect(metrics.ratio).toBeCloseTo(0.2, 10);
    expect(metrics.level).toBe('safe');

    const rec = recoverBankLoans(split.cashDeltaMicros, split.loanedDeltaMicros, 1);
    expect(rec.movedMicros).toBe(640 * PRICE_SCALE);

    const trust = computeTrustInterestDue({
      totalDeposits: 100_000,
      rfNano: 15_000_000, // 0.015/day
      trustPremiumNano: 1_000_000, // 0.001/day
      elapsedHours: 24,
      accruedCarryMicros: 0,
    });
    expect(trust.payablePelica).toBe(Math.trunc(100_000 * Math.expm1(0.016)));
  });
});
