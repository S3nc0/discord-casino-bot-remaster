import { describe, expect, it } from 'vitest';
import { GUILD, INSTANCE, USER, setup } from './test-kit.ts';
import { TABLE_IDLE_EVICT_MS } from './tables.ts';

const OTHER_INSTANCE = 'i-other-instance';
const instance = (n: number) => `i-instance-${n}`;

describe('shared tables in memory', () => {
  it('R-15: idle chinchiro tables of past instances are dropped, a running one stays', () => {
    const s = setup();
    for (let n = 0; n < 50; n++) s.games.chinchiroTable.snapshot(GUILD, instance(n));
    s.games.chinchiroTable.sit(s.caller(USER, INSTANCE), { stake: 100 }); // a lobby, timer running
    expect(s.games.chinchiroTable.tableCount()).toBe(51);

    s.clock.advance(TABLE_IDLE_EVICT_MS);
    s.games.chinchiroTable.snapshot(GUILD, OTHER_INSTANCE);
    expect(s.games.chinchiroTable.tableCount()).toBe(2);
    expect(s.games.chinchiroTable.snapshot(GUILD, INSTANCE).phase).toBe('lobby');
  });

  it('R-15: idle roulette tables of past instances are dropped, a recent one stays', () => {
    const s = setup();
    for (let n = 0; n < 50; n++) s.games.roulette.snapshot(GUILD, instance(n));
    s.clock.advance(TABLE_IDLE_EVICT_MS - 1);
    s.games.roulette.snapshot(GUILD, INSTANCE);
    expect(s.games.roulette.tableCount()).toBe(51);

    s.clock.advance(1);
    s.games.roulette.snapshot(GUILD, OTHER_INSTANCE);
    expect(s.games.roulette.tableCount()).toBe(2);
  });
});
