import type { Clock, Rng } from '@casino/shared';
import type { JuniorLoanClaim, JuniorLoanSettlement } from '@casino/domain/finance';
import type { IdentityRepo } from '../db/identity.ts';
import type { Store } from '../db/store.ts';
import type { EconomyService } from '../economy/economy-service.ts';
import type { EventBus } from '../runtime/bus.ts';

/** Standard dependencies shared by all finance server services. */
export interface FinanceDeps {
  readonly store: Store;
  readonly economy: EconomyService;
  readonly identity: IdentityRepo;
  readonly clock: Clock;
  readonly rng: Rng;
  readonly bus?: EventBus;
  /** Guild local timezone offset in hours (defaults to 9 for JST). */
  readonly utcOffsetHours?: number;
}

/**
 * Adapter for Player Market item/horse ownership (owned by B2-B tables `inventory` / `horses`).
 * B3 ships a clean interface + in-memory test double; B1/B2-B wires the SQLite implementation.
 */
export interface MarketplaceAssetAdapter {
  /** Verify seller owns the asset and move it into escrow. Return `true` on success. */
  escrowAsset(
    guildId: string,
    sellerId: string,
    kind: 'item' | 'horse',
    ref: string,
    qty: number,
  ): boolean;
  /** Deliver escrowed asset to buyer (or return to seller on cancel/expire/pull-back). */
  deliverAsset(
    guildId: string,
    recipientId: string,
    kind: 'item' | 'horse',
    ref: string,
    qty: number,
  ): void;
}

/**
 * Cross-service hooks registered onto `TeiaiService` by peer finance services (and optional B2-B
 * shop/horse liquidation adapters) so Teiai never has circular imports.
 */
export interface TeiaiCrossHooks {
  /** Sum of active bond principals in `guildId` (used for Teiai Bank liabilities). */
  getActiveBondPrincipal?: (guildId: string) => number;
  /** Current cross-margin ratio of a user, or `null` if no margin positions. */
  getMarginRatio?: (guildId: string, userId: string) => number | null;
  /** True if the user currently has any overdue P2P loan. */
  hasOverdueLoan?: (guildId: string, userId: string) => boolean;
  /** Garnish overdue P2P loans from remaining 30% withholding budget; returns total garnished. */
  garnishOverdueLoans?: (guildId: string, userId: string, budget: number, nowMs: number) => number;
  /** Charge excess bank shortfall across Kyosai unit holders; returns unpaid house share (Pelica). */
  chargeKyosaiExcess?: (guildId: string, amount: number, nowMs: number) => number;
  /** Forced execution seizure hooks (Steps 3..7). Each returns Pelica recovered into cash/repayment. */
  seizeCompanyFunds?: (guildId: string, userId: string, need: number, nowMs: number) => number;
  seizeSecurities?: (guildId: string, userId: string, need: number, nowMs: number) => number;
  /** Pull back open bids/listings when a user enters grace or declares bankruptcy. */
  onGraceOrBankruptcyPullBack?: (guildId: string, userId: string, nowMs: number) => void;
  /** Bankruptcy full liquidation hooks (credit cash to user or return liquidated Pelica). */
  liquidateSecuritiesForBankruptcy?: (guildId: string, userId: string, nowMs: number) => number;
  liquidateCompanyForBankruptcy?: (guildId: string, userId: string, nowMs: number) => number;
  recoverKyosaiOnBankruptcy?: (guildId: string, userId: string, nowMs: number) => void;
  /** Optional external liquidation hook (e.g. B2-B shop items / horses) returning Pelica added to pool. */
  liquidateExternalAssets?: (guildId: string, userId: string, nowMs: number) => {
    readonly recovered: number;
    readonly shopValue: number;
  };
  /** List active/overdue junior P2P loans owed by `userId` oldest-first, for bankruptcy waterfall. */
  listJuniorLoansForBankruptcy?: (guildId: string, userId: string, nowMs: number) => JuniorLoanClaim[];
  /** Persist junior P2P loan bankruptcy settlements and credit lenders via `p2p_bankruptcy_payout`. */
  applyJuniorLoanSettlements?: (
    guildId: string,
    settlements: readonly JuniorLoanSettlement[],
    nowMs: number,
  ) => void;
}

/** Return all known guild IDs in the database. */
export function listKnownGuildIds(store: Store): string[] {
  const rows = store
    .stmt(
      `SELECT guild_id FROM guilds
       UNION SELECT guild_id FROM bank_reserve
       UNION SELECT guild_id FROM bank_accounts
       UNION SELECT guild_id FROM loans
       UNION SELECT guild_id FROM kyosai_units
       UNION SELECT guild_id FROM companies
       UNION SELECT guild_id FROM marketplace_listings`,
    )
    .all() as { guild_id: string }[];
  return rows.map((r) => r.guild_id);
}

/**
 * Shared rolling 24h unordered pair transfer volume across BOTH Player Market (`marketplace_listings`)
 * and Kyosai P2P unit offers (`kyosai_offers`).
 */
export function getSharedPairVolume24h(
  store: Store,
  guildId: string,
  userA: string,
  userB: string,
  nowMs: number,
): number {
  const sinceMs = nowMs - 86_400_000;
  const pmRow = store
    .stmt(
      `SELECT COALESCE(SUM(sold_price), 0) AS total
       FROM marketplace_listings
       WHERE guild_id = ? AND status = 'sold' AND closed_at >= ?
         AND ((seller_id = ? AND buyer_id = ?) OR (seller_id = ? AND buyer_id = ?))`,
    )
    .get(guildId, sinceMs, userA, userB, userB, userA) as { total: number };
  const kyRow = store
    .stmt(
      `SELECT COALESCE(SUM(price), 0) AS total
       FROM kyosai_offers
       WHERE guild_id = ? AND status = 'done' AND done_at >= ?
         AND ((seller_id = ? AND buyer_id = ?) OR (seller_id = ? AND buyer_id = ?))`,
    )
    .get(guildId, sinceMs, userA, userB, userB, userA) as { total: number };
  return (pmRow?.total ?? 0) + (kyRow?.total ?? 0);
}
