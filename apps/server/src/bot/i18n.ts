import { t, type Locale, type MessageKey, type MessageParams } from '@casino/shared/i18n';

/**
 * Local bot i18n messages not yet in `@casino/shared/i18n`.
 * Listed under NEXT for A1 to merge into packages/shared/i18n.
 */
export const botEn = {
  'bot.balance.title': "{name}'s Balance",
  'bot.balance.noAccount': 'No account in this server yet.',
  'bot.settings.status': 'Language: **{language}** (active: **{resolved}**)',
  'bot.settings.updated': 'Language updated to **{language}** (active: **{resolved}**).',
  'bot.settings.footer': 'Applies across all servers and the Activity.',
  'bot.help.title': 'Casino Guide',
  'bot.help.body':
    'Check your balance with `/pelica balance`, change language with `/settings`, or open the Activity below.',
  'bot.help.commandsTitle': 'Commands',
  'bot.help.commandsList':
    '`/pelica` `/casino` `/horse` `/arena` `/labor` `/market` `/loan` `/kyosai` `/company` `/shop` `/quiz` `/poll` `/settings`',
  'bot.activity.placeholder': 'Activity launch is coming in the next update.',
  'bot.comingSoon.title': 'Coming Soon',
  'bot.comingSoon.body': '`/{command}` is coming soon.',
  'bot.guard.guildOnly': 'Use this command in a server.',
  'bot.guard.ownerOnly': 'Only bot owners can use this command.',
  'bot.guard.dmOnly': 'Use this command in DMs with the bot.',
  'bot.error.unknownCommand': 'Unknown command.',
} as const;

export type BotLocalMessageKey = keyof typeof botEn;
export type BotLocalMessages = { readonly [K in BotLocalMessageKey]: string };
export type BotMessageKey = MessageKey | BotLocalMessageKey;

export const botJa: BotLocalMessages = {
  'bot.balance.title': '{name} の残高',
  'bot.balance.noAccount': 'まだ口座がありません。',
  'bot.settings.status': '言語設定: **{language}**（適用中: **{resolved}**）',
  'bot.settings.updated': '言語を **{language}** に変更しました（適用中: **{resolved}**）。',
  'bot.settings.footer': '全サーバーとアクティビティに共通です。',
  'bot.help.title': 'カジノ案内',
  'bot.help.body':
    '`/ペリカ 残高` で残高確認、`/設定` で言語変更、下のボタンでアクティビティを開けます。',
  'bot.help.commandsTitle': '主なコマンド',
  'bot.help.commandsList':
    '`/ペリカ` `/カジノ` `/競馬` `/闘技場` `/地下` `/証券` `/貸付` `/共済` `/会社` `/ショップ` `/クイズ` `/投票` `/設定`',
  'bot.activity.placeholder': 'アクティビティ起動は次回対応予定です。',
  'bot.comingSoon.title': '準備中',
  'bot.comingSoon.body': '`/{command}` は準備中です。',
  'bot.guard.guildOnly': 'このコマンドはサーバー内でのみ使えます。',
  'bot.guard.ownerOnly': 'Bot の持ち主だけが使えます。',
  'bot.guard.dmOnly': 'Bot とのDMでのみ使えます。',
  'bot.error.unknownCommand': '不明なコマンドです。',
};

const localDictionaries: Readonly<Record<Locale, BotLocalMessages>> = {
  en: botEn,
  ja: botJa,
};

function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

function isBotLocalKey(key: BotMessageKey): key is BotLocalMessageKey {
  return key in botEn;
}

/** Resolve either a shared `@casino/shared` key or a bot-local key in the target locale. */
export function tb(locale: Locale, key: BotMessageKey, params?: MessageParams): string {
  if (isBotLocalKey(key)) {
    return interpolate(localDictionaries[locale][key], params);
  }
  return t(locale, key, params);
}
