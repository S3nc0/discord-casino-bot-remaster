import type { Store } from '../../db/store.ts';
import { AppError } from '../../runtime/errors.ts';

/** `profiles` columns that hold an equipped item id (fixed names, never user input). */
const EQUIP_COLUMNS = [
  'title',
  'card_color',
  'card_icon',
  'skin_dice',
  'skin_table',
  'color_role',
] as const;

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

  /** Remove `qty` (a positive integer); false (and nothing changes) when the player holds fewer. */
  take(guildId: string, userId: string, itemId: string, qty: number): boolean {
    if (!Number.isSafeInteger(qty) || qty <= 0) throw new AppError('invalid_payload');
    if (this.qty(guildId, userId, itemId) < qty) return false;
    this.store
      .stmt('UPDATE inventory SET qty = qty - ? WHERE guild_id = ? AND user_id = ? AND item_id = ?')
      .run(qty, guildId, userId, itemId);
    if (this.qty(guildId, userId, itemId) <= 0) this.unequip(guildId, userId, itemId);
    return true;
  }

  /**
   * A cosmetic the player no longer owns cannot stay worn (player-market spec §3: listing
   * auto-unequips it when the last copy leaves). When the item returns it comes back unequipped.
   */
  private unequip(guildId: string, userId: string, itemId: string): void {
    for (const column of EQUIP_COLUMNS) {
      const changes = this.store
        .stmt(
          `UPDATE profiles SET ${column} = NULL WHERE guild_id = ? AND user_id = ? AND ${column} = ?`,
        )
        .run(guildId, userId, itemId).changes;
      // A name colour that leaves (seized, listed, sold, removed) takes its Discord role with it:
      // queue the member for the colour-role sweep in this same transaction.
      if (column === 'color_role' && changes > 0) queueColorRoleSync(this.store, guildId, userId);
    }
  }
}

/**
 * Mark a member's Discord colour role as out of date (games/shop/color-roles.ts applies it after
 * commit). Call inside the transaction that changed the equipped colour.
 */
export function queueColorRoleSync(
  store: Store,
  guildId: string,
  userId: string,
  now = Date.now(),
): void {
  store
    .stmt(
      `INSERT INTO color_role_sync (guild_id, user_id, queued_at, next_at, tries) VALUES (?, ?, ?, 0, 0)
       ON CONFLICT (guild_id, user_id) DO UPDATE SET
         queued_at = excluded.queued_at, next_at = 0, tries = 0, seq = seq + 1`,
    )
    .run(guildId, userId, now);
}
