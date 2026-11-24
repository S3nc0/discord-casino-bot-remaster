import { createSeededRng } from '@casino/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { classify, strength, type ChinchiroHand, type Dice } from './index.ts';
import {
  TABLE_JOIN_MS,
  TABLE_MAX_SEATS,
  TABLE_MIN_SEATS,
  TABLE_RAKE_BPS,
  TABLE_ROLL_MS,
  begin,
  expire,
  openLobby,
  potPayouts,
  resultOrder,
  rollRefusal,
  rollSeat,
  sit,
  stand,
  tooFew,
  type LobbyState,
} from './table.ts';

const ok = (r: ReturnType<typeof sit>): LobbyState => {
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  return r.state;
};

const hand = (...dice: Dice): ChinchiroHand => classify(dice);
const SHIGORO = hand(4, 5, 6);
const ME3 = hand(2, 2, 3);
const ME6 = hand(1, 1, 6);
const HIFUMI = hand(1, 2, 3);
const MENASHI = hand(1, 3, 5);

describe('chinchiro lobby', () => {
  it('opens with the host seated and a 60 s window', () => {
    const lobby = openLobby('host', 100, 5_000);
    expect(lobby).toEqual({
      phase: 'lobby',
      hostId: 'host',
      bet: 100,
      seats: ['host'],
      deadline: 5_000 + TABLE_JOIN_MS,
    });
    expect(TABLE_JOIN_MS).toBe(60_000);
    expect(TABLE_MIN_SEATS).toBe(2);
    expect(TABLE_MAX_SEATS).toBe(6);
    expect(TABLE_ROLL_MS).toBe(45_000);
    expect(TABLE_RAKE_BPS).toBe(1000);
  });

  it('seats up to six, refuses a second seat, a seventh and a different bet', () => {
    let lobby = openLobby('p0', 100, 0);
    expect(sit(lobby, 'p0', 100)).toEqual({ ok: false, reason: 'already_sat' });
    expect(sit(lobby, 'p1', 50)).toEqual({ ok: false, reason: 'bet_mismatch' });
    for (let i = 1; i < 6; i++) lobby = ok(sit(lobby, `p${i}`, 100));
    expect(lobby.seats).toHaveLength(6);
    expect(sit(lobby, 'p6', 100)).toEqual({ ok: false, reason: 'full' });
  });

  it('lets a seated player stand before the start only', () => {
    let lobby = ok(sit(openLobby('h', 10, 0), 'a', 10));
    expect(stand(lobby, 'zz')).toEqual({ ok: false, reason: 'not_seated' });
    lobby = ok(stand(lobby, 'a'));
    expect(lobby.seats).toEqual(['h']);
    const started = ok(begin(lobby, 'h'));
    expect(stand(started, 'h')).toEqual({ ok: false, reason: 'not_seated' });
    expect(sit(started, 'b', 10)).toEqual({ ok: false, reason: 'started' });
  });

  it('lets only the host begin early, and the window expire into play', () => {
    const lobby = ok(sit(openLobby('h', 10, 0), 'a', 10));
    expect(begin(lobby, 'a')).toEqual({ ok: false, reason: 'host_only' });
    expect(ok(begin(lobby, 'h')).phase).toBe('playing');
    expect(begin(ok(begin(lobby, 'h')), 'h')).toEqual({ ok: false, reason: 'started' });
    expect(expire(lobby).phase).toBe('playing');
  });

  it('folds below two seats', () => {
    expect(tooFew(openLobby('h', 10, 0))).toBe(true);
    expect(tooFew(ok(stand(openLobby('h', 10, 0), 'h')))).toBe(true);
    expect(tooFew(ok(sit(openLobby('h', 10, 0), 'a', 10)))).toBe(false);
  });
});

describe('chinchiro table rolls', () => {
  it('refuses in the legacy order: not seated, finished, not started, already rolled', () => {
    const seats = ['a', 'b'];
    expect(rollRefusal({ phase: 'rolling', seats, rolled: [] }, 'z')).toBe('not_at_table');
    expect(rollRefusal({ phase: 'finished', seats, rolled: ['a'] }, 'a')).toBe('finished');
    expect(rollRefusal({ phase: 'lobby', seats, rolled: [] }, 'a')).toBe('not_started');
    expect(rollRefusal({ phase: 'rolling', seats, rolled: ['a'] }, 'a')).toBe('already_rolled');
    expect(rollRefusal({ phase: 'rolling', seats, rolled: ['a'] }, 'b')).toBeNull();
  });

  it('plays a whole hand per press: up to three rolls, stopping on the first hand', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rolls = rollSeat(createSeededRng(seed));
      expect(rolls.length).toBeGreaterThanOrEqual(1);
      expect(rolls.length).toBeLessThanOrEqual(3);
      rolls.slice(0, -1).forEach((r) => expect(r.hand.kind).toBe('menashi'));
    }
  });
});

describe('chinchiro table pot', () => {
  it('bet 1000, 3 seats, 1 winner: the winner gets 2800, the rake is 200', () => {
    expect(potPayouts([ME3, SHIGORO, MENASHI], 1000)).toEqual({
      payouts: [0, 2800, 0],
      winners: [false, true, false],
      rake: 200,
    });
  });

  it('bet 1000, 4 seats, 2 tied winners: 1900 each, the rake is 200', () => {
    expect(potPayouts([ME6, HIFUMI, ME6, ME3], 1000)).toEqual({
      payouts: [1900, 0, 1900, 0],
      winners: [true, false, true, false],
      rake: 200,
    });
  });

  it('bet 333, 3 seats, 2 tied: share floor(299.7) // 2 = 149, so 482 each, rake 35', () => {
    expect(potPayouts([SHIGORO, MENASHI, SHIGORO], 333)).toEqual({
      payouts: [482, 0, 482],
      winners: [true, false, true],
      rake: 35,
    });
  });

  it('bet 500, 3 seats, all tied: everyone gets 500 back, rake 0', () => {
    expect(potPayouts([ME3, ME3, ME3], 500)).toEqual({
      payouts: [500, 500, 500],
      winners: [true, true, true],
      rake: 0,
    });
  });

  it('pays hifumi no double: it is just the weakest hand', () => {
    expect(potPayouts([HIFUMI, MENASHI], 100).payouts).toEqual([0, 190]);
  });

  it('never pays out more than was staked, and every winner gets at least the bet', () => {
    const anyHand = fc
      .tuple(
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 1, max: 6 }),
      )
      .map((d) => classify(d));
    fc.assert(
      fc.property(
        fc.array(anyHand, { minLength: TABLE_MIN_SEATS, maxLength: TABLE_MAX_SEATS }),
        fc.integer({ min: 10, max: 10_000_000 }),
        (hands, bet) => {
          const { payouts, winners, rake } = potPayouts(hands, bet);
          const paid = payouts.reduce((a, b) => a + b, 0);
          expect(paid + rake).toBe(bet * hands.length);
          expect(rake).toBeGreaterThanOrEqual(0);
          // the fee is 10 % of the losers' stakes, plus at most winners − 1 of division leftover
          const winnerCount = winners.filter(Boolean).length;
          const losers = hands.length - winnerCount;
          expect(rake).toBeGreaterThanOrEqual(Math.ceil((bet * losers) / 10) - 1);
          expect(rake).toBeLessThanOrEqual(Math.ceil((bet * losers) / 10) + winnerCount);
          payouts.forEach((p, i) => {
            if (winners[i]) expect(p).toBeGreaterThanOrEqual(bet);
            else expect(p).toBe(0);
          });
          // the integer form matches the legacy float `int(bet*losers*(1-0.1))//winners`
          const legacy = Math.trunc(bet * losers * (1 - 0.1));
          expect(payouts[winners.indexOf(true)]).toBe(bet + Math.floor(legacy / winnerCount));
        },
      ),
    );
  });

  it('lists the result strongest first, ties in seat order', () => {
    const hands = [ME3, SHIGORO, HIFUMI, SHIGORO, MENASHI];
    expect(resultOrder(hands)).toEqual([1, 3, 0, 4, 2]);
    expect(resultOrder(hands).map((i) => strength(hands[i] as ChinchiroHand))).toEqual([
      30, 30, 13, 1, 0,
    ]);
  });
});
