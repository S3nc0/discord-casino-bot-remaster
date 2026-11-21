import { MERGE_COUNT, RELIC_BASES, STAR_MAX, starId } from '../work/relics.ts';

export const ITEM_KINDS = [
  'title',
  'card_color',
  'card_icon',
  'consumable',
  'racing',
  'market',
  'skin_dice',
  'skin_table',
  'collection',
  'color_role',
  'relic',
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export interface Item {
  id: string;
  kind: ItemKind;
  price: number;
  /** Not for sale and never auto-listed (weekly title, relics). */
  limited: boolean;
}

/** One owned copy at most, no rebuy. */
export const UNIQUE_KINDS: ReadonlySet<ItemKind> = new Set([
  'title',
  'card_color',
  'card_icon',
  'skin_dice',
  'skin_table',
  'color_role',
  'collection',
]);
export const EQUIP_SLOTS = ['title', 'card_color', 'card_icon', 'skin_dice', 'skin_table'] as const;
export type EquipSlot = (typeof EQUIP_SLOTS)[number];

export const CONFIRM_FROM = 10_000;
export const INSURANCE_CAP = 1000;
export const WEEKLY_KING = 'title_weekly_king';

const sale = (kind: ItemKind, entries: [string, number][]): Item[] =>
  entries.map(([id, price]) => ({ id, kind, price, limited: false }));

const RELICS: Item[] = RELIC_BASES.flatMap((base) =>
  Array.from({ length: STAR_MAX + 1 }, (_, star) => ({
    id: starId(base, star),
    kind: 'relic' as const,
    price: 0,
    limited: true,
  })),
);

export const CATALOG: readonly Item[] = [
  ...sale('title', [
    ['title_rookie', 2000],
    ['title_broke', 3000],
    ['title_regular', 5000],
    ['title_zawa', 8000],
    ['title_underground', 12_000],
    ['title_lucky', 20_000],
    ['title_emperor', 100_000],
    ['title_creditor', 500_000],
    ['title_fixer', 2_000_000],
    ['title_100oku', 10_000_000],
  ]),
  { id: WEEKLY_KING, kind: 'title', price: 0, limited: true },
  ...sale('card_color', [
    ['cardcolor_red', 3000],
    ['cardcolor_blue', 3000],
    ['cardcolor_green', 3000],
    ['cardcolor_gold', 3000],
    ['cardcolor_purple', 3000],
    ['cardcolor_dark', 3000],
  ]),
  ...sale('card_icon', [
    ['cardicon_slot', 3000],
    ['cardicon_gem', 3000],
    ['cardicon_fire', 3000],
    ['cardicon_moon', 3000],
    ['cardicon_dragon', 3000],
    ['cardicon_crown', 5000],
  ]),
  ...sale('consumable', [
    ['daily_double', 3000],
    ['insurance', 2000],
    ['streak_guard', 16_000],
    ['labor_drink', 300],
  ]),
  ...sale('racing', [
    ['horse_voucher', 30_000],
    ['carrot', 1000],
    ['gold_carrot', 50_000],
  ]),
  ...sale('market', [['insider_memo', 5000]]),
  ...sale('skin_dice', [
    ['skin_kuro', 30_000],
    ['skin_gold_dice', 150_000],
    ['skin_glass_dice', 500_000],
  ]),
  ...sale('skin_table', [
    ['skin_vip', 300_000],
    ['skin_numa', 1_000_000],
  ]),
  ...sale('collection', [
    ['col_beer', 13_500],
    ['col_yakitori', 25_000],
    ['col_gaishutsu', 50_000],
    ['col_sunglasses', 100_000],
    ['col_teppan', 250_000],
    ['col_megaphone', 500_000],
    ['col_gold_bar', 1_000_000],
    ['col_stock', 3_000_000],
    ['col_throne', 10_000_000],
  ]),
  ...sale(
    'color_role',
    [
      'role_red',
      'role_orange',
      'role_yellow',
      'role_green',
      'role_cyan',
      'role_blue',
      'role_purple',
      'role_pink',
      'role_gold',
      'role_silver',
      'role_black',
      'role_white',
    ].map((id): [string, number] => [id, 20_000]),
  ),
  ...RELICS,
];

const BY_ID = new Map(CATALOG.map((i) => [i.id, i]));

export function itemById(id: string): Item | undefined {
  return BY_ID.get(id);
}

export function isUnique(item: Item): boolean {
  return UNIQUE_KINDS.has(item.kind);
}

/** For sale in the shop: priced, not limited. */
export function isBuyable(item: Item): boolean {
  return !item.limited && item.price > 0;
}

/** Items the Teiai seized-goods auction can resell: no limited items, collections or titles. */
export function isAuctionListable(item: Item): boolean {
  return !item.limited && item.price > 0 && item.kind !== 'collection' && item.kind !== 'title';
}

/** Items the daily Teiai market can offer: any priced, unlimited item. */
export function isMarketListable(item: Item): boolean {
  return !item.limited && item.price > 0;
}

export function needsConfirm(item: Item, black = false): boolean {
  return black || item.id === 'insider_memo' || item.price >= CONFIRM_FROM;
}

export type PurchaseError =
  'unknown_item' | 'not_for_sale' | 'already_owned' | 'debt_blocks' | 'insufficient_balance';

export function validatePurchase(input: {
  item: Item | undefined;
  owned: number;
  debt: number;
  balance: number;
  unitPrice?: number;
}): PurchaseError | null {
  const { item } = input;
  if (!item) return 'unknown_item';
  if (!isBuyable(item) && input.unitPrice === undefined) return 'not_for_sale';
  if (isUnique(item) && input.owned > 0) return 'already_owned';
  if (input.debt > 0) return 'debt_blocks';
  if (input.balance < (input.unitPrice ?? item.price)) return 'insufficient_balance';
  return null;
}

/** Relic total value of an inventory, for net worth. */
export function relicInventoryValue(
  entries: Iterable<[string, number]>,
  valueOf: (id: string) => number,
): number {
  let total = 0;
  for (const [id, qty] of entries) if (id.startsWith('relic_')) total += valueOf(id) * qty;
  return total;
}

export { MERGE_COUNT };
