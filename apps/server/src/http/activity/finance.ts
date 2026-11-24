import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Value } from 'typebox/value';
import type { Static, TSchema } from 'typebox';
import {
  FINANCE_ROUTES,
  FinanceBondRequest,
  FinanceCompanyDividendRequest,
  FinanceCompanyFoundRequest,
  FinanceCompanyFundRequest,
  FinanceCompanyInvestRequest,
  FinanceKyosaiBidRequest,
  FinanceKyosaiOfferRefRequest,
  FinanceKyosaiOfferRequest,
  FinanceKyosaiProposeRequest,
  FinanceKyosaiVoteRequest,
  FinanceListingBidRequest,
  FinanceListingCreateRequest,
  FinanceListingRefRequest,
  FinanceLoanAskRequest,
  FinanceLoanOfferRequest,
  FinanceLoanRefRequest,
  FinanceLoanRepayRequest,
  FinanceMarginRequest,
  FinanceOptionRequest,
  FinanceRepayRequest,
  FinanceSettleRequest,
  FinanceSpotRequest,
  PRICE_SCALE,
  QUANTITY_SCALE,
  type Clock,
  type FinanceBankView,
  type FinanceCompaniesView,
  type FinanceError,
  type FinanceKyosaiView,
  type FinanceListingsView,
  type FinanceLoansView,
  type FinanceMarketView,
  type FinancePerson,
  type FinanceWriteResult,
  type SessionClaims,
} from '@casino/shared';
import {
  BOND_CONSTANTS,
  COMPANY_CONSTANTS,
  COMPANY_KINDS,
  MARKET_CONSTANTS,
  MARKET_SYMBOLS,
  P2P_LOAN_CONSTANTS,
  PLAYER_MARKET_CONSTANTS,
  TEIAI_CONSTANTS,
  companyStakeCap,
  isTradableItem,
  MARKET_ITEM_CATALOG,
  minNextBid,
  rateToNano,
  relicReferenceValue,
  type SymbolKey,
} from '@casino/domain/finance';
import type { IdentityRepo } from '../../db/identity.ts';
import type { Store } from '../../db/store.ts';
import type { EconomyService } from '../../economy/economy-service.ts';
import type { FinanceServices } from '../../finance/index.ts';
import type { ServiceResult } from '../../finance/teiai-service.ts';
import { ITEM_LABELS } from '../../bot/shop-items.ts';
import { IdempotencyStore } from '../../games/casino/idempotency.ts';
import { Inventory } from '../../games/shop/inventory.ts';
import { AppError } from '../../runtime/errors.ts';
import { RateLimiter } from '../../runtime/rate-limit.ts';

/** What the finance routes need from the app; `session` is the verified token of the request. */
export interface FinanceRouteContext {
  finance: FinanceServices;
  economy: EconomyService;
  identity: IdentityRepo;
  store: Store;
  clock: Clock;
  session: (request: FastifyRequest) => SessionClaims;
  /** Writes per user per minute (default 60). */
  writesPerMinute?: number;
}

const SYMBOL_KEYS: ReadonlySet<string> = new Set(MARKET_SYMBOLS.map((s) => s.key));
const isSymbol = (value: string): value is SymbolKey => SYMBOL_KEYS.has(value);
const HISTORY_POINTS = 48;
const OPTION_HOURS = 24;

/** Service failure → typed error: generic code for the status, the rule code as `reason`. */
export function unwrapRule<T>(res: ServiceResult<T>): T {
  if (res.ok) return res.data;
  const reason = res.reason;
  const code = (() => {
    if (reason === 'insufficient_funds') return 'insufficient_funds' as const;
    if (reason.includes('self_')) return 'invalid_payload' as const;
    if (/(debtor_blocked|katagi_only|forbidden|not_buyer|not_borrower|grace_lock)/.test(reason)) {
      return 'forbidden' as const;
    }
    if (
      reason.includes('not_found') ||
      reason === 'no_debt' ||
      reason.includes('no_open') ||
      reason.includes('unavailable')
    ) {
      return 'not_found' as const;
    }
    if (reason.includes('expired')) return 'expired' as const;
    if (/(invalid|min_|too_small|too_low|out_of_range|self_|_limit|max_)/.test(reason)) {
      return 'invalid_payload' as const;
    }
    return 'conflict' as const;
  })();
  throw new AppError(code, { reason, ...(res.params ? { ruleParams: res.params } : {}) });
}

/** Catalog name of a listed item (`[ja, en]` in the shop catalog); horses carry their own name. */
function itemName(kind: 'item' | 'horse', ref: string): { en: string; ja: string } | null {
  const entry = kind === 'item' ? ITEM_LABELS[ref] : undefined;
  return entry ? { ja: entry[0], en: entry[1] } : null;
}

export function registerFinanceRoutes(authed: FastifyInstance, ctx: FinanceRouteContext): void {
  const { finance, economy, identity, store, clock } = ctx;
  const { teiai, loans, kyosai, stocks, companies, playerMarket } = finance;
  const idem = new IdempotencyStore(store, clock);
  const inventory = new Inventory(store);
  const writeLimiter = new RateLimiter({
    limit: ctx.writesPerMinute ?? 60,
    windowMs: 60_000,
    clock,
  }).start();
  authed.addHook('onClose', (_instance, done) => {
    writeLimiter.stop();
    done();
  });

  const person = (id: string): FinancePerson => {
    const user = identity.getUser(id);
    return { id, name: user?.globalName ?? user?.username ?? id };
  };
  const personOrNull = (id: string | null | undefined): FinancePerson | null =>
    id ? person(id) : null;

  // ---------------------------------------------------------------- plumbing

  /** Reads: the session's own guild and user, the account created on first sight. */
  const read = <T>(path: string, fn: (g: string, u: string) => T): void => {
    authed.get(path, (request): T => {
      const s = ctx.session(request);
      economy.ensureMember(s.gid, s.sub);
      return fn(s.gid, s.sub);
    });
  };

  /**
   * Writes: schema check, per-user write limit, then one idempotent transaction. A rule failure
   * throws inside it, so nothing is stored and the client may retry with the same key.
   */
  const write = <S extends TSchema>(
    path: string,
    schema: S,
    run: (a: {
      g: string;
      u: string;
      body: Static<S>;
      key: string;
    }) => Omit<FinanceWriteResult, 'balance' | 'replayed'>,
  ): void => {
    authed.post(path, (request: FastifyRequest, reply: FastifyReply) => {
      const s = ctx.session(request);
      const hit = writeLimiter.hit(s.sub);
      if (!hit.allowed) throw new AppError('rate_limited', { retryAfterMs: hit.retryAfterMs });
      if (!Value.Check(schema, request.body)) throw new AppError('invalid_payload');
      const body = request.body as Static<S> & { idempotencyKey: string };
      economy.ensureMember(s.gid, s.sub);
      try {
        const { response, replayed } = idem.run(
          { guildId: s.gid, userId: s.sub },
          body.idempotencyKey,
          path,
          body,
          (): Omit<FinanceWriteResult, 'replayed'> => ({
            ...run({ g: s.gid, u: s.sub, body, key: body.idempotencyKey }),
            balance: economy.getBalance(s.gid, s.sub),
          }),
        );
        return { ...response, ...(replayed ? { replayed: true } : {}) };
      } catch (error) {
        if (error instanceof AppError && error.authReason !== undefined) {
          const payload: FinanceError = {
            error: error.code,
            reason: error.authReason,
            ...(error.ruleParams ? { params: error.ruleParams } : {}),
          };
          return reply.code(error.status).send(payload);
        }
        throw error;
      }
    });
  };

  // ---------------------------------------------------------------- Teiai Bank

  read(FINANCE_ROUTES.bank, (g, u): FinanceBankView => {
    const account = teiai.ensureAccount(g, u);
    const bank = teiai.getBankStatus(g);
    return {
      balance: economy.getBalance(g, u),
      debt: account.debt,
      deposit: teiai.getDeposit(g, u),
      status: teiai.getStatus(g, u),
      inGrace: teiai.isInGrace(g, u),
      graceUntil: account.grace_until,
      blacklistUntil: account.blacklist_until,
      graceDebt: TEIAI_CONSTANTS.graceDebt,
      bank: {
        cash: bank.cash,
        available: bank.available,
        ratio: bank.ratio,
        level: bank.level,
        trustRate: bank.trustRate,
      },
    };
  });

  write(FINANCE_ROUTES.bankRepay, FinanceRepayRequest, ({ g, u, body, key }) => {
    const res = unwrapRule(teiai.repayDebt(g, u, body.amount, undefined, key));
    return { amount: res.paid, remainingDebt: res.remainingDebt };
  });

  // ---------------------------------------------------------------- player loans

  read(FINANCE_ROUTES.loans, (g, u): FinanceLoansView => {
    const now = clock.now();
    const toView = (l: ReturnType<typeof loans.listLoansFor>[number]) => {
      const role =
        l.status === 'request' && l.borrower_id !== u
          ? 'open'
          : l.lender_id === u
            ? 'lender'
            : 'borrower';
      const other = role === 'lender' ? l.borrower_id : l.lender_id;
      const counterparty = role === 'open' ? person(l.borrower_id) : personOrNull(other);
      return {
        id: l.id,
        role,
        counterparty,
        status: l.status,
        principal: l.principal,
        rateBps: l.rate_bps,
        termDays: l.term_days,
        paid: l.paid,
        remaining: loans.remainingOf(l, now),
        dueAt: l.due_at,
        offerExpiresAt: l.offer_expires_at,
      } as const;
    };
    return {
      loans: [...loans.listLoansFor(g, u), ...loans.listOpenRequests(g, u, now)].map(toView),
      limits: {
        minPrincipal: P2P_LOAN_CONSTANTS.minPrincipal,
        minTermDays: P2P_LOAN_CONSTANTS.minTermDays,
        maxTermDays: P2P_LOAN_CONSTANTS.maxTermDays,
      },
    };
  });

  write(FINANCE_ROUTES.loanOffer, FinanceLoanOfferRequest, ({ g, u, body }) => ({
    id: unwrapRule(
      loans.offerLoan({
        guildId: g,
        lenderId: u,
        borrowerId: body.borrowerId,
        principal: body.principal,
        rateBps: body.rateBps,
        termDays: body.termDays,
      }),
    ),
    amount: body.principal,
  }));
  write(FINANCE_ROUTES.loanRequest, FinanceLoanAskRequest, ({ g, u, body }) => ({
    id: unwrapRule(
      loans.requestLoan({
        guildId: g,
        borrowerId: u,
        principal: body.principal,
        rateBps: body.rateBps,
        termDays: body.termDays,
      }),
    ),
    amount: body.principal,
  }));
  write(FINANCE_ROUTES.loanAccept, FinanceLoanRefRequest, ({ g, u, body, key }) => {
    const loan = unwrapRule(loans.acceptOffer(g, body.loanId, u, undefined, key));
    return { id: loan.id, amount: loan.principal };
  });
  write(FINANCE_ROUTES.loanLend, FinanceLoanRefRequest, ({ g, u, body, key }) => {
    const loan = unwrapRule(loans.lendToRequest(g, body.loanId, u, undefined, key));
    return { id: loan.id, amount: loan.principal };
  });
  write(FINANCE_ROUTES.loanDecline, FinanceLoanRefRequest, ({ g, u, body }) => {
    unwrapRule(loans.declineOffer(g, body.loanId, u));
    return { id: body.loanId };
  });
  write(FINANCE_ROUTES.loanCancel, FinanceLoanRefRequest, ({ g, u, body }) => {
    unwrapRule(loans.cancelPending(g, body.loanId, u));
    return { id: body.loanId };
  });
  write(FINANCE_ROUTES.loanRepay, FinanceLoanRepayRequest, ({ g, u, body, key }) => ({
    id: body.loanId,
    amount: unwrapRule(loans.repayLoan(g, body.loanId, u, body.amount, undefined, key)),
  }));

  // ---------------------------------------------------------------- Kyosai

  read(FINANCE_ROUTES.kyosai, (g, u): FinanceKyosaiView => {
    const st = kyosai.getStatus(g, u);
    const now = clock.now();
    return {
      total: st.total,
      house: st.house,
      circulating: st.circulating,
      holders: st.holders,
      units: st.units,
      pool: st.pool,
      premiumBps: st.premium * 10_000,
      ratio: st.theta,
      locked: st.locked,
      auction: st.auction
        ? {
            id: st.auction.id,
            units: st.auction.units,
            topBid: st.auction.top_bid,
            topBidder: personOrNull(st.auction.top_bidder_id),
            youAreTop: st.auction.top_bidder_id === u,
            endsAt: st.auction.ends_at,
          }
        : null,
      motions: st.motions.map((m) => ({
        id: m.id,
        proposer: person(m.proposer_id),
        premiumBps: m.proposed_premium_nano / 100_000,
        yesUnits: m.yes_units,
        noUnits: m.no_units,
        circulatingUnits: m.circulating_units,
        closesAt: m.closes_at,
      })),
      offers: kyosai.listOffersFor(g, u, now).map((o) => ({
        id: o.id,
        direction: o.seller_id === u ? ('outgoing' as const) : ('incoming' as const),
        counterparty: person(o.seller_id === u ? o.buyer_id : o.seller_id),
        units: o.units,
        price: o.price,
        expiresAt: o.expires_at,
      })),
    };
  });

  write(FINANCE_ROUTES.kyosaiBid, FinanceKyosaiBidRequest, ({ g, u, body, key }) => {
    const auction = unwrapRule(kyosai.bidAuction(g, u, body.amount, undefined, key));
    return { id: auction.id, amount: auction.top_bid };
  });
  write(FINANCE_ROUTES.kyosaiOffer, FinanceKyosaiOfferRequest, ({ g, u, body }) => ({
    id: unwrapRule(kyosai.createOffer(g, u, body.buyerId, body.units, body.price)),
    amount: body.price,
  }));
  write(FINANCE_ROUTES.kyosaiAccept, FinanceKyosaiOfferRefRequest, ({ g, u, body, key }) => {
    const offer = unwrapRule(kyosai.acceptOffer(g, u, body.offerId, undefined, key));
    return { id: offer.id, amount: offer.price, fee: offer.fee };
  });
  write(FINANCE_ROUTES.kyosaiCancel, FinanceKyosaiOfferRefRequest, ({ g, u, body }) => {
    unwrapRule(kyosai.cancelOffer(g, u, body.offerId));
    return { id: body.offerId };
  });
  write(FINANCE_ROUTES.kyosaiPropose, FinanceKyosaiProposeRequest, ({ g, u, body }) => {
    const motion = unwrapRule(kyosai.proposeMotion(g, u, rateToNano(body.premiumBps / 10_000)));
    return { id: motion.id };
  });
  write(FINANCE_ROUTES.kyosaiVote, FinanceKyosaiVoteRequest, ({ g, u, body }) => {
    unwrapRule(kyosai.voteMotion(g, u, body.motionId, body.yes));
    return { id: body.motionId };
  });

  // ---------------------------------------------------------------- securities market

  read(FINANCE_ROUTES.market, (g, u): FinanceMarketView => {
    stocks.ensureMarketInitialized();
    const prices = stocks.getPricesMicros();
    const refs = stocks.getReferencePrices24h();
    const pins = stocks.getPinStates();
    const portfolio = stocks.getPortfolioMarginStatus(g, u);
    const valueOf = (symbol: SymbolKey, unitsMilli: number): number =>
      Math.floor((unitsMilli / QUANTITY_SCALE) * (prices[symbol] / PRICE_SCALE));
    return {
      symbols: MARKET_SYMBOLS.map((s) => {
        const ref = refs[s.key] ?? null;
        return {
          key: s.key,
          name: s.name,
          priceMicros: prices[s.key],
          refMicros: ref,
          changeBps: ref && ref > 0 ? Math.round(((prices[s.key] - ref) / ref) * 10_000) : 0,
          history: stocks.getPriceHistory(s.key, HISTORY_POINTS),
          pin: pins[s.key],
        };
      }),
      spot: stocks.getSpotHoldings(g, u).map((h) => ({
        symbol: h.symbol,
        unitsMilli: h.units_milli,
        cost: h.cost,
        value: valueOf(h.symbol, h.units_milli),
      })),
      margin: stocks.listMarginPositions(g, u).map((m) => ({
        symbol: m.symbol,
        side: m.side,
        unitsMilli: m.units_milli,
        margin: m.margin,
        openedAt: m.opened_at,
      })),
      options: stocks.listOpenOptions(g, u).map((o) => ({
        id: o.id,
        side: o.side,
        kind: o.kind,
        symbol: o.symbol,
        symbolB: o.symbol_b,
        unitsMilli: o.units_milli,
        premium: o.premium,
        margin: o.margin,
        expiresAt: o.expires_at,
      })),
      bonds: stocks.listActiveBonds(g, u).map((b) => ({
        id: b.id,
        kind: b.kind,
        principal: b.principal,
        rateBps: b.rate_bps,
        dueAt: b.due_at,
      })),
      portfolio: { equity: portfolio.equity, required: portfolio.required },
      limits: {
        minMargin: MARKET_CONSTANTS.minMargin,
        leverages: [...MARKET_CONSTANTS.allowedLeverages],
        bondMin: BOND_CONSTANTS.minAmount,
        bonds: (['normal', 'junk'] as const).map((k) => ({
          key: k,
          hours: BOND_CONSTANTS.kinds[k].hours,
          ratePct: BOND_CONSTANTS.kinds[k].baseRatePct,
          maxTotal: BOND_CONSTANTS.kinds[k].maxTotal,
          sellable: BOND_CONSTANTS.kinds[k].sellable,
        })),
      },
    };
  });

  write(FINANCE_ROUTES.marketSpot, FinanceSpotRequest, ({ g, u, body, key }) => {
    const res = unwrapRule(
      stocks.buySpot(g, u, body.symbol, body.amount, undefined, { idempotencyKey: key }),
    );
    return { unitsMilli: res.unitsMilli, fee: res.fee, amount: body.amount };
  });
  write(FINANCE_ROUTES.marketMargin, FinanceMarginRequest, ({ g, u, body, key }) => {
    const res = unwrapRule(
      stocks.openMargin(g, u, body.side, body.symbol, body.amount, body.leverage, undefined, key),
    );
    return { unitsMilli: res.unitsMilli, amount: res.margin };
  });
  write(FINANCE_ROUTES.marketOption, FinanceOptionRequest, ({ g, u, body, key }) => {
    if (body.kind === 'pair' && (!body.symbolB || body.symbolB === body.symbol)) {
      throw new AppError('invalid_payload', { reason: 'option_pair_symbols' });
    }
    const option = unwrapRule(
      stocks.buyOption({
        guildId: g,
        userId: u,
        kind: body.kind,
        symbol: body.symbol,
        ...(body.kind === 'pair' && body.symbolB ? { symbolB: body.symbolB } : {}),
        premium: body.premium,
        hours: OPTION_HOURS,
        ...(body.kind !== 'pair' && body.targetPct !== undefined
          ? { customTargetPct: body.targetPct }
          : {}),
        idempotencyKey: key,
      }),
    );
    return { id: option.id, amount: option.premium };
  });
  write(FINANCE_ROUTES.marketBond, FinanceBondRequest, ({ g, u, body, key }) => {
    const bond = unwrapRule(stocks.buyBond(g, u, body.kind, body.amount, undefined, key));
    return { id: bond.id, amount: bond.principal };
  });
  write(FINANCE_ROUTES.marketSettle, FinanceSettleRequest, ({ g, u, body, key }) => {
    const [kind = '', ref = ''] = body.position.split(':');
    if (kind === 'spot' && isSymbol(ref)) {
      const held = stocks.getSpotHoldings(g, u).find((s) => s.symbol === ref);
      if (!held) throw new AppError('not_found', { reason: 'position_not_found' });
      const percent = body.percent ?? 100;
      const sell =
        percent === 100 ? held.units_milli : Math.floor((held.units_milli * percent) / 100);
      const res = unwrapRule(stocks.sellSpot(g, u, ref, sell, undefined, { idempotencyKey: key }));
      return {
        unitsMilli: res.unitsMilli,
        amount: res.money,
        fee: res.fee,
        tax: res.tax,
        pnl: res.profit,
      };
    }
    if ((kind === 'long' || kind === 'short') && isSymbol(ref)) {
      const res = unwrapRule(
        stocks.closeMargin(g, u, kind, ref, undefined, {
          idempotencyKey: key,
          percent: body.percent ?? 100,
        }),
      );
      return { pnl: res.pnl, returned: res.returned, tax: res.tax };
    }
    const id = Number(ref);
    if (kind === 'option' && Number.isInteger(id)) {
      const option = stocks.listOpenOptions(g, u).find((o) => o.id === id);
      if (!option) throw new AppError('not_found', { reason: 'position_not_found' });
      if (option.side === 'long') {
        return { id, amount: unwrapRule(stocks.sellOptionEarly(g, u, id, undefined, key)) };
      }
      const res = unwrapRule(stocks.buybackOption(g, u, id, undefined, key));
      return { id, amount: res.cost, returned: res.marginReturned };
    }
    if (kind === 'bond' && Number.isInteger(id)) {
      return { id, amount: unwrapRule(stocks.sellBondEarly(g, u, id, undefined, key)) };
    }
    throw new AppError('invalid_payload', { reason: 'position_invalid' });
  });

  // ---------------------------------------------------------------- companies

  read(FINANCE_ROUTES.companies, (g, u): FinanceCompaniesView => {
    const mine = companies.getCompanyState(g, u);
    return {
      mine: mine
        ? {
            name: mine.name,
            kind: mine.kind,
            level: mine.level,
            funds: mine.funds,
            invested: mine.invested,
            upgradeCost: mine.upgradeCost,
            upkeep: mine.upkeep,
            unpaidDays: mine.unpaidDays,
            dailyOutput: mine.dailyOutput,
            stockValue: mine.stockValue,
            condition: mine.condition,
            dividendRateBps: Math.round(mine.dividendRate * 10_000),
            stakeCap: mine.stakeCap,
            stakesTotal: mine.stakesTotal,
            investors: mine.investors,
            withdrawable: mine.withdrawable,
          }
        : null,
      holdings: companies.listStakesOf(g, u).map((h) => ({
        owner: person(h.ownerId),
        name: h.name,
        level: h.level,
        amount: h.amount,
        value: h.value,
        dividendRateBps: Math.round(h.dividendRate * 10_000),
      })),
      others: companies.listOpenCompanies(g, u).map((c) => ({
        owner: person(c.user_id),
        name: c.name,
        kind: c.kind,
        level: c.level,
        dividendRateBps: c.dividend_rate_bps,
        room: Math.max(0, companyStakeCap(c.level) - c.stakes_total),
      })),
      foundCost: COMPANY_CONSTANTS.foundFee + (COMPANY_CONSTANTS.buildCosts[0] ?? 0),
      stakeMin: COMPANY_CONSTANTS.stakeMin,
      dividendMaxBps: COMPANY_CONSTANTS.dividendMaxBps,
    };
  });

  write(FINANCE_ROUTES.companyFound, FinanceCompanyFoundRequest, ({ g, u, body, key }) => {
    if (!(body.kind in COMPANY_KINDS)) throw new AppError('invalid_payload');
    const state = unwrapRule(companies.foundCompany(g, u, body.name, body.kind, undefined, key));
    return { amount: state.invested };
  });
  write(FINANCE_ROUTES.companyInvest, FinanceCompanyInvestRequest, ({ g, u, body, key }) => {
    const res = unwrapRule(companies.stakeInvest(g, u, body.ownerId, body.amount, undefined, key));
    return { amount: res.amount };
  });
  write(FINANCE_ROUTES.companyFund, FinanceCompanyFundRequest, ({ g, u, body, key }) => ({
    amount: unwrapRule(companies.ownerInvest(g, u, body.amount, key)),
  }));
  write(FINANCE_ROUTES.companyDividend, FinanceCompanyDividendRequest, ({ g, u, body }) => ({
    amount: unwrapRule(companies.setDividendRate(g, u, body.rateBps)),
  }));

  // ---------------------------------------------------------------- player market

  read(FINANCE_ROUTES.listings, (g, u): FinanceListingsView => ({
    listings: playerMarket.listActive(g).map((l) => ({
      id: l.id,
      seller: person(l.seller_id),
      kind: l.kind,
      ref: l.ref,
      name: itemName(l.kind, l.ref),
      qty: l.qty,
      mode: l.mode,
      price: l.price,
      bid: l.bid,
      topBidder: personOrNull(l.bidder_id),
      youAreTop: l.bidder_id === u,
      mine: l.seller_id === u,
      endAt: l.end_at,
      minNextBid: l.mode === 'auction' ? minNextBid(l.price, l.bid) : l.price,
    })),
    feeBps: PLAYER_MARKET_CONSTANTS.feeRateBps,
    sellable: [...inventory.all(g, u)]
      .filter(([ref]) => isTradableItem(ref))
      .map(([ref, qty]) => ({
        ref,
        name: itemName('item', ref),
        qty,
        unitValue: relicReferenceValue(ref) ?? MARKET_ITEM_CATALOG.get(ref)?.price ?? 0,
      }))
      .sort((a, b) => a.ref.localeCompare(b.ref)),
    maxActive: PLAYER_MARKET_CONSTANTS.maxActiveListings,
    auctionHours: [...PLAYER_MARKET_CONSTANTS.auctionHours],
    fixedDays: PLAYER_MARKET_CONSTANTS.fixedDays,
  }));

  write(FINANCE_ROUTES.listingCreate, FinanceListingCreateRequest, ({ g, u, body }) => ({
    id: unwrapRule(
      playerMarket.listAsset({
        guildId: g,
        sellerId: u,
        kind: 'item',
        ref: body.ref,
        qty: body.qty,
        mode: body.mode,
        price: body.price,
        ...(body.hours !== undefined ? { hours: body.hours } : {}),
      }),
    ),
  }));

  write(FINANCE_ROUTES.listingBuy, FinanceListingRefRequest, ({ g, u, body, key }) => ({
    id: body.listingId,
    amount: unwrapRule(playerMarket.buyFixed(g, u, body.listingId, undefined, key)),
  }));
  write(FINANCE_ROUTES.listingBid, FinanceListingBidRequest, ({ g, u, body, key }) => {
    unwrapRule(playerMarket.placeBid(g, u, body.listingId, body.amount, undefined, key));
    return { id: body.listingId, amount: body.amount };
  });
  write(FINANCE_ROUTES.listingCancel, FinanceListingRefRequest, ({ g, u, body }) => {
    unwrapRule(playerMarket.cancelListing(g, u, body.listingId));
    return { id: body.listingId };
  });
}
