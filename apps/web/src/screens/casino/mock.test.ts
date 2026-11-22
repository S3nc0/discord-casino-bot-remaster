// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  ChinchiroView,
  PachinkoResultView,
  SlotsResultView,
  TableSnapshot,
} from '@casino/shared';
import { useBalanceStore } from '../../shell/stores/balance.ts';
import { resetStores } from '../../shell/testing/fakes.ts';
import { getMockServices } from './mock.ts';

beforeEach(() => {
  resetStores();
  useBalanceStore.getState().set(5_000);
});

describe('mock casino (screenshot and offline mode)', () => {
  it('follows the real result shapes and moves the balance through the same store', async () => {
    const { client } = getMockServices();
    const slots = await client.bet<SlotsResultView>('slots', { stake: 100 });
    expect(slots.result.reels).toHaveLength(3);
    expect(slots.result.settlement.stake).toBe(100);
    expect(useBalanceStore.getState().balance).toBe(slots.result.settlement.balance);

    const pachinko = await client.bet<PachinkoResultView>('pachinko', {
      stake: 10,
      args: { sets: 2 },
    });
    expect(pachinko.result.sets).toHaveLength(2);
    expect(pachinko.result.settlement.stake).toBe(20);

    const solo = await client.bet<ChinchiroView>('chinchiro', { stake: 10 });
    expect(solo.result.status).toBe('player_turn');
    expect(solo.result.dealerRolls.length).toBeGreaterThan(0);
  });

  it('refuses what the server refuses', async () => {
    const { client } = getMockServices();
    await expect(client.bet('slots', { stake: 5 })).rejects.toMatchObject({
      code: 'invalid_payload',
    });
    await expect(client.bet('slots', { stake: 10_000_000 })).rejects.toMatchObject({
      code: 'insufficient_funds',
    });
    await expect(client.bet('horse', { stake: 100 })).rejects.toMatchObject({
      code: 'feature_disabled',
    });
  });

  it('answers the HTTP side: daily claim once, history paged', async () => {
    const { api } = getMockServices();
    const status = await api.daily();
    if (status.claimable) {
      const claim = await api.claimDaily();
      expect(claim.amount).toBeGreaterThan(0);
    }
    await expect(api.claimDaily()).rejects.toMatchObject({ code: 'conflict' });
    const page = await api.history({ limit: 5 });
    expect(page.items).toHaveLength(5);
    const next = await api.history({ limit: 5, before: page.nextBefore as number });
    expect(next.items[0]?.id).toBeLessThan(page.nextBefore as number);
  });

  it('opens a roulette table that the watcher hears', async () => {
    const { client } = getMockServices();
    const heard: TableSnapshot[] = [];
    const off = client.watchTable('roulette', (s) => heard.push(s));
    await new Promise((r) => setTimeout(r, 5));
    expect(heard[0]?.phase).toBe('idle');
    await client.bet('roulette', { stake: 20, bets: [{ kind: 'red', targets: [], stake: 20 }] });
    expect(heard[heard.length - 1]?.phase).toBe('betting');
    off();
  });
});
