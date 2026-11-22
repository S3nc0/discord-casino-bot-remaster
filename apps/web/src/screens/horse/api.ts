import {
  ARENA_ROUTES,
  ERROR_CODES,
  HORSE_ROUTES,
  type ArenaBetRequest,
  type ArenaBetResponse,
  type ArenaToday,
  type ErrorCode,
  type HorseBetRequest,
  type HorseBetResponse,
  type HorseBreedPreview,
  type HorseBreedRequest,
  type HorseBreedResponse,
  type HorseCard,
  type HorseCarrotRequest,
  type HorseCreateRequest,
  type HorseEntryRequest,
  type HorseGoldCarrotRequest,
  type HorseRaceDetail,
  type HorseRetireRequest,
  type HorseRetireResponse,
  type HorseStable,
  type HorseStyleRequest,
  type HorseTimeline,
  type HorseWriteResponse,
} from '@casino/shared';

/** A request the server refused. `rule` is the game rule behind a 4xx, when there is one. */
export class HorseApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly rule: string | undefined;
  readonly params: Record<string, string | number>;
  readonly retryAfterMs: number | undefined;
  constructor(
    code: ErrorCode,
    status: number,
    rule?: string,
    params: Record<string, string | number> = {},
    retryAfterMs?: number,
  ) {
    super(rule ?? code);
    this.name = 'HorseApiError';
    this.code = code;
    this.status = status;
    this.rule = rule;
    this.params = params;
    this.retryAfterMs = retryAfterMs;
  }
}

type Without<T> = Omit<T, 'idempotencyKey'>;

/** Every call of the horse and arena screens. Writes get a fresh idempotency key per intent. */
export interface HorseApi {
  stable(): Promise<HorseStable>;
  createHorse(intent: Without<HorseCreateRequest>, key: string): Promise<HorseWriteResponse>;
  carrot(intent: Without<HorseCarrotRequest>, key: string): Promise<HorseWriteResponse>;
  goldCarrot(intent: Without<HorseGoldCarrotRequest>, key: string): Promise<HorseWriteResponse>;
  style(intent: Without<HorseStyleRequest>, key: string): Promise<HorseWriteResponse>;
  retire(intent: Without<HorseRetireRequest>, key: string): Promise<HorseRetireResponse>;
  breedPreview(a: number, b: number): Promise<HorseBreedPreview>;
  breed(intent: Without<HorseBreedRequest>, key: string): Promise<HorseBreedResponse>;
  card(): Promise<HorseCard>;
  race(id: number): Promise<HorseRaceDetail>;
  timeline(id: number): Promise<HorseTimeline>;
  enter(
    raceId: number,
    intent: Without<HorseEntryRequest>,
    key: string,
  ): Promise<HorseWriteResponse>;
  withdraw(
    raceId: number,
    intent: Without<HorseEntryRequest>,
    key: string,
  ): Promise<HorseWriteResponse>;
  bet(raceId: number, intent: Without<HorseBetRequest>, key: string): Promise<HorseBetResponse>;
  arena(): Promise<ArenaToday>;
  arenaBet(intent: Without<ArenaBetRequest>, key: string): Promise<ArenaBetResponse>;
}

export interface HorseHttpOptions {
  /** `/.proxy` inside Discord, empty in dev. */
  prefix: string;
  getSessionToken: () => string | null;
  fetchImpl?: typeof fetch;
}

const isErrorCode = (value: unknown): value is ErrorCode =>
  typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);

const withId = (route: string, id: number): string => route.replace(':id', String(id));

export function createHorseHttpApi({
  prefix,
  getSessionToken,
  fetchImpl,
}: HorseHttpOptions): HorseApi {
  async function call<T>(method: 'GET' | 'POST', path: string, body?: object): Promise<T> {
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
      throw new HorseApiError('internal', 0);
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
      throw new HorseApiError(
        code,
        response.status,
        typeof p.rule === 'string' ? p.rule : undefined,
        p.params && typeof p.params === 'object'
          ? (p.params as Record<string, string | number>)
          : {},
        typeof p.retryAfterMs === 'number' ? p.retryAfterMs : undefined,
      );
    }
    return payload as T;
  }
  const post = <T>(path: string, intent: object, key: string) =>
    call<T>('POST', path, { ...intent, idempotencyKey: key });

  return {
    stable: () => call('GET', HORSE_ROUTES.stable),
    createHorse: (i, k) => post(HORSE_ROUTES.create, i, k),
    carrot: (i, k) => post(HORSE_ROUTES.carrot, i, k),
    goldCarrot: (i, k) => post(HORSE_ROUTES.goldCarrot, i, k),
    style: (i, k) => post(HORSE_ROUTES.style, i, k),
    retire: (i, k) => post(HORSE_ROUTES.retire, i, k),
    breedPreview: (a, b) => call('GET', `${HORSE_ROUTES.breedPreview}?a=${a}&b=${b}`),
    breed: (i, k) => post(HORSE_ROUTES.breed, i, k),
    card: () => call('GET', HORSE_ROUTES.card),
    race: (id) => call('GET', withId(HORSE_ROUTES.race, id)),
    timeline: (id) => call('GET', withId(HORSE_ROUTES.timeline, id)),
    enter: (id, i, k) => post(withId(HORSE_ROUTES.enter, id), i, k),
    withdraw: (id, i, k) => post(withId(HORSE_ROUTES.withdraw, id), i, k),
    bet: (id, i, k) => post(withId(HORSE_ROUTES.bet, id), i, k),
    arena: () => call('GET', ARENA_ROUTES.today),
    arenaBet: (i, k) => post(ARENA_ROUTES.bet, i, k),
  };
}

/** A fresh key per intent; a retry of the same intent reuses it. */
export function newKey(): string {
  return globalThis.crypto.randomUUID();
}
