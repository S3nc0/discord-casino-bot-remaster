import type { Store } from '../../db/store.ts';
import { AppError } from '../../runtime/errors.ts';

/** Items per player. Quantities never go below zero; the service checks before it takes. */
export class Inventory {
  private readonly store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  qty(guildId: string, userId: string, itemId: string): number {
    const row = this.store
      .stmt('SELECT qty FROM inventory WHERE guild_id = ? AND user_id = ? AND item_id = ?')
      .get(guildId, userId, itemId) as { qty: number } | undefined;
    return row?.qty ?? 0;
  }

  all(guildId: string, userId: string): Map<string, number> {
    const rows = this.store
      .stmt('SELECT item_id, qty FROM inventory WHERE guild_id = ? AND user_id = ? AND qty > 0')
      .all(guildId, userId) as { item_id: string; qty: number }[];
    return new Map(rows.map((r) => [r.item_id, r.qty]));
  }

  add(guildId: string, userId: string, itemId: string, qty: number): void {
    if (!Number.isSafeInteger(qty) || qty <= 0) throw new AppError('invalid_payload');
    this.store
      .stmt(
        `INSERT INTO inventory (guild_id, user_id, item_id, qty) VALUES (?, ?, ?, ?)
         ON CONFLICT (guild_id, user_id, item_id) DO UPDATE SET qty = qty + excluded.qty`,
      )
      .run(guildId, userId, itemId, qty);
  }

  /** Remove `qty`; false (and nothing changes) when the player holds fewer. */
  take(guildId: string, userId: string, itemId: string, qty: number): boolean {
    if (this.qty(guildId, userId, itemId) < qty) return false;
    this.store
      .stmt('UPDATE inventory SET qty = qty - ? WHERE guild_id = ? AND user_id = ? AND item_id = ?')
      .run(qty, guildId, userId, itemId);
    return true;
  }
}
