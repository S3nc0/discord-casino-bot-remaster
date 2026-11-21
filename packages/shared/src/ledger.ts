import { Type } from 'typebox';

/**
 * Why a ledger row exists. Every balance change carries exactly one reason.
 * Append-only list: add values through an A1 task, never rename or remove one
 * (rows in the ledger keep the old string forever).
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
] as const;

export const LedgerReason = Type.Enum(LEDGER_REASONS);
export type LedgerReason = (typeof LEDGER_REASONS)[number];

export function isLedgerReason(value: string): value is LedgerReason {
  return (LEDGER_REASONS as readonly string[]).includes(value);
}
