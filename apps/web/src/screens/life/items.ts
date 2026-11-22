import type { Locale } from '@casino/shared/i18n';
import type { GameIconName } from '@casino/ui';

/** Shop item labels `[ja, en]` per catalog id (catalogs/shop.yaml). Relics are named by i18n keys. */
const ITEM_LABELS: Readonly<Record<string, readonly [ja: string, en: string]>> = {
  title_rookie: ['🎲 見習いギャンブラー', '🎲 Rookie Gambler'],
  title_broke: ['💸 破産常連', '💸 Chronic Bankrupt'],
  title_regular: ['🎰 常連', '🎰 Regular'],
  title_zawa: ['😨 ざわ…ざわ…', '😨 Zawa… Zawa…'],
  title_underground: ['🕳️ 地下の住人', '🕳️ Underground Dweller'],
  title_lucky: ['🍀 強運の持ち主', '🍀 Lucky Soul'],
  title_emperor: ['🔱 地下の帝王', '🔱 Underground Emperor'],
  title_creditor: ['💰 債権王', '💰 Creditor King'],
  title_fixer: ['🕴️ フィクサー', '🕴️ The Fixer'],
  title_100oku: ['💴 百億の男', '💴 Ten-Billion Man'],
  title_weekly_king: ['👑週間王者', 'Weekly Champion'],
  cardcolor_red: ['🔴 赤', '🔴 Red'],
  cardcolor_blue: ['🔵 青', '🔵 Blue'],
  cardcolor_green: ['🟢 緑', '🟢 Green'],
  cardcolor_gold: ['🟡 金', '🟡 Gold'],
  cardcolor_purple: ['🟣 紫', '🟣 Purple'],
  cardcolor_dark: ['⚫ 黒', '⚫ Dark'],
  cardicon_slot: ['スロット', 'Slots'],
  cardicon_gem: ['宝石', 'Gem'],
  cardicon_fire: ['炎', 'Flame'],
  cardicon_moon: ['月', 'Moon'],
  cardicon_dragon: ['龍', 'Dragon'],
  cardicon_crown: ['王冠', 'Crown'],
  daily_double: ['🎟️ デイリー2倍券', '🎟️ Daily Double Ticket'],
  insurance: ['🛡️ 保険券', '🛡️ Insurance Ticket'],
  streak_guard: ['🔥 連続守り券', '🔥 Streak Guard Ticket'],
  labor_drink: ['🥤 栄養ドリンコ', '🥤 Energy Drink'],
  horse_voucher: ['🐎 競走馬（購入券）', '🐎 Racehorse Voucher'],
  carrot: ['🥕 にんじん', '🥕 Carrot'],
  insider_memo: ['🕴️ 裏情報メモ（決算）', '🕴️ Insider Memo (Earnings)'],
  gold_carrot: ['🥇 金にんじん', '🥇 Golden Carrot'],
  skin_kuro: ['🕴️ 黒服の立会い', '🕴️ Black Suit Dealer'],
  skin_gold_dice: ['🎲 黄金の賽', '🎲 Golden Dice'],
  skin_glass_dice: ['💅 血のマニキュア / ガラスの賽', '💅 Glass Dice / Blood Manicure'],
  skin_vip: ['🌹 VIP黒薔薇シート', '🌹 VIP Black Rose Seat'],
  skin_numa: ['🌀 沼（第3クギ突破仕様演出）', '🌀 The Swamp (Nail 3 Breakthrough FX)'],
  col_beer: ['キンキンに冷えたビール', 'Ice-Cold Beer'],
  col_yakitori: ['焼き鳥・柿ピー盛り合わせ', 'Yakitori & Peanuts Platter'],
  col_gaishutsu: ['1日外出録（外出許可証レプリカ）', 'Day Pass Replica'],
  col_sunglasses: ['黒服のサングラス', 'Black Suit Sunglasses'],
  col_teppan: ['焼き土下座用の鉄板・炭火セット', 'Dogeza Iron Plate & Charcoal Set'],
  col_megaphone: ['利根川の拡声器', "Tone's Megaphone"],
  col_gold_bar: ['純金の延べ棒（1kg）', 'Pure Gold Bar (1 kg)'],
  col_stock: ['帝愛グループ特別優待株券（額装）', 'Teiai Group Shareholder Certificate (Framed)'],
  col_throne: ['兵藤会長の玉座', "Chairman Hyodo's Throne"],
  role_red: ['🔴 赤', '🔴 Red'],
  role_orange: ['🟠 橙', '🟠 Orange'],
  role_yellow: ['🟡 黄', '🟡 Yellow'],
  role_green: ['🟢 緑', '🟢 Green'],
  role_cyan: ['🩵 水色', '🩵 Cyan'],
  role_blue: ['🔵 青', '🔵 Blue'],
  role_purple: ['🟣 紫', '🟣 Purple'],
  role_pink: ['🩷 桃', '🩷 Pink'],
  role_gold: ['🥇 金', '🥇 Gold'],
  role_silver: ['🥈 銀', '🥈 Silver'],
  role_black: ['⚫ 黒', '⚫ Black'],
  role_white: ['⚪ 白', '⚪ White'],
};

/** The catalog text has a leading emoji; the screens show a pixel icon instead. */
const LEADING_EMOJI = /^[\p{Extended_Pictographic}\u200d\ufe0f]+\s*/u;

/** The shown name of a catalog item, without its emoji; unknown ids show as is. */
export function itemLabel(locale: Locale, id: string): string {
  const label = ITEM_LABELS[id];
  return label ? label[locale === 'ja' ? 0 : 1].replace(LEADING_EMOJI, '') : id;
}

const ITEM_ICONS: Readonly<Record<string, GameIconName>> = {
  title_rookie: 'dice',
  title_broke: 'coin',
  title_regular: 'slots',
  title_zawa: 'cards',
  title_underground: 'pickaxe',
  title_lucky: 'clover',
  title_emperor: 'crown',
  title_creditor: 'coin',
  title_fixer: 'sword',
  title_100oku: 'stocks',
  title_weekly_king: 'crown',
  cardicon_slot: 'slots',
  cardicon_gem: 'gem',
  cardicon_fire: 'flame',
  cardicon_moon: 'sword',
  cardicon_dragon: 'flame',
  cardicon_crown: 'crown',
  daily_double: 'ticket',
  insurance: 'shield',
  streak_guard: 'flame',
  labor_drink: 'drink',
  horse_voucher: 'horse',
  carrot: 'carrot',
  gold_carrot: 'carrot',
  insider_memo: 'stocks',
  col_gold_bar: 'coin',
  col_throne: 'crown',
  col_stock: 'stocks',
};

const PREFIX_ICONS: Readonly<Record<string, GameIconName>> = {
  title: 'crown',
  cardcolor: 'cards',
  cardicon: 'gem',
  skin: 'dice',
  col: 'gem',
  role: 'gem',
  relic: 'gem',
};

/** The pixel icon of a catalog item: its own, else one per family, else a coin. */
export function itemIcon(id: string): GameIconName {
  if (id === '?') return 'ticket';
  return ITEM_ICONS[id] ?? PREFIX_ICONS[id.split('_')[0] ?? ''] ?? 'coin';
}
