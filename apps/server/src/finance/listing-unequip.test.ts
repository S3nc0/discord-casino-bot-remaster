import { describe, expect, it } from 'vitest';
import { isTradableItem } from '@casino/domain/finance';
import { CATALOG } from '@casino/domain/shop';
import { GUILD, OTHER_USER, USER, createTestServer, type TestServer } from '../runtime/test-kit.ts';

const cosmetic = CATALOG.find((i) => i.kind === 'card_color' && isTradableItem(i.id))!;

function boot(): TestServer {
  const s = createTestServer();
  s.identity.ensureGuild(GUILD, 'approved', 'Test Guild');
  for (const userId of [USER, OTHER_USER]) {
    s.economy.credit({
      guildId: GUILD,
      userId,
      amount: 50_000,
      reason: 'admin_grant',
      idempotencyKey: `seed-${userId}`,
    });
  }
  return s;
}

const equipped = (s: TestServer, userId = USER): string | null =>
  (
    s.store
      .stmt('SELECT card_color FROM profiles WHERE guild_id = ? AND user_id = ?')
      .get(GUILD, userId) as { card_color: string | null } | undefined
  )?.card_color ?? null;

const list = (s: TestServer): number => {
  const listed = s.finance.playerMarket.listAsset({
    guildId: GUILD,
    sellerId: USER,
    kind: 'item',
    ref: cosmetic.id,
    mode: 'fixed',
    price: cosmetic.price,
  });
  expect(listed).toMatchObject({ ok: true });
  return listed.ok ? listed.data : 0;
};

describe('listing an equipped cosmetic (player-market spec §3)', () => {
  it('unequips it, and a cancelled listing returns it unequipped', () => {
    const s = boot();
    s.games.shop.inventory.add(GUILD, USER, cosmetic.id, 1);
    s.games.shop.equip(GUILD, USER, 'card_color', cosmetic.id);
    expect(equipped(s)).toBe(cosmetic.id);
    const id = list(s);
    expect(equipped(s)).toBeNull();
    expect(s.finance.playerMarket.cancelListing(GUILD, USER, id)).toMatchObject({ ok: true });
    expect(s.games.shop.inventory.qty(GUILD, USER, cosmetic.id)).toBe(1);
    expect(equipped(s)).toBeNull();
    s.close();
  });

  it('an expired listing returns it unequipped', () => {
    const s = boot();
    s.games.shop.inventory.add(GUILD, USER, cosmetic.id, 1);
    s.games.shop.equip(GUILD, USER, 'card_color', cosmetic.id);
    list(s);
    s.clock.advance(10 * 24 * 3_600_000);
    expect(s.finance.playerMarket.settleExpired(GUILD)).toHaveLength(1);
    expect(s.games.shop.inventory.qty(GUILD, USER, cosmetic.id)).toBe(1);
    expect(equipped(s)).toBeNull();
    s.close();
  });

  it('keeps it equipped while the player still owns another copy', () => {
    const s = boot();
    s.games.shop.inventory.add(GUILD, USER, cosmetic.id, 2);
    s.games.shop.equip(GUILD, USER, 'card_color', cosmetic.id);
    list(s);
    expect(s.games.shop.inventory.qty(GUILD, USER, cosmetic.id)).toBe(1);
    expect(equipped(s)).toBe(cosmetic.id);
    s.close();
  });

  it('leaves a different equipped cosmetic alone', () => {
    const s = boot();
    const other = CATALOG.find((i) => i.kind === 'card_color' && i.id !== cosmetic.id)!;
    s.games.shop.inventory.add(GUILD, USER, cosmetic.id, 1);
    s.games.shop.inventory.add(GUILD, USER, other.id, 1);
    s.games.shop.equip(GUILD, USER, 'card_color', other.id);
    list(s);
    expect(equipped(s)).toBe(other.id);
    s.close();
  });
});
