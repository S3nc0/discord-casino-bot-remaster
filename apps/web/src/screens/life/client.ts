import {
  ERROR_CODES,
  LIFE_ROUTES,
  type ErrorCode,
  type LotteryView,
  type MissionsView,
  type PollCreateRequest,
  type PollsView,
  type PollWriteResponse,
  type QuizAnswerResponse,
  type QuizPostRequest,
  type QuizPostResponse,
  type QuizView,
  type RankingView,
  type ShopBuyResponse,
  type ShopView,
  type ToolWire,
  type TransferMembers,
  type TransferPreview,
  type TransferSendResponse,
  type TransferView,
  type WorkClickResponse,
  type WorkCollectResponse,
  type WorkDrinkResponse,
  type WorkHireResponse,
  type WorkMergeResponse,
  type WorkRanking,
  type WorkUpgradeResponse,
  type WorkView,
  type WorkerKindWire,
  type LifeWriteResponse,
} from '@casino/shared';

/** A refusal from a life route: the generic `code`, and the game `rule` (with `params`) if any. */
export class LifeApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly rule: string | undefined;
  readonly params: Record<string, string | number> | undefined;
  readonly retryAfterMs: number | undefined;
  constructor(
    code: ErrorCode,
    status: number,
    extra: { rule?: string; params?: Record<string, string | number>; retryAfterMs?: number } = {},
  ) {
    super(extra.rule ?? code);
    this.name = 'LifeApiError';
    this.code = code;
    this.status = status;
    this.rule = extra.rule;
    this.params = extra.params;
    this.retryAfterMs = extra.retryAfterMs;
  }
  /** The server may not have seen the request (offline, proxy or server error): safe to retry with the same key. */
  get transient(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

/** Every call the life screens make. Writes take the idempotency key as their last argument. */
export interface LifeApi {
  work(): Promise<WorkView>;
  workClick(key: string): Promise<WorkClickResponse>;
  workCollect(key: string): Promise<WorkCollectResponse>;
  workDrink(key: string): Promise<WorkDrinkResponse>;
  workUpgrade(tool: ToolWire | 'dorm', key: string): Promise<WorkUpgradeResponse>;
  workHire(kind: WorkerKindWire, key: string): Promise<WorkHireResponse>;
  workDismiss(kind: WorkerKindWire, key: string): Promise<LifeWriteResponse>;
  workRenew(renew: boolean, key: string): Promise<LifeWriteResponse>;
  workMerge(itemId: string, key: string): Promise<WorkMergeResponse>;
  workRanking(period: 'total' | 'today'): Promise<WorkRanking>;
  quiz(): Promise<QuizView>;
  quizAnswer(quizId: number, choice: number, key: string): Promise<QuizAnswerResponse>;
  quizPost(input: Omit<QuizPostRequest, 'idempotencyKey'>, key: string): Promise<QuizPostResponse>;
  quizWithdraw(quizId: number, key: string): Promise<LifeWriteResponse>;
  lottery(): Promise<LotteryView>;
  lotteryJoin(raffleId: number, key: string): Promise<LifeWriteResponse>;
  polls(): Promise<PollsView>;
  pollCreate(
    input: Omit<PollCreateRequest, 'idempotencyKey'>,
    key: string,
  ): Promise<PollWriteResponse>;
  pollVote(pollId: number, yes: boolean, key: string): Promise<PollWriteResponse>;
  shop(): Promise<ShopView>;
  shopBuy(itemId: string, qty: number | undefined, key: string): Promise<ShopBuyResponse>;
  shopMarketBuy(lotId: number, key: string): Promise<ShopBuyResponse>;
  shopSeizedBuy(lotId: number, key: string): Promise<ShopBuyResponse>;
  missions(): Promise<MissionsView>;
  ranking(): Promise<RankingView>;
  transfer(): Promise<TransferView>;
  transferMembers(q: string): Promise<TransferMembers>;
  transferPreview(receiverId: string, amount: number): Promise<TransferPreview>;
  transferSend(receiverId: string, amount: number, key: string): Promise<TransferSendResponse>;
}

export type LifeApiMethod = keyof LifeApi;

export interface HttpLifeApiOptions {
  /** Path prefix in front of the routes (`/.proxy` inside Discord). */
  prefix: string;
  getSessionToken: () => string | null;
  fetchImpl?: typeof fetch;
}

const isErrorCode = (v: unknown): v is ErrorCode =>
  typeof v === 'string' && (ERROR_CODES as readonly string[]).includes(v);

export function createHttpLifeApi({
  prefix,
  getSessionToken,
  fetchImpl,
}: HttpLifeApiOptions): LifeApi {
  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const token = getSessionToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    let response: Response;
    try {
      response = await (fetchImpl ?? fetch)(`${prefix}${path}`, init);
    } catch {
      throw new LifeApiError('internal', 0);
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const p = (payload ?? {}) as {
        error?: unknown;
        rule?: unknown;
        params?: unknown;
        retryAfterMs?: unknown;
      };
      const code: ErrorCode = isErrorCode(p.error)
        ? p.error
        : response.status === 401
          ? 'unauthorized'
          : 'internal';
      throw new LifeApiError(code, response.status, {
        ...(typeof p.rule === 'string' ? { rule: p.rule } : {}),
        ...(p.params && typeof p.params === 'object'
          ? { params: p.params as Record<string, string | number> }
          : {}),
        ...(typeof p.retryAfterMs === 'number' ? { retryAfterMs: p.retryAfterMs } : {}),
      });
    }
    return payload as T;
  }
  const post = <T>(path: string, body: object) => call<T>('POST', path, body);
  const query = (path: string, params: Record<string, string>) =>
    `${path}?${new URLSearchParams(params).toString()}`;

  return {
    work: () => call('GET', LIFE_ROUTES.work),
    workClick: (k) => post(LIFE_ROUTES.workClick, { idempotencyKey: k }),
    workCollect: (k) => post(LIFE_ROUTES.workCollect, { idempotencyKey: k }),
    workDrink: (k) => post(LIFE_ROUTES.workDrink, { idempotencyKey: k }),
    workUpgrade: (tool, k) => post(LIFE_ROUTES.workUpgrade, { idempotencyKey: k, tool }),
    workHire: (kind, k) => post(LIFE_ROUTES.workHire, { idempotencyKey: k, kind }),
    workDismiss: (kind, k) => post(LIFE_ROUTES.workDismiss, { idempotencyKey: k, kind }),
    workRenew: (renew, k) => post(LIFE_ROUTES.workRenew, { idempotencyKey: k, renew }),
    workMerge: (itemId, k) => post(LIFE_ROUTES.workMerge, { idempotencyKey: k, itemId }),
    workRanking: (period) => call('GET', query(LIFE_ROUTES.workRanking, { period })),
    quiz: () => call('GET', LIFE_ROUTES.quiz),
    quizAnswer: (quizId, choice, k) =>
      post(LIFE_ROUTES.quizAnswer, { idempotencyKey: k, quizId, choice }),
    quizPost: (input, k) => post(LIFE_ROUTES.quizPost, { ...input, idempotencyKey: k }),
    quizWithdraw: (quizId, k) => post(LIFE_ROUTES.quizWithdraw, { idempotencyKey: k, quizId }),
    lottery: () => call('GET', LIFE_ROUTES.lottery),
    lotteryJoin: (raffleId, k) => post(LIFE_ROUTES.lotteryJoin, { idempotencyKey: k, raffleId }),
    polls: () => call('GET', LIFE_ROUTES.polls),
    pollCreate: (input, k) => post(LIFE_ROUTES.pollCreate, { ...input, idempotencyKey: k }),
    pollVote: (pollId, yes, k) => post(LIFE_ROUTES.pollVote, { idempotencyKey: k, pollId, yes }),
    shop: () => call('GET', LIFE_ROUTES.shop),
    shopBuy: (itemId, qty, k) =>
      post(LIFE_ROUTES.shopBuy, {
        idempotencyKey: k,
        itemId,
        ...(qty === undefined ? {} : { qty }),
      }),
    shopMarketBuy: (lotId, k) => post(LIFE_ROUTES.shopMarketBuy, { idempotencyKey: k, lotId }),
    shopSeizedBuy: (lotId, k) => post(LIFE_ROUTES.shopSeizedBuy, { idempotencyKey: k, lotId }),
    missions: () => call('GET', LIFE_ROUTES.missions),
    ranking: () => call('GET', LIFE_ROUTES.ranking),
    transfer: () => call('GET', LIFE_ROUTES.transfer),
    transferMembers: (q) => call('GET', query(LIFE_ROUTES.transferMembers, { q })),
    transferPreview: (receiverId, amount) =>
      post(LIFE_ROUTES.transferPreview, { receiverId, amount }),
    transferSend: (receiverId, amount, k) =>
      post(LIFE_ROUTES.transferSend, { idempotencyKey: k, receiverId, amount }),
  };
}
