import { describe, expect, it } from 'vitest';
import { Value } from 'typebox/value';
import {
  ActionIntent,
  BalanceUpdate,
  BetIntent,
  CLIENT_PAYLOADS,
  IntentAck,
  LEDGER_REASONS,
  PROXY_HEADERS,
  ProxyPayload,
  SCREEN_IDS,
  SERVER_ENV_KEYS,
  ServerEnv,
  TableJoin,
  TokenRequest,
  Toast,
  canJoinRoom,
  isSessionExpired,
  rooms,
} from './index.ts';

const KEY = '6f1c2f0e-6a8b-4d8e-9a61-0f2b3c4d5e6f';
const G = '234567890123456789';
const U = '123456789012345678';

describe('balances are never negative on the wire', () => {
  it('rejects a negative balance in BalanceUpdate and IntentAck', () => {
    const update = {
      guildId: G,
      userId: U,
      balance: 0,
      delta: -100,
      reason: 'game_stake',
      ledgerId: 1,
    };
    expect(Value.Check(BalanceUpdate, update)).toBe(true);
    expect(Value.Check(BalanceUpdate, { ...update, balance: -1 })).toBe(false);
    expect(
      Value.Check(IntentAck, { ok: true, idempotencyKey: KEY, replayed: false, balance: -5 }),
    ).toBe(false);
  });
});

describe('proxy signature and env contract', () => {
  it('names the three proxy headers in lower case', () => {
    expect(PROXY_HEADERS).toEqual({
      signature: 'x-signature-ed25519',
      timestamp: 'x-signature-timestamp',
      payload: 'x-discord-proxy-payload',
    });
  });

  it('requires integer created_at and expires_at in the payload', () => {
    expect(Value.Check(ProxyPayload, { created_at: 1, expires_at: 2, user_id: U })).toBe(true);
    expect(Value.Check(ProxyPayload, { created_at: '1', expires_at: 2 })).toBe(false);
  });

  it('requires a hex DISCORD_PUBLIC_KEY', () => {
    expect(SERVER_ENV_KEYS).toContain('DISCORD_PUBLIC_KEY');
    const key = ServerEnv.properties.DISCORD_PUBLIC_KEY;
    expect(Value.Check(key, '0'.repeat(64))).toBe(true);
    expect(Value.Check(key, 'not-a-key')).toBe(false);
  });
});

describe('inbound payloads', () => {
  it('reject unknown properties', () => {
    const bet = { idempotencyKey: KEY, game: 'slots', stake: 100 };
    expect(Value.Check(BetIntent, bet)).toBe(true);
    expect(Value.Check(BetIntent, { ...bet, result: { payout: 999999 } })).toBe(false);
    expect(Value.Check(TableJoin, { game: 'roulette', userId: U })).toBe(false);
    expect(
      Value.Check(TokenRequest, { code: 'c', guildId: G, instanceId: 'i-1', admin: true }),
    ).toBe(false);
    for (const schema of Object.values(CLIENT_PAYLOADS)) {
      expect((schema as { additionalProperties?: unknown }).additionalProperties).toBe(false);
    }
  });

  it('ActionIntent requires a roundId', () => {
    const action = { idempotencyKey: KEY, game: 'blackjack', action: 'hit' };
    expect(Value.Check(ActionIntent, action)).toBe(false);
    expect(Value.Check(ActionIntent, { ...action, roundId: 'r-42' })).toBe(true);
  });

  it('BetIntent carries structured multi-bets', () => {
    const bets = [
      { kind: 'straight', targets: [17], stake: 100 },
      { kind: 'red', targets: [], stake: 200 },
    ];
    expect(
      Value.Check(BetIntent, { idempotencyKey: KEY, game: 'roulette', stake: 300, bets }),
    ).toBe(true);
    expect(
      Value.Check(BetIntent, {
        idempotencyKey: KEY,
        game: 'roulette',
        stake: 300,
        bets: [{ kind: 'red', targets: [], stake: 1.5 }],
      }),
    ).toBe(false);
    expect(
      Value.Check(BetIntent, {
        idempotencyKey: KEY,
        game: 'horse',
        stake: 100,
        args: { tickets: [{ kind: 'exacta', horses: [3, 5] }] },
      }),
    ).toBe(true);
  });
});

describe('sessions and rooms', () => {
  const scope = { userId: U, guildId: G, instanceId: 'i-1' };

  it('joins only the session’s own guild, user and instance rooms', () => {
    expect(canJoinRoom(scope, rooms.guild(G))).toBe(true);
    expect(canJoinRoom(scope, rooms.user(U))).toBe(true);
    expect(canJoinRoom(scope, rooms.instance('i-1'))).toBe(true);
    expect(canJoinRoom(scope, rooms.table('i-1', 'blackjack'))).toBe(true);
    expect(canJoinRoom(scope, rooms.guild('345678901234567890'))).toBe(false);
    expect(canJoinRoom(scope, rooms.user('345678901234567890'))).toBe(false);
    expect(canJoinRoom(scope, rooms.instance('i-other'))).toBe(false);
    expect(canJoinRoom(scope, rooms.table('i-other', 'roulette'))).toBe(false);
    expect(canJoinRoom(scope, 'admin')).toBe(false);
  });

  it('expires at expiresAt', () => {
    expect(isSessionExpired({ expiresAt: 1000 }, 999)).toBe(false);
    expect(isSessionExpired({ expiresAt: 1000 }, 1000)).toBe(true);
  });

  it('toasts carry their guild', () => {
    expect(Value.Check(Toast, { tone: 'info', messageKey: 'common.ok' })).toBe(false);
    expect(Value.Check(Toast, { guildId: G, tone: 'info', messageKey: 'common.ok' })).toBe(true);
  });
});

describe('enum coverage for planned features', () => {
  it('has the reasons and screens Wave 2 needs', () => {
    for (const r of [
      'race_refund',
      'arena_refund',
      'kyosai_buy',
      'kyosai_dividend',
      'company_invest',
      'company_dividend',
      'shop_refund',
      'marketplace_buy',
    ]) {
      expect(LEDGER_REASONS).toContain(r);
    }
    for (const s of ['kyosai', 'companies', 'shop', 'market']) expect(SCREEN_IDS).toContain(s);
  });
});
