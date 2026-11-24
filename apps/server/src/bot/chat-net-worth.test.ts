import { afterEach, describe, expect, it } from 'vitest';
import { emptyParts, balanceSheet } from '@casino/domain/progression';
import {
  GUILD,
  OTHER_USER,
  USER,
  allText,
  button,
  command,
  createTestServer,
  customIds,
  embedOf,
  makeHandler,
  makeUser,
} from './chat-test-kit.ts';
import { boardEmbed } from './boards.ts';
import { subtotals } from './net-worth-chat.ts';
import type { TestServer } from '../runtime/test-kit.ts';

let server: TestServer | null = null;
afterEach(async () => {
  if (server) await server.close();
  server = null;
});

/** USER: 5,000 cash + a 30,000 horse; OTHER_USER: 20,000 cash and 1,000 Teiai debt. */
function setup() {
  server = createTestServer({ casinoHandlers: true });
  const s = server;
  s.economy.ensureMember(GUILD, USER, { initialGrant: false });
  s.economy.ensureMember(GUILD, OTHER_USER, { initialGrant: false });
  s.economy.credit({ guildId: GUILD, userId: USER, amount: 5_000, reason: 'admin_grant' });
  s.economy.credit({ guildId: GUILD, userId: OTHER_USER, amount: 20_000, reason: 'admin_grant' });
  s.store
    .stmt(
      `INSERT INTO horses (guild_id, owner_id, name, coat, silks, speed, stamina, power, guts, created_at)
       VALUES (?, ?, 'H', 'bay', 'red', 50, 50, 50, 50, 0)`,
    )
    .run(GUILD, USER);
  s.finance.teiai.ensureAccount(GUILD, OTHER_USER);
  s.store
    .stmt(
      'UPDATE bank_accounts SET debt = 1000, debt_interest_at = ? WHERE guild_id = ? AND user_id = ?',
    )
    .run(s.clock.now(), GUILD, OTHER_USER);
  return { s, handler: makeHandler(s) };
}

describe('subtotals', () => {
  it('leaves zero groups out, in both languages', () => {
    const p = emptyParts();
    p.cash = 12_345;
    p.debt = -1_000;
    const g = balanceSheet('1', p).groups;
    expect(subtotals('en', g)).toBe('(current 12,345 · liabilities 1,000)');
    expect(subtotals('ja', g)).toBe('（流動 12,345・負債 1,000）');
    expect(subtotals('ja', balanceSheet('1', emptyParts()).groups)).toBe('');
  });
});

describe('/pelica ranking view', () => {
  it('stays the weekly game ranking by default', async () => {
    const { handler } = setup();
    const run = command({ name: 'pelica', sub: 'ranking' });
    await handler(run.interaction as never);
    expect(embedOf(run.out[0]!.options).title).toBe('Ranking');
  });

  it('net: ranks by total assets − liabilities with subtotals and three buttons', async () => {
    const { handler } = setup();
    const run = command({ name: 'pelica', sub: 'ranking', strings: { view: 'net' }, locale: 'ja' });
    await handler(run.interaction as never);
    const e = embedOf(run.out[0]!.options);
    expect(e.title).toBe('🏆 このサーバーのランキング（純資産）');
    const lines = (e.description ?? '').split('\n');
    expect(lines[0]).toContain(`<@${USER}>`);
    expect(lines[0]).toContain('35,000');
    expect(lines[0]).toContain('（流動 5,000・固定 30,000）');
    expect(lines[1]).toContain(`<@${OTHER_USER}>`);
    expect(lines[1]).toContain('（流動 20,000・負債 1,000）');
    expect(e.footer?.text).toContain('純資産 = 総資産 − 負債');
    expect(customIds(run.out[0]!.options)).toEqual(
      expect.arrayContaining([`b:nw:net:${USER}`, `b:nw:liquid:${USER}`, `b:nw:mine:${USER}`]),
    );
  });

  it('liquid: fixed assets drop out, so the order changes', async () => {
    const { handler } = setup();
    const run = command({ name: 'pelica', sub: 'ranking', strings: { view: 'liquid' } });
    await handler(run.interaction as never);
    const e = embedOf(run.out[0]!.options);
    expect(e.title).toBe('🏆 Server ranking (current assets)');
    const lines = (e.description ?? '').split('\n');
    expect(lines[0]).toContain(`<@${OTHER_USER}>`);
    expect(lines[1]).toContain(`<@${USER}>`);
  });

  it('member: opens that member’s balance sheet, for the caller only', async () => {
    const { handler } = setup();
    const run = command({
      name: 'pelica',
      sub: 'ranking',
      strings: { view: 'net' },
      users: { member: makeUser(OTHER_USER, 'bob', 'Bob') },
    });
    await handler(run.interaction as never);
    const text = allText(run.out[0]!.options);
    expect(embedOf(run.out[0]!.options).title).toBe('🧾 Asset breakdown of Bob');
    expect(run.out[0]!.options.flags).toBeDefined();
    expect(text).toContain('💴 Cash: 20,000');
    expect(text).toContain('💳 Borrowings (debt to Teiai): 1,000');
    expect(text).toContain('Net assets (total assets − liabilities): 19,000');
  });
});

describe('net worth buttons', () => {
  it('switch the view in place and open the caller’s own breakdown', async () => {
    const { handler } = setup();
    const liquid = button(`b:nw:liquid:${USER}`);
    await handler(liquid.interaction as never);
    expect(liquid.out[0]!.kind).toBe('update');
    expect(embedOf(liquid.out[0]!.options).title).toBe('🏆 Server ranking (current assets)');

    const mine = button(`b:nw:mine:${USER}`, { locale: 'ja' });
    await handler(mine.interaction as never);
    const text = allText(mine.out[0]!.options);
    expect(text).toContain('🐎 競走馬（購入価格＋引退金の見込み）: 30,000');
    expect(text).toContain('総資産（流動＋固定）: 35,000');
    expect(text).toContain('負債合計: 0');
  });

  it('answer anyone else privately and change nothing', async () => {
    const { handler } = setup();
    const press = button(`b:nw:net:${USER}`, { user: makeUser(OTHER_USER, 'bob') });
    await handler(press.interaction as never);
    expect(press.out[0]!.kind).toBe('reply');
    expect(press.out[0]!.options.content).toContain("someone else's ranking");
    expect(press.out[0]!.options.flags).toBeDefined();
  });
});

describe('balance card and board', () => {
  it('the balance card shows the net-worth rank and the balance-sheet field', async () => {
    const { handler } = setup();
    const run = command({ name: 'pelica', sub: 'balance', locale: 'ja' });
    await handler(run.interaction as never);
    const fields = embedOf(run.out[0]!.options).fields ?? [];
    expect(fields.find((f) => f.name === 'このサーバーでの順位（純資産）')?.value).toBe(
      '1位 / 2人',
    );
    const sheet = fields.find((f) => f.name === '🧾 資産（貸借対照表）')?.value ?? '';
    expect(sheet).toContain('流動資産 5,000');
    expect(sheet).toContain('固定資産 30,000');
    expect(sheet).toContain('**純資産 35,000');
  });

  it('the board ranks by balance-sheet net worth with subtotals and status emoji', () => {
    const { s } = setup();
    const rows = s.finance.netWorth.standings(GUILD, 'net').rows;
    const e = boardEmbed('en', rows, s.clock.now()).toJSON();
    expect(e.description).toContain(`🥇 <@${USER}> —`);
    expect(e.description).toContain('(current 5,000 · fixed 30,000)');
    expect(e.description).toContain(`🥈 <@${OTHER_USER}> 🟤 —`);
  });

  it('balance card flips from Clean to Wealthy at 1,000,000 financial assets and drops back', async () => {
    const { s, handler } = setup();
    const runClean = command({ name: 'pelica', sub: 'balance', locale: 'en' });
    await handler(runClean.interaction as never);
    const cleanFields = embedOf(runClean.out[0]!.options).fields ?? [];
    expect(cleanFields.find((f) => f.name === 'Status')?.value).toBe('🟢 Clean');

    // Credit enough cash to reach 1,000,000 financial net worth -> Wealthy (EN + JA)
    s.economy.credit({ guildId: GUILD, userId: USER, amount: 995_000, reason: 'admin_grant' });
    const runEn = command({ name: 'pelica', sub: 'balance', locale: 'en' });
    await handler(runEn.interaction as never);
    expect(
      (embedOf(runEn.out[0]!.options).fields ?? []).find((f) => f.name === 'Status')?.value,
    ).toBe('🟡 Wealthy');

    const runJa = command({ name: 'pelica', sub: 'balance', locale: 'ja' });
    await handler(runJa.interaction as never);
    expect(
      (embedOf(runJa.out[0]!.options).fields ?? []).find((f) => f.name === '身分')?.value,
    ).toBe('🟡 富豪');

    // /pelica bank also displays the Wealthy badge
    const runBank = command({ name: 'pelica', sub: 'bank', locale: 'ja' });
    await handler(runBank.interaction as never);
    expect(
      (embedOf(runBank.out[0]!.options).fields ?? []).find((f) => f.name === '状態')?.value,
    ).toBe('🟡 富豪');

    // Drop cash by 1 Pelica -> drops back to Clean even though the 30,000 horse keeps net worth > 1M
    s.economy.debit({ guildId: GUILD, userId: USER, amount: 1, reason: 'admin_revoke' });
    const runDrop = command({ name: 'pelica', sub: 'balance', locale: 'en' });
    await handler(runDrop.interaction as never);
    expect(
      (embedOf(runDrop.out[0]!.options).fields ?? []).find((f) => f.name === 'Status')?.value,
    ).toBe('🟢 Clean');
  });

  it('ranking rows and board show 🟡 / 🟤 / 🔴 next to names and no emoji for Clean', async () => {
    const { s, handler } = setup();
    const THIRD = '200000000000000009';
    const FOURTH = '200000000000000010';
    s.economy.ensureMember(GUILD, THIRD, { initialGrant: false });
    s.economy.ensureMember(GUILD, FOURTH, { initialGrant: false });
    // USER -> wealthy, OTHER_USER -> underground (already has 1,000 debt), THIRD -> bankrupt, FOURTH -> katagi
    s.economy.credit({ guildId: GUILD, userId: USER, amount: 1_000_000, reason: 'admin_grant' });
    s.finance.teiai.ensureAccount(GUILD, THIRD);
    s.store
      .stmt(
        'UPDATE bank_accounts SET debt = 5000, debt_interest_at = ?, bankrupt_at = ? WHERE guild_id = ? AND user_id = ?',
      )
      .run(s.clock.now(), s.clock.now(), GUILD, THIRD);
    s.economy.credit({ guildId: GUILD, userId: FOURTH, amount: 10_000, reason: 'admin_grant' });

    // Net worth ranking
    const netRun = command({ name: 'pelica', sub: 'ranking', strings: { view: 'net' } });
    await handler(netRun.interaction as never);
    const netDesc = embedOf(netRun.out[0]!.options).description ?? '';
    expect(netDesc).toContain(`<@${USER}> 🟡 —`);
    expect(netDesc).toContain(`<@${OTHER_USER}> 🟤 —`);
    expect(netDesc).toContain(`<@${THIRD}> 🔴 —`);
    expect(netDesc).toContain(`<@${FOURTH}> —`);

    // Weekly ranking
    for (const [uid, net] of [
      [USER, 500],
      [OTHER_USER, 400],
      [THIRD, 300],
      [FOURTH, 200],
    ] as const) {
      s.bus.publishDomain({
        type: 'GameSettled',
        guildId: GUILD,
        at: s.clock.now(),
        userId: uid,
        game: 'slots',
        roundId: `r-${uid}`,
        stake: 100,
        payout: 100 + net,
        net,
        source: 'chat',
      });
    }
    const weeklyRun = command({ name: 'pelica', sub: 'ranking' });
    await handler(weeklyRun.interaction as never);
    const weeklyDesc = embedOf(weeklyRun.out[0]!.options).description ?? '';
    expect(weeklyDesc).toContain(`<@${USER}> 🟡 —`);
    expect(weeklyDesc).toContain(`<@${OTHER_USER}> 🟤 —`);
    expect(weeklyDesc).toContain(`<@${THIRD}> 🔴 —`);
    expect(weeklyDesc).toContain(`<@${FOURTH}> —`);
  });
});
