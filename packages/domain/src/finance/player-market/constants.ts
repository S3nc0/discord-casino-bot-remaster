/**
 * Player Market (P2P marketplace, fixed-price & timed auctions) constants and tradable item catalog.
 * Mirrors `catalogs/economy.yaml` (`p2p`), `catalogs/shop.yaml`, and `docs/spec/relics.md`.
 */
export const PLAYER_MARKET_CONSTANTS = {
  feeRateBps: 500, // 5%
  maxActiveListings: 5,
  fixedDays: 7,
  auctionHours: [1, 6, 24, 72] as readonly number[],
  minIncrementRateBps: 500, // 5%
  minIncrement: 100,
  snipeSeconds: 300, // 5 min anti-snipe
  pairDailyLimit: 100_000,
  minPrice: 100,
  itemPriceRangeMinBps: 1_000, // 0.10x
  itemPriceRangeMaxBps: 50_000, // 5.0x
  horsePriceMin: 3_000,
  horsePriceMax: 300_000,
  confirmFrom: 10_000,
  maxHorses: 3,
} as const;

export type MarketplaceAssetKind = 'item' | 'horse';
export type MarketplaceMode = 'fixed' | 'auction';
export type MarketplaceStatus = 'active' | 'sold' | 'cancelled' | 'expired';

export const TRADABLE_ITEM_KINDS = new Set([
  'consumable',
  'racing',
  'card_color',
  'card_icon',
  'skin_dice',
  'skin_table',
  'color_role',
]);

export const UNIQUE_ITEM_KINDS = new Set([
  'title',
  'card_color',
  'card_icon',
  'skin_dice',
  'skin_table',
  'color_role',
  'collection',
]);

export const EQUIP_SLOT_BY_KIND: Readonly<Record<string, string>> = {
  card_color: 'card_color',
  card_icon: 'card_icon',
  skin_dice: 'skin_dice',
  skin_table: 'skin_table',
};

export interface MarketCatalogItem {
  readonly id: string;
  readonly kind: string;
  readonly price: number;
  readonly unique: boolean;
  readonly limited: boolean;
}

/** Base reference values for the 6 underground labor relics (★0). Star `s` multiplies by `10^s`. */
export const RELIC_BASE_VALUES: Readonly<Record<string, number>> = {
  relic_fossil: 1_500,
  relic_bone: 4_000,
  relic_meteor: 10_000,
  relic_vase: 25_000,
  relic_crown: 60_000,
  relic_tear: 100_000,
};

export const RELIC_STAR_MAX = 3;

const STATIC_ITEMS: readonly [id: string, kind: string, price: number, limited?: boolean][] = [
  // Titles (not tradable)
  ['title_rookie', 'title', 2_000],
  ['title_broke', 'title', 3_000],
  ['title_regular', 'title', 5_000],
  ['title_zawa', 'title', 8_000],
  ['title_underground', 'title', 12_000],
  ['title_lucky', 'title', 20_000],
  ['title_emperor', 'title', 100_000],
  ['title_creditor', 'title', 500_000],
  ['title_fixer', 'title', 2_000_000],
  ['title_100oku', 'title', 10_000_000],
  ['title_weekly_king', 'title', 0, true],
  // Card colors
  ['cardcolor_red', 'card_color', 3_000],
  ['cardcolor_blue', 'card_color', 3_000],
  ['cardcolor_green', 'card_color', 3_000],
  ['cardcolor_gold', 'card_color', 3_000],
  ['cardcolor_purple', 'card_color', 3_000],
  ['cardcolor_dark', 'card_color', 3_000],
  // Card icons
  ['cardicon_slot', 'card_icon', 3_000],
  ['cardicon_gem', 'card_icon', 3_000],
  ['cardicon_fire', 'card_icon', 3_000],
  ['cardicon_moon', 'card_icon', 3_000],
  ['cardicon_dragon', 'card_icon', 3_000],
  ['cardicon_crown', 'card_icon', 5_000],
  // Consumables
  ['daily_double', 'consumable', 3_000],
  ['insurance', 'consumable', 2_000],
  ['streak_guard', 'consumable', 16_000],
  ['labor_drink', 'consumable', 300],
  // Racing
  ['horse_voucher', 'racing', 30_000],
  ['carrot', 'racing', 1_000],
  ['gold_carrot', 'racing', 50_000],
  // Market (not tradable)
  ['insider_memo', 'market', 5_000],
  // Skins
  ['skin_kuro', 'skin_dice', 30_000],
  ['skin_gold_dice', 'skin_dice', 150_000],
  ['skin_glass_dice', 'skin_dice', 500_000],
  ['skin_vip', 'skin_table', 300_000],
  ['skin_numa', 'skin_table', 1_000_000],
  // Collections (not tradable)
  ['col_beer', 'collection', 13_500],
  ['col_yakitori', 'collection', 25_000],
  ['col_gaishutsu', 'collection', 50_000],
  ['col_sunglasses', 'collection', 100_000],
  ['col_teppan', 'collection', 250_000],
  ['col_megaphone', 'collection', 500_000],
  ['col_gold_bar', 'collection', 1_000_000],
  ['col_stock', 'collection', 3_000_000],
  ['col_throne', 'collection', 10_000_000],
  // Color roles
  ['role_red', 'color_role', 20_000],
  ['role_orange', 'color_role', 20_000],
  ['role_yellow', 'color_role', 20_000],
  ['role_green', 'color_role', 20_000],
  ['role_cyan', 'color_role', 20_000],
  ['role_blue', 'color_role', 20_000],
  ['role_purple', 'color_role', 20_000],
  ['role_pink', 'color_role', 20_000],
  ['role_gold', 'color_role', 20_000],
  ['role_silver', 'color_role', 20_000],
  ['role_black', 'color_role', 20_000],
  ['role_white', 'color_role', 20_000],
];

function buildCatalog(): ReadonlyMap<string, MarketCatalogItem> {
  const map = new Map<string, MarketCatalogItem>();
  for (const [id, kind, price, limited = false] of STATIC_ITEMS) {
    map.set(id, { id, kind, price, unique: UNIQUE_ITEM_KINDS.has(kind), limited });
  }
  for (const baseId of Object.keys(RELIC_BASE_VALUES)) {
    for (let star = 0; star <= RELIC_STAR_MAX; star++) {
      const id = star === 0 ? baseId : `${baseId}_s${star}`;
      map.set(id, { id, kind: 'relic', price: 0, unique: false, limited: true });
    }
  }
  return map;
}

export const MARKET_ITEM_CATALOG: ReadonlyMap<string, MarketCatalogItem> = buildCatalog();

/** Reference value of a relic item ID (including `_s1`..`_s3`), or `null` if not a known relic. */
export function relicReferenceValue(itemId: string): number | null {
  const m = /^(relic_[a-z]+)(?:_s([1-3]))?$/.exec(itemId);
  if (!m) return null;
  const baseId = m[1];
  if (!baseId) return null;
  const baseVal = RELIC_BASE_VALUES[baseId];
  if (baseVal === undefined) return null;
  const star = m[2] ? Number(m[2]) : 0;
  return baseVal * 10 ** star;
}
