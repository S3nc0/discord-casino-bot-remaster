import { afterEach, describe, expect, it } from 'vitest';
import { en, ja } from '@casino/shared/i18n';
import { GUILD, USER, allText, command, createTestServer, makeHandler } from './chat-test-kit.ts';
import type { TestServer } from '../runtime/test-kit.ts';

let server: TestServer | null = null;
afterEach(async () => {
  if (server) await server.close();
  server = null;
});

function setup() {
  server = createTestServer({ casinoHandlers: true });
  server.economy.ensureMember(GUILD, USER);
  server.economy.credit({ guildId: GUILD, userId: USER, amount: 200_000, reason: 'admin_grant' });
  return { s: server, handler: makeHandler(server) };
}

/** A leveraged NUMA long whose price then falls by `drop`, leaving the account thin. */
async function stressedAccount(
  s: TestServer,
  handler: ReturnType<typeof makeHandler>,
  drop: number,
): Promise<void> {
  const open = command({
    name: 'market',
    group: 'order',
    sub: 'margin',
    strings: { symbol: 'numa', side: 'long' },
    integers: { amount: 10_000, leverage: 5 },
  });
  await handler(open.interaction as never);
  expect(s.finance.stocks.listMarginPositions(GUILD, USER)).toHaveLength(1);
  const price = s.finance.stocks.getPricesMicros().numa;
  s.finance.stocks.setPrice('numa', Math.round(price * (1 - drop)));
}

describe('margin refusals in chat', () => {
  it.each([
    ['en-US', en],
    ['ja', ja],
  ] as const)('explains a margin position that is too thin (%s)', async (locale, dict) => {
    const { s, handler } = setup();
    await stressedAccount(s, handler, 0.19);
    const open = command({
      name: 'market',
      group: 'order',
      sub: 'margin',
      locale,
      strings: { symbol: 'numa', side: 'long' },
      integers: { amount: 500, leverage: 5 },
    });
    await handler(open.interaction as never);
    expect(allText(open.out[0]!.options)).toContain(
      dict['screen.finance.reason.margin_ratio_too_low'],
    );
    expect(s.finance.stocks.listMarginPositions(GUILD, USER)).toHaveLength(1);
  });

  it.each([
    ['en-US', en],
    ['ja', ja],
  ] as const)('explains a spot sale that would strip the collateral (%s)', async (locale, dict) => {
    const { s, handler } = setup();
    const buy = command({
      name: 'market',
      group: 'order',
      sub: 'spot',
      strings: { symbol: 'cs' },
      integers: { amount: 3_000 },
    });
    await handler(buy.interaction as never);
    await stressedAccount(s, handler, 0.19);
    const sell = command({
      name: 'market',
      sub: 'settle',
      locale,
      strings: { position: 'spot:cs' },
      integers: { percent: 100 },
    });
    await handler(sell.interaction as never);
    expect(allText(sell.out[0]!.options)).toContain(
      dict['screen.finance.reason.market_collateral_locked'],
    );
    expect(s.finance.stocks.getSpotHoldings(GUILD, USER)).toHaveLength(1);
  });
});
