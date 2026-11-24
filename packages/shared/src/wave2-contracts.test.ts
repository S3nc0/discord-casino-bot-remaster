import { describe, expect, it } from 'vitest';
import { Value } from 'typebox/value';
import {
  DOMAIN_EVENT_TYPES,
  DmDisabledNotice,
  DomainEvent,
  FOAL_ANNOUNCE_MIN_TOTAL,
  GameTags,
  INBOX_KINDS,
  InboxItem,
  LEDGER_REASONS,
  LEDGER_REASON_FLOW,
  NOTIFICATION_KINDS,
  NOTIFICATION_SOURCE,
  SYSTEM_INBOX_KINDS,
  isDeltaAllowed,
} from './index.ts';
import { en, inboxKindMessageKey, ja, t } from '../i18n/index.ts';

const GUILD = '123456789012345678';
const USER = '234567890123456789';
const AT = 1_790_000_000_000;

describe('wave 2 ledger reasons', () => {
  it('appends the breeding fee, insurance refund and quiz author payment', () => {
    // Later waves append after these three, so look them up instead of taking the list's tail.
    const at = LEDGER_REASONS.indexOf('horse_breeding_fee');
    expect(at).toBeGreaterThan(0);
    expect(LEDGER_REASONS.slice(at, at + 3)).toEqual([
      'horse_breeding_fee',
      'game_insurance_refund',
      'quiz_author_pay',
    ]);
  });

  it('classifies them per the flow table', () => {
    expect(LEDGER_REASON_FLOW.horse_breeding_fee).toBe('sink');
    expect(LEDGER_REASON_FLOW.game_insurance_refund).toBe('faucet');
    expect(LEDGER_REASON_FLOW.quiz_author_pay).toBe('sink');
  });

  it('allows only the right direction', () => {
    expect(isDeltaAllowed('horse_breeding_fee', -15_000)).toBe(true);
    expect(isDeltaAllowed('horse_breeding_fee', 15_000)).toBe(false);
    expect(isDeltaAllowed('game_insurance_refund', 1_000)).toBe(true);
    expect(isDeltaAllowed('game_insurance_refund', -1_000)).toBe(false);
    expect(isDeltaAllowed('game_insurance_refund', 0)).toBe(false);
    expect(isDeltaAllowed('quiz_author_pay', -100)).toBe(true);
    expect(isDeltaAllowed('quiz_author_pay', 100)).toBe(false);
  });
});

describe('HorseFoaled', () => {
  const foaled = {
    type: 'HorseFoaled',
    guildId: GUILD,
    at: AT,
    userId: USER,
    foalId: 42,
    foalName: 'ペリカ号',
    parentIds: [7, 9],
    statTotal: 205,
    generation: 1,
    maturesAt: AT + 48 * 3_600_000,
  };

  it('is a domain event with the spec fields', () => {
    expect(DOMAIN_EVENT_TYPES).toContain('HorseFoaled');
    expect(Value.Check(DomainEvent, foaled)).toBe(true);
    expect(FOAL_ANNOUNCE_MIN_TOTAL).toBe(205);
  });

  it('rejects out-of-range totals, generation 0, bad names and a single parent', () => {
    expect(Value.Check(DomainEvent, { ...foaled, statTotal: 211 })).toBe(false);
    expect(Value.Check(DomainEvent, { ...foaled, statTotal: 189 })).toBe(false);
    expect(Value.Check(DomainEvent, { ...foaled, generation: 0 })).toBe(false);
    expect(Value.Check(DomainEvent, { ...foaled, foalName: '' })).toBe(false);
    expect(Value.Check(DomainEvent, { ...foaled, foalName: 'x'.repeat(13) })).toBe(false);
    expect(Value.Check(DomainEvent, { ...foaled, parentIds: [7] })).toBe(false);
  });
});

describe('GameSettled tags', () => {
  const settled = {
    type: 'GameSettled',
    guildId: GUILD,
    at: AT,
    userId: USER,
    game: 'blackjack',
    roundId: 'bl_1',
    stake: 100,
    payout: 400,
    net: 300,
    source: 'activity',
  };

  it('are optional and additive', () => {
    expect(Value.Check(DomainEvent, settled)).toBe(true);
    expect(Value.Check(DomainEvent, { ...settled, tags: [] })).toBe(true);
    expect(Value.Check(DomainEvent, { ...settled, tags: ['natural', 'double_win'] })).toBe(true);
  });

  it('are short snake_case labels, at most 16', () => {
    expect(Value.Check(GameTags, ['Natural'])).toBe(false);
    expect(Value.Check(GameTags, ['double-win'])).toBe(false);
    expect(Value.Check(GameTags, ['x'.repeat(33)])).toBe(false);
    expect(
      Value.Check(
        GameTags,
        Array.from({ length: 17 }, () => 'jackpot'),
      ),
    ).toBe(false);
  });
});

describe('notification and inbox kinds', () => {
  it('adds horse_foaled as an opt-in kind sourced from HorseFoaled', () => {
    expect(NOTIFICATION_KINDS).toContain('horse_foaled');
    expect(NOTIFICATION_SOURCE.horse_foaled).toBe('HorseFoaled');
    expect(Object.keys(NOTIFICATION_SOURCE).sort()).toEqual([...NOTIFICATION_KINDS].sort());
  });

  it('keeps dm_disabled inbox-only, outside the DM preferences', () => {
    expect(SYSTEM_INBOX_KINDS).toEqual(['dm_disabled']);
    expect(NOTIFICATION_KINDS as readonly string[]).not.toContain('dm_disabled');
    expect(INBOX_KINDS).toEqual([...NOTIFICATION_KINDS, ...SYSTEM_INBOX_KINDS]);
  });

  it('accepts a dm_disabled inbox item carrying the notice', () => {
    const notice = {
      type: 'DmDisabled',
      guildId: GUILD,
      at: AT,
      userId: USER,
      reason: 'dm_closed',
    };
    expect(Value.Check(DmDisabledNotice, notice)).toBe(true);
    const item = {
      id: 1,
      guildId: GUILD,
      kind: 'dm_disabled',
      event: notice,
      createdAt: AT,
      readAt: null,
    };
    expect(Value.Check(InboxItem, item)).toBe(true);
    expect(Value.Check(InboxItem, { ...item, kind: 'dm_closed' })).toBe(false);
    expect(Value.Check(InboxItem, { ...item, event: { ...notice, reason: 'other' } })).toBe(false);
  });

  it('labels every inbox kind in both languages', () => {
    for (const kind of INBOX_KINDS) {
      expect(t('en', inboxKindMessageKey(kind))).not.toBe(`inbox.kind.${kind}`);
      expect(t('ja', inboxKindMessageKey(kind))).not.toBe(`inbox.kind.${kind}`);
    }
    expect(t('ja', 'inbox.kind.horse_foaled')).toBe('子馬が生まれました');
  });
});

describe('wave 2 i18n keys', () => {
  it('moves the bot and notify keys into the shared dictionaries', () => {
    const keys = Object.keys(en);
    // The original bot keys stay; later waves add more `bot.*` keys, so no exact count.
    for (const key of [
      'bot.balance.title',
      'bot.balance.noAccount',
      'bot.settings.status',
      'bot.settings.updated',
      'bot.settings.footer',
      'bot.help.title',
      'bot.help.body',
      'bot.help.commandsTitle',
      'bot.help.commandsList',
      'bot.activity.placeholder',
      'bot.comingSoon.title',
      'bot.comingSoon.body',
      'bot.guard.guildOnly',
      'bot.guard.ownerOnly',
      'bot.guard.dmOnly',
      'bot.error.unknownCommand',
    ]) {
      expect(keys).toContain(key);
      expect(Object.keys(ja)).toContain(key);
    }
    expect(Object.keys(ja).sort()).toEqual([...keys].sort());
    expect(keys).toContain('notify.dm_disabled.title');
    expect(keys).toContain('notify.event.LotteryDrawn.won');
    expect(t('ja', 'bot.balance.title', { name: 'A' })).toBe('A の残高');
  });

  it('has the breeding and finance keys as written in the specs', () => {
    expect(t('en', 'horse.breed.fee', { fee: '15,000' })).toBe('Breeding fee: 15,000');
    expect(ja['horse.lineage']).toBe('両親: {a} × {b}・{gen}代目');
    expect(ja['finance.debtorBlocked']).toBe('借金中不可');
    expect(en['finance.marginLosscut']).toBe('Margin loss-cut');
  });
});
