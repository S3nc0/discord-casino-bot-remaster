import { PRICE_SCALE } from '@casino/shared';
import type { Clock } from '@casino/shared';
import type { Store } from '../../db/store.ts';
import type { TeiaiService } from '../../finance/teiai-service.ts';
import type { TeiaiPort } from '../../games/progression/ports.ts';

export interface TeiaiPortDeps {
  store?: Store;
  teiai: TeiaiService;
  clock?: Clock;
}

/**
 * The games' `TeiaiPort` on the real Teiai services: debt, bank cash and house income all live
 * in the finance tables, so a player's debt is the same number in the casino, the daily claim
 * and the bank.
 */
export function createTeiaiPort({ teiai, clock }: TeiaiPortDeps): TeiaiPort {
  return {
    debtOf(guildId, userId) {
      // Interest accrues on access, as in the finance services.
      teiai.accrueDebtInterest(guildId, userId);
      return teiai.getDebt(guildId, userId);
    },

    addDebt(guildId, userId, amount) {
      teiai.addDebtFromExcess(guildId, userId, amount);
    },

    /**
     * The caller already took `amount` from the wallet (a `debt_withholding` row), so only the
     * debt shrinks and the finance service's grace/blacklist rules run.
     */
    repayDebt(guildId, userId, amount) {
      teiai.repayWithheldDebt(guildId, userId, amount, clock?.now());
    },

    bankCash(guildId) {
      const reserve = teiai.ensureReserve(guildId);
      return Math.max(0, Math.floor(reserve.cash_micros / PRICE_SCALE));
    },

    drawBankCash(guildId, amount) {
      // Prize top-ups and subsidies come out of cash only: no trust haircut, no thermostat.
      teiai.bankOutflow(guildId, amount, { useTrust: false, thermo: false });
    },

    bankIncome(guildId, amount) {
      teiai.bankIncome(guildId, amount);
    },

    houseIncome(guildId, amount, why) {
      teiai.houseReceive(guildId, amount, { isSkim: why.includes('skim') });
    },
  };
}
