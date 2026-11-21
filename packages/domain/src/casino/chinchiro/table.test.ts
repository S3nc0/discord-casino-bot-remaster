import { createSeededRng } from '@casino/shared';
import { describe, expect, it } from 'vitest';
import { compare, payoutFor } from './index.ts';
import { pyRandom } from '../testing/pyrandom.ts';
import {
  TABLE_JOIN_MS,
  TABLE_MAX_SEATS,
  begin,
  expire,
  isEmpty,
  openLobby,
  playTable,
  sit,
  stand,
  tableWon,
  type LobbyState,
} from './table.ts';

const ok = (r: ReturnType<typeof sit>): LobbyState => {
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  return r.state;
};

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
    expect(TABLE_MAX_SEATS).toBe(6);
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
    expect(isEmpty(ok(stand(openLobby('h', 10, 0), 'h')))).toBe(true);
  });
});

describe('chinchiro table round', () => {
  it('plays one dealer hand and one hand per seat, paid by the solo rules', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const seats = ['a', 'b', 'c', 'd'];
      const table = playTable(pyRandom(seed), 1000, seats);
      expect(table.dealerRolls.length).toBeGreaterThanOrEqual(1);
      expect(table.dealerRolls.length).toBeLessThanOrEqual(3);
      const dealer = table.dealerRolls.at(-1)!.hand;
      expect(table.seats.map((s) => s.userId)).toEqual(seats);
      for (const seat of table.seats) {
        expect(seat.rolls.length).toBeLessThanOrEqual(3);
        const outcome = compare(seat.rolls.at(-1)!.hand, dealer);
        expect(seat.outcome).toEqual(outcome);
        expect({ payout: seat.payout, penalty: seat.penalty }).toEqual(payoutFor(outcome, 1000));
      }
    }
  });

  it('is deterministic for a seed and consumes the dealer first', () => {
    const a = playTable(createSeededRng(7), 100, ['x', 'y']);
    const b = playTable(createSeededRng(7), 100, ['x', 'y']);
    expect(a).toEqual(b);
  });

  it('colours the card green when half or more of the seats won', () => {
    const r = (result: 'win' | 'lose' | 'draw') => ({ outcome: { result } });
    expect(tableWon([r('win'), r('lose')])).toBe(true);
    expect(tableWon([r('win'), r('lose'), r('lose')])).toBe(false);
    expect(tableWon([r('draw'), r('win'), r('lose'), r('lose')])).toBe(false);
  });
});
