import type { ReactElement } from 'react';
import type {
  CasinoOverview,
  DailyClaimResponse,
  DailyStatus,
  GameId,
  HistoryPage,
  TableSnapshot,
} from '@casino/shared';
import type { CasinoApi } from './api.ts';
import {
  GameError,
  type BetOutcome,
  type BetRequest,
  type CasinoClient,
  type TableListener,
} from './client.ts';
import { CasinoProvider } from './services.tsx';

export interface RecordedBet {
  game: GameId;
  request: BetRequest;
}
export interface RecordedAction {
  game: GameId;
  roundId: string;
  action: string;
  args?: Record<string, unknown> | undefined;
}

/** A scripted client: answers are queued per call; table snapshots are pushed by the test. */
export class FakeClient implements CasinoClient {
  bets: RecordedBet[] = [];
  actions: RecordedAction[] = [];
  watched: GameId[] = [];
  unwatched: GameId[] = [];
  private answers: (BetOutcome<unknown> | GameError)[] = [];
  private listeners = new Map<GameId, Set<TableListener>>();

  /** The next bet or action answers with this (an error is thrown instead). */
  answer<T>(result: T, extra: { balance?: number; roundId?: string } = {}): this {
    this.answers.push({
      balance: extra.balance ?? 1_000,
      roundId: extra.roundId,
      result,
      replayed: false,
    });
    return this;
  }

  fail(code: ConstructorParameters<typeof GameError>[0], offline = false): this {
    this.answers.push(new GameError(code, { offline }));
    return this;
  }

  private next<T>(): Promise<BetOutcome<T>> {
    const answer = this.answers.shift();
    if (!answer) return Promise.reject(new Error('no scripted answer'));
    return answer instanceof GameError
      ? Promise.reject(answer)
      : Promise.resolve(answer as BetOutcome<T>);
  }

  bet<T>(game: GameId, request: BetRequest): Promise<BetOutcome<T>> {
    this.bets.push({ game, request });
    return this.next<T>();
  }

  action<T>(
    game: GameId,
    roundId: string,
    action: string,
    args?: Record<string, unknown>,
  ): Promise<BetOutcome<T>> {
    this.actions.push({ game, roundId, action, ...(args ? { args } : {}) });
    return this.next<T>();
  }

  watchTable(game: GameId, listener: TableListener): () => void {
    this.watched.push(game);
    const set = this.listeners.get(game) ?? new Set<TableListener>();
    set.add(listener);
    this.listeners.set(game, set);
    return () => {
      set.delete(listener);
      this.unwatched.push(game);
    };
  }

  clockOffsetMs = () => 0;

  /** The server pushes a table snapshot. */
  push(snapshot: TableSnapshot): void {
    for (const l of this.listeners.get(snapshot.game) ?? []) l(snapshot);
  }
}

export const OVERVIEW: CasinoOverview = {
  minBet: 10,
  jackpotPool: 48_200,
  disabled: [],
  recent: [
    { roundId: 'r1', game: 'slots', stake: 100, payout: 0, net: -100, settledAt: 1 },
    { roundId: 'r2', game: 'chinchiro', stake: 50, payout: 100, net: 50, settledAt: 2 },
  ],
};

export function fakeApi(patch: Partial<CasinoApi> = {}): CasinoApi & { claims: string[] } {
  const claims: string[] = [];
  const api: CasinoApi = {
    overview: () => Promise.resolve(OVERVIEW),
    daily: () => Promise.resolve<DailyStatus>({ claimable: true, nextSlotAt: 1_000, streak: 3 }),
    claimDaily: (key) => {
      claims.push(key ?? '');
      return Promise.resolve<DailyClaimResponse>({
        replayed: false,
        amount: 1_300,
        skimmed: 0,
        repaid: 0,
        streak: 4,
        boosted: false,
        guarded: 0,
        balance: 5_300,
        nextSlotAt: Date.now() + 5 * 3_600_000,
      });
    },
    history: () => Promise.resolve<HistoryPage>({ items: [], nextBefore: null }),
    ...patch,
  };
  return Object.assign(api, { claims });
}

export function withServices(
  ui: ReactElement,
  services: { api?: CasinoApi; client?: CasinoClient } = {},
): { element: ReactElement; client: FakeClient; api: CasinoApi } {
  const client = (services.client as FakeClient | undefined) ?? new FakeClient();
  const api = services.api ?? fakeApi();
  return {
    element: <CasinoProvider services={{ api, client }}>{ui}</CasinoProvider>,
    client: client as FakeClient,
    api,
  };
}

export function tableSnapshot(
  game: GameId,
  phase: string,
  data: unknown,
  extra: Partial<TableSnapshot> = {},
): TableSnapshot {
  return {
    guildId: '100000000000000001',
    instanceId: 'i-1',
    game,
    seq: 1,
    roundId: phase === 'idle' ? null : 'tbl-1',
    phase,
    seats: [],
    data,
    ...extra,
  };
}

/** Skip every animation: the screens read this flag at the start of each one. */
export function reduceMotion(on = true): void {
  if (on) document.documentElement.setAttribute('data-reduced-motion', 'true');
  else document.documentElement.removeAttribute('data-reduced-motion');
}

export const settlement = (
  net: number,
  stake = 100,
  game: 'slots' | 'chinchiro' | 'pachinko' | 'blackjack' | 'roulette' = 'slots',
) => ({
  roundId: 'r-test',
  game,
  stake,
  payout: Math.max(0, stake + net),
  net,
  eventBonus: 0,
  insured: 0,
  penalty: 0,
  penaltyShortfall: 0,
  withheld: 0,
  jackpot: 0,
  jackpotPool: 48_200,
  balance: 1_000,
  tier: null,
});

// ---- helpers for the screen tests -------------------------------------------------------

import { act } from 'react';
import { useBalanceStore } from '../../shell/stores/balance.ts';
import { useSessionStore } from '../../shell/stores/session.ts';
import { useSettingsStore } from '../../shell/stores/settings.ts';
import { GUILD, USER_ID, flush, resetStores } from '../../shell/testing/fakes.ts';

export { GUILD, USER_ID };

/** Fresh stores, motion off, a signed-in user with 5,000 Pelica. */
export function prepare(options: { language?: 'ja'; balance?: number } = {}): void {
  resetStores();
  reduceMotion(true);
  useBalanceStore.getState().set(options.balance ?? 5_000);
  useSessionStore.getState().authenticated({
    user: { id: USER_ID, username: 'p', globalName: 'Player', avatar: null },
    guildId: GUILD,
    instanceId: 'i-1',
    sessionToken: 't',
    expiresAt: 1e13,
    guildLocale: 'en',
  });
  if (options.language) useSettingsStore.getState().update({ language: options.language });
}

export const buttons = (root: ParentNode) => [
  ...root.querySelectorAll<HTMLButtonElement>('button'),
];

export function button(root: ParentNode, text: string | RegExp): HTMLButtonElement {
  const found = buttons(root).find((b) => {
    const label = (b.textContent ?? '').trim();
    return typeof text === 'string' ? label === text : text.test(label);
  });
  if (!found)
    throw new Error(
      `no button "${String(text)}" in: ${buttons(root)
        .map((b) => b.textContent)
        .join(' | ')}`,
    );
  return found;
}

export function byLabel(root: ParentNode, label: string): HTMLButtonElement {
  const found = root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!found) throw new Error(`no button labelled "${label}"`);
  return found;
}

export async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.click();
    await flush();
  });
}

export async function settle(): Promise<void> {
  await act(async () => {
    await flush();
    await flush();
  });
}

export const text = (root: ParentNode) => root.textContent ?? '';
