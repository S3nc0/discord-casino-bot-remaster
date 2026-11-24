// Name colours (docs/spec/shop.md §2): wearing, switching and taking off a colour is a profile
// change plus a Discord role; it never moves Pelica, and the supply check still holds.
import { afterEach, describe, expect, it } from 'vitest';
import { GUILDS, USERS, checkInvariants, createWorld, type World } from './world.ts';

const [GUILD] = GUILDS as unknown as [string];
const [ALICE] = USERS as unknown as [string];

let w: World | undefined;
afterEach(async () => {
  await w?.close();
  w = undefined;
});

describe('name colours', () => {
  it('cost their shop price once; wearing them moves no Pelica', async () => {
    w = createWorld(7);
    const { server } = w;
    server.economy.credit({
      guildId: GUILD,
      userId: ALICE,
      amount: 50_000,
      reason: 'admin_grant',
      idempotencyKey: 'color-grant-0001',
    });
    server.games.shop.buy({
      guildId: GUILD,
      userId: ALICE,
      itemId: 'role_red',
      idempotencyKey: 'color-buy-red-01',
    });
    server.games.shop.buy({
      guildId: GUILD,
      userId: ALICE,
      itemId: 'role_blue',
      idempotencyKey: 'color-buy-blue-1',
    });
    checkInvariants(w);
    const balance = server.economy.getBalance(GUILD, ALICE);
    const ledgerRows = () =>
      (server.store.stmt('SELECT COUNT(*) AS n FROM ledger').get() as { n: number }).n;
    const before = ledgerRows();
    for (const item of ['role_red', 'role_blue', null, 'role_red', null] as const) {
      await server.games.shop.wearColor(GUILD, ALICE, item);
      checkInvariants(w);
    }
    expect(server.economy.getBalance(GUILD, ALICE)).toBe(balance);
    expect(ledgerRows()).toBe(before);
  });
});
