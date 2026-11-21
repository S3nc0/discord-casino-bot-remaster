import { afterEach, describe, expect, it } from 'vitest';
import {
  GUILD,
  OTHER_USER,
  USER,
  allText,
  autocomplete,
  button,
  command,
  createTestServer,
  customIds,
  embedOf,
  ledgerReasons,
  makeHandler,
  makeUser,
} from './chat-test-kit.ts';
import type { TestServer } from '../runtime/test-kit.ts';

let server: TestServer | null = null;
afterEach(async () => {
  if (server) await server.close();
  server = null;
});

function setup() {
  server = createTestServer({ casinoHandlers: true });
  server.economy.ensureMember(GUILD, USER);
  server.economy.ensureMember(GUILD, OTHER_USER);
  return { s: server, handler: makeHandler(server) };
}

describe('/pelica bankrupt', () => {
  it('asks first, then declares bankruptcy publicly on confirm (EN)', async () => {
    const { s, handler } = setup();
    s.finance.teiai.adminSetDebt(GUILD, USER, 8000);
    const ask = command({ name: 'pelica', sub: 'bankrupt' });
    await handler(ask.interaction as never);
    expect(embedOf(ask.out[0]!.options).title).toBe('Declare bankruptcy?');
    expect(s.finance.teiai.getStatus(GUILD, USER)).not.toBe('bankrupt');

    const ids = customIds(ask.out[0]!.options);
    const confirm = button(ids[0]!);
    await handler(confirm.interaction as never);
    expect(s.finance.teiai.getStatus(GUILD, USER)).toBe('bankrupt');
    expect(confirm.out.map((o) => o.kind)).toEqual(['update', 'followUp']);
    expect(embedOf(confirm.out[1]!.options).title).toBe('🔴 Bankruptcy');
    expect(confirm.out[1]!.options.flags).toBeUndefined();
  });

  it('is cancellable and cannot be confirmed by someone else', async () => {
    const { s, handler } = setup();
    s.finance.teiai.adminSetDebt(GUILD, USER, 8000);
    const ask = command({ name: 'pelica', sub: 'bankrupt', locale: 'ja' });
    await handler(ask.interaction as never);
    expect(embedOf(ask.out[0]!.options).title).toBe('破産しますか？');
    const ids = customIds(ask.out[0]!.options);

    const thief = button(ids[0]!, { user: makeUser(OTHER_USER, 'bob') });
    await handler(thief.interaction as never);
    expect(s.finance.teiai.getStatus(GUILD, USER)).not.toBe('bankrupt');
    expect(thief.out[0]!.options.flags).toBeDefined();

    const cancel = button(ids[1]!, { locale: 'ja' });
    await handler(cancel.interaction as never);
    expect(allText(cancel.out[0]!.options)).toContain('破産はしていません');
    expect(s.finance.teiai.getStatus(GUILD, USER)).not.toBe('bankrupt');
  });

  it('says there is nothing to declare without debt', async () => {
    const { handler } = setup();
    const ask = command({ name: 'pelica', sub: 'bankrupt' });
    await handler(ask.interaction as never);
    const confirm = button(customIds(ask.out[0]!.options)[0]!);
    await handler(confirm.interaction as never);
    expect(confirm.out[0]!.options.embeds).toBeDefined();
    expect(confirm.out[0]!.kind).toBe('reply');
  });
});

describe('/market settle and /market order write', () => {
  it('lists positions in autocomplete and sells part of a spot holding', async () => {
    const { s, handler } = setup();
    const buy = command({
      name: 'market',
      group: 'order',
      sub: 'spot',
      strings: { symbol: 'cs' },
      integers: { amount: 2000 },
    });
    await handler(buy.interaction as never);
    const held = s.finance.stocks.getSpotHoldings(GUILD, USER)[0]!;

    const ac = autocomplete('market', { name: 'position', value: '' });
    await handler(ac.interaction as never);
    expect(ac.responses[0]).toEqual([expect.objectContaining({ value: 'spot:cs' })]);

    const settle = command({
      name: 'market',
      sub: 'settle',
      strings: { position: 'spot:cs' },
      integers: { percent: 50 },
    });
    await handler(settle.interaction as never);
    expect(embedOf(settle.out[0]!.options).title).toBe('Settled');
    const left = s.finance.stocks.getSpotHoldings(GUILD, USER)[0]!;
    expect(left.units_milli).toBe(held.units_milli - Math.floor(held.units_milli / 2));
    expect(ledgerReasons(s).length).toBeGreaterThan(2);
  });

  it('closes half of a margin position and all of an unknown id fails cleanly', async () => {
    const { s, handler } = setup();
    s.economy.credit({ guildId: GUILD, userId: USER, amount: 50_000, reason: 'admin_grant' });
    const open = command({
      name: 'market',
      group: 'order',
      sub: 'margin',
      strings: { symbol: 'cs', side: 'long' },
      integers: { amount: 4000, leverage: 2 },
    });
    await handler(open.interaction as never);
    const before = s.finance.stocks.listMarginPositions(GUILD, USER)[0]!;
    const settle = command({
      name: 'market',
      sub: 'settle',
      strings: { position: 'long:cs' },
      integers: { percent: 50 },
    });
    await handler(settle.interaction as never);
    const after = s.finance.stocks.listMarginPositions(GUILD, USER)[0]!;
    expect(after.units_milli).toBe(before.units_milli - Math.floor(before.units_milli / 2));
    expect(after.margin).toBe(before.margin - Math.floor(before.margin / 2));

    const bad = command({ name: 'market', sub: 'settle', strings: { position: 'bond:999' } });
    await handler(bad.interaction as never);
    expect(bad.out[0]!.options.flags).toBeDefined();
  });

  it('writes a naked option: posts collateral and receives the premium', async () => {
    const { s, handler } = setup();
    s.economy.credit({ guildId: GUILD, userId: USER, amount: 50_000, reason: 'admin_grant' });
    const write = command({
      name: 'market',
      group: 'order',
      sub: 'write',
      strings: { symbol: 'cs', kind: 'call' },
      integers: { amount: 5000 },
    });
    await handler(write.interaction as never);
    const first = write.out[0]!;
    expect(first.options.flags).toBeUndefined();
    expect(allText(first.options)).toContain('Collateral');
    const reasons = ledgerReasons(s);
    expect(reasons).toContain('margin_open');
    expect(reasons).toContain('option_write_premium');
    const opt = s.finance.stocks.listOpenOptions(GUILD, USER)[0]!;
    expect(opt.side).toBe('short');
    expect(opt.margin).toBeLessThanOrEqual(5000);

    // The same position can then be bought back from /market settle.
    const settle = command({
      name: 'market',
      sub: 'settle',
      strings: { position: `option:${opt.id}` },
    });
    await handler(settle.interaction as never);
    expect(embedOf(settle.out[0]!.options).title).toBe('Settled');
    expect(s.finance.stocks.listOpenOptions(GUILD, USER)).toHaveLength(0);
  });
});

describe('/loan list', () => {
  it('lists loans on both sides', async () => {
    const { s, handler } = setup();
    const offer = command({
      name: 'loan',
      sub: 'offer',
      users: { member: makeUser(OTHER_USER, 'bob') },
      integers: { principal: 500, days: 5 },
      numbers: { rate: 1 },
    });
    await handler(offer.interaction as never);
    const mine = command({ name: 'loan', sub: 'list' });
    await handler(mine.interaction as never);
    expect(allText(mine.out[0]!.options)).toContain(`<@${OTHER_USER}>`);
    const theirs = command({
      name: 'loan',
      sub: 'list',
      user: makeUser(OTHER_USER, 'bob'),
      locale: 'ja',
    });
    await handler(theirs.interaction as never);
    expect(allText(theirs.out[0]!.options)).toContain('から借り');
    const empty = command({ name: 'loan', sub: 'list', user: makeUser('999', 'carol') });
    await handler(empty.interaction as never);
    expect(allText(empty.out[0]!.options)).toContain('no loans');
    void s;
  });
});

describe('/company holdings', () => {
  it('shows stakes the member holds, ephemeral', async () => {
    const { s, handler } = setup();
    s.economy.credit({
      guildId: GUILD,
      userId: OTHER_USER,
      amount: 300_000,
      reason: 'admin_grant',
    });
    const found = command({
      name: 'company',
      sub: 'found',
      user: makeUser(OTHER_USER, 'bob'),
      strings: { name: 'Acme', kind: 'farm' },
    });
    await handler(found.interaction as never);
    s.economy.credit({ guildId: GUILD, userId: USER, amount: 5000, reason: 'admin_grant' });
    const invest = command({
      name: 'company',
      sub: 'invest',
      users: { owner: makeUser(OTHER_USER, 'bob') },
      integers: { amount: 2000 },
    });
    await handler(invest.interaction as never);

    const holdings = command({ name: 'company', sub: 'holdings' });
    await handler(holdings.interaction as never);
    const text = allText(holdings.out[0]!.options);
    expect(text).toContain('Acme');
    expect(text).toContain('2,000');
    expect(holdings.out[0]!.options.flags).toBeDefined();

    const none = command({
      name: 'company',
      sub: 'holdings',
      user: makeUser(OTHER_USER, 'bob'),
      locale: 'ja',
    });
    await handler(none.interaction as never);
    expect(allText(none.out[0]!.options)).toContain('出資している会社はありません');
  });
});
