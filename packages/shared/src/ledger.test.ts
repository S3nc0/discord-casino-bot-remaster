import { describe, expect, it } from 'vitest';
import { Value } from 'typebox/value';
import {
  LEDGER_FLOWS,
  LEDGER_REASONS,
  LEDGER_REASON_FLOW,
  LEDGER_REASON_SIGN,
  LedgerFlow,
  LedgerReason,
  SCREEN_IDS,
  isDeltaAllowed,
  isScreenId,
  ledgerFlowOf,
  ledgerReasonsOf,
} from './index.ts';

/** The Wave 1 list, frozen: later tasks may only append. */
const WAVE1_REASONS = [
  'initial_grant',
  'legacy_import',
  'admin_grant',
  'admin_revoke',
  'daily_bonus',
  'mission_reward',
  'title_reward',
  'game_stake',
  'game_payout',
  'game_refund',
  'jackpot_payout',
  'race_bet',
  'race_payout',
  'race_prize',
  'race_refund',
  'arena_bet',
  'arena_payout',
  'arena_refund',
  'transfer_out',
  'transfer_in',
  'transfer_fee',
  'shop_buy',
  'shop_sell',
  'shop_refund',
  'horse_buy',
  'horse_sell',
  'horse_upkeep',
  'horse_retirement',
  'marketplace_buy',
  'marketplace_hold',
  'marketplace_release',
  'marketplace_sale',
  'marketplace_fee',
  'work_earnings',
  'worker_hire',
  'quiz_reward',
  'lottery_entry',
  'lottery_refund',
  'lottery_prize',
  'poll_fee',
  'stock_buy',
  'stock_sell',
  'margin_open',
  'margin_close',
  'margin_interest',
  'option_premium',
  'option_payout',
  'bond_buy',
  'bond_coupon',
  'bond_redeem',
  'bank_deposit',
  'bank_withdraw',
  'bank_interest',
  'loan_borrow',
  'loan_repay',
  'loan_interest',
  'p2p_lend',
  'p2p_repay',
  'cds_premium',
  'cds_payout',
  'debt_withholding',
  'bankruptcy_writeoff',
  'kyosai_buy',
  'kyosai_sell',
  'kyosai_bid_hold',
  'kyosai_bid_release',
  'kyosai_dividend',
  'kyosai_charge',
  'company_create',
  'company_upgrade',
  'company_invest',
  'company_dividend',
  'company_payout',
] as const;

describe('ledger reasons', () => {
  it('only appends to the Wave 1 list', () => {
    expect(LEDGER_REASONS.slice(0, WAVE1_REASONS.length)).toEqual(WAVE1_REASONS);
    expect(new Set(LEDGER_REASONS).size).toBe(LEDGER_REASONS.length);
  });

  it('covers the money movements named in the legacy spec', () => {
    for (const r of [
      'capital_gains_tax',
      'teiai_skim',
      'debt_seizure',
      'kyosai_fee',
      'trade_fee',
      'game_penalty',
      'race_entry_fee',
      'horse_retirement_fee',
      'teiai_auction_buy',
      'teiai_market_buy',
      'marketplace_auction_sale',
      'work_upgrade',
      'work_renewal',
      'quiz_author_reward',
      'quiz_author_clawback',
      'option_write_premium',
      'option_buyback',
      'p2p_borrow',
      'p2p_collect',
      'p2p_garnishment',
      'p2p_bankruptcy_payout',
    ]) {
      expect(Value.Check(LedgerReason, r)).toBe(true);
    }
  });

  it('gives every reason one flow class and one direction', () => {
    expect(Object.keys(LEDGER_REASON_FLOW).sort()).toEqual([...LEDGER_REASONS].sort());
    expect(Object.keys(LEDGER_REASON_SIGN).sort()).toEqual([...LEDGER_REASONS].sort());
    for (const r of LEDGER_REASONS) {
      expect(Value.Check(LedgerFlow, LEDGER_REASON_FLOW[r])).toBe(true);
      expect([1, -1]).toContain(LEDGER_REASON_SIGN[r]);
      expect(ledgerFlowOf(r)).toBe(LEDGER_REASON_FLOW[r]);
    }
  });

  it('makes faucets credits and sinks debits', () => {
    for (const r of ledgerReasonsOf('faucet')) expect(LEDGER_REASON_SIGN[r]).toBe(1);
    for (const r of ledgerReasonsOf('sink')) expect(LEDGER_REASON_SIGN[r]).toBe(-1);
  });

  it('partitions the list into the three flows', () => {
    const all = LEDGER_FLOWS.flatMap((f) => ledgerReasonsOf(f));
    expect(all.sort()).toEqual([...LEDGER_REASONS].sort());
  });

  it('pairs every transfer leg with a leg in the other direction', () => {
    const transfers = ledgerReasonsOf('transfer');
    const out = transfers.filter((r) => LEDGER_REASON_SIGN[r] === -1);
    const inn = transfers.filter((r) => LEDGER_REASON_SIGN[r] === 1);
    expect(out.sort()).toEqual([
      'kyosai_buy',
      'marketplace_buy',
      'p2p_garnishment',
      'p2p_lend',
      'p2p_repay',
      'transfer_out',
    ]);
    expect(inn.sort()).toEqual([
      'kyosai_sell',
      'marketplace_sale',
      'p2p_borrow',
      'p2p_collect',
      'transfer_in',
    ]);
  });

  it('classifies the Teiai and fee reasons as sinks', () => {
    for (const r of [
      'transfer_fee',
      'marketplace_fee',
      'kyosai_fee',
      'poll_fee',
      'capital_gains_tax',
      'teiai_skim',
      'debt_withholding',
      'debt_seizure',
      'bankruptcy_writeoff',
      'cds_premium',
    ] as const) {
      expect(LEDGER_REASON_FLOW[r]).toBe('sink');
    }
  });

  it('checks the delta direction', () => {
    expect(isDeltaAllowed('daily_bonus', 500)).toBe(true);
    expect(isDeltaAllowed('daily_bonus', -500)).toBe(false);
    expect(isDeltaAllowed('teiai_skim', -100)).toBe(true);
    expect(isDeltaAllowed('teiai_skim', 100)).toBe(false);
    expect(isDeltaAllowed('transfer_in', 0)).toBe(false);
    expect(isDeltaAllowed('transfer_out', -1.5)).toBe(false);
  });
});

describe('screen ids from the spec', () => {
  it('routes every spec module', () => {
    for (const s of [
      'relics',
      'crypto',
      'companies',
      'kyosai',
      'loans',
      'bank',
      'lottery',
      'poll',
      'quiz',
      'missions',
      'ranking',
      'daily',
      'transfer',
      'shop',
      'market',
      'stocks',
      'work',
      'horse',
      'arena',
    ]) {
      expect(isScreenId(s)).toBe(true);
    }
    expect(new Set(SCREEN_IDS).size).toBe(SCREEN_IDS.length);
  });
});
