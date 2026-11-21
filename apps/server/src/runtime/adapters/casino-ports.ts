import { TEIAI_CONSTANTS } from '@casino/domain/finance';
import { withholdIncome } from '@casino/domain/progression';
import type { Store } from '../../db/store.ts';
import type { EconomyService } from '../../economy/economy-service.ts';
import type { TeiaiService } from '../../finance/teiai-service.ts';
import type { CasinoPorts } from '../../games/casino/types.ts';
import type { TeiaiPort } from '../../games/progression/ports.ts';
import type { ShopService } from '../../games/shop/service.ts';

export interface CasinoPortsDeps {
  store: Store;
  economy: EconomyService;
  teiai: TeiaiService;
  teiaiPort: TeiaiPort;
  shop: ShopService;
}

/**
 * The casino's cross-module ports on the finance and shop services. Not covered here, so they
 * keep the casino's defaults: `rtpLevel` and `isEnabled` (own tables), and `eventBoost` (0: no
 * module owns the daily and manual casino events yet).
 */
export function createCasinoPorts({
  store,
  economy,
  teiai,
  teiaiPort,
  shop,
}: CasinoPortsDeps): Pick<CasinoPorts, 'insurance' | 'debt' | 'bank' | 'credit'> {
  return {
    insurance: {
      has: (guildId, userId) => shop.hasInsurance(guildId, userId),
      consume: (guildId, userId) => shop.consumeInsurance(guildId, userId),
    },
    debt: {
      // 30 % of the income pays down the Teiai debt; the casino posts the `debt_withholding` row.
      withhold(guildId, userId, income) {
        const amount = withholdIncome(income, teiaiPort.debtOf(guildId, userId));
        if (amount > 0) teiaiPort.repayDebt(guildId, userId, amount);
        return amount;
      },
      // A chinchiro multiplier loss the wallet could not cover is a forced execution: assets are
      // seized before the rest becomes debt (docs/spec/chinchiro.md, "Debt & Forced Seizure").
      owe(guildId, userId, amount) {
        teiai.owe(guildId, userId, amount, { refType: 'chinchiro_penalty' });
      },
    },
    bank: {
      // The core already computed the bank's 3 % share (`SettleResult.bankShare`).
      lossShare: (guildId, amount) => teiaiPort.bankIncome(guildId, amount, 'casino loss share'),
    },
    credit: {
      // Blackjack double on credit: the bank lends the shortfall (at most the seed cap) unless
      // the player is bankrupt or in the 24 h grace window. The borrow is Teiai debt.
      borrowForDouble(guildId, userId, need) {
        if (need <= 0 || need > TEIAI_CONSTANTS.seedLoanCap) return false;
        return store.transaction(() => {
          if (teiai.getStatus(guildId, userId) === 'bankrupt') return false;
          if (teiai.isInGrace(guildId, userId)) return false;
          economy.credit({
            guildId,
            userId,
            amount: need,
            reason: 'loan_borrow',
            refType: 'casino_double_credit',
          });
          teiai.addDebtFromExcess(guildId, userId, need);
          return true;
        });
      },
    },
  };
}
