import { withholdIncome } from './economy-core.ts';

export const TRANSFER_FEE_RATE_BPS = 1000;
export const TRANSFER_DAILY_LIMIT = 20_000;
export const TRANSFER_CONFIRM_FROM = 5000;
export const TRANSFER_MIN_GAMES = 3;
export const TRANSFER_MAX_AMOUNT = 1_000_000;

/** 10 % ceiling fee, paid on top by the sender; at least 1 for any positive amount. */
export function transferFee(amount: number): number {
  if (amount <= 0) return 0;
  return Math.ceil((amount * TRANSFER_FEE_RATE_BPS) / 10_000);
}

export type TransferError =
  | { code: 'transfer_self'; params: Record<string, never> }
  | { code: 'amount_must_be_positive'; params: Record<string, never> }
  | { code: 'transfer_min_games'; params: { min_games: number } }
  | { code: 'transfer_daily_limit'; params: { daily_limit: number; sent_today: number } }
  | { code: 'debt_blocks'; params: { debt: number } }
  | { code: 'transfer_insufficient_balance'; params: { need: number; balance: number } };

export interface TransferInput {
  senderId: string;
  receiverId: string;
  amount: number;
  /** `games_played` of the sender. */
  senderGames: number;
  /** Principal sent today (fees excluded). */
  sentToday: number;
  senderDebt: number;
  senderBalance: number;
  receiverDebt: number;
}

export type TransferPlan =
  | {
      ok: true;
      amount: number;
      fee: number;
      /** Part of the received amount withheld toward the receiver's debt. */
      receiverWithheld: number;
      needsConfirm: boolean;
    }
  | { ok: false; error: TransferError };

/** Validation order of the legacy repo, then the amounts. */
export function planTransfer(input: TransferInput): TransferPlan {
  const fail = (error: TransferError): TransferPlan => ({ ok: false, error });
  if (input.senderId === input.receiverId) return fail({ code: 'transfer_self', params: {} });
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    return fail({ code: 'amount_must_be_positive', params: {} });
  }
  if (input.senderGames < TRANSFER_MIN_GAMES) {
    return fail({ code: 'transfer_min_games', params: { min_games: TRANSFER_MIN_GAMES } });
  }
  if (input.sentToday + input.amount > TRANSFER_DAILY_LIMIT) {
    return fail({
      code: 'transfer_daily_limit',
      params: { daily_limit: TRANSFER_DAILY_LIMIT, sent_today: input.sentToday },
    });
  }
  if (input.senderDebt > 0)
    return fail({ code: 'debt_blocks', params: { debt: input.senderDebt } });
  const fee = transferFee(input.amount);
  if (input.senderBalance < input.amount + fee) {
    return fail({
      code: 'transfer_insufficient_balance',
      params: { need: input.amount + fee, balance: input.senderBalance },
    });
  }
  return {
    ok: true,
    amount: input.amount,
    fee,
    receiverWithheld: withholdIncome(input.amount, input.receiverDebt),
    needsConfirm: input.amount >= TRANSFER_CONFIRM_FROM,
  };
}
