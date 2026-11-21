import { Type } from 'typebox';

/**
 * Why a ledger row exists. Every balance change carries exactly one reason.
 * Append-only list: add values through an A1 task, never rename or remove one
 * (rows in the ledger keep the old string forever).
 *
 * Every reason has one direction (`LEDGER_REASON_SIGN`) and one flow class
 * (`LEDGER_REASON_FLOW`). The rules are in docs/ARCHITECTURE.md ("Ledger reasons").
 */
export const LEDGER_REASONS = [
  // account
  'initial_grant',
  'legacy_import',
  'admin_grant',
  'admin_revoke',
  // daily, missions, titles
  'daily_bonus',
  'mission_reward',
  'title_reward',
  // casino games and other wagers
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
  // transfers
  'transfer_out',
  'transfer_in',
  'transfer_fee',
  // shop, items, horses
  'shop_buy',
  'shop_sell',
  'shop_refund',
  'horse_buy',
  'horse_sell',
  'horse_upkeep',
  'horse_retirement',
  // player market
  'marketplace_buy',
  'marketplace_hold',
  'marketplace_release',
  'marketplace_sale',
  'marketplace_fee',
  // work, quiz, lottery, polls
  'work_earnings',
  'worker_hire',
  'quiz_reward',
  'lottery_entry',
  'lottery_refund',
  'lottery_prize',
  'poll_fee',
  // securities
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
  // Teiai bank, loans, CDS, bankruptcy
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
  // Teiai kyosai (mutual fund units, auctions, dividends, loss charges)
  'kyosai_buy',
  'kyosai_sell',
  'kyosai_bid_hold',
  'kyosai_bid_release',
  'kyosai_dividend',
  'kyosai_charge',
  // companies (company funds are separate; these move Pelica between a player and a company)
  'company_create',
  'company_upgrade',
  'company_invest',
  'company_dividend',
  'company_payout',
  // --- added from the legacy spec (docs/spec/) ---
  // casino: extra loss above the stake (chinchiro multiplier loss)
  'game_penalty',
  // horse racing: entry fee; retirement with a negative value
  'race_entry_fee',
  'horse_retirement_fee',
  // Teiai shop channels: seized-goods auction and timed black market
  'teiai_auction_buy',
  'teiai_market_buy',
  // player market: seller paid from a won auction's escrowed bid
  'marketplace_auction_sale',
  // labor: tool and dorm upgrades, worker contract renewal paid from the wallet
  'work_upgrade',
  'work_renewal',
  // quiz: author payout and its downward adjustment
  'quiz_author_reward',
  'quiz_author_clawback',
  // securities (stocks and the cs crypto ticker share one spot book)
  'capital_gains_tax',
  'trade_fee',
  'option_write_premium',
  'option_buyback',
  // Teiai: skims on income while in debt; cash taken by forced execution
  'teiai_skim',
  'debt_seizure',
  // P2P loans: the receiving legs, garnishment, and the bankruptcy dividend to lenders
  'p2p_borrow',
  'p2p_collect',
  'p2p_garnishment',
  'p2p_bankruptcy_payout',
  // kyosai: 5% fee on player-to-player unit trades
  'kyosai_fee',
] as const;

export const LedgerReason = Type.Enum(LEDGER_REASONS);
export type LedgerReason = (typeof LEDGER_REASONS)[number];

export function isLedgerReason(value: string): value is LedgerReason {
  return (LEDGER_REASONS as readonly string[]).includes(value);
}

/**
 * Where a row's Pelica comes from or goes to, seen from player balances (the ledger).
 * - `faucet`: credit whose Pelica does not come from another player's balance in the same
 *   transaction (system grant, Teiai bank or house account, company funds, an escrow, a
 *   position, a pot). Pelica enters circulation.
 * - `sink`: debit whose Pelica does not go to another player's balance in the same transaction.
 *   Pelica leaves circulation (escrows and positions included: they come back as faucets).
 * - `transfer`: one leg of a player-to-player move. The transfer rows of one transaction always
 *   sum to zero; fees on top are separate sink rows.
 */
export const LEDGER_FLOWS = ['faucet', 'sink', 'transfer'] as const;
export const LedgerFlow = Type.Enum(LEDGER_FLOWS);
export type LedgerFlow = (typeof LEDGER_FLOWS)[number];

/** Flow class and direction of each reason. `sign` is the sign every `delta` must have. */
const FLOW: { readonly [R in LedgerReason]: readonly [LedgerFlow, 1 | -1] } = {
  initial_grant: ['faucet', 1],
  legacy_import: ['faucet', 1],
  admin_grant: ['faucet', 1],
  admin_revoke: ['sink', -1],
  daily_bonus: ['faucet', 1],
  mission_reward: ['faucet', 1],
  title_reward: ['faucet', 1],
  game_stake: ['sink', -1],
  game_payout: ['faucet', 1],
  game_refund: ['faucet', 1],
  jackpot_payout: ['faucet', 1],
  race_bet: ['sink', -1],
  race_payout: ['faucet', 1],
  race_prize: ['faucet', 1],
  race_refund: ['faucet', 1],
  arena_bet: ['sink', -1],
  arena_payout: ['faucet', 1],
  arena_refund: ['faucet', 1],
  transfer_out: ['transfer', -1],
  transfer_in: ['transfer', 1],
  transfer_fee: ['sink', -1],
  shop_buy: ['sink', -1],
  shop_sell: ['faucet', 1],
  shop_refund: ['faucet', 1],
  horse_buy: ['sink', -1],
  horse_sell: ['faucet', 1],
  horse_upkeep: ['sink', -1],
  horse_retirement: ['faucet', 1],
  marketplace_buy: ['transfer', -1],
  marketplace_hold: ['sink', -1],
  marketplace_release: ['faucet', 1],
  marketplace_sale: ['transfer', 1],
  marketplace_fee: ['sink', -1],
  work_earnings: ['faucet', 1],
  worker_hire: ['sink', -1],
  quiz_reward: ['faucet', 1],
  lottery_entry: ['sink', -1],
  lottery_refund: ['faucet', 1],
  lottery_prize: ['faucet', 1],
  poll_fee: ['sink', -1],
  stock_buy: ['sink', -1],
  stock_sell: ['faucet', 1],
  margin_open: ['sink', -1],
  margin_close: ['faucet', 1],
  margin_interest: ['sink', -1],
  option_premium: ['sink', -1],
  option_payout: ['faucet', 1],
  bond_buy: ['sink', -1],
  bond_coupon: ['faucet', 1],
  bond_redeem: ['faucet', 1],
  bank_deposit: ['sink', -1],
  bank_withdraw: ['faucet', 1],
  bank_interest: ['faucet', 1],
  loan_borrow: ['faucet', 1],
  loan_repay: ['sink', -1],
  loan_interest: ['sink', -1],
  p2p_lend: ['transfer', -1],
  p2p_repay: ['transfer', -1],
  cds_premium: ['sink', -1],
  cds_payout: ['faucet', 1],
  debt_withholding: ['sink', -1],
  bankruptcy_writeoff: ['sink', -1],
  kyosai_buy: ['transfer', -1],
  kyosai_sell: ['transfer', 1],
  kyosai_bid_hold: ['sink', -1],
  kyosai_bid_release: ['faucet', 1],
  kyosai_dividend: ['faucet', 1],
  kyosai_charge: ['sink', -1],
  company_create: ['sink', -1],
  company_upgrade: ['sink', -1],
  company_invest: ['sink', -1],
  company_dividend: ['faucet', 1],
  company_payout: ['faucet', 1],
  game_penalty: ['sink', -1],
  race_entry_fee: ['sink', -1],
  horse_retirement_fee: ['sink', -1],
  teiai_auction_buy: ['sink', -1],
  teiai_market_buy: ['sink', -1],
  marketplace_auction_sale: ['faucet', 1],
  work_upgrade: ['sink', -1],
  work_renewal: ['sink', -1],
  quiz_author_reward: ['faucet', 1],
  quiz_author_clawback: ['sink', -1],
  capital_gains_tax: ['sink', -1],
  trade_fee: ['sink', -1],
  option_write_premium: ['faucet', 1],
  option_buyback: ['sink', -1],
  teiai_skim: ['sink', -1],
  debt_seizure: ['sink', -1],
  p2p_borrow: ['transfer', 1],
  p2p_collect: ['transfer', 1],
  p2p_garnishment: ['transfer', -1],
  p2p_bankruptcy_payout: ['faucet', 1],
  kyosai_fee: ['sink', -1],
};

function project<T>(pick: (entry: readonly [LedgerFlow, 1 | -1]) => T) {
  return Object.fromEntries(LEDGER_REASONS.map((r) => [r, pick(FLOW[r])])) as {
    readonly [R in LedgerReason]: T;
  };
}

/** Reason → faucet / sink / transfer. The Wave 3 supply invariant is checked against this. */
export const LEDGER_REASON_FLOW = project((e) => e[0]);

/** Reason → required sign of `delta` (+1 credit, -1 debit). Deltas are never 0. */
export const LEDGER_REASON_SIGN = project((e) => e[1]);

export function ledgerFlowOf(reason: LedgerReason): LedgerFlow {
  return LEDGER_REASON_FLOW[reason];
}

/** True when `delta` is a non-zero safe integer with the direction `reason` requires. */
export function isDeltaAllowed(reason: LedgerReason, delta: number): boolean {
  return (
    Number.isSafeInteger(delta) && delta !== 0 && Math.sign(delta) === LEDGER_REASON_SIGN[reason]
  );
}

/** Reasons of one flow class, in list order. */
export function ledgerReasonsOf(flow: LedgerFlow): LedgerReason[] {
  return LEDGER_REASONS.filter((r) => LEDGER_REASON_FLOW[r] === flow);
}
