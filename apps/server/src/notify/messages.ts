import type {
  DomainEvent,
  DomainEventOf,
  DomainEventType,
  NotificationKind,
  Toast,
} from '@casino/shared';
import {
  dictionaries,
  formatPelica,
  inboxKindMessageKey,
  screenMessageKey,
  t,
  type Locale,
  type MessageKey,
  type MessageParams,
} from '@casino/shared/i18n';
import type { ChannelMessage, DiscordEmbed, EmbedField } from './ports.ts';
import { defaultEmbedTheme, type EmbedRole, type EmbedTheme } from './theme.ts';

/** All 17 domain events subscribed by the notify module (everything except per-minute MarketTick). */
export const SUBSCRIBED_EVENT_TYPES = [
  'GameSettled',
  'BigWin',
  'Jackpot',
  'RaceScheduled',
  'RaceFinished',
  'MarketMove',
  'TitleAwarded',
  'BankruptcyGraceStarted',
  'BankruptcyDeclared',
  'CompanyBankrupt',
  'LotteryDrawn',
  'HorseRetired',
  'LoanDue',
  'MissionCompleted',
  'OrderFilled',
  'MarketplaceOutbid',
  'DailyReady',
] as const satisfies readonly DomainEventType[];

export type SubscribedEventType = (typeof SUBSCRIBED_EVENT_TYPES)[number];
export type SubscribedDomainEvent = DomainEventOf<SubscribedEventType>;

export type PersonaId = 'race_caller' | 'market_news' | 'teiai_bank';

/**
 * Local notify i18n keys (English).
 *
 * TODO(A1): Move these keys into `packages/shared/i18n/{en,ja}.ts` in the next shared contract
 * batch. Placeholder parity with `NOTIFY_MESSAGES_JA` is enforced by tests via `checkParity`.
 */
export const NOTIFY_MESSAGES_EN = {
  'notify.persona.race_caller': 'Race Caller',
  'notify.persona.market_news': 'Market News',
  'notify.persona.teiai_bank': 'Teiai Bank',

  'notify.batch.title': '{count} casino updates',
  'notify.batch.footer': 'Batched announcements',
  'notify.digest.title': 'Your casino digest ({count} updates)',
  'notify.digest.footer': 'Hourly DM digest — adjust your preferences in Settings',

  'notify.event.GameSettled.title': 'Big Win!',
  'notify.event.GameSettled.body': '<@{userId}> won {payout} playing {game} (net +{net}).',
  'notify.event.BigWin.title': 'Big Win!',
  'notify.event.BigWin.body': '<@{userId}> hit a {multiplier}x win of {payout} on {game}!',
  'notify.event.Jackpot.title': 'Jackpot!',
  'notify.event.Jackpot.body': '<@{userId}> hit the {game} jackpot for {amount}!',
  'notify.event.RaceScheduled.title': 'Race #{raceId} Scheduled',
  'notify.event.RaceScheduled.body': 'Post time <t:{startsAtSec}:R> with {entrants} entrants.',
  'notify.event.RaceFinished.title': 'Race #{raceId} Finished',
  'notify.event.RaceFinished.body': 'Official order: {placings}.',
  'notify.event.MarketMove.title': 'Market Alert: {ticker}',
  'notify.event.MarketMove.spike': '{ticker} surged {change}% to {price}.',
  'notify.event.MarketMove.crash': '{ticker} plunged {change}% to {price}.',
  'notify.event.TitleAwarded.title': 'Title Awarded',
  'notify.event.TitleAwarded.body': '<@{userId}> earned the title "{titleId}".',
  'notify.event.TitleAwarded.weekly': '<@{userId}> earned weekly title "{titleId}" ({week}).',
  'notify.event.BankruptcyGraceStarted.title': 'Bankruptcy Grace Period Started',
  'notify.event.BankruptcyGraceStarted.body':
    '<@{userId}> has {debt} in debt. Grace period ends <t:{graceEndsAtSec}:R>.',
  'notify.event.BankruptcyDeclared.title': 'Bankruptcy Declared',
  'notify.event.BankruptcyDeclared.body':
    '<@{userId}> declared bankruptcy ({cause}): debt {debtBefore} → {debtAfter}.',
  'notify.event.CompanyBankrupt.title': 'Company Collapsed: {companyName}',
  'notify.event.CompanyBankrupt.body':
    '{companyName} (owner <@{ownerId}>) went bankrupt ({cause}). {investors} investor stakes wiped.',
  'notify.event.LotteryDrawn.title': 'Lottery #{lotteryId} Drawn',
  'notify.event.LotteryDrawn.won':
    '<@{winnerId}> won {prize} from {entrants} entries (ticket {fee})!',
  'notify.event.LotteryDrawn.refunded':
    'Lottery #{lotteryId} was cancelled; {entrants} entries were refunded {fee} each.',
  'notify.event.HorseRetired.title': 'Horse Retired',
  'notify.event.HorseRetired.body':
    '<@{userId}> retired horse #{horseId} for a payout of {payout}.',
  'notify.event.LoanDue.title': 'Loan Repayment Due',
  'notify.event.LoanDue.body': 'Loan #{loanId} for {amount} is due <t:{dueAtSec}:R>.',
  'notify.event.MissionCompleted.title': 'Mission Completed',
  'notify.event.MissionCompleted.body': 'Completed mission "{missionId}" and earned {reward}.',
  'notify.event.OrderFilled.title': 'Order Filled: {ticker}',
  'notify.event.OrderFilled.body':
    'Order #{orderId} ({side}) filled: {quantity} {ticker} @ {price}.',
  'notify.event.MarketplaceOutbid.title': 'You Were Outbid',
  'notify.event.MarketplaceOutbid.body': 'Listing #{listingId} now has a higher bid of {newBid}.',
  'notify.event.DailyReady.title': 'Daily Bonus Ready',
  'notify.event.DailyReady.body': 'Your daily bonus is ready to claim!',

  'notify.dm_disabled.title': 'Direct Messages Disabled',
  'notify.dm_disabled.body':
    'We could not deliver a DM because your Discord DMs are closed. DM notifications have been turned off; re-enable them after opening DMs.',

  'notify.cause.voluntary': 'voluntary',
  'notify.cause.forced': 'forced',
  'notify.cause.escape': 'overseas escape',
  'notify.cause.upkeep': 'unpaid upkeep',
  'notify.cause.owner_bankrupt': 'owner bankruptcy',
  'notify.side.buy': 'BUY',
  'notify.side.sell': 'SELL',
  'notify.race.noPlacings': 'No finishers',
} as const;

export type NotifyLocalMessageKey = keyof typeof NOTIFY_MESSAGES_EN;
export type NotifyMessageKey = MessageKey | NotifyLocalMessageKey;

/** Local notify i18n keys (Japanese), typed strictly against `NOTIFY_MESSAGES_EN`. */
export const NOTIFY_MESSAGES_JA: Readonly<Record<NotifyLocalMessageKey, string>> = {
  'notify.persona.race_caller': '競馬実況',
  'notify.persona.market_news': '証券ニュース',
  'notify.persona.teiai_bank': '帝愛銀行',

  'notify.batch.title': 'カジノのお知らせ（{count}件）',
  'notify.batch.footer': 'まとめ通知',
  'notify.digest.title': 'カジノ通知ダイジェスト（{count}件）',
  'notify.digest.footer': '1時間ごとのDMダイジェスト — 設定から変更できます',

  'notify.event.GameSettled.title': '大当たり！',
  'notify.event.GameSettled.body': '<@{userId}> が{game}で{payout}を獲得（純利益 +{net}）！',
  'notify.event.BigWin.title': 'ビッグウィン！',
  'notify.event.BigWin.body': '<@{userId}> が{game}で{multiplier}倍（{payout}）を獲得！',
  'notify.event.Jackpot.title': 'ジャックポット！',
  'notify.event.Jackpot.body': '<@{userId}> が{game}のジャックポット {amount} を獲得！',
  'notify.event.RaceScheduled.title': '第{raceId}回レース 開催予定',
  'notify.event.RaceScheduled.body': '発走 <t:{startsAtSec}:R>（出走 {entrants}頭）',
  'notify.event.RaceFinished.title': '第{raceId}回レース 確定',
  'notify.event.RaceFinished.body': '着順: {placings}',
  'notify.event.MarketMove.title': '市況速報: {ticker}',
  'notify.event.MarketMove.spike': '{ticker} が {change}% 急騰（現在値 {price}）！',
  'notify.event.MarketMove.crash': '{ticker} が {change}% 急落（現在値 {price}）！',
  'notify.event.TitleAwarded.title': '称号獲得',
  'notify.event.TitleAwarded.body': '<@{userId}> が称号「{titleId}」を獲得しました！',
  'notify.event.TitleAwarded.weekly':
    '<@{userId}> が週間称号「{titleId}」を獲得しました（{week}週）！',
  'notify.event.BankruptcyGraceStarted.title': '破産猶予期間 開始',
  'notify.event.BankruptcyGraceStarted.body':
    '<@{userId}> の借金は {debt} です。猶予期限は <t:{graceEndsAtSec}:R> です。',
  'notify.event.BankruptcyDeclared.title': '破産確定',
  'notify.event.BankruptcyDeclared.body':
    '<@{userId}> が破産しました（{cause}）：借金 {debtBefore} → {debtAfter}。',
  'notify.event.CompanyBankrupt.title': '企業倒産: {companyName}',
  'notify.event.CompanyBankrupt.body':
    '{companyName}（オーナー <@{ownerId}>）が倒産しました（{cause}）。投資家 {investors}名の持分が消滅しました。',
  'notify.event.LotteryDrawn.title': '抽選会 #{lotteryId} 結果',
  'notify.event.LotteryDrawn.won':
    '<@{winnerId}> が賞金 {prize} を獲得（参加 {entrants}名・参加費 {fee}）！',
  'notify.event.LotteryDrawn.refunded':
    '抽選会 #{lotteryId} は中止となり、{entrants}名へ参加費 {fee} を返金しました。',
  'notify.event.HorseRetired.title': '競走馬 引退',
  'notify.event.HorseRetired.body':
    '<@{userId}> の競走馬 #{horseId} が引退し、{payout} を受け取りました。',
  'notify.event.LoanDue.title': 'ローン返済期限',
  'notify.event.LoanDue.body': 'ローン #{loanId}（{amount}）の返済期限は <t:{dueAtSec}:R> です。',
  'notify.event.MissionCompleted.title': 'ミッション達成',
  'notify.event.MissionCompleted.body':
    'ミッション「{missionId}」を達成し、報酬 {reward} を獲得しました！',
  'notify.event.OrderFilled.title': '注文約定: {ticker}',
  'notify.event.OrderFilled.body':
    '注文 #{orderId}（{side}）が約定しました：{ticker} {quantity} @ {price}。',
  'notify.event.MarketplaceOutbid.title': 'オークション競り負け',
  'notify.event.MarketplaceOutbid.body':
    '出品 #{listingId} でより高い入札（{newBid}）がありました。',
  'notify.event.DailyReady.title': 'デイリーボーナス受け取り可能',
  'notify.event.DailyReady.body': 'デイリーボーナスを受け取れるようになりました！',

  'notify.dm_disabled.title': 'DM通知を自動オフにしました',
  'notify.dm_disabled.body':
    'DMを受け取れない設定のため送信できませんでした。DM通知をオフにしました。DiscordのDM設定を開いたあとに再度オンにしてください。',

  'notify.cause.voluntary': '自己破産',
  'notify.cause.forced': '強制破産',
  'notify.cause.escape': '海外逃亡',
  'notify.cause.upkeep': '維持費未払い',
  'notify.cause.owner_bankrupt': 'オーナー破産',
  'notify.side.buy': '買い',
  'notify.side.sell': '売り',
  'notify.race.noPlacings': '完走馬なし',
};

const LOCAL_DICTIONARIES: Readonly<
  Record<Locale, Readonly<Record<NotifyLocalMessageKey, string>>>
> = {
  en: NOTIFY_MESSAGES_EN,
  ja: NOTIFY_MESSAGES_JA,
};

/**
 * Translate either a shared i18n key (delegating to `@casino/shared/i18n`'s `t()`)
 * or a local notify key awaiting inclusion in `packages/shared/i18n/`.
 */
export function translateNotify(
  locale: Locale,
  key: NotifyMessageKey,
  params?: MessageParams,
): string {
  if (key in dictionaries[locale]) {
    return t(locale, key as MessageKey, params);
  }
  const text = LOCAL_DICTIONARIES[locale][key as NotifyLocalMessageKey];
  if (!params) return text;
  return text.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

export interface EventMeta {
  readonly titleKey: NotifyLocalMessageKey;
  readonly bodyKey: NotifyLocalMessageKey;
  readonly role: EmbedRole;
  readonly persona: PersonaId | null;
  readonly defaultAnnounce: boolean;
  readonly notificationKind: NotificationKind | null;
  readonly toastTone: Toast['tone'];
}

/** Complete metadata map covering every one of the 17 subscribed events. */
export const EVENT_META: Readonly<Record<SubscribedEventType, EventMeta>> = {
  GameSettled: {
    titleKey: 'notify.event.GameSettled.title',
    bodyKey: 'notify.event.GameSettled.body',
    role: 'success',
    persona: null,
    defaultAnnounce: true,
    notificationKind: null,
    toastTone: 'success',
  },
  BigWin: {
    titleKey: 'notify.event.BigWin.title',
    bodyKey: 'notify.event.BigWin.body',
    role: 'gold',
    persona: null,
    defaultAnnounce: true,
    notificationKind: null,
    toastTone: 'success',
  },
  Jackpot: {
    titleKey: 'notify.event.Jackpot.title',
    bodyKey: 'notify.event.Jackpot.body',
    role: 'gold',
    persona: null,
    defaultAnnounce: true,
    notificationKind: null,
    toastTone: 'success',
  },
  RaceScheduled: {
    titleKey: 'notify.event.RaceScheduled.title',
    bodyKey: 'notify.event.RaceScheduled.body',
    role: 'race',
    persona: 'race_caller',
    defaultAnnounce: true,
    notificationKind: null,
    toastTone: 'info',
  },
  RaceFinished: {
    titleKey: 'notify.event.RaceFinished.title',
    bodyKey: 'notify.event.RaceFinished.body',
    role: 'race',
    persona: 'race_caller',
    defaultAnnounce: true,
    notificationKind: 'race_result',
    toastTone: 'info',
  },
  MarketMove: {
    titleKey: 'notify.event.MarketMove.title',
    bodyKey: 'notify.event.MarketMove.spike',
    role: 'market',
    persona: 'market_news',
    defaultAnnounce: true,
    notificationKind: null,
    toastTone: 'warning',
  },
  TitleAwarded: {
    titleKey: 'notify.event.TitleAwarded.title',
    bodyKey: 'notify.event.TitleAwarded.body',
    role: 'gold',
    persona: null,
    defaultAnnounce: true,
    notificationKind: null,
    toastTone: 'success',
  },
  BankruptcyGraceStarted: {
    titleKey: 'notify.event.BankruptcyGraceStarted.title',
    bodyKey: 'notify.event.BankruptcyGraceStarted.body',
    role: 'bank',
    persona: 'teiai_bank',
    defaultAnnounce: true,
    notificationKind: 'bankruptcy_grace',
    toastTone: 'warning',
  },
  BankruptcyDeclared: {
    titleKey: 'notify.event.BankruptcyDeclared.title',
    bodyKey: 'notify.event.BankruptcyDeclared.body',
    role: 'bank',
    persona: 'teiai_bank',
    defaultAnnounce: true,
    notificationKind: null,
    toastTone: 'error',
  },
  CompanyBankrupt: {
    titleKey: 'notify.event.CompanyBankrupt.title',
    bodyKey: 'notify.event.CompanyBankrupt.body',
    role: 'bank',
    persona: 'teiai_bank',
    defaultAnnounce: true,
    notificationKind: null,
    toastTone: 'warning',
  },
  LotteryDrawn: {
    titleKey: 'notify.event.LotteryDrawn.title',
    bodyKey: 'notify.event.LotteryDrawn.won',
    role: 'gold',
    persona: null,
    defaultAnnounce: true,
    notificationKind: null,
    toastTone: 'success',
  },
  HorseRetired: {
    titleKey: 'notify.event.HorseRetired.title',
    bodyKey: 'notify.event.HorseRetired.body',
    role: 'race',
    persona: 'race_caller',
    defaultAnnounce: false,
    notificationKind: 'horse_retired',
    toastTone: 'info',
  },
  LoanDue: {
    titleKey: 'notify.event.LoanDue.title',
    bodyKey: 'notify.event.LoanDue.body',
    role: 'warning',
    persona: 'teiai_bank',
    defaultAnnounce: false,
    notificationKind: 'loan_due',
    toastTone: 'warning',
  },
  MissionCompleted: {
    titleKey: 'notify.event.MissionCompleted.title',
    bodyKey: 'notify.event.MissionCompleted.body',
    role: 'success',
    persona: null,
    defaultAnnounce: false,
    notificationKind: 'mission_complete',
    toastTone: 'success',
  },
  OrderFilled: {
    titleKey: 'notify.event.OrderFilled.title',
    bodyKey: 'notify.event.OrderFilled.body',
    role: 'market',
    persona: 'market_news',
    defaultAnnounce: false,
    notificationKind: 'order_filled',
    toastTone: 'success',
  },
  MarketplaceOutbid: {
    titleKey: 'notify.event.MarketplaceOutbid.title',
    bodyKey: 'notify.event.MarketplaceOutbid.body',
    role: 'warning',
    persona: null,
    defaultAnnounce: false,
    notificationKind: 'marketplace_outbid',
    toastTone: 'warning',
  },
  DailyReady: {
    titleKey: 'notify.event.DailyReady.title',
    bodyKey: 'notify.event.DailyReady.body',
    role: 'primary',
    persona: null,
    defaultAnnounce: false,
    notificationKind: 'daily_ready',
    toastTone: 'info',
  },
};

export function isSubscribedEvent(event: DomainEvent): event is SubscribedDomainEvent {
  return event.type !== 'MarketTick';
}

function formatPriceMicros(locale: Locale, micros: number): string {
  const whole = micros / 1_000_000;
  const formatted = new Intl.NumberFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
    maximumFractionDigits: 2,
  }).format(whole);
  return t(locale, 'currency.amount', { amount: formatted });
}

function formatQuantityMilli(milli: number): string {
  const value = milli / 1_000;
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '');
}

function formatPercentFromBps(bps: number): string {
  const sign = bps > 0 ? '+' : '';
  return `${sign}${(bps / 100).toFixed(1)}`;
}

export interface RenderedEventCopy {
  title: string;
  body: string;
  role: EmbedRole;
  openInActivity: boolean;
}

/** Render title + body + color role for any subscribed domain event in the given locale. */
export function renderEventCopy(locale: Locale, event: SubscribedDomainEvent): RenderedEventCopy {
  const meta = EVENT_META[event.type];
  switch (event.type) {
    case 'GameSettled': {
      const game = t(locale, screenMessageKey(event.game));
      return {
        title: translateNotify(locale, meta.titleKey),
        body: translateNotify(locale, meta.bodyKey, {
          userId: event.userId,
          game,
          payout: formatPelica(locale, event.payout),
          net: formatPelica(locale, event.net),
        }),
        role: meta.role,
        openInActivity: event.source === 'chat',
      };
    }
    case 'BigWin': {
      const game = t(locale, screenMessageKey(event.game));
      return {
        title: translateNotify(locale, meta.titleKey),
        body: translateNotify(locale, meta.bodyKey, {
          userId: event.userId,
          game,
          payout: formatPelica(locale, event.payout),
          multiplier: (event.multiplierBps / 10_000).toFixed(2),
        }),
        role: meta.role,
        openInActivity: false,
      };
    }
    case 'Jackpot': {
      const game = t(locale, screenMessageKey(event.game));
      return {
        title: translateNotify(locale, meta.titleKey),
        body: translateNotify(locale, meta.bodyKey, {
          userId: event.userId,
          game,
          amount: formatPelica(locale, event.amount),
        }),
        role: meta.role,
        openInActivity: false,
      };
    }
    case 'RaceScheduled':
      return {
        title: translateNotify(locale, meta.titleKey, { raceId: event.raceId }),
        body: translateNotify(locale, meta.bodyKey, {
          startsAtSec: Math.floor(event.startsAt / 1000),
          entrants: event.entrants,
        }),
        role: meta.role,
        openInActivity: false,
      };
    case 'RaceFinished': {
      const placings =
        event.placings.length > 0
          ? event.placings.map((horseId, idx) => `${idx + 1}. #${horseId}`).join(' / ')
          : translateNotify(locale, 'notify.race.noPlacings');
      return {
        title: translateNotify(locale, meta.titleKey, { raceId: event.raceId }),
        body: translateNotify(locale, meta.bodyKey, { placings }),
        role: meta.role,
        openInActivity: false,
      };
    }
    case 'MarketMove': {
      const bodyKey =
        event.direction === 'spike'
          ? 'notify.event.MarketMove.spike'
          : 'notify.event.MarketMove.crash';
      return {
        title: translateNotify(locale, meta.titleKey, { ticker: event.ticker }),
        body: translateNotify(locale, bodyKey, {
          ticker: event.ticker,
          change: formatPercentFromBps(event.changeBps),
          price: formatPriceMicros(locale, event.price),
        }),
        role: event.direction === 'spike' ? 'success' : 'error',
        openInActivity: false,
      };
    }
    case 'TitleAwarded':
      return {
        title: translateNotify(locale, meta.titleKey),
        body: event.week
          ? translateNotify(locale, 'notify.event.TitleAwarded.weekly', {
              userId: event.userId,
              titleId: event.titleId,
              week: event.week,
            })
          : translateNotify(locale, meta.bodyKey, {
              userId: event.userId,
              titleId: event.titleId,
            }),
        role: meta.role,
        openInActivity: false,
      };
    case 'BankruptcyGraceStarted':
      return {
        title: translateNotify(locale, meta.titleKey),
        body: translateNotify(locale, meta.bodyKey, {
          userId: event.userId,
          debt: formatPelica(locale, event.debt),
          graceEndsAtSec: Math.floor(event.graceEndsAt / 1000),
        }),
        role: meta.role,
        openInActivity: false,
      };
    case 'BankruptcyDeclared': {
      const cause = translateNotify(locale, `notify.cause.${event.cause}`);
      return {
        title: translateNotify(locale, meta.titleKey),
        body: translateNotify(locale, meta.bodyKey, {
          userId: event.userId,
          cause,
          debtBefore: formatPelica(locale, event.debtBefore),
          debtAfter: formatPelica(locale, event.debtAfter),
        }),
        role: meta.role,
        openInActivity: false,
      };
    }
    case 'CompanyBankrupt': {
      const cause = translateNotify(locale, `notify.cause.${event.cause}`);
      return {
        title: translateNotify(locale, meta.titleKey, { companyName: event.companyName }),
        body: translateNotify(locale, meta.bodyKey, {
          companyName: event.companyName,
          ownerId: event.ownerId,
          cause,
          investors: event.investorIds.length,
        }),
        role: meta.role,
        openInActivity: false,
      };
    }
    case 'LotteryDrawn': {
      const winnerId = event.outcome === 'won' ? event.winnerId : undefined;
      return {
        title: translateNotify(locale, meta.titleKey, { lotteryId: event.lotteryId }),
        body: winnerId
          ? translateNotify(locale, 'notify.event.LotteryDrawn.won', {
              winnerId,
              prize: formatPelica(locale, event.prize),
              entrants: event.entrantIds.length,
              fee: formatPelica(locale, event.fee),
            })
          : translateNotify(locale, 'notify.event.LotteryDrawn.refunded', {
              lotteryId: event.lotteryId,
              entrants: event.entrantIds.length,
              fee: formatPelica(locale, event.fee),
            }),
        role: winnerId ? 'gold' : 'info',
        openInActivity: false,
      };
    }
    case 'HorseRetired':
      return {
        title: translateNotify(locale, meta.titleKey),
        body: translateNotify(locale, meta.bodyKey, {
          userId: event.userId,
          horseId: event.horseId,
          payout: formatPelica(locale, event.payout),
        }),
        role: meta.role,
        openInActivity: false,
      };
    case 'LoanDue':
      return {
        title: translateNotify(locale, meta.titleKey),
        body: translateNotify(locale, meta.bodyKey, {
          loanId: event.loanId,
          amount: formatPelica(locale, event.amount),
          dueAtSec: Math.floor(event.dueAt / 1000),
        }),
        role: meta.role,
        openInActivity: false,
      };
    case 'MissionCompleted':
      return {
        title: translateNotify(locale, meta.titleKey),
        body: translateNotify(locale, meta.bodyKey, {
          missionId: event.missionId,
          reward: formatPelica(locale, event.reward),
        }),
        role: meta.role,
        openInActivity: false,
      };
    case 'OrderFilled': {
      const side = translateNotify(locale, `notify.side.${event.side}`);
      return {
        title: translateNotify(locale, meta.titleKey, { ticker: event.ticker }),
        body: translateNotify(locale, meta.bodyKey, {
          orderId: event.orderId,
          side,
          ticker: event.ticker,
          quantity: formatQuantityMilli(event.quantity),
          price: formatPriceMicros(locale, event.price),
        }),
        role: meta.role,
        openInActivity: false,
      };
    }
    case 'MarketplaceOutbid':
      return {
        title: translateNotify(locale, meta.titleKey),
        body: translateNotify(locale, meta.bodyKey, {
          listingId: event.listingId,
          newBid: formatPelica(locale, event.newBid),
        }),
        role: meta.role,
        openInActivity: false,
      };
    case 'DailyReady':
      return {
        title: translateNotify(locale, meta.titleKey),
        body: translateNotify(locale, meta.bodyKey),
        role: meta.role,
        openInActivity: false,
      };
  }
}

/** Render one or more events into a single Discord ChannelMessage (coalescing bursts into 1 embed). */
export function renderAnnouncementBatch(
  locale: Locale,
  events: readonly SubscribedDomainEvent[],
  theme: EmbedTheme = defaultEmbedTheme,
): ChannelMessage {
  const first = events[0];
  if (!first) return { embeds: [] };

  if (events.length === 1) {
    const copy = renderEventCopy(locale, first);
    const embed: DiscordEmbed = {
      title: copy.title,
      description: copy.body,
      color: theme.color(copy.role),
      timestamp: new Date(first.at).toISOString(),
    };
    return {
      embeds: [embed],
      openInActivity: copy.openInActivity,
    };
  }

  const rendered = events.map((ev) => ({ ev, copy: renderEventCopy(locale, ev) }));
  const fields: EmbedField[] = rendered.slice(0, 25).map(({ copy }) => ({
    name: copy.title,
    value: copy.body.slice(0, 1024),
  }));
  const primaryRole = rendered[0]?.copy.role ?? 'primary';
  const latestAt = events[events.length - 1]?.at ?? first.at;

  return {
    embeds: [
      {
        title: translateNotify(locale, 'notify.batch.title', { count: events.length }),
        color: theme.color(primaryRole),
        fields,
        footer: { text: translateNotify(locale, 'notify.batch.footer') },
        timestamp: new Date(latestAt).toISOString(),
      },
    ],
    openInActivity: rendered.some(({ copy }) => copy.openInActivity),
  };
}

/** Render one or more queued DM items into a single DM message (digest when 2+ items). */
export function renderDmBatch(
  locale: Locale,
  events: readonly SubscribedDomainEvent[],
  theme: EmbedTheme = defaultEmbedTheme,
): ChannelMessage {
  const first = events[0];
  if (!first) return { embeds: [] };

  if (events.length === 1) {
    const copy = renderEventCopy(locale, first);
    return {
      embeds: [
        {
          title: copy.title,
          description: copy.body,
          color: theme.color(copy.role),
          timestamp: new Date(first.at).toISOString(),
        },
      ],
    };
  }

  const fields: EmbedField[] = events.slice(0, 25).map((ev) => {
    const copy = renderEventCopy(locale, ev);
    return {
      name: copy.title,
      value: copy.body.slice(0, 1024),
    };
  });
  const latestAt = events[events.length - 1]?.at ?? first.at;
  return {
    embeds: [
      {
        title: translateNotify(locale, 'notify.digest.title', { count: events.length }),
        color: theme.color('primary'),
        fields,
        footer: { text: translateNotify(locale, 'notify.digest.footer') },
        timestamp: new Date(latestAt).toISOString(),
      },
    ],
  };
}

/** Build the live Socket.io toast payload for an inbox notification using the shared `inbox.kind.*` key. */
export function buildNotificationToast(
  kind: NotificationKind,
  event: SubscribedDomainEvent,
): Toast {
  const meta = EVENT_META[event.type];
  return {
    guildId: event.guildId,
    tone: meta.toastTone,
    messageKey: inboxKindMessageKey(kind),
  };
}

/** Build the live Socket.io toast payload when a user's DMs are automatically disabled. */
export function buildDmDisabledToast(guildId: string): Toast {
  return {
    guildId,
    tone: 'warning',
    messageKey: 'notify.dm_disabled.title',
  };
}
