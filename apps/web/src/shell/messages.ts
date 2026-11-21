import type { NotificationKind, ScreenId } from '@casino/shared';

/**
 * Shell-only messages. The shared dictionaries are frozen and hold only a few keys, so the
 * shell layers its own on top; `ja` is checked against `en` by the compiler. When the shared
 * dictionaries grow, keys move there (see report).
 */
type ScreenKey = `screen.${ScreenId}`;
type KindKey = `inbox.kind.${NotificationKind}`;

const enScreens: Record<ScreenKey, string> = {
  'screen.home': 'Home',
  'screen.chinchiro': 'Chinchiro',
  'screen.pachinko': 'Pachinko',
  'screen.slots': 'Slots',
  'screen.blackjack': 'Blackjack',
  'screen.roulette': 'Roulette',
  'screen.horse': 'Horse racing',
  'screen.arena': 'Arena',
  'screen.daily': 'Daily bonus',
  'screen.missions': 'Missions',
  'screen.ranking': 'Ranking',
  'screen.transfer': 'Transfer',
  'screen.history': 'History',
  'screen.inventory': 'Inventory',
  'screen.shop': 'Shop',
  'screen.market': 'Market',
  'screen.stocks': 'Stocks',
  'screen.bank': 'Bank',
  'screen.loans': 'Loans',
  'screen.kyosai': 'Kyosai',
  'screen.companies': 'Companies',
  'screen.work': 'Work',
  'screen.quiz': 'Quiz',
  'screen.lottery': 'Lottery',
  'screen.poll': 'Poll',
  'screen.inbox': 'Inbox',
  'screen.profile': 'Profile',
  'screen.settings': 'Settings',
};

const jaScreens: Record<ScreenKey, string> = {
  'screen.home': 'ホーム',
  'screen.chinchiro': 'チンチロ',
  'screen.pachinko': 'パチンコ',
  'screen.slots': 'スロット',
  'screen.blackjack': 'ブラックジャック',
  'screen.roulette': 'ルーレット',
  'screen.horse': '競馬',
  'screen.arena': 'アリーナ',
  'screen.daily': 'デイリー',
  'screen.missions': 'ミッション',
  'screen.ranking': 'ランキング',
  'screen.transfer': '送金',
  'screen.history': '履歴',
  'screen.inventory': '持ち物',
  'screen.shop': 'ショップ',
  'screen.market': 'マーケット',
  'screen.stocks': '株',
  'screen.bank': '銀行',
  'screen.loans': 'ローン',
  'screen.kyosai': '共済',
  'screen.companies': '会社',
  'screen.work': '仕事',
  'screen.quiz': 'クイズ',
  'screen.lottery': '宝くじ',
  'screen.poll': '投票',
  'screen.inbox': '受信箱',
  'screen.profile': 'プロフィール',
  'screen.settings': '設定',
};

const enKinds: Record<KindKey, string> = {
  'inbox.kind.race_result': 'Race result',
  'inbox.kind.horse_retired': 'Horse retired',
  'inbox.kind.loan_due': 'Loan due',
  'inbox.kind.bankruptcy_grace': 'Bankruptcy grace period',
  'inbox.kind.daily_ready': 'Daily bonus ready',
  'inbox.kind.mission_complete': 'Mission complete',
  'inbox.kind.order_filled': 'Order filled',
  'inbox.kind.marketplace_outbid': 'Outbid on the marketplace',
};

const jaKinds: Record<KindKey, string> = {
  'inbox.kind.race_result': 'レース結果',
  'inbox.kind.horse_retired': '馬が引退しました',
  'inbox.kind.loan_due': 'ローンの返済期限',
  'inbox.kind.bankruptcy_grace': '破産の猶予期間',
  'inbox.kind.daily_ready': 'デイリーボーナス受け取り可',
  'inbox.kind.mission_complete': 'ミッション達成',
  'inbox.kind.order_filled': '注文が約定しました',
  'inbox.kind.marketplace_outbid': 'マーケットで競り負けました',
};

export const enShell = {
  ...enScreens,
  ...enKinds,
  'shell.loading': 'Connecting to the casino…',
  'shell.retry': 'Try again',
  'shell.notInDiscord': 'Open this app as a Discord Activity.',
  'shell.noGuild': 'Start the Activity from a server, not a direct message.',
  'shell.nav': 'Main navigation',
  'shell.players': 'Players here',
  'shell.balance': 'Balance',
  'shell.placeholder': 'This screen is on its way.',
  'shell.connecting': 'Connecting…',
  'shell.reconnecting': 'Reconnecting…',
  'shell.offline': 'Offline',
  'toast.dismiss': 'Dismiss',
  'settings.title': 'Settings',
  'settings.language.auto': 'Automatic',
  'settings.language.en': 'English',
  'settings.language.ja': '日本語',
  'settings.theme': 'Theme',
  'settings.theme.auto': 'Follow Discord',
  'settings.theme.light': 'Light',
  'settings.theme.dark': 'Dark',
  'settings.sound.enabled': 'Sound on',
  'settings.sound.sfx': 'Sound effects',
  'settings.sound.music': 'Music',
  'settings.saveFailed': 'Could not save your settings.',
  'inbox.title': 'Inbox',
  'inbox.empty': 'Nothing here yet.',
  'inbox.markAllRead': 'Mark all as read',
  'inbox.unread': 'Unread',
  'presence.playing': 'Playing {screen}',
  'presence.browsing': '{screen}',
} as const;

export type ShellKey = keyof typeof enShell;

export const jaShell: Record<ShellKey, string> = {
  ...jaScreens,
  ...jaKinds,
  'shell.loading': 'カジノに接続しています…',
  'shell.retry': 'もう一度試す',
  'shell.notInDiscord': 'Discord のアクティビティとして開いてください。',
  'shell.noGuild': 'ダイレクトメッセージではなく、サーバーから起動してください。',
  'shell.nav': 'メインメニュー',
  'shell.players': '参加中のプレイヤー',
  'shell.balance': '所持金',
  'shell.placeholder': 'この画面は準備中です。',
  'shell.connecting': '接続中…',
  'shell.reconnecting': '再接続中…',
  'shell.offline': 'オフライン',
  'toast.dismiss': '閉じる',
  'settings.title': '設定',
  'settings.language.auto': '自動',
  'settings.language.en': 'English',
  'settings.language.ja': '日本語',
  'settings.theme': 'テーマ',
  'settings.theme.auto': 'Discord に合わせる',
  'settings.theme.light': 'ライト',
  'settings.theme.dark': 'ダーク',
  'settings.sound.enabled': 'サウンドをオン',
  'settings.sound.sfx': '効果音',
  'settings.sound.music': 'ミュージック',
  'settings.saveFailed': '設定を保存できませんでした。',
  'inbox.title': '受信箱',
  'inbox.empty': 'まだ何もありません。',
  'inbox.markAllRead': 'すべて既読にする',
  'inbox.unread': '未読',
  'presence.playing': '{screen}中',
  'presence.browsing': '{screen}',
};

export const shellMessages = { en: enShell, ja: jaShell } as const;

export function screenKey(screen: ScreenId): ScreenKey {
  return `screen.${screen}`;
}
