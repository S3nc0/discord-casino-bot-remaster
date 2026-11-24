import {
  FOAL_ANNOUNCE_MIN_TOTAL,
  type DomainEvent,
  type DomainEventOf,
  type DomainEventType,
  type NotificationKind,
  type ScreenId,
  type Toast,
} from '@casino/shared';
import {
  en,
  formatPelica,
  inboxKindMessageKey,
  screenMessageKey,
  t,
  type Locale,
  type MessageKey,
} from '@casino/shared/i18n';
import type { ChannelMessage, DiscordEmbed, EmbedField } from './ports.ts';
import { defaultEmbedTheme, type EmbedRole, type EmbedTheme } from './theme.ts';

/** All 19 domain events subscribed by the notify module (everything except per-minute MarketTick). */
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
  'HorseFoaled',
  'LoanDue',
  'MissionCompleted',
  'OrderFilled',
  'MarketplaceOutbid',
  'DailyReady',
  'TeiaiRelicListed',
] as const satisfies readonly DomainEventType[];

export type SubscribedEventType = (typeof SUBSCRIBED_EVENT_TYPES)[number];
export type SubscribedDomainEvent = DomainEventOf<SubscribedEventType>;

export type PersonaId = 'race_caller' | 'market_news' | 'teiai_bank';

export interface EventMeta {
  readonly titleKey: MessageKey;
  readonly bodyKey: MessageKey;
  readonly role: EmbedRole;
  readonly persona: PersonaId | null;
  readonly defaultAnnounce: boolean;
  readonly notificationKind: NotificationKind | null;
  readonly toastTone: Toast['tone'];
}

/** Complete metadata map covering every one of the 19 subscribed events. */
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
  HorseFoaled: {
    titleKey: 'inbox.kind.horse_foaled',
    bodyKey: 'horse.announce.foaled',
    role: 'race',
    persona: 'race_caller',
    // Enabled by default; `shouldAnnounceEvent` gates guild posts to `statTotal >= FOAL_ANNOUNCE_MIN_TOTAL` (205).
    defaultAnnounce: true,
    notificationKind: 'horse_foaled',
    toastTone: 'success',
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
  TeiaiRelicListed: {
    titleKey: 'notify.event.TeiaiRelicListed.title',
    bodyKey: 'notify.event.TeiaiRelicListed.body',
    role: 'gold',
    persona: 'teiai_bank',
    defaultAnnounce: true,
    notificationKind: null,
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
  activityScreen?: ScreenId;
}

/** Render title + body + color role for any subscribed domain event in the given locale. */
export function renderEventCopy(locale: Locale, event: SubscribedDomainEvent): RenderedEventCopy {
  const meta = EVENT_META[event.type];
  switch (event.type) {
    case 'GameSettled': {
      const game = t(locale, screenMessageKey(event.game));
      return {
        title: t(locale, meta.titleKey),
        body: t(locale, meta.bodyKey, {
          userId: event.userId,
          game,
          payout: formatPelica(locale, event.payout),
          net: formatPelica(locale, event.net),
        }),
        role: meta.role,
        openInActivity: event.source === 'chat',
        activityScreen: event.game,
      };
    }
    case 'BigWin': {
      const game = t(locale, screenMessageKey(event.game));
      return {
        title: t(locale, meta.titleKey),
        body: t(locale, meta.bodyKey, {
          userId: event.userId,
          game,
          payout: formatPelica(locale, event.payout),
          multiplier: (event.multiplierBps / 10_000).toFixed(2),
        }),
        role: meta.role,
        openInActivity: false,
        activityScreen: event.game,
      };
    }
    case 'Jackpot': {
      const game = t(locale, screenMessageKey(event.game));
      return {
        title: t(locale, meta.titleKey),
        body: t(locale, meta.bodyKey, {
          userId: event.userId,
          game,
          amount: formatPelica(locale, event.amount),
        }),
        role: meta.role,
        openInActivity: false,
        activityScreen: event.game,
      };
    }
    case 'RaceScheduled':
      return {
        title: t(locale, meta.titleKey, { raceId: event.raceId }),
        body: t(locale, meta.bodyKey, {
          startsAtSec: Math.floor(event.startsAt / 1000),
          entrants: event.entrants,
        }),
        role: meta.role,
        openInActivity: false,
        activityScreen: 'horse',
      };
    case 'RaceFinished': {
      const placings =
        event.placings.length > 0
          ? event.placings.map((horseId, idx) => `${idx + 1}. #${horseId}`).join(' / ')
          : t(locale, 'notify.race.noPlacings');
      return {
        title: t(locale, meta.titleKey, { raceId: event.raceId }),
        body: t(locale, meta.bodyKey, { placings }),
        role: meta.role,
        openInActivity: false,
        activityScreen: 'horse',
      };
    }
    case 'MarketMove': {
      const bodyKey =
        event.direction === 'spike'
          ? 'notify.event.MarketMove.spike'
          : 'notify.event.MarketMove.crash';
      return {
        title: t(locale, meta.titleKey, { ticker: event.ticker }),
        body: t(locale, bodyKey, {
          ticker: event.ticker,
          change: formatPercentFromBps(event.changeBps),
          price: formatPriceMicros(locale, event.price),
        }),
        role: event.direction === 'spike' ? 'success' : 'error',
        openInActivity: false,
        activityScreen: 'market',
      };
    }
    case 'TitleAwarded':
      return {
        title: t(locale, meta.titleKey),
        body: event.week
          ? t(locale, 'notify.event.TitleAwarded.weekly', {
              userId: event.userId,
              titleId: event.titleId,
              week: event.week,
            })
          : t(locale, meta.bodyKey, {
              userId: event.userId,
              titleId: event.titleId,
            }),
        role: meta.role,
        openInActivity: false,
        activityScreen: 'profile',
      };
    case 'BankruptcyGraceStarted':
      return {
        title: t(locale, meta.titleKey),
        body: t(locale, meta.bodyKey, {
          userId: event.userId,
          debt: formatPelica(locale, event.debt),
          graceEndsAtSec: Math.floor(event.graceEndsAt / 1000),
        }),
        role: meta.role,
        openInActivity: false,
        activityScreen: 'bank',
      };
    case 'BankruptcyDeclared': {
      const cause = t(locale, `notify.cause.${event.cause}`);
      return {
        title: t(locale, meta.titleKey),
        body: t(locale, meta.bodyKey, {
          userId: event.userId,
          cause,
          debtBefore: formatPelica(locale, event.debtBefore),
          debtAfter: formatPelica(locale, event.debtAfter),
        }),
        role: meta.role,
        openInActivity: false,
        activityScreen: 'bank',
      };
    }
    case 'CompanyBankrupt': {
      const cause = t(locale, `notify.cause.${event.cause}`);
      return {
        title: t(locale, meta.titleKey, { companyName: event.companyName }),
        body: t(locale, meta.bodyKey, {
          companyName: event.companyName,
          ownerId: event.ownerId,
          cause,
          investors: event.investorIds.length,
        }),
        role: meta.role,
        openInActivity: false,
        activityScreen: 'companies',
      };
    }
    case 'LotteryDrawn': {
      const winnerId = event.outcome === 'won' ? event.winnerId : undefined;
      return {
        title: t(locale, meta.titleKey, { lotteryId: event.lotteryId }),
        body: winnerId
          ? t(locale, 'notify.event.LotteryDrawn.won', {
              winnerId,
              prize: formatPelica(locale, event.prize),
              entrants: event.entrantIds.length,
              fee: formatPelica(locale, event.fee),
            })
          : t(locale, 'notify.event.LotteryDrawn.refunded', {
              lotteryId: event.lotteryId,
              entrants: event.entrantIds.length,
              fee: formatPelica(locale, event.fee),
            }),
        role: winnerId ? 'gold' : 'info',
        openInActivity: false,
        activityScreen: 'lottery',
      };
    }
    case 'HorseRetired':
      return {
        title: t(locale, meta.titleKey),
        body: t(locale, meta.bodyKey, {
          userId: event.userId,
          horseId: event.horseId,
          payout: formatPelica(locale, event.payout),
        }),
        role: meta.role,
        openInActivity: false,
        activityScreen: 'horse',
      };
    case 'HorseFoaled': {
      const parentA = `#${event.parentIds[0]}`;
      const parentB = `#${event.parentIds[1]}`;
      const lineage = t(locale, 'horse.lineage', {
        a: parentA,
        b: parentB,
        gen: event.generation,
      });
      const matures = t(locale, 'horse.breed.matures', {
        time: `<t:${Math.floor(event.maturesAt / 1000)}:R>`,
      });
      const isPromising = event.statTotal >= FOAL_ANNOUNCE_MIN_TOTAL;
      const headline = isPromising
        ? t(locale, 'horse.announce.foaled', {
            name: event.foalName,
            owner: `<@${event.userId}>`,
            a: parentA,
            b: parentB,
          })
        : t(locale, 'horse.breed.born', { name: event.foalName });
      return {
        title: isPromising
          ? t(locale, meta.titleKey)
          : t(locale, 'horse.breed.born', { name: event.foalName }),
        body: isPromising ? `${headline}\n${lineage} · ${matures}` : `${lineage}\n${matures}`,
        role: isPromising ? 'gold' : meta.role,
        openInActivity: false,
        activityScreen: 'horse',
      };
    }
    case 'LoanDue':
      return {
        title: t(locale, meta.titleKey),
        body: t(locale, meta.bodyKey, {
          loanId: event.loanId,
          amount: formatPelica(locale, event.amount),
          dueAtSec: Math.floor(event.dueAt / 1000),
        }),
        role: meta.role,
        openInActivity: false,
        activityScreen: 'loans',
      };
    case 'MissionCompleted':
      return {
        title: t(locale, meta.titleKey),
        body: t(locale, meta.bodyKey, {
          missionId: event.missionId,
          reward: formatPelica(locale, event.reward),
        }),
        role: meta.role,
        openInActivity: false,
        activityScreen: 'missions',
      };
    case 'OrderFilled': {
      const side = t(locale, `notify.side.${event.side}`);
      return {
        title: t(locale, meta.titleKey, { ticker: event.ticker }),
        body: t(locale, meta.bodyKey, {
          orderId: event.orderId,
          side,
          ticker: event.ticker,
          quantity: formatQuantityMilli(event.quantity),
          price: formatPriceMicros(locale, event.price),
        }),
        role: meta.role,
        openInActivity: false,
        activityScreen: 'market',
      };
    }
    case 'MarketplaceOutbid':
      return {
        title: t(locale, meta.titleKey),
        body: t(locale, meta.bodyKey, {
          listingId: event.listingId,
          newBid: formatPelica(locale, event.newBid),
        }),
        role: meta.role,
        openInActivity: false,
        activityScreen: 'market',
      };
    case 'DailyReady':
      return {
        title: t(locale, meta.titleKey),
        body: t(locale, meta.bodyKey),
        role: meta.role,
        openInActivity: false,
        activityScreen: 'daily',
      };
    case 'TeiaiRelicListed': {
      const itemKey = `screen.finance.item.${event.itemId}`;
      const item = itemKey in en ? t(locale, itemKey as MessageKey) : event.itemId;
      return {
        title: t(locale, meta.titleKey, { item }),
        body: t(locale, meta.bodyKey, {
          item,
          listingId: event.listingId,
          startPrice: formatPelica(locale, event.startPrice),
          endAtSec: Math.floor(event.endAt / 1000),
        }),
        role: meta.role,
        openInActivity: true,
        activityScreen: 'market',
      };
    }
  }
}

/** Render one or more events into a single Discord ChannelMessage (coalescing bursts into 1 embed). */
export function renderAnnouncementBatch(
  locale: Locale,
  events: readonly SubscribedDomainEvent[],
  theme: EmbedTheme = defaultEmbedTheme,
): ChannelMessage {
  const first = events[0];
  if (!first) return { embeds: [], locale };

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
      ...(copy.activityScreen === undefined ? {} : { activityScreen: copy.activityScreen }),
      locale,
    };
  }

  const rendered = events.map((ev) => ({ ev, copy: renderEventCopy(locale, ev) }));
  const fields: EmbedField[] = rendered.slice(0, 25).map(({ copy }) => ({
    name: copy.title,
    value: copy.body.slice(0, 1024),
  }));
  const primaryRole = rendered[0]?.copy.role ?? 'primary';
  const latestAt = events[events.length - 1]?.at ?? first.at;
  const openCopy = rendered.find(({ copy }) => copy.openInActivity)?.copy;

  return {
    embeds: [
      {
        title: t(locale, 'notify.batch.title', { count: events.length }),
        color: theme.color(primaryRole),
        fields,
        footer: { text: t(locale, 'notify.batch.footer') },
        timestamp: new Date(latestAt).toISOString(),
      },
    ],
    openInActivity: openCopy !== undefined,
    ...(openCopy?.activityScreen === undefined ? {} : { activityScreen: openCopy.activityScreen }),
    locale,
  };
}

/** Render one or more queued DM items into a single DM message (digest when 2+ items). */
export function renderDmBatch(
  locale: Locale,
  events: readonly SubscribedDomainEvent[],
  theme: EmbedTheme = defaultEmbedTheme,
): ChannelMessage {
  const first = events[0];
  if (!first) return { embeds: [], locale };

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
      locale,
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
        title: t(locale, 'notify.digest.title', { count: events.length }),
        color: theme.color('primary'),
        fields,
        footer: { text: t(locale, 'notify.digest.footer') },
        timestamp: new Date(latestAt).toISOString(),
      },
    ],
    locale,
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
    messageKey: inboxKindMessageKey('dm_disabled'),
  };
}
