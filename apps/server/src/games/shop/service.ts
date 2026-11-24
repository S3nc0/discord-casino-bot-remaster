import {
  auctionPrice,
  EQUIP_SLOTS,
  isAuctionListable,
  isUnique,
  itemById,
  marketPrice,
  needsConfirm,
  planMarketDay,
  revealBlack,
  SEIZE_RATE,
  STOCK_RULES,
  stockAvailable,
  stockNow,
  validatePurchase,
  type EquipSlot,
  type Item,
} from '@casino/domain/shop';
import { MS_DAY, roundHalfEven } from '@casino/domain/progression';
import { HORSE_VOUCHER_PRICE } from '@casino/domain/race';
import { GameRuleError, type GamesCtx } from '../progression/context.ts';
import { ColorRoleService, type ColorRoleSyncResult } from './color-roles.ts';
import { Inventory, queueColorRoleSync } from './inventory.ts';

export interface ProfileView {
  title: string | null;
  cardColor: string | null;
  cardIcon: string | null;
  skinDice: string | null;
  skinTable: string | null;
  /** The name colour (a Discord role). Shown even while frozen: the role stays on in Discord. */
  colorRole: string | null;
  dailyBoost: number;
  insurance: number;
  /** True while debt (or bankruptcy) hides the equipment; it comes back when the debt is gone. */
  frozen: boolean;
}

export interface MarketLot {
  id: number;
  itemId: string;
  mode: 'auction' | 'fixed';
  black: boolean;
  qty: number;
  price: number;
  expiresAt: number;
  /** True when the player must confirm (black market, big or insider purchases). */
  confirm: boolean;
}

const SLOT_COLUMN: Record<EquipSlot, string> = {
  title: 'title',
  card_color: 'card_color',
  card_icon: 'card_icon',
  skin_dice: 'skin_dice',
  skin_table: 'skin_table',
  color_role: 'color_role',
};

/** Official shop, inventory, profile, seized-goods auction and the daily Teiai market. */
export class ShopService {
  readonly inventory: Inventory;
  /** Puts the equipped name colour on the member in Discord (after commit). */
  readonly colorRoles: ColorRoleService;
  private readonly ctx: GamesCtx;

  constructor(ctx: GamesCtx) {
    this.ctx = ctx;
    this.inventory = new Inventory(ctx.store);
    this.colorRoles = new ColorRoleService({ store: ctx.store, clock: ctx.clock });
  }

  // ------------------------------------------------------------------ stock

  private stockExact(guildId: string, userId: string, itemId: string): number | null {
    const rule = STOCK_RULES[itemId];
    if (!rule) return null;
    const row = this.ctx.store
      .stmt(
        'SELECT stock_milli, updated_at FROM shop_stock WHERE guild_id = ? AND user_id = ? AND item_id = ?',
      )
      .get(guildId, userId, itemId) as { stock_milli: number; updated_at: number } | undefined;
    if (!row) return rule.max;
    return stockNow(rule, row.stock_milli / 1000, row.updated_at, this.ctx.clock.now());
  }

  /** Units a limited item can be bought right now (null: unlimited). */
  available(guildId: string, userId: string, itemId: string): number | null {
    const exact = this.stockExact(guildId, userId, itemId);
    return exact === null ? null : stockAvailable(exact);
  }

  // ------------------------------------------------------------------ buy

  buy(input: {
    guildId: string;
    userId: string;
    itemId: string;
    qty?: number;
    idempotencyKey: string;
  }): { price: number; balance: number } {
    const { ctx } = this;
    const { guildId, userId, itemId } = input;
    const qty = input.qty ?? 1;
    return ctx.store.transaction(() => {
      ctx.economy.ensureMember(guildId, userId);
      const item = itemById(itemId);
      if (!Number.isInteger(qty) || qty < 1 || qty > 99 || (item && isUnique(item) && qty > 1))
        throw new GameRuleError('invalid_quantity', {}, 'invalid_payload');
      if (itemId === 'insider_memo')
        throw new GameRuleError('feature_disabled', {}, 'feature_disabled');
      const total = (item?.price ?? 0) * qty;
      const err = validatePurchase({
        item,
        owned: this.inventory.qty(guildId, userId, itemId),
        debt: ctx.teiai.debtOf(guildId, userId),
        balance: ctx.economy.getBalance(guildId, userId),
      });
      if (err)
        throw new GameRuleError(
          err,
          { price: item?.price ?? 0 },
          err === 'insufficient_balance' ? 'insufficient_funds' : 'conflict',
        );
      if (ctx.economy.getBalance(guildId, userId) < total)
        throw new GameRuleError('insufficient_balance', { price: total }, 'insufficient_funds');
      const exact = this.stockExact(guildId, userId, itemId);
      if (exact !== null) {
        if (stockAvailable(exact) < qty)
          throw new GameRuleError('out_of_stock', { available: stockAvailable(exact) });
        ctx.store
          .stmt(
            `INSERT INTO shop_stock (guild_id, user_id, item_id, stock_milli, updated_at) VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT (guild_id, user_id, item_id) DO UPDATE SET stock_milli = excluded.stock_milli, updated_at = excluded.updated_at`,
          )
          .run(guildId, userId, itemId, Math.round((exact - qty) * 1000), ctx.clock.now());
      }
      const debit = ctx.economy.debit({
        guildId,
        userId,
        amount: total,
        reason: 'shop_buy',
        refType: 'shop',
        refId: itemId,
        idempotencyKey: input.idempotencyKey,
      });
      if (!debit.replayed) this.inventory.add(guildId, userId, itemId, qty);
      return { price: total, balance: debit.entry.balanceAfter };
    });
  }

  /** Arm a consumable: daily_double doubles the next daily claim, insurance refunds half a loss. */
  arm(guildId: string, userId: string, itemId: 'daily_double' | 'insurance'): void {
    this.ctx.store.transaction(() => {
      if (!this.inventory.take(guildId, userId, itemId, 1))
        throw new GameRuleError('not_owned', {}, 'not_found');
      const column = itemId === 'daily_double' ? 'daily_boost' : 'insurance';
      this.ctx.store
        .stmt(
          `INSERT INTO profiles (guild_id, user_id, ${column}) VALUES (?, ?, 1) ON CONFLICT (guild_id, user_id) DO UPDATE SET ${column} = ${column} + 1`,
        )
        .run(guildId, userId);
    });
  }

  hasInsurance(guildId: string, userId: string): boolean {
    const r = this.ctx.store
      .stmt('SELECT insurance FROM profiles WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId) as { insurance: number } | undefined;
    return (r?.insurance ?? 0) > 0;
  }

  consumeInsurance(guildId: string, userId: string): void {
    this.ctx.store
      .stmt(
        'UPDATE profiles SET insurance = insurance - 1 WHERE guild_id = ? AND user_id = ? AND insurance > 0',
      )
      .run(guildId, userId);
  }

  // ------------------------------------------------------------------ profile

  profile(guildId: string, userId: string): ProfileView {
    const r = this.ctx.store
      .stmt('SELECT * FROM profiles WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId) as Record<string, string | number | null> | undefined;
    const frozen = this.ctx.teiai.debtOf(guildId, userId) > 0;
    const show = (v: string | number | null | undefined): string | null =>
      frozen ? null : ((v ?? null) as string | null);
    return {
      title: show(r?.title),
      cardColor: show(r?.card_color),
      cardIcon: show(r?.card_icon),
      skinDice: show(r?.skin_dice),
      skinTable: show(r?.skin_table),
      colorRole: this.colorRoles.equipped(guildId, userId),
      dailyBoost: (r?.daily_boost as number | undefined) ?? 0,
      insurance: (r?.insurance as number | undefined) ?? 0,
      frozen,
    };
  }

  /**
   * Equip an owned cosmetic, or pass `null` to unequip a slot. The name colour (`color_role`)
   * also queues its Discord role; call `colorRoles.syncNow` after the commit to apply it at once.
   */
  equip(guildId: string, userId: string, slot: EquipSlot, itemId: string | null): void {
    if (!(EQUIP_SLOTS as readonly string[]).includes(slot))
      throw new GameRuleError('invalid_slot', {}, 'invalid_payload');
    if (itemId !== null) {
      const item = itemById(itemId);
      if (!item || item.kind !== slot || this.inventory.qty(guildId, userId, itemId) < 1)
        throw new GameRuleError('not_owned', {}, 'not_found');
    }
    this.ctx.store.transaction(() => {
      // Wearing the colour already worn (and already on Discord) changes nothing: no sync, so
      // `syncNow` answers without a Discord call.
      const unchanged =
        slot === 'color_role' &&
        this.colorRoles.equipped(guildId, userId) === itemId &&
        this.colorRoles.upToDate(guildId, userId);
      this.ctx.store
        .stmt(
          `INSERT INTO profiles (guild_id, user_id, ${SLOT_COLUMN[slot]}) VALUES (?, ?, ?) ON CONFLICT (guild_id, user_id) DO UPDATE SET ${SLOT_COLUMN[slot]} = excluded.${SLOT_COLUMN[slot]}`,
        )
        .run(guildId, userId, itemId);
      if (slot === 'color_role' && !unchanged)
        queueColorRoleSync(this.ctx.store, guildId, userId, this.ctx.clock.now());
    });
  }

  /**
   * Wear a name colour (or `null` to take it off) and apply its Discord role once the change has
   * committed. The choice is recorded even when Discord refuses; the result says why.
   */
  async wearColor(
    guildId: string,
    userId: string,
    itemId: string | null,
  ): Promise<ColorRoleSyncResult | 'pending'> {
    this.equip(guildId, userId, 'color_role', itemId);
    return this.colorRoles.syncNow(guildId, userId);
  }

  // ------------------------------------------------------------------ bankruptcy seizure

  /**
   * Move a bankrupt player's belongings to the seized-goods auction. Returns the value credited
   * against the debt at the seizure rate (the debt module applies it); horses count 30,000 each.
   */
  seizeAssets(guildId: string, userId: string): { items: number; horses: number; credit: number } {
    const { ctx } = this;
    return ctx.store.transaction(() => {
      const now = ctx.clock.now();
      let credit = 0;
      let items = 0;
      for (const [itemId, qty] of this.inventory.all(guildId, userId)) {
        const item = itemById(itemId);
        if (!item || !isAuctionListable(item)) continue;
        this.inventory.take(guildId, userId, itemId, qty);
        ctx.store
          .stmt('INSERT INTO seized_items (guild_id, item_id, qty, listed_at) VALUES (?, ?, ?, ?)')
          .run(guildId, itemId, qty, now);
        credit += roundHalfEven(item.price * qty * SEIZE_RATE);
        items += qty;
      }
      const horses = ctx.store
        .stmt(
          'UPDATE horses SET owner_id = NULL, retired_at = ? WHERE guild_id = ? AND owner_id = ?',
        )
        .run(now, guildId, userId).changes;
      if (horses > 0) {
        ctx.store
          .stmt(
            `INSERT INTO seized_items (guild_id, item_id, qty, listed_at) VALUES (?, 'horse_voucher', ?, ?)`,
          )
          .run(guildId, horses, now);
        credit += horses * HORSE_VOUCHER_PRICE;
      }
      return { items, horses, credit };
    });
  }

  seizedLots(guildId: string): { id: number; itemId: string; qty: number; price: number }[] {
    const now = this.ctx.clock.now();
    return (
      this.ctx.store
        .stmt(
          'SELECT id, item_id, qty, listed_at FROM seized_items WHERE guild_id = ? AND qty > 0 ORDER BY listed_at, id',
        )
        .all(guildId) as { id: number; item_id: string; qty: number; listed_at: number }[]
    ).map((r) => ({
      id: r.id,
      itemId: r.item_id,
      qty: r.qty,
      price: auctionPrice((itemById(r.item_id) as Item).price, r.listed_at, now),
    }));
  }

  /** Buy one seized item (debt-free players only). The money goes to the Teiai bank. */
  buySeized(input: { guildId: string; userId: string; lotId: number; idempotencyKey: string }): {
    price: number;
  } {
    const { ctx } = this;
    return ctx.store.transaction(() => {
      const { guildId, userId } = input;
      ctx.economy.ensureMember(guildId, userId);
      if (ctx.teiai.debtOf(guildId, userId) > 0) throw new GameRuleError('auction_katagi_only');
      const lot = this.seizedLots(guildId).find((l) => l.id === input.lotId);
      if (!lot) throw new GameRuleError('lot_gone', {}, 'not_found');
      const item = itemById(lot.itemId) as Item;
      if (isUnique(item) && this.inventory.qty(guildId, userId, lot.itemId) > 0)
        throw new GameRuleError('already_owned');
      const debit = ctx.economy.debit({
        guildId,
        userId,
        amount: lot.price,
        reason: 'teiai_auction_buy',
        refType: 'seized',
        refId: String(lot.id),
        idempotencyKey: input.idempotencyKey,
      });
      if (!debit.replayed) {
        ctx.store
          .stmt('UPDATE seized_items SET qty = qty - 1 WHERE id = ? AND qty > 0')
          .run(lot.id);
        this.inventory.add(guildId, userId, lot.itemId, 1);
        ctx.teiai.bankIncome(guildId, lot.price, 'seized auction');
      }
      return { price: lot.price };
    });
  }

  // ------------------------------------------------------------------ Teiai timed market

  /** Plan today's (UTC) market once. Safe to call often. */
  ensureMarketDay(guildId: string): number {
    const { ctx } = this;
    const day = Math.floor(ctx.clock.now() / MS_DAY);
    return ctx.store.transaction(() => {
      const fresh = ctx.store
        .stmt('INSERT OR IGNORE INTO teiai_market_days (guild_id, day) VALUES (?, ?)')
        .run(guildId, day).changes;
      if (fresh === 0) return 0;
      const plan = planMarketDay(day * MS_DAY, ctx.rng);
      for (const l of plan) {
        ctx.store
          .stmt(
            'INSERT INTO teiai_market (guild_id, item_id, mode, black, qty, start_price, end_price, listed_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            guildId,
            l.itemId,
            l.mode,
            l.black ? 1 : 0,
            l.qty,
            l.startPrice,
            l.endPrice,
            Math.round(l.listedAt),
            Math.round(l.expiresAt),
          );
      }
      return plan.length;
    });
  }

  marketLots(guildId: string): MarketLot[] {
    const now = this.ctx.clock.now();
    const rows = this.ctx.store
      .stmt(
        'SELECT * FROM teiai_market WHERE guild_id = ? AND qty > 0 AND listed_at <= ? AND expires_at > ? ORDER BY listed_at',
      )
      .all(guildId, now, now) as {
      id: number;
      item_id: string;
      mode: 'auction' | 'fixed';
      black: number;
      qty: number;
      start_price: number;
      end_price: number;
      listed_at: number;
      expires_at: number;
    }[];
    return rows.map((r) => ({
      id: r.id,
      itemId: r.black === 1 ? '?' : r.item_id,
      mode: r.mode,
      black: r.black === 1,
      qty: r.qty,
      price: marketPrice(
        {
          startPrice: r.start_price,
          endPrice: r.end_price,
          listedAt: r.listed_at,
          expiresAt: r.expires_at,
        },
        now,
      ),
      expiresAt: r.expires_at,
      confirm: needsConfirm(itemById(r.item_id) as Item, r.black === 1),
    }));
  }

  /** Buy one unit of a market lot. A black-market lot reveals its real content only now. */
  buyMarket(input: { guildId: string; userId: string; lotId: number; idempotencyKey: string }): {
    itemId: string;
    price: number;
    revealed: 'same' | 'worse' | 'better';
  } {
    const { ctx } = this;
    return ctx.store.transaction(() => {
      const { guildId, userId } = input;
      ctx.economy.ensureMember(guildId, userId);
      if (ctx.teiai.debtOf(guildId, userId) > 0) throw new GameRuleError('auction_katagi_only');
      const lot = this.marketLots(guildId).find((l) => l.id === input.lotId);
      if (!lot) throw new GameRuleError('lot_gone', {}, 'not_found');
      const raw = ctx.store.stmt('SELECT item_id FROM teiai_market WHERE id = ?').get(lot.id) as {
        item_id: string;
      };
      const shown = itemById(raw.item_id) as Item;
      if (!lot.black && isUnique(shown) && this.inventory.qty(guildId, userId, shown.id) > 0)
        throw new GameRuleError('already_owned');
      const debit = ctx.economy.debit({
        guildId,
        userId,
        amount: lot.price,
        reason: 'teiai_market_buy',
        refType: 'market',
        refId: String(lot.id),
        idempotencyKey: input.idempotencyKey,
      });
      const reveal = lot.black
        ? revealBlack(shown, ctx.rng, (id) => this.inventory.qty(guildId, userId, id) > 0)
        : { itemId: shown.id, outcome: 'same' as const };
      if (!debit.replayed) {
        ctx.store
          .stmt('UPDATE teiai_market SET qty = qty - 1 WHERE id = ? AND qty > 0')
          .run(lot.id);
        this.inventory.add(guildId, userId, reveal.itemId, 1);
        ctx.teiai.bankIncome(guildId, lot.price, 'teiai market');
      }
      return { itemId: reveal.itemId, price: lot.price, revealed: reveal.outcome };
    });
  }
}
