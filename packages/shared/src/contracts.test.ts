import { describe, expect, expectTypeOf, it } from 'vitest';
import { Value } from 'typebox/value';
import {
  BetIntent,
  CLIENT_PAYLOADS,
  DOMAIN_EVENT_TYPES,
  DomainEvent,
  type DomainEventOf,
  type GameId,
  IntentAck,
  LaunchIntent,
  LEDGER_REASONS,
  SessionClaims,
  TokenRequest,
  TokenResponse,
  createSeededRng,
  manualClock,
  parseRoom,
  rooms,
  shuffle,
} from './index.ts';

const USER = '123456789012345678';
const GUILD = '234567890123456789';

describe('http schemas', () => {
  it('accepts a valid token request and rejects a numeric snowflake', () => {
    expect(Value.Check(TokenRequest, { code: 'abc', guildId: GUILD, instanceId: 'i-1-gc-2' })).toBe(
      true,
    );
    expect(Value.Check(TokenRequest, { code: 'abc', guildId: 2345, instanceId: 'i-1' })).toBe(
      false,
    );
  });

  it('describes the token response with a nullable launch intent', () => {
    const base = {
      accessToken: 'x',
      sessionToken: 'y',
      expiresAt: 1,
      user: { id: USER, username: 'u', globalName: null, avatar: null },
      guildId: GUILD,
      locale: 'ja',
    };
    expect(Value.Check(TokenResponse, { ...base, launchIntent: null })).toBe(true);
    const intent = { userId: USER, guildId: GUILD, screen: 'blackjack', expires: 10 };
    expect(Value.Check(LaunchIntent, intent)).toBe(true);
    expect(Value.Check(TokenResponse, { ...base, launchIntent: intent })).toBe(true);
    expect(Value.Check(LaunchIntent, { ...intent, screen: 'nowhere' })).toBe(false);
  });

  it('validates session claims', () => {
    const claims = {
      v: 1,
      sub: USER,
      gid: GUILD,
      iid: 'i-1',
      loc: 'en',
      iat: 1,
      exp: 2,
      jti: 'abcdefgh',
    };
    expect(Value.Check(SessionClaims, claims)).toBe(true);
    expect(Value.Check(SessionClaims, { ...claims, loc: 'fr' })).toBe(false);
  });
});

describe('intents', () => {
  const key = '6f1c2f0e-6a8b-4d8e-9a61-0f2b3c4d5e6f';

  it('requires an idempotency key and a positive integer stake', () => {
    expect(Value.Check(BetIntent, { idempotencyKey: key, game: 'slots', stake: 100 })).toBe(true);
    expect(Value.Check(BetIntent, { game: 'slots', stake: 100 })).toBe(false);
    expect(Value.Check(BetIntent, { idempotencyKey: key, game: 'slots', stake: 0 })).toBe(false);
    expect(Value.Check(BetIntent, { idempotencyKey: key, game: 'slots', stake: 1.5 })).toBe(false);
    expect(Value.Check(BetIntent, { idempotencyKey: 'short', game: 'slots', stake: 1 })).toBe(
      false,
    );
  });

  it('has a schema for every client payload', () => {
    expect(Object.keys(CLIENT_PAYLOADS).sort()).toEqual(
      [
        'game:action',
        'game:bet',
        'inbox:read',
        'presence:screen',
        'table:join',
        'table:leave',
      ].sort(),
    );
  });

  it('acks are a discriminated union', () => {
    expect(
      Value.Check(IntentAck, { ok: true, idempotencyKey: key, replayed: false, balance: 3000 }),
    ).toBe(true);
    expect(Value.Check(IntentAck, { ok: false, idempotencyKey: null, error: 'rate_limited' })).toBe(
      true,
    );
    expect(Value.Check(IntentAck, { ok: false, idempotencyKey: null, error: 'nope' })).toBe(false);
  });
});

describe('domain events', () => {
  it('lists every union member exactly once', () => {
    const members = DomainEvent.anyOf.map((s) => s.properties.type.const as string);
    expect([...members].sort()).toEqual([...DOMAIN_EVENT_TYPES].sort());
    expect(new Set(members).size).toBe(members.length);
  });

  it('validates a settled game and narrows by type', () => {
    const e: DomainEventOf<'GameSettled'> = {
      type: 'GameSettled',
      guildId: GUILD,
      at: 1,
      userId: USER,
      game: 'blackjack',
      roundId: 'r1',
      stake: 100,
      payout: 250,
      net: 150,
      source: 'activity',
    };
    expect(Value.Check(DomainEvent, e)).toBe(true);
    expect(Value.Check(DomainEvent, { ...e, guildId: undefined })).toBe(false);
    expectTypeOf(e.game).toEqualTypeOf<GameId>();
  });

  it('validates the bankruptcy, company and lottery events', () => {
    const base = { guildId: GUILD, at: 1 };
    const bankrupt: DomainEventOf<'BankruptcyDeclared'> = {
      ...base,
      type: 'BankruptcyDeclared',
      userId: USER,
      cause: 'forced',
      debtBefore: 25_000,
      debtAfter: 10_000,
    };
    const company: DomainEventOf<'CompanyBankrupt'> = {
      ...base,
      type: 'CompanyBankrupt',
      ownerId: USER,
      companyName: 'Pelica Mining',
      cause: 'upkeep',
      investorIds: [GUILD],
    };
    const won: DomainEventOf<'LotteryDrawn'> = {
      ...base,
      type: 'LotteryDrawn',
      lotteryId: 3,
      outcome: 'won',
      winnerId: USER,
      prize: 3000,
      fee: 1000,
      entrantIds: [USER, GUILD, '345678901234567890'],
    };
    for (const e of [bankrupt, company, won]) expect(Value.Check(DomainEvent, e)).toBe(true);
    expect(
      Value.Check(DomainEvent, { ...won, outcome: 'refunded', winnerId: undefined, prize: 0 }),
    ).toBe(true);
    expect(Value.Check(DomainEvent, { ...bankrupt, cause: 'fled' })).toBe(false);
    expect(Value.Check(DomainEvent, { ...company, companyName: '' })).toBe(false);
    expect(Value.Check(DomainEvent, { ...won, prize: -1 })).toBe(false);
  });
});

describe('ledger reasons', () => {
  it('are unique snake_case strings', () => {
    expect(new Set(LEDGER_REASONS).size).toBe(LEDGER_REASONS.length);
    for (const r of LEDGER_REASONS) expect(r).toMatch(/^[a-z][a-z0-9_]*$/);
  });
});

describe('rooms', () => {
  it('builds and parses every room kind', () => {
    expect(rooms.guild(GUILD)).toBe(`guild:${GUILD}`);
    expect(parseRoom(rooms.user(USER))).toEqual({ kind: 'user', userId: USER });
    expect(parseRoom(rooms.instance('i-1:x'))).toEqual({ kind: 'instance', instanceId: 'i-1:x' });
    expect(parseRoom(rooms.table('i-1', 'roulette'))).toEqual({
      kind: 'table',
      instanceId: 'i-1',
      game: 'roulette',
    });
    expect(parseRoom('table:i-1:poker')).toBeNull();
    expect(parseRoom('guild:')).toBeNull();
  });
});

describe('rng and clock', () => {
  it('seeded rng is deterministic and in range', () => {
    const a = createSeededRng(42);
    const b = createSeededRng(42);
    for (let i = 0; i < 1000; i++) {
      const x = a.int(1, 7);
      expect(x).toBe(b.int(1, 7));
      expect(x).toBeGreaterThanOrEqual(1);
      expect(x).toBeLessThan(7);
    }
    expect(() => a.int(5, 5)).toThrow(RangeError);
    expect(shuffle(createSeededRng(1), [1, 2, 3, 4]).sort()).toEqual([1, 2, 3, 4]);
  });

  it('manual clock only moves when told', () => {
    const clock = manualClock(1000);
    clock.advance(500);
    expect(clock.now()).toBe(1500);
  });
});
