import type { Store } from '../../db/store.ts';
import type { MarketplaceAssetAdapter, TeiaiCrossHooks } from '../../finance/types.ts';
import type { Inventory } from '../../games/shop/inventory.ts';
import type { ShopService } from '../../games/shop/service.ts';

/**
 * Player market ownership on the real tables. Items move through the shop inventory. A horse in
 * escrow has no owner and is not retired (`owner_id IS NULL AND retired_at IS NULL`), so it can
 * neither race nor be seized until the sale settles or the listing returns it.
 */
export function createMarketplaceAssets(
  store: Store,
  inventory: Inventory,
): MarketplaceAssetAdapter {
  const horseId = (ref: string): number | null => {
    const id = Number(ref);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  };
  return {
    escrowAsset(guildId, sellerId, kind, ref, qty) {
      if (kind === 'item') return inventory.take(guildId, sellerId, ref, qty);
      const id = horseId(ref);
      if (id === null || qty !== 1) return false;
      const entered = store
        .stmt(
          `SELECT 1 FROM horse_entries e JOIN horse_races r ON r.id = e.race_id
           WHERE e.horse_id = ? AND r.status != 'done' LIMIT 1`,
        )
        .get(id);
      if (entered !== undefined) return false;
      return (
        store
          .stmt(
            `UPDATE horses SET owner_id = NULL
             WHERE id = ? AND guild_id = ? AND owner_id = ? AND retired_at IS NULL`,
          )
          .run(id, guildId, sellerId).changes === 1
      );
    },

    deliverAsset(guildId, recipientId, kind, ref, qty) {
      if (kind === 'item') {
        inventory.add(guildId, recipientId, ref, qty);
        return;
      }
      const id = horseId(ref);
      const changes =
        id === null
          ? 0
          : store
              .stmt(
                `UPDATE horses SET owner_id = ?
                 WHERE id = ? AND guild_id = ? AND owner_id IS NULL AND retired_at IS NULL`,
              )
              .run(recipientId, id, guildId).changes;
      if (changes !== 1) throw new Error(`horse ${ref} is not in escrow`);
    },
  };
}

/**
 * Bankruptcy liquidation of what the games own: shop belongings and horses go to the seized
 * goods auction; the value credited against the debt is what the shop reports.
 */
export function createExternalLiquidation(
  shop: () => ShopService,
): NonNullable<TeiaiCrossHooks['liquidateExternalAssets']> {
  return (guildId, userId) => {
    const seized = shop().seizeAssets(guildId, userId);
    return { recovered: seized.credit, shopValue: seized.credit };
  };
}
