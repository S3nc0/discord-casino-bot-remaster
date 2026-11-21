import { create } from 'zustand';
import type { BalanceUpdate } from '@casino/shared';

export interface BalanceState {
  /** null until the first value arrives. */
  balance: number | null;
  /** Ledger id of the newest applied update; older updates are ignored. */
  ledgerId: number;
  lastDelta: number;
  set: (balance: number) => void;
  apply: (update: Pick<BalanceUpdate, 'balance' | 'delta' | 'ledgerId'>) => void;
  reset: () => void;
}

export const useBalanceStore = create<BalanceState>()((set, get) => ({
  balance: null,
  ledgerId: 0,
  lastDelta: 0,
  set: (balance) => set({ balance, lastDelta: 0 }),
  apply: (update) => {
    if (update.ledgerId <= get().ledgerId) return;
    set({ balance: update.balance, lastDelta: update.delta, ledgerId: update.ledgerId });
  },
  reset: () => set({ balance: null, ledgerId: 0, lastDelta: 0 }),
}));
