import {
  FINANCE_ROUTES as R,
  PRICE_SCALE,
  QUANTITY_SCALE,
  type FinanceBankView,
  type FinanceCompaniesView,
  type FinanceKyosaiView,
  type FinanceListingsView,
  type FinanceLoansView,
  type FinanceMarketView,
  type FinancePerson,
  type FinanceSymbol,
  type FinanceWriteResult,
} from '@casino/shared';
import { useBalanceStore } from '../../shell/stores/balance.ts';
import {
  FinanceApiError,
  type FinanceBody,
  type FinanceClient,
  type FinanceReads,
} from './types.ts';

const MIKA: FinancePerson = { id: '200000000000000002', name: 'Mika' };
const REN: FinancePerson = { id: '200000000000000003', name: 'Ren' };
const SORA: FinancePerson = { id: '200000000000000004', name: 'Sora' };
export const MOCK_PEOPLE: readonly FinancePerson[] = [MIKA, REN, SORA];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NAMES: Record<FinanceSymbol, string> = {
  cs: 'CSトークン',
  teio: 'TEIO重工',
  numa: 'NUMAバイオ',
  gold: 'GOLD',
};
const START: Record<FinanceSymbol, number> = { cs: 1000, teio: 1200, numa: 400, gold: 2000 };

/** A calm, repeatable chart: a slow wave plus a small wobble, never random. */
function history(symbol: FinanceSymbol, now: number): number[] {
  const base = START[symbol];
  const phase = symbol.length + base / 400;
  return Array.from({ length: 48 }, (_, i) => {
    const wave =
      Math.sin(i / 6 + phase) * 0.05 + Math.sin(i / 2.3 + phase * 2) * 0.012 + i * 0.0012;
    return Math.round(base * (1 + wave) * PRICE_SCALE + (now % 7));
  });
}

function fail(code: FinanceApiError['code'], reason?: string): never {
  throw new FinanceApiError(code, code === 'insufficient_funds' ? 409 : 400, reason);
}

/** In-memory server for `VITE_MOCK_DISCORD=1`, the component tests and the screenshot run. */
export function createMockFinanceClient(options: { balance?: number } = {}): FinanceClient {
  const now = () => Date.now();
  let balance = options.balance ?? 12_400;
  let debt = 4_200;
  let nextId = 100;
  const seen = new Map<string, FinanceWriteResult>();

  const loans: FinanceLoansView['loans'] = [
    {
      id: 1,
      role: 'borrower',
      counterparty: MIKA,
      status: 'active',
      principal: 2_000,
      rateBps: 100,
      termDays: 7,
      paid: 500,
      remaining: 1_620,
      dueAt: now() + 4 * DAY,
      offerExpiresAt: now() + DAY,
    },
    {
      id: 2,
      role: 'borrower',
      counterparty: REN,
      status: 'offer',
      principal: 1_000,
      rateBps: 50,
      termDays: 3,
      paid: 0,
      remaining: 0,
      dueAt: null,
      offerExpiresAt: now() + 20 * HOUR,
    },
    {
      id: 3,
      role: 'open',
      counterparty: SORA,
      status: 'request',
      principal: 800,
      rateBps: 80,
      termDays: 5,
      paid: 0,
      remaining: 0,
      dueAt: null,
      offerExpiresAt: now() + 18 * HOUR,
    },
  ];

  const kyosai: FinanceKyosaiView = {
    total: 10_000,
    house: 6_800,
    circulating: 3_200,
    holders: 9,
    units: 120,
    pool: 18_400,
    premiumBps: 130,
    ratio: 0.42,
    locked: false,
    auction: {
      id: 7,
      units: 100,
      topBid: 6_400,
      topBidder: MIKA,
      youAreTop: false,
      endsAt: now() + 9 * HOUR,
    },
    motions: [
      {
        id: 4,
        proposer: REN,
        premiumBps: 150,
        yesUnits: 800,
        noUnits: 300,
        circulatingUnits: 3_200,
        closesAt: now() + 6 * HOUR,
      },
    ],
    offers: [
      {
        id: 9,
        direction: 'incoming',
        counterparty: SORA,
        units: 20,
        price: 900,
        expiresAt: now() + 12 * HOUR,
      },
    ],
  };

  const market: FinanceMarketView = {
    symbols: (Object.keys(NAMES) as FinanceSymbol[]).map((key) => {
      const h = history(key, 0);
      const ref = h[0] ?? START[key] * PRICE_SCALE;
      const price = h[h.length - 1] ?? ref;
      return {
        key,
        name: NAMES[key],
        priceMicros: price,
        refMicros: ref,
        changeBps: Math.round(((price - ref) / ref) * 10_000),
        history: h,
        pin: 0,
      };
    }),
    spot: [{ symbol: 'cs', unitsMilli: 2_500, cost: 2_400, value: 2_700 }],
    margin: [
      { symbol: 'teio', side: 'long', unitsMilli: 1_000, margin: 600, openedAt: now() - HOUR },
    ],
    options: [
      {
        id: 5,
        side: 'long',
        kind: 'call',
        symbol: 'numa',
        symbolB: null,
        unitsMilli: 3_000,
        premium: 150,
        margin: 0,
        expiresAt: now() + 15 * HOUR,
      },
    ],
    bonds: [{ id: 6, kind: 'normal', principal: 3_000, rateBps: 400, dueAt: now() + 2 * DAY }],
    portfolio: { equity: 6_900, required: 1_800 },
    limits: {
      minMargin: 10,
      leverages: [1, 2, 3, 5],
      bondMin: 1_000,
      bonds: [
        { key: 'normal', hours: 72, ratePct: 4, maxTotal: 30_000, sellable: true },
        { key: 'junk', hours: 24, ratePct: 20, maxTotal: 10_000, sellable: false },
      ],
    },
  };

  const companies: FinanceCompaniesView = {
    mine: null,
    holdings: [
      {
        owner: MIKA,
        name: 'Mika Farm',
        level: 2,
        amount: 3_000,
        value: 3_150,
        dividendRateBps: 1_000,
      },
    ],
    others: [
      {
        owner: MIKA,
        name: 'Mika Farm',
        kind: 'farm',
        level: 2,
        dividendRateBps: 1_000,
        room: 6_000,
      },
      { owner: REN, name: 'Ren Mine', kind: 'mine', level: 1, dividendRateBps: 500, room: 4_000 },
    ],
    foundCost: 200_000,
    stakeMin: 1_000,
    dividendMaxBps: 5_000,
  };

  const listings: FinanceListingsView = {
    feeBps: 500,
    sellable: [
      {
        ref: 'carrot',
        name: { en: '🥕 Carrot', ja: '🥕 ニンジン' },
        qty: 3,
        unitValue: 1_000,
      },
      { ref: 'relic_bone', name: null, qty: 1, unitValue: 4_000 },
    ],
    maxActive: 5,
    auctionHours: [1, 6, 24, 72],
    fixedDays: 7,
    listings: [
      {
        id: 21,
        seller: MIKA,
        kind: 'item',
        ref: 'relic_crown',
        name: null,
        qty: 1,
        mode: 'auction',
        price: 5_000,
        bid: 6_200,
        topBidder: REN,
        youAreTop: false,
        mine: false,
        endAt: now() + 3 * HOUR,
        minNextBid: 6_510,
      },
      {
        id: 22,
        seller: SORA,
        kind: 'item',
        ref: 'skin_gold_dice',
        name: { en: '🎲 Golden Dice', ja: '🎲 黄金の賽' },
        qty: 2,
        mode: 'fixed',
        price: 1_800,
        bid: 0,
        topBidder: null,
        youAreTop: false,
        mine: false,
        endAt: now() + 5 * DAY,
        minNextBid: 1_800,
      },
      {
        id: 23,
        seller: { id: '200000000000000001', name: 'Mock Player' },
        kind: 'horse',
        ref: 'Blue Comet',
        name: null,
        qty: 1,
        mode: 'fixed',
        price: 24_000,
        bid: 0,
        topBidder: null,
        youAreTop: false,
        mine: true,
        endAt: now() + 6 * DAY,
        minNextBid: 24_000,
      },
    ],
  };

  const push = (): void => useBalanceStore.getState().set(balance);
  const spend = (amount: number): void => {
    if (amount > balance) fail('insufficient_funds');
    balance -= amount;
    push();
  };
  const price = (s: FinanceSymbol): number =>
    (market.symbols.find((x) => x.key === s)?.priceMicros ?? PRICE_SCALE) / PRICE_SCALE;
  const done = (extra: Omit<FinanceWriteResult, 'balance'> = {}): FinanceWriteResult => ({
    balance,
    ...extra,
  });

  const writes: Record<
    string,
    (b: Record<string, unknown>) => Omit<FinanceWriteResult, 'balance'>
  > = {
    [R.bankRepay]: (b) => {
      if (debt <= 0) fail('not_found', 'no_debt');
      const pay = Math.min(debt, balance, typeof b.amount === 'number' ? b.amount : debt);
      if (pay <= 0) fail('insufficient_funds');
      spend(pay);
      debt -= pay;
      return { amount: pay, remainingDebt: debt };
    },
    [R.loanOffer]: (b) => {
      spend(Number(b.principal));
      return { id: nextId++, amount: Number(b.principal) };
    },
    [R.loanRequest]: (b) => {
      loans.unshift({
        id: nextId++,
        role: 'borrower',
        counterparty: null,
        status: 'request',
        principal: Number(b.principal),
        rateBps: Number(b.rateBps),
        termDays: Number(b.termDays),
        paid: 0,
        remaining: 0,
        dueAt: null,
        offerExpiresAt: now() + DAY,
      });
      return { id: nextId, amount: Number(b.principal) };
    },
    [R.loanAccept]: (b) => {
      const loan = loans.find((l) => l.id === b.loanId);
      if (!loan) fail('not_found', 'loan_not_found_or_closed');
      balance += loan.principal;
      push();
      Object.assign(loan, { status: 'active', dueAt: now() + loan.termDays * DAY });
      loan.remaining = loan.principal;
      return { id: loan.id, amount: loan.principal };
    },
    [R.loanLend]: (b) => {
      const loan = loans.find((l) => l.id === b.loanId);
      if (!loan) fail('not_found', 'loan_not_found_or_closed');
      spend(loan.principal);
      loans.splice(loans.indexOf(loan), 1);
      return { id: loan.id, amount: loan.principal };
    },
    [R.loanDecline]: (b) => {
      const i = loans.findIndex((l) => l.id === b.loanId);
      if (i >= 0) loans.splice(i, 1);
      return { id: Number(b.loanId) };
    },
    [R.loanCancel]: (b) => {
      const i = loans.findIndex((l) => l.id === b.loanId);
      if (i >= 0) loans.splice(i, 1);
      return { id: Number(b.loanId) };
    },
    [R.loanRepay]: (b) => {
      const loan = loans.find((l) => l.id === b.loanId);
      if (!loan) fail('not_found', 'loan_not_found_or_closed');
      const pay = Math.min(
        loan.remaining,
        balance,
        typeof b.amount === 'number' ? b.amount : loan.remaining,
      );
      spend(pay);
      loan.remaining -= pay;
      loan.paid += pay;
      if (loan.remaining <= 0) loan.status = 'repaid';
      return { id: loan.id, amount: pay };
    },
    [R.kyosaiBid]: (b) => {
      const auction = kyosai.auction;
      if (!auction) fail('not_found', 'kyosai_no_open_auction');
      if (Number(b.amount) <= auction.topBid) fail('invalid_payload', 'kyosai_bid_too_low');
      spend(Number(b.amount));
      Object.assign(auction, {
        topBid: Number(b.amount),
        topBidder: { id: '200000000000000001', name: 'Mock Player' },
        youAreTop: true,
      });
      return { id: auction.id, amount: Number(b.amount) };
    },
    [R.kyosaiOffer]: (b) => ({ id: nextId++, amount: Number(b.price) }),
    [R.kyosaiAccept]: (b) => {
      const offer = kyosai.offers.find((o) => o.id === b.offerId);
      if (!offer) fail('not_found', 'kyosai_offer_not_found');
      spend(offer.price);
      kyosai.units += offer.units;
      kyosai.offers = kyosai.offers.filter((o) => o !== offer);
      return { id: offer.id, amount: offer.price };
    },
    [R.kyosaiCancel]: (b) => {
      kyosai.offers = kyosai.offers.filter((o) => o.id !== b.offerId);
      return { id: Number(b.offerId) };
    },
    [R.kyosaiPropose]: () => ({ id: nextId++ }),
    [R.kyosaiVote]: (b) => {
      const motion = kyosai.motions.find((m) => m.id === b.motionId);
      if (motion) {
        if (b.yes) motion.yesUnits += kyosai.units;
        else motion.noUnits += kyosai.units;
      }
      return { id: Number(b.motionId) };
    },
    [R.marketSpot]: (b) => {
      const symbol = b.symbol as FinanceSymbol;
      spend(Number(b.amount));
      const units = Math.floor((Number(b.amount) / price(symbol)) * QUANTITY_SCALE);
      const held = market.spot.find((s) => s.symbol === symbol);
      if (held) {
        held.unitsMilli += units;
        held.cost += Number(b.amount);
        held.value += Number(b.amount);
      } else
        market.spot.push({
          symbol,
          unitsMilli: units,
          cost: Number(b.amount),
          value: Number(b.amount),
        });
      return { unitsMilli: units, fee: 0, amount: Number(b.amount) };
    },
    [R.marketMargin]: (b) => {
      if (Number(b.amount) < 10) fail('invalid_payload', 'margin_min_amount');
      spend(Number(b.amount));
      market.margin.push({
        symbol: b.symbol as FinanceSymbol,
        side: b.side as 'long' | 'short',
        unitsMilli: Math.floor(
          ((Number(b.amount) * Number(b.leverage)) / price(b.symbol as FinanceSymbol)) *
            QUANTITY_SCALE,
        ),
        margin: Number(b.amount),
        openedAt: now(),
      });
      return { amount: Number(b.amount) };
    },
    [R.marketOption]: (b) => {
      spend(Number(b.premium));
      market.options.push({
        id: nextId++,
        side: 'long',
        kind: b.kind as 'call' | 'put' | 'pair',
        symbol: b.symbol as FinanceSymbol,
        symbolB: (b.symbolB as FinanceSymbol | undefined) ?? null,
        unitsMilli: 1_000,
        premium: Number(b.premium),
        margin: 0,
        expiresAt: now() + DAY,
      });
      return { id: nextId, amount: Number(b.premium) };
    },
    [R.marketBond]: (b) => {
      if (Number(b.amount) < 1_000) fail('invalid_payload', 'bond_min_amount');
      spend(Number(b.amount));
      market.bonds.push({
        id: nextId++,
        kind: b.kind as 'normal' | 'junk',
        principal: Number(b.amount),
        rateBps: b.kind === 'junk' ? 2_000 : 400,
        dueAt: now() + (b.kind === 'junk' ? DAY : 3 * DAY),
      });
      return { id: nextId, amount: Number(b.amount) };
    },
    [R.marketSettle]: (b) => {
      const [kind = '', ref = ''] = String(b.position).split(':');
      if (kind === 'spot') {
        const held = market.spot.find((s) => s.symbol === ref);
        if (!held) fail('not_found', 'position_not_found');
        balance += held.value;
        push();
        market.spot = market.spot.filter((s) => s !== held);
        return { amount: held.value, pnl: held.value - held.cost };
      }
      if (kind === 'long' || kind === 'short') {
        const pos = market.margin.find((m) => m.symbol === ref && m.side === kind);
        if (!pos) fail('not_found', 'position_not_found');
        balance += pos.margin;
        push();
        market.margin = market.margin.filter((m) => m !== pos);
        return { returned: pos.margin, pnl: 0 };
      }
      if (kind === 'option') market.options = market.options.filter((o) => o.id !== Number(ref));
      if (kind === 'bond') market.bonds = market.bonds.filter((o) => o.id !== Number(ref));
      return { id: Number(ref) };
    },
    [R.companyFound]: (b) => {
      spend(companies.foundCost);
      companies.mine = {
        name: String(b.name),
        kind: b.kind as 'farm' | 'mine',
        level: 1,
        funds: 100_000,
        invested: 100_000,
        upgradeCost: 200_000,
        upkeep: 300,
        unpaidDays: 0,
        dailyOutput: 1_800,
        stockValue: 0,
        condition: 'sunny',
        dividendRateBps: 0,
        stakeCap: 200_000,
        stakesTotal: 0,
        investors: 0,
        withdrawable: 100_000,
      };
      return { amount: companies.foundCost };
    },
    [R.companyInvest]: (b) => {
      if (Number(b.amount) < companies.stakeMin) fail('invalid_payload', 'company_stake_min');
      spend(Number(b.amount));
      return { amount: Number(b.amount) };
    },
    [R.companyFund]: (b) => {
      spend(Number(b.amount));
      if (companies.mine) companies.mine.funds += Number(b.amount);
      return { amount: Number(b.amount) };
    },
    [R.companyDividend]: (b) => {
      if (companies.mine) companies.mine.dividendRateBps = Number(b.rateBps);
      return { amount: Number(b.rateBps) };
    },
    [R.listingBuy]: (b) => {
      const listing = listings.listings.find((l) => l.id === b.listingId);
      if (!listing) fail('not_found', 'marketplace_listing_unavailable');
      spend(listing.price);
      listings.listings = listings.listings.filter((l) => l !== listing);
      return { id: listing.id, amount: listing.price };
    },
    [R.listingBid]: (b) => {
      const listing = listings.listings.find((l) => l.id === b.listingId);
      if (!listing) fail('not_found', 'marketplace_listing_unavailable');
      if (Number(b.amount) < listing.minNextBid) fail('invalid_payload', 'marketplace_bid_too_low');
      spend(Number(b.amount));
      Object.assign(listing, {
        bid: Number(b.amount),
        youAreTop: true,
        topBidder: { id: '200000000000000001', name: 'Mock Player' },
      });
      listing.minNextBid = Math.round(Number(b.amount) * 1.05);
      return { id: listing.id, amount: Number(b.amount) };
    },
    [R.listingCreate]: (b) => {
      const owned = listings.sellable.find((i) => i.ref === b.ref);
      const qty = Number(b.qty);
      if (!owned || owned.qty < qty) fail('conflict', 'marketplace_asset_not_owned');
      owned.qty -= qty;
      listings.sellable = listings.sellable.filter((i) => i.qty > 0);
      const id = Math.max(0, ...listings.listings.map((l) => l.id)) + 1;
      listings.listings.push({
        id,
        seller: { id: '200000000000000001', name: 'Mock Player' },
        kind: 'item',
        ref: owned.ref,
        name: owned.name,
        qty,
        mode: b.mode === 'auction' ? 'auction' : 'fixed',
        price: Number(b.price),
        bid: 0,
        topBidder: null,
        youAreTop: false,
        mine: true,
        endAt: now() + (b.mode === 'auction' ? Number(b.hours ?? 24) * HOUR : 7 * DAY),
        minNextBid: Number(b.price),
      });
      return { id };
    },
    [R.listingCancel]: (b) => {
      listings.listings = listings.listings.filter((l) => l.id !== b.listingId);
      return { id: Number(b.listingId) };
    },
  };

  const bank = (): FinanceBankView => ({
    balance,
    debt,
    deposit: 0,
    status: debt > 0 ? 'underground' : 'katagi',
    inGrace: debt >= 15_000,
    graceUntil: debt >= 15_000 ? now() + 18 * HOUR : null,
    blacklistUntil: null,
    graceDebt: 15_000,
    bank: { cash: 2_400_000, available: 1_900_000, ratio: 0.42, level: 'safe', trustRate: 0.014 },
  });

  const reads: { [K in keyof FinanceReads]: () => FinanceReads[K] } = {
    [R.bank]: bank,
    [R.loans]: () => ({
      loans: structuredClone(loans),
      limits: { minPrincipal: 100, minTermDays: 1, maxTermDays: 30 },
    }),
    [R.kyosai]: () => structuredClone(kyosai),
    [R.market]: () => structuredClone(market),
    [R.companies]: () => structuredClone(companies),
    [R.listings]: () => structuredClone(listings),
  };

  return {
    get: (route) => Promise.resolve(reads[route]() as FinanceReads[typeof route]),
    post: (route: string, body: FinanceBody) => {
      const replay = seen.get(body.idempotencyKey);
      if (replay) return Promise.resolve({ ...replay, replayed: true });
      const handler = writes[route];
      if (!handler) return Promise.reject(new FinanceApiError('not_found', 404));
      try {
        const result = done(handler(body));
        result.balance = balance;
        seen.set(body.idempotencyKey, result);
        return Promise.resolve(result);
      } catch (error) {
        return Promise.reject(error);
      }
    },
  };
}
