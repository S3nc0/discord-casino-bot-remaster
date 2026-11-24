import { Type, type Static } from 'typebox';
import { ErrorCode } from '../errors.ts';
import { EpochMs, Pelica, Snowflake } from '../ids.ts';
import { IdempotencyKey } from '../intents.ts';

/**
 * Finance slice of the Activity API: Teiai Bank, P2P loans, Kyosai, the securities market,
 * companies and the player market. Every route needs the session token and acts on the token's
 * own user and guild. Reads are `GET`; every write is a `POST` with an `idempotencyKey` and answers
 * `FinanceWriteResult`. Failures use `FinanceError`: `error` is the generic `ErrorCode`, `reason`
 * the stable rule code of the service (`kyosai_gate_locked`, `margin_min_amount`, ...).
 */
export const FINANCE_ROUTES = {
  bank: '/api/finance/bank',
  bankRepay: '/api/finance/bank/repay',
  loans: '/api/finance/loans',
  loanOffer: '/api/finance/loans/offer',
  loanRequest: '/api/finance/loans/request',
  loanAccept: '/api/finance/loans/accept',
  loanLend: '/api/finance/loans/lend',
  loanDecline: '/api/finance/loans/decline',
  loanCancel: '/api/finance/loans/cancel',
  loanRepay: '/api/finance/loans/repay',
  kyosai: '/api/finance/kyosai',
  kyosaiBid: '/api/finance/kyosai/bid',
  kyosaiOffer: '/api/finance/kyosai/offer',
  kyosaiAccept: '/api/finance/kyosai/accept',
  kyosaiCancel: '/api/finance/kyosai/cancel',
  kyosaiPropose: '/api/finance/kyosai/propose',
  kyosaiVote: '/api/finance/kyosai/vote',
  market: '/api/finance/market',
  marketSpot: '/api/finance/market/spot',
  marketMargin: '/api/finance/market/margin',
  marketOption: '/api/finance/market/option',
  marketBond: '/api/finance/market/bond',
  marketSettle: '/api/finance/market/settle',
  companies: '/api/finance/companies',
  companyFound: '/api/finance/companies/found',
  companyInvest: '/api/finance/companies/invest',
  companyFund: '/api/finance/companies/fund',
  companyDividend: '/api/finance/companies/dividend',
  listings: '/api/finance/listings',
  listingBuy: '/api/finance/listings/buy',
  listingBid: '/api/finance/listings/bid',
  listingCancel: '/api/finance/listings/cancel',
  listingCreate: '/api/finance/listings/create',
} as const;
export type FinanceRoute = (typeof FINANCE_ROUTES)[keyof typeof FINANCE_ROUTES];

const closed = { additionalProperties: false } as const;
const Amount = Type.Integer({ minimum: 1, maximum: 1_000_000_000_000 });
const RecordId = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const idem = { idempotencyKey: IdempotencyKey };

export const FINANCE_SYMBOLS = ['cs', 'teio', 'numa', 'gold'] as const;
export const FinanceSymbol = Type.Enum(FINANCE_SYMBOLS);
export type FinanceSymbol = (typeof FINANCE_SYMBOLS)[number];

export const FINANCE_COMPANY_KINDS = ['farm', 'mine'] as const;
export const FinanceCompanyKind = Type.Enum(FINANCE_COMPANY_KINDS);
export type FinanceCompanyKind = (typeof FINANCE_COMPANY_KINDS)[number];

// ---- error body ----

export const FinanceError = Type.Object({
  error: ErrorCode,
  reason: Type.Optional(Type.String({ maxLength: 80 })),
  /** Numbers the refusal text quotes, such as the margin ratio after the action. */
  params: Type.Optional(Type.Record(Type.String({ maxLength: 40 }), Type.Number())),
  retryAfterMs: Type.Optional(Type.Integer({ minimum: 0 })),
});
export type FinanceError = Static<typeof FinanceError>;

/** A player the screen names: the id for follow-up calls, the display name for the list. */
export const FinancePerson = Type.Object({ id: Snowflake, name: Type.String() });
export type FinancePerson = Static<typeof FinancePerson>;

/** Every write answers with the new balance plus the numbers of that one action. */
export const FinanceWriteResult = Type.Object({
  balance: Pelica,
  id: Type.Optional(Type.Integer()),
  amount: Type.Optional(Type.Integer()),
  fee: Type.Optional(Type.Integer()),
  tax: Type.Optional(Type.Integer()),
  /** Milli-units bought or sold. */
  unitsMilli: Type.Optional(Type.Integer()),
  /** Profit or loss of a close (signed). */
  pnl: Type.Optional(Type.Integer()),
  returned: Type.Optional(Type.Integer()),
  remainingDebt: Type.Optional(Type.Integer()),
  replayed: Type.Optional(Type.Boolean()),
});
export type FinanceWriteResult = Static<typeof FinanceWriteResult>;

// ---- Teiai Bank ----

export const FinanceDebtStatus = Type.Enum(['katagi', 'underground', 'bankrupt'] as const);
export type FinanceDebtStatus = Static<typeof FinanceDebtStatus>;

export const FinanceBankView = Type.Object({
  balance: Pelica,
  debt: Pelica,
  deposit: Pelica,
  status: FinanceDebtStatus,
  /** True from the moment debt reaches `graceDebt` until the 24 h window ends. */
  inGrace: Type.Boolean(),
  graceUntil: Type.Union([EpochMs, Type.Null()]),
  blacklistUntil: Type.Union([EpochMs, Type.Null()]),
  /** Debt that opens the bankruptcy grace window. */
  graceDebt: Pelica,
  bank: Type.Object({
    cash: Type.Integer(),
    available: Type.Integer(),
    /** Reserve ratio θ, null while the bank has no liabilities. */
    ratio: Type.Union([Type.Number(), Type.Null()]),
    level: Type.String(),
    trustRate: Type.Number(),
  }),
});
export type FinanceBankView = Static<typeof FinanceBankView>;

export const FinanceRepayRequest = Type.Object({ ...idem, amount: Type.Optional(Amount) }, closed);
export type FinanceRepayRequest = Static<typeof FinanceRepayRequest>;

// ---- player loans ----

export const FINANCE_LOAN_STATUSES = [
  'offer',
  'request',
  'active',
  'overdue',
  'repaid',
  'discharged',
  'declined',
  'cancelled',
  'expired',
] as const;

export const FinanceLoanView = Type.Object({
  id: RecordId,
  /** What the signed-in player is in this loan; `open` is somebody else's request to fund. */
  role: Type.Enum(['lender', 'borrower', 'open'] as const),
  /** The other side; null for an open request that has no lender yet. */
  counterparty: Type.Union([FinancePerson, Type.Null()]),
  status: Type.Enum(FINANCE_LOAN_STATUSES),
  principal: Pelica,
  rateBps: Type.Integer(),
  termDays: Type.Integer(),
  paid: Pelica,
  remaining: Pelica,
  dueAt: Type.Union([EpochMs, Type.Null()]),
  offerExpiresAt: EpochMs,
});
export type FinanceLoanView = Static<typeof FinanceLoanView>;

export const FinanceLoansView = Type.Object({
  loans: Type.Array(FinanceLoanView),
  limits: Type.Object({
    minPrincipal: Pelica,
    minTermDays: Type.Integer(),
    maxTermDays: Type.Integer(),
  }),
});
export type FinanceLoansView = Static<typeof FinanceLoansView>;

const LoanTerms = {
  principal: Amount,
  /** Daily simple interest in basis points (10 bps = 0.1 % a day). */
  rateBps: Type.Integer({ minimum: 0, maximum: 10_000 }),
  termDays: Type.Integer({ minimum: 1, maximum: 365 }),
};
export const FinanceLoanOfferRequest = Type.Object(
  { ...idem, borrowerId: Snowflake, ...LoanTerms },
  closed,
);
export type FinanceLoanOfferRequest = Static<typeof FinanceLoanOfferRequest>;
export const FinanceLoanAskRequest = Type.Object({ ...idem, ...LoanTerms }, closed);
export type FinanceLoanAskRequest = Static<typeof FinanceLoanAskRequest>;
/** Accept (borrower), lend (lender of a request), decline, cancel: all name one loan. */
export const FinanceLoanRefRequest = Type.Object({ ...idem, loanId: RecordId }, closed);
export type FinanceLoanRefRequest = Static<typeof FinanceLoanRefRequest>;
export const FinanceLoanRepayRequest = Type.Object(
  { ...idem, loanId: RecordId, amount: Type.Optional(Amount) },
  closed,
);
export type FinanceLoanRepayRequest = Static<typeof FinanceLoanRepayRequest>;

// ---- Kyosai ----

export const FinanceKyosaiView = Type.Object({
  total: Type.Integer(),
  house: Type.Integer(),
  circulating: Type.Integer(),
  holders: Type.Integer(),
  /** Units the signed-in player holds. */
  units: Type.Integer(),
  pool: Pelica,
  /** Trust premium in basis points of the daily rate. */
  premiumBps: Type.Number(),
  ratio: Type.Union([Type.Number(), Type.Null()]),
  /** The liquidity gate is shut: no bids or unit offers. */
  locked: Type.Boolean(),
  auction: Type.Union([
    Type.Object({
      id: RecordId,
      units: Type.Integer(),
      topBid: Pelica,
      topBidder: Type.Union([FinancePerson, Type.Null()]),
      youAreTop: Type.Boolean(),
      endsAt: EpochMs,
    }),
    Type.Null(),
  ]),
  motions: Type.Array(
    Type.Object({
      id: RecordId,
      proposer: FinancePerson,
      premiumBps: Type.Number(),
      yesUnits: Type.Integer(),
      noUnits: Type.Integer(),
      circulatingUnits: Type.Integer(),
      closesAt: EpochMs,
    }),
  ),
  offers: Type.Array(
    Type.Object({
      id: RecordId,
      direction: Type.Enum(['incoming', 'outgoing'] as const),
      counterparty: FinancePerson,
      units: Type.Integer(),
      price: Pelica,
      expiresAt: EpochMs,
    }),
  ),
});
export type FinanceKyosaiView = Static<typeof FinanceKyosaiView>;

export const FinanceKyosaiBidRequest = Type.Object({ ...idem, amount: Amount }, closed);
export const FinanceKyosaiOfferRequest = Type.Object(
  {
    ...idem,
    buyerId: Snowflake,
    units: Type.Integer({ minimum: 1, maximum: 10_000 }),
    price: Type.Integer({ minimum: 0, maximum: 1_000_000_000 }),
  },
  closed,
);
export const FinanceKyosaiOfferRefRequest = Type.Object({ ...idem, offerId: RecordId }, closed);
export const FinanceKyosaiProposeRequest = Type.Object(
  { ...idem, premiumBps: Type.Number({ minimum: 0, maximum: 1_000_000 }) },
  closed,
);
export const FinanceKyosaiVoteRequest = Type.Object(
  { ...idem, motionId: RecordId, yes: Type.Boolean() },
  closed,
);
export type FinanceKyosaiBidRequest = Static<typeof FinanceKyosaiBidRequest>;
export type FinanceKyosaiOfferRequest = Static<typeof FinanceKyosaiOfferRequest>;
export type FinanceKyosaiOfferRefRequest = Static<typeof FinanceKyosaiOfferRefRequest>;
export type FinanceKyosaiProposeRequest = Static<typeof FinanceKyosaiProposeRequest>;
export type FinanceKyosaiVoteRequest = Static<typeof FinanceKyosaiVoteRequest>;

// ---- securities market ----

export const FinanceSymbolView = Type.Object({
  key: FinanceSymbol,
  name: Type.String(),
  priceMicros: Type.Integer(),
  /** The 24 h reference price the daily limit is measured from. */
  refMicros: Type.Union([Type.Integer(), Type.Null()]),
  /** Change against the reference in basis points. */
  changeBps: Type.Integer(),
  /** Oldest first, micro-Pelica; feeds the pixel chart. */
  history: Type.Array(Type.Integer()),
  /** -1 stop-low, +1 stop-high, 0 free. */
  pin: Type.Integer({ minimum: -1, maximum: 1 }),
});
export type FinanceSymbolView = Static<typeof FinanceSymbolView>;

export const FinanceMarketView = Type.Object({
  symbols: Type.Array(FinanceSymbolView),
  spot: Type.Array(
    Type.Object({
      symbol: FinanceSymbol,
      unitsMilli: Type.Integer(),
      cost: Pelica,
      value: Pelica,
    }),
  ),
  margin: Type.Array(
    Type.Object({
      symbol: FinanceSymbol,
      side: Type.Enum(['long', 'short'] as const),
      unitsMilli: Type.Integer(),
      margin: Pelica,
      openedAt: EpochMs,
    }),
  ),
  options: Type.Array(
    Type.Object({
      id: RecordId,
      side: Type.Enum(['long', 'short'] as const),
      kind: Type.Enum(['call', 'put', 'pair'] as const),
      symbol: FinanceSymbol,
      symbolB: Type.Union([FinanceSymbol, Type.Null()]),
      unitsMilli: Type.Integer(),
      premium: Pelica,
      margin: Pelica,
      expiresAt: EpochMs,
    }),
  ),
  bonds: Type.Array(
    Type.Object({
      id: RecordId,
      kind: Type.Enum(['normal', 'junk'] as const),
      principal: Pelica,
      rateBps: Type.Integer(),
      dueAt: EpochMs,
    }),
  ),
  /** Cross-margin health; `required` is 0 without margin positions. */
  portfolio: Type.Object({ equity: Type.Number(), required: Type.Number() }),
  limits: Type.Object({
    minMargin: Pelica,
    leverages: Type.Array(Type.Integer()),
    bondMin: Pelica,
    bonds: Type.Array(
      Type.Object({
        key: Type.Enum(['normal', 'junk'] as const),
        hours: Type.Integer(),
        ratePct: Type.Number(),
        maxTotal: Pelica,
        sellable: Type.Boolean(),
      }),
    ),
  }),
});
export type FinanceMarketView = Static<typeof FinanceMarketView>;

export const FinanceSpotRequest = Type.Object(
  { ...idem, symbol: FinanceSymbol, amount: Amount },
  closed,
);
export const FinanceMarginRequest = Type.Object(
  {
    ...idem,
    symbol: FinanceSymbol,
    side: Type.Enum(['long', 'short'] as const),
    amount: Amount,
    leverage: Type.Integer({ minimum: 1, maximum: 10 }),
  },
  closed,
);
export const FinanceOptionRequest = Type.Object(
  {
    ...idem,
    kind: Type.Enum(['call', 'put', 'pair'] as const),
    symbol: FinanceSymbol,
    /** Required for `pair`. */
    symbolB: Type.Optional(FinanceSymbol),
    /** Premium to pay in Pelica. */
    premium: Amount,
    targetPct: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  closed,
);
export const FinanceBondRequest = Type.Object(
  { ...idem, kind: Type.Enum(['normal', 'junk'] as const), amount: Amount },
  closed,
);
/** `position` is `spot:<symbol>`, `long:<symbol>`, `short:<symbol>`, `option:<id>` or `bond:<id>`. */
export const FinanceSettleRequest = Type.Object(
  {
    ...idem,
    position: Type.String({
      pattern: '^(spot|long|short):[a-z]{2,8}$|^(option|bond):[0-9]{1,12}$',
    }),
    percent: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  closed,
);
export type FinanceSpotRequest = Static<typeof FinanceSpotRequest>;
export type FinanceMarginRequest = Static<typeof FinanceMarginRequest>;
export type FinanceOptionRequest = Static<typeof FinanceOptionRequest>;
export type FinanceBondRequest = Static<typeof FinanceBondRequest>;
export type FinanceSettleRequest = Static<typeof FinanceSettleRequest>;

// ---- companies ----

export const FinanceCompanyView = Type.Object({
  name: Type.String(),
  kind: FinanceCompanyKind,
  level: Type.Integer(),
  funds: Type.Integer(),
  invested: Type.Integer(),
  upgradeCost: Type.Union([Pelica, Type.Null()]),
  upkeep: Pelica,
  unpaidDays: Type.Integer(),
  dailyOutput: Type.Integer(),
  stockValue: Type.Integer(),
  condition: Type.String(),
  dividendRateBps: Type.Integer(),
  stakeCap: Type.Integer(),
  stakesTotal: Type.Integer(),
  investors: Type.Integer(),
  withdrawable: Type.Integer(),
});
export type FinanceCompanyView = Static<typeof FinanceCompanyView>;

export const FinanceCompaniesView = Type.Object({
  mine: Type.Union([FinanceCompanyView, Type.Null()]),
  /** Stakes the signed-in player holds in other people's companies. */
  holdings: Type.Array(
    Type.Object({
      owner: FinancePerson,
      name: Type.String(),
      level: Type.Integer(),
      amount: Pelica,
      value: Pelica,
      dividendRateBps: Type.Integer(),
    }),
  ),
  /** Other players' companies that take stakes. */
  others: Type.Array(
    Type.Object({
      owner: FinancePerson,
      name: Type.String(),
      kind: FinanceCompanyKind,
      level: Type.Integer(),
      dividendRateBps: Type.Integer(),
      room: Pelica,
    }),
  ),
  foundCost: Pelica,
  stakeMin: Pelica,
  dividendMaxBps: Type.Integer(),
});
export type FinanceCompaniesView = Static<typeof FinanceCompaniesView>;

export const FinanceCompanyFoundRequest = Type.Object(
  { ...idem, name: Type.String({ minLength: 1, maxLength: 24 }), kind: FinanceCompanyKind },
  closed,
);
export const FinanceCompanyInvestRequest = Type.Object(
  { ...idem, ownerId: Snowflake, amount: Amount },
  closed,
);
export const FinanceCompanyFundRequest = Type.Object({ ...idem, amount: Amount }, closed);
export const FinanceCompanyDividendRequest = Type.Object(
  { ...idem, rateBps: Type.Integer({ minimum: 0, maximum: 10_000 }) },
  closed,
);
export type FinanceCompanyFoundRequest = Static<typeof FinanceCompanyFoundRequest>;
export type FinanceCompanyInvestRequest = Static<typeof FinanceCompanyInvestRequest>;
export type FinanceCompanyFundRequest = Static<typeof FinanceCompanyFundRequest>;
export type FinanceCompanyDividendRequest = Static<typeof FinanceCompanyDividendRequest>;

// ---- player market ----

/**
 * Seller of a listing: a player, or Teiai (`id` is `TEIAI_SELLER_ID`, which is not a snowflake;
 * screens show their own "Teiai" label for it).
 */
export const FinanceListingSeller = Type.Object({
  id: Type.String({ pattern: '^[0-9]{1,20}$' }),
  name: Type.String(),
});
export type FinanceListingSeller = Static<typeof FinanceListingSeller>;

export const FinanceListingView = Type.Object({
  id: RecordId,
  seller: FinanceListingSeller,
  kind: Type.Enum(['item', 'horse'] as const),
  ref: Type.String(),
  /** Catalog name of an item in both languages; null for horses and ids without a catalog entry. */
  name: Type.Union([Type.Object({ en: Type.String(), ja: Type.String() }), Type.Null()]),
  qty: Type.Integer(),
  mode: Type.Enum(['fixed', 'auction'] as const),
  price: Pelica,
  bid: Pelica,
  topBidder: Type.Union([FinancePerson, Type.Null()]),
  youAreTop: Type.Boolean(),
  mine: Type.Boolean(),
  endAt: EpochMs,
  minNextBid: Pelica,
});
export type FinanceListingView = Static<typeof FinanceListingView>;

/** One tradable item the caller owns (the inventory picker of the listing form). */
export const FinanceSellableItem = Type.Object({
  ref: Type.String(),
  name: Type.Union([Type.Object({ en: Type.String(), ja: Type.String() }), Type.Null()]),
  qty: Type.Integer({ minimum: 1 }),
  /** Reference value of one unit; the allowed price range is a multiple of it. */
  unitValue: Pelica,
});
export type FinanceSellableItem = Static<typeof FinanceSellableItem>;

export const FinanceListingsView = Type.Object({
  listings: Type.Array(FinanceListingView),
  feeBps: Type.Integer(),
  /** Tradable items the caller owns, with quantities; empty when there is nothing to sell. */
  sellable: Type.Array(FinanceSellableItem),
  /** Listings one player may keep open at once. */
  maxActive: Type.Integer({ minimum: 1 }),
  /** Allowed auction lengths in hours. */
  auctionHours: Type.Array(Type.Integer({ minimum: 1 })),
  /** How long a fixed-price listing stays open. */
  fixedDays: Type.Integer({ minimum: 1 }),
});
export type FinanceListingsView = Static<typeof FinanceListingsView>;

export const FinanceListingRefRequest = Type.Object({ ...idem, listingId: RecordId }, closed);
export const FinanceListingBidRequest = Type.Object(
  { ...idem, listingId: RecordId, amount: Amount },
  closed,
);
export const FinanceListingCreateRequest = Type.Object(
  {
    ...idem,
    ref: Type.String({ minLength: 1, maxLength: 64 }),
    qty: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
    mode: Type.Enum(['fixed', 'auction'] as const),
    price: Amount,
    /** Auction length; ignored for fixed-price listings. */
    hours: Type.Optional(Type.Integer({ minimum: 1, maximum: 72 })),
  },
  closed,
);
export type FinanceListingCreateRequest = Static<typeof FinanceListingCreateRequest>;
export type FinanceListingRefRequest = Static<typeof FinanceListingRefRequest>;
export type FinanceListingBidRequest = Static<typeof FinanceListingBidRequest>;
