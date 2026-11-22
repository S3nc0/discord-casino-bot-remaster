import { describe, expect, it } from 'vitest';
import type { DomainEvent, DomainEventOf } from '@casino/shared';
import { dictionaries, LOCALES, type Locale } from '@casino/shared/i18n';
import {
  EVENT_META,
  isSubscribedEvent,
  renderAnnouncementBatch,
  renderDmBatch,
  renderEventCopy,
  SUBSCRIBED_EVENT_TYPES,
  type SubscribedDomainEvent,
  type SubscribedEventType,
} from './messages.ts';
import {
  botColor,
  createEmbedTheme,
  defaultEmbedTheme,
  EMBED_ROLE_COLORS,
  EMBED_ROLE_HEX,
  EMBED_ROLES,
  embedColor,
} from './theme.ts';

const G = '234567890123456789';
const U1 = '123456789012345678';
const U2 = '123456789012345679';
const AT = 1_800_000_000_000;

const SAMPLE_EVENTS: { [K in SubscribedEventType]: DomainEventOf<K> } = {
  GameSettled: {
    type: 'GameSettled',
    guildId: G,
    at: AT,
    userId: U1,
    game: 'slots',
    roundId: 'r-1',
    stake: 10_000,
    payout: 250_000,
    net: 240_000,
    source: 'chat',
  },
  BigWin: {
    type: 'BigWin',
    guildId: G,
    at: AT,
    userId: U1,
    game: 'chinchiro',
    roundId: 'r-2',
    payout: 500_000,
    multiplierBps: 50_000,
  },
  Jackpot: {
    type: 'Jackpot',
    guildId: G,
    at: AT,
    userId: U1,
    game: 'pachinko',
    amount: 1_200_000,
  },
  RaceScheduled: {
    type: 'RaceScheduled',
    guildId: G,
    at: AT,
    raceId: 12,
    startsAt: AT + 300_000,
    entrants: 8,
  },
  RaceFinished: {
    type: 'RaceFinished',
    guildId: G,
    at: AT,
    raceId: 12,
    placings: [3, 7, 1],
    ownerIds: [U1],
    bettorIds: [U2],
  },
  MarketMove: {
    type: 'MarketMove',
    guildId: G,
    at: AT,
    ticker: 'CS',
    direction: 'spike',
    changeBps: 1550,
    price: 42_500_000,
  },
  TitleAwarded: {
    type: 'TitleAwarded',
    guildId: G,
    at: AT,
    userId: U1,
    titleId: 'weekly_champion',
    week: '2026-11-16',
  },
  BankruptcyGraceStarted: {
    type: 'BankruptcyGraceStarted',
    guildId: G,
    at: AT,
    userId: U1,
    debt: 25_000,
    graceEndsAt: AT + 86_400_000,
  },
  BankruptcyDeclared: {
    type: 'BankruptcyDeclared',
    guildId: G,
    at: AT,
    userId: U1,
    cause: 'forced',
    debtBefore: 30_000,
    debtAfter: 10_000,
  },
  CompanyBankrupt: {
    type: 'CompanyBankrupt',
    guildId: G,
    at: AT,
    ownerId: U1,
    companyName: 'Teiai Mining',
    cause: 'upkeep',
    investorIds: [U1, U2],
  },
  LotteryDrawn: {
    type: 'LotteryDrawn',
    guildId: G,
    at: AT,
    lotteryId: 4,
    outcome: 'won',
    winnerId: U1,
    prize: 40_000,
    fee: 2_000,
    entrantIds: [U1, U2],
  },
  HorseRetired: {
    type: 'HorseRetired',
    guildId: G,
    at: AT,
    userId: U1,
    horseId: 9,
    payout: 65_000,
  },
  HorseFoaled: {
    type: 'HorseFoaled',
    guildId: G,
    at: AT,
    userId: U1,
    foalId: 42,
    foalName: 'Starlight',
    parentIds: [3, 7],
    statTotal: 207,
    generation: 2,
    maturesAt: AT + 86_400_000,
  },
  LoanDue: {
    type: 'LoanDue',
    guildId: G,
    at: AT,
    userId: U1,
    loanId: 7,
    amount: 15_000,
    dueAt: AT + 3_600_000,
  },
  MissionCompleted: {
    type: 'MissionCompleted',
    guildId: G,
    at: AT,
    userId: U1,
    missionId: 'play_5_slots',
    reward: 3_000,
  },
  OrderFilled: {
    type: 'OrderFilled',
    guildId: G,
    at: AT,
    userId: U1,
    orderId: 55,
    ticker: 'TECH',
    side: 'buy',
    quantity: 2_500,
    price: 120_000_000,
  },
  MarketplaceOutbid: {
    type: 'MarketplaceOutbid',
    guildId: G,
    at: AT,
    userId: U1,
    listingId: 88,
    newBid: 18_500,
  },
  DailyReady: {
    type: 'DailyReady',
    guildId: G,
    at: AT,
    userId: U1,
  },
};

describe('notify messages & shared i18n', () => {
  it('maps every one of the 18 subscribed events to shared EN and JA keys and renders without leftover placeholders', () => {
    expect(SUBSCRIBED_EVENT_TYPES).toHaveLength(18);

    for (const type of SUBSCRIBED_EVENT_TYPES) {
      const meta = EVENT_META[type];
      expect(dictionaries.en[meta.titleKey]).toBeTruthy();
      expect(dictionaries.ja[meta.titleKey]).toBeTruthy();
      expect(dictionaries.en[meta.bodyKey]).toBeTruthy();
      expect(dictionaries.ja[meta.bodyKey]).toBeTruthy();

      const event = SAMPLE_EVENTS[type];
      for (const locale of LOCALES) {
        const copy = renderEventCopy(locale, event);
        expect(copy.title.length).toBeGreaterThan(0);
        expect(copy.body.length).toBeGreaterThan(0);
        expect(copy.title).not.toMatch(/\{[A-Za-z0-9_]+\}/);
        expect(copy.body).not.toMatch(/\{[A-Za-z0-9_]+\}/);
      }

      // EN and JA render distinct localized strings.
      const enCopy = renderEventCopy('en', event);
      const jaCopy = renderEventCopy('ja', event);
      expect(enCopy.body).not.toBe(jaCopy.body);
    }
  });

  it('renders both promising (statTotal >= 205) and regular (< 205) HorseFoaled copies in EN and JA', () => {
    const regularFoal: SubscribedDomainEvent = { ...SAMPLE_EVENTS.HorseFoaled, statTotal: 198 };
    const promisingFoal = SAMPLE_EVENTS.HorseFoaled;

    for (const locale of LOCALES) {
      const reg = renderEventCopy(locale, regularFoal);
      const prom = renderEventCopy(locale, promisingFoal);
      expect(reg.role).toBe('race');
      expect(prom.role).toBe('gold');
      expect(reg.title).toContain('Starlight');
      expect(prom.body).toContain('Starlight');
      expect(prom.body).toContain(`<@${U1}>`);
      expect(reg.body).not.toMatch(/\{[A-Za-z0-9_]+\}/);
      expect(prom.body).not.toMatch(/\{[A-Za-z0-9_]+\}/);
    }
    expect(embedColor('dark')).toBe(0x172030);
    expect(botColor('primary')).toBe(EMBED_ROLE_COLORS.primary);
  });

  it('renders variant branches (crash, refunded, escape, owner_bankrupt, sell, non-weekly title) in EN and JA', () => {
    const variants: SubscribedDomainEvent[] = [
      {
        type: 'MarketMove',
        guildId: G,
        at: AT,
        ticker: 'GOLD',
        direction: 'crash',
        changeBps: -1200,
        price: 8_000_000,
      },
      {
        type: 'LotteryDrawn',
        guildId: G,
        at: AT,
        lotteryId: 5,
        outcome: 'refunded',
        prize: 0,
        fee: 1_000,
        entrantIds: [U1],
      },
      {
        type: 'BankruptcyDeclared',
        guildId: G,
        at: AT,
        userId: U1,
        cause: 'escape',
        debtBefore: 50_000,
        debtAfter: 0,
      },
      {
        type: 'CompanyBankrupt',
        guildId: G,
        at: AT,
        ownerId: U1,
        companyName: 'Alpha Co',
        cause: 'owner_bankrupt',
        investorIds: [],
      },
      {
        type: 'TitleAwarded',
        guildId: G,
        at: AT,
        userId: U1,
        titleId: 'high_roller',
      },
      {
        type: 'OrderFilled',
        guildId: G,
        at: AT,
        userId: U1,
        orderId: 56,
        ticker: 'TB',
        side: 'sell',
        quantity: 1_000,
        price: 15_000_000,
      },
      {
        type: 'RaceFinished',
        guildId: G,
        at: AT,
        raceId: 13,
        placings: [],
        ownerIds: [],
        bettorIds: [],
      },
    ];

    for (const ev of variants) {
      for (const locale of ['en', 'ja'] as readonly Locale[]) {
        const copy = renderEventCopy(locale, ev);
        expect(copy.body).not.toMatch(/\{[A-Za-z0-9_]+\}/);
      }
    }
  });

  it('sets openInActivity only for chat-sourced GameSettled events and coalesces batches', () => {
    const chatWin = SAMPLE_EVENTS.GameSettled;
    const activityWin: SubscribedDomainEvent = { ...chatWin, source: 'activity' };

    expect(renderAnnouncementBatch('en', [chatWin]).openInActivity).toBe(true);
    expect(renderAnnouncementBatch('en', [activityWin]).openInActivity).toBe(false);

    const batched = renderAnnouncementBatch('ja', [activityWin, chatWin]);
    expect(batched.openInActivity).toBe(true);
    expect(batched.embeds).toHaveLength(1);
    expect(batched.embeds?.[0]?.fields).toHaveLength(2);
    expect(batched.embeds?.[0]?.title).toContain('2');

    const digest = renderDmBatch('en', [SAMPLE_EVENTS.DailyReady, SAMPLE_EVENTS.OrderFilled]);
    expect(digest.embeds).toHaveLength(1);
    expect(digest.embeds?.[0]?.fields).toHaveLength(2);
    expect(digest.embeds?.[0]?.title).toContain('2');
  });

  it('excludes MarketTick from subscribed notify events', () => {
    const tick: DomainEvent = {
      type: 'MarketTick',
      guildId: G,
      at: AT,
      prices: { CS: 10_000_000 },
    };
    expect(isSubscribedEvent(tick)).toBe(false);
    expect(isSubscribedEvent(SAMPLE_EVENTS.MarketMove)).toBe(true);
  });

  it('exposes consistent role→hex and role→number colors in EmbedTheme', () => {
    for (const role of EMBED_ROLES) {
      const num = defaultEmbedTheme.color(role);
      const hex = defaultEmbedTheme.hex(role);
      expect(num).toBe(EMBED_ROLE_COLORS[role]);
      expect(hex).toBe(EMBED_ROLE_HEX[role]);
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    }
    const custom = createEmbedTheme({ gold: 0xffd700 });
    expect(custom.color('gold')).toBe(0xffd700);
    expect(custom.hex('gold')).toBe('#ffd700');
  });
});
