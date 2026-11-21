import { PRICE_SCALE } from '@casino/shared';
import { evaluateGraceTransition, TEIAI_CONSTANTS } from '@casino/domain/finance';
import type { Clock } from '@casino/shared';
import type { Store } from '../../db/store.ts';
import type { TeiaiService } from '../../finance/teiai-service.ts';
import type { TeiaiPort } from '../../games/progression/ports.ts';

const MS_PER_DAY = 86_400_000;

export interface TeiaiPortDeps {
  store: Store;
  teiai: TeiaiService;
  clock: Clock;
}

/**
 * The games' `TeiaiPort` on the real Teiai services: debt, bank cash and house income all live
 * in the finance tables, so a player's debt is the same number in the casino, the daily claim
 * and the bank.
 */
export function createTeiaiPort({ store, teiai, clock }: TeiaiPortDeps): TeiaiPort {
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
     * debt shrinks. Mirrors the finance services' after-change rules: leaving the grace window
     * below the threshold, and the blacklist when a bankrupt player's debt reaches zero.
     * TODO(B3): replace by a public `TeiaiService` method so the rules live in one place.
     */
    repayDebt(guildId, userId, amount) {
      if (amount <= 0) return;
      store.transaction(() => {
        const nowMs = clock.now();
        const acc = teiai.ensureAccount(guildId, userId);
        const debt = Math.max(0, acc.debt - amount);
        const grace = evaluateGraceTransition(debt, acc.grace_until, nowMs);
        let bankruptAt = acc.bankrupt_at;
        let blacklistUntil = acc.blacklist_until;
        let interestAt = acc.debt_interest_at;
        if (debt <= 0) {
          interestAt = 0;
          if (bankruptAt !== null) {
            bankruptAt = null;
            blacklistUntil = nowMs + TEIAI_CONSTANTS.blacklistDays * MS_PER_DAY;
          }
        }
        store
          .stmt(
            `UPDATE bank_accounts
             SET debt = ?, grace_until = ?, bankrupt_at = ?, blacklist_until = ?, debt_interest_at = ?
             WHERE guild_id = ? AND user_id = ?`,
          )
          .run(
            debt,
            grace.nextGraceUntilMs,
            bankruptAt,
            blacklistUntil,
            interestAt,
            guildId,
            userId,
          );
      });
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
