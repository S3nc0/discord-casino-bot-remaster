// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STREAM_LIMITS,
  STREAM_TIP_TIERS,
  streamOddsBps,
  streamTipColor,
  type AckResult,
  type DomainEvent,
  type StreamBetResponse,
  type StreamEndResponse,
  type StreamList,
  type StreamRoundView,
  type StreamSettleResponse,
  type StreamSettleResult,
  type StreamStartResponse,
  type StreamTipResponse,
  type StreamView,
  type StreamWriteResponse,
  type TransferView,
} from '@casino/shared';
import { ThemeProvider } from '@casino/ui';
import { RuntimeContext, ShellRuntime } from '../../shell/runtime.ts';
import { createMockApi } from '../../shell/mockApi.ts';
import { useBalanceStore } from '../../shell/stores/balance.ts';
import { useSessionStore } from '../../shell/stores/session.ts';
import { useSettingsStore } from '../../shell/stores/settings.ts';
import { useToastStore } from '../../shell/stores/toasts.ts';
import { fakeSdk, type FakeSdk } from '../../shell/testing/fakes.ts';
import { render, type Rendered } from '../../shell/testing/render.tsx';
import type { CasinoSocket } from '../../shell/socket.ts';
import {
  StreamApiError,
  createStreamSocket,
  type StreamApi,
  type StreamDomainEvent,
  type StreamSocket,
} from './client.ts';
import { calcTipFee, formatOdds, tipTierFor } from './helpers.ts';
import { StreamProvider, type StreamServices } from './services.tsx';
import StreamScreen from './StreamScreen.tsx';

const NOW = 1_750_000_000_000;
const STREAMER_ID = '200000000000000099';
const VIEWER_ID = '100000000000000001';
const GUILD_ID = '300000000000000001';

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.restoreAllMocks();
});

function makeRound(patch: Partial<StreamRoundView> = {}): StreamRoundView {
  const winTotal = patch.winTotal ?? 4000;
  const loseTotal = patch.loseTotal ?? 2000;
  return {
    id: 10,
    label: 'Boss rush',
    status: 'open',
    openedAt: NOW - 60_000,
    autoLockAt: NOW + 9 * 60_000,
    lockedAt: null,
    winTotal,
    loseTotal,
    bettors: 3,
    winOddsBps:
      patch.winOddsBps !== undefined ? patch.winOddsBps : streamOddsBps(winTotal, loseTotal, 'win'),
    loseOddsBps:
      patch.loseOddsBps !== undefined
        ? patch.loseOddsBps
        : streamOddsBps(winTotal, loseTotal, 'lose'),
    ...patch,
  };
}

function makeView(patch: Partial<StreamView> = {}): StreamView {
  return {
    now: NOW,
    id: 1,
    streamerId: STREAMER_ID,
    streamerName: 'Minato',
    streamerAvatar: null,
    title: 'Ranked grind',
    url: 'https://example.com/live',
    channelId: '400000000000000001',
    location: { channelId: '500000000000000001', source: 'activity' },
    status: 'live',
    startedAt: NOW - 30 * 60_000,
    endsAt: NOW + 23 * 3600_000,
    endedAt: null,
    tips: 6500,
    tipCount: 2,
    round: makeRound(),
    recentTips: [
      {
        tipperId: '200000000000000002',
        tipperName: 'Yui',
        amount: 20_000,
        message: 'Huge clutch!',
        at: NOW - 20_000,
      },
      {
        tipperId: '200000000000000003',
        tipperName: 'Ren',
        amount: 500,
        message: 'Good luck',
        at: NOW - 50_000,
      },
    ],
    me: {
      isStreamer: false,
      balance: 25_000,
      bet: null,
      betRoom: STREAM_LIMITS.betMax,
    },
    ...patch,
  };
}

function makeList(view: StreamView, mine: number | null = null): StreamList {
  return {
    now: view.now,
    mine,
    streams:
      view.status === 'live'
        ? [
            {
              id: view.id,
              streamerId: view.streamerId,
              streamerName: view.streamerName,
              streamerAvatar: view.streamerAvatar,
              title: view.title,
              startedAt: view.startedAt,
              tips: view.tips,
              roundStatus: view.round?.status ?? null,
            },
          ]
        : [],
  };
}

function makeTransfer(patch: Partial<TransferView> = {}): TransferView {
  return {
    now: NOW,
    balance: 25_000,
    debt: 0,
    gamesPlayed: 15,
    minGames: 5,
    dailyLimit: 20_000,
    sentToday: 3000,
    feeBps: 1000,
    confirmFrom: 5000,
    maxAmount: 20_000,
    ...patch,
  };
}

interface Harness {
  sdk: FakeSdk;
  api: StreamApi;
  socket: StreamSocket;
  joinedIds: number[];
  leftIds: number[];
  emit: (event: StreamDomainEvent) => void;
  pushSnapshot: (view: StreamView) => void;
  calls: Array<{ method: string; args: unknown; key?: string }>;
  container: HTMLElement;
}

function makeHarness(overrides: Partial<StreamApi> = {}, initialView = makeView()): Harness {
  const calls: Harness['calls'] = [];
  const joinedIds: number[] = [];
  const leftIds: number[] = [];
  const snapshotListeners = new Map<number, Set<(v: StreamView) => void>>();
  const eventListeners = new Set<(e: StreamDomainEvent) => void>();

  let currentView = initialView;

  const baseApi: StreamApi = {
    streams: async () => {
      calls.push({ method: 'streams', args: null });
      return makeList(currentView, currentView.me.isStreamer ? currentView.id : null);
    },
    view: async (streamId) => {
      calls.push({ method: 'view', args: { streamId } });
      return currentView;
    },
    transfer: async () => {
      calls.push({ method: 'transfer', args: null });
      return makeTransfer();
    },
    start: async (input, key): Promise<StreamStartResponse> => {
      calls.push({ method: 'start', args: input, key });
      currentView = makeView({
        id: 7,
        streamerId: VIEWER_ID,
        streamerName: 'You',
        title: input.title,
        url: input.url ?? null,
        round: null,
        recentTips: [],
        tips: 0,
        tipCount: 0,
        me: { isStreamer: true, balance: 25_000, bet: null, betRoom: 0 },
      });
      return { replayed: false, balance: 25_000, stream: currentView };
    },
    tip: async (input, key): Promise<StreamTipResponse> => {
      calls.push({ method: 'tip', args: input, key });
      const fee = calcTipFee(input.amount, 1000);
      currentView = {
        ...currentView,
        tips: currentView.tips + input.amount,
        tipCount: currentView.tipCount + 1,
        recentTips: [
          {
            tipperId: VIEWER_ID,
            tipperName: 'Viewer',
            amount: input.amount,
            message: input.message ?? '',
            at: NOW,
          },
          ...currentView.recentTips,
        ],
      };
      return {
        replayed: false,
        balance: 25_000 - input.amount - fee,
        stream: currentView,
        amount: input.amount,
        fee,
        received: input.amount,
        withheld: 0,
      };
    },
    bet: async (input, key): Promise<StreamBetResponse> => {
      calls.push({ method: 'bet', args: input, key });
      const round = currentView.round ?? makeRound();
      const winTotal = round.winTotal + (input.side === 'win' ? input.amount : 0);
      const loseTotal = round.loseTotal + (input.side === 'lose' ? input.amount : 0);
      const already = currentView.me.bet?.amount ?? 0;
      const total = already + input.amount;
      currentView = {
        ...currentView,
        round: {
          ...round,
          winTotal,
          loseTotal,
          bettors: already === 0 ? round.bettors + 1 : round.bettors,
          winOddsBps: streamOddsBps(winTotal, loseTotal, 'win'),
          loseOddsBps: streamOddsBps(winTotal, loseTotal, 'lose'),
        },
        me: {
          ...currentView.me,
          balance: currentView.me.balance - input.amount,
          bet: { side: input.side, amount: total },
          betRoom: STREAM_LIMITS.betMax - total,
        },
      };
      return {
        replayed: false,
        balance: currentView.me.balance,
        stream: currentView,
        side: input.side,
        total,
      };
    },
    openRound: async (input, key): Promise<StreamWriteResponse> => {
      calls.push({ method: 'openRound', args: input, key });
      currentView = {
        ...currentView,
        round: makeRound({
          id: 20,
          label: input.label ?? '',
          status: 'open',
          winTotal: 0,
          loseTotal: 0,
          bettors: 0,
          winOddsBps: null,
          loseOddsBps: null,
        }),
      };
      return { replayed: false, balance: currentView.me.balance, stream: currentView };
    },
    lock: async (input, key): Promise<StreamWriteResponse> => {
      calls.push({ method: 'lock', args: input, key });
      currentView = {
        ...currentView,
        round: currentView.round ? { ...currentView.round, status: 'locked', lockedAt: NOW } : null,
      };
      return { replayed: false, balance: currentView.me.balance, stream: currentView };
    },
    settle: async (input, key): Promise<StreamSettleResponse> => {
      calls.push({ method: 'settle', args: input, key });
      const r = currentView.round ?? makeRound();
      const result: StreamSettleResult = {
        roundId: r.id,
        label: r.label,
        outcome: input.winner,
        refunded: false,
        cause: 'streamer',
        bettors: r.bettors,
        winTotal: r.winTotal,
        loseTotal: r.loseTotal,
        rake: 100,
        payoutCount: 2,
        payouts: [],
      };
      currentView = { ...currentView, round: null };
      return { replayed: false, balance: currentView.me.balance, stream: currentView, result };
    },
    voidRound: async (input, key): Promise<StreamSettleResponse> => {
      calls.push({ method: 'voidRound', args: input, key });
      const r = currentView.round ?? makeRound();
      const result: StreamSettleResult = {
        roundId: r.id,
        label: r.label,
        outcome: 'void',
        refunded: true,
        cause: 'streamer',
        bettors: r.bettors,
        winTotal: r.winTotal,
        loseTotal: r.loseTotal,
        rake: 0,
        payoutCount: r.bettors,
        payouts: [],
      };
      currentView = { ...currentView, round: null };
      return { replayed: false, balance: currentView.me.balance, stream: currentView, result };
    },
    end: async (input, key): Promise<StreamEndResponse> => {
      calls.push({ method: 'end', args: input, key });
      currentView = { ...currentView, status: 'ended', endedAt: NOW, round: null };
      return {
        replayed: false,
        balance: currentView.me.balance,
        stream: currentView,
        voided: null,
      };
    },
    ...overrides,
  };

  const socket: StreamSocket = {
    join(streamId, onSnapshot) {
      joinedIds.push(streamId);
      let set = snapshotListeners.get(streamId);
      if (!set) snapshotListeners.set(streamId, (set = new Set()));
      set.add(onSnapshot);
      return () => {
        leftIds.push(streamId);
        set?.delete(onSnapshot);
      };
    },
    onEvent(listener) {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },
  };

  const sdk = fakeSdk();
  const runtime = new ShellRuntime({
    config: { mode: 'mock', clientId: '1', proxyPrefix: '', mockScreen: 'stream' },
    sdk,
    api: createMockApi(),
    origin: 'http://localhost',
  });
  const services: StreamServices = { api: baseApi, socket };

  mounted = render(
    <ThemeProvider>
      <RuntimeContext.Provider value={runtime}>
        <StreamProvider services={services}>
          <StreamScreen />
        </StreamProvider>
      </RuntimeContext.Provider>
    </ThemeProvider>,
  );

  return {
    sdk,
    api: baseApi,
    socket,
    joinedIds,
    leftIds,
    emit: (event) => {
      act(() => {
        for (const fn of eventListeners) fn(event);
      });
    },
    pushSnapshot: (v) => {
      currentView = v;
      act(() => {
        for (const fn of snapshotListeners.get(v.id) ?? []) fn(v);
      });
    },
    calls,
    container: mounted.container,
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function clickEl(el: Element): Promise<void> {
  return act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setInput(input: HTMLInputElement, value: string): Promise<void> {
  return act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
  });
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('button')).find((b) =>
    b.textContent?.includes(text),
  );
  if (!btn) {
    const names = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
    throw new Error(`Button "${text}" not found. Buttons: ${JSON.stringify(names)}`);
  }
  return btn;
}

function findInputByLabel(container: HTMLElement, labelText: string): HTMLInputElement {
  const label = Array.from(container.querySelectorAll('label')).find((l) =>
    l.textContent?.includes(labelText),
  );
  if (!label) throw new Error(`Label "${labelText}" not found`);
  const id = label.getAttribute('for');
  const input = id ? container.querySelector<HTMLInputElement>(`#${CSS.escape(id)}`) : null;
  if (!input) throw new Error(`Input for "${labelText}" not found`);
  return input;
}

describe('Stream helpers', () => {
  it('computes 10% ceiling tip fees and 2-decimal indicative odds', () => {
    expect(calcTipFee(100)).toBe(10);
    expect(calcTipFee(101)).toBe(11);
    expect(calcTipFee(500)).toBe(50);
    expect(calcTipFee(5000)).toBe(500);
    expect(formatOdds(null)).toBeNull();
    expect(formatOdds(14_750)).toBe('1.48');
    expect(formatOdds(10_000)).toBe('1.00');
  });

  it('maps super-chat amounts strictly to STREAM_TIP_TIERS colours', () => {
    for (const tier of STREAM_TIP_TIERS) {
      const meta = tipTierFor(tier.from);
      expect(meta.hex).toBe(`#${streamTipColor(tier.from).toString(16).padStart(6, '0')}`);
    }
    expect(tipTierFor(100).tier).toBe('default');
  });
});

describe('StreamScreen', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' });
    useBalanceStore.getState().set(25_000);
    useToastStore.getState().clear();
    useSessionStore.setState({
      guildId: GUILD_ID,
      user: { id: VIEWER_ID, username: 'viewer', globalName: 'Viewer', avatar: null },
    });
  });

  it('shows live list, opens stream room, uses SDK openExternalLink (never window.open) and shows location', async () => {
    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null);
    const h = makeHarness();
    await flush();

    expect(h.container.textContent).toContain('Ranked grind');
    expect(h.container.textContent).toContain('Minato');

    // Open stream room
    const row = h.container.querySelector('.bb-list__item');
    expect(row).not.toBeNull();
    await clickEl(row as Element);
    await flush();

    expect(h.joinedIds).toEqual([1]);
    expect(h.container.textContent).toContain('Ranked grind');
    expect(h.container.querySelector('[data-testid="stream-location"]')?.textContent).toContain(
      '500000000000000001',
    );
    expect(h.container.querySelector('[data-testid="win-odds"]')?.textContent).toContain('1.48');
    expect(h.container.querySelector('[data-testid="lose-odds"]')?.textContent).toContain('2.90');
    expect(h.container.querySelector('[data-testid="round-autolock"]')).not.toBeNull();

    // Open stream URL via Discord SDK, never window.open
    await clickEl(findButton(h.container, 'Open stream link'));
    expect(h.sdk.openedUrls).toEqual(['https://example.com/live']);
    expect(windowOpen).not.toHaveBeenCalled();

    // Back to list leaves the socket room
    await clickEl(findButton(h.container, 'All streams'));
    await flush();
    expect(h.leftIds).toEqual([1]);
  });

  it('hides location when null and disables betting when round is locked or ended', async () => {
    const lockedView = makeView({
      location: null,
      url: null,
      round: makeRound({ status: 'locked', lockedAt: NOW - 10_000 }),
    });
    const h = makeHarness({}, lockedView);
    await flush();
    await clickEl(h.container.querySelector('.bb-list__item') as Element);
    await flush();

    expect(h.container.querySelector('[data-testid="stream-location"]')).toBeNull();
    expect(h.container.textContent).toContain('Bets closed');
    expect(findButton(h.container, 'Streamer wins').disabled).toBe(true);
    expect(findButton(h.container, 'Streamer loses').disabled).toBe(true);

    // Live StreamEnded event transitions cleanly to ended state
    h.emit({
      type: 'StreamEnded',
      guildId: GUILD_ID,
      at: NOW + 1000,
      streamId: 1,
      streamerId: STREAMER_ID,
      cause: 'streamer',
      tips: 6500,
      tipCount: 2,
    });
    await flush();
    expect(h.container.textContent).toContain('This stream has ended.');
    expect(h.container.textContent).toContain('Recent super chats');
  });

  it('locks viewer bet side after first bet and enforces stake vs 10,000 cap', async () => {
    const h = makeHarness();
    await flush();
    await clickEl(h.container.querySelector('.bb-list__item') as Element);
    await flush();

    const betInput = findInputByLabel(h.container, 'Bet amount');
    await setInput(betInput, '2500');
    await clickEl(findButton(h.container, 'Streamer wins'));
    await flush();

    const betCall = h.calls.find((c) => c.method === 'bet');
    expect(betCall?.args).toEqual({ streamId: 1, roundId: 10, side: 'win', amount: 2500 });
    expect(betCall?.key).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(h.container.querySelector('[data-testid="my-stake"]')?.textContent).toContain('2,500');
    expect(h.container.querySelector('[data-testid="bet-room"]')?.textContent).toContain('7,500');

    // Opposite side is now disabled; same side stays enabled
    expect(findButton(h.container, 'Streamer loses').disabled).toBe(true);
    expect(findButton(h.container, 'Streamer wins').disabled).toBe(false);
  });

  it('shows 10% ceiling fee preview, daily cap hint, confirms tips >= 5,000, and renders tier colours', async () => {
    const h = makeHarness();
    await flush();
    await clickEl(h.container.querySelector('.bb-list__item') as Element);
    await flush();

    // Daily cap remaining: 20,000 - 3,000 = 17,000
    expect(h.container.querySelector('[data-testid="tip-daily-cap"]')?.textContent).toContain(
      '17,000',
    );

    // Recent tips carry STREAM_TIP_TIERS colours
    const tipNodes = Array.from(h.container.querySelectorAll('.st-tip'));
    expect(tipNodes[0]?.getAttribute('data-tier')).toBe('20000');
    expect(tipNodes[0]?.getAttribute('data-color')).toBe('#e62117');
    expect(tipNodes[1]?.getAttribute('data-tier')).toBe('500');
    expect(tipNodes[1]?.getAttribute('data-color')).toBe('#00e5ff');

    // 101 Pelica -> fee 11, total 112; sends directly without confirmation dialog
    const tipInput = findInputByLabel(h.container, 'Tip amount');
    await setInput(tipInput, '101');
    const preview = h.container.querySelector('[data-testid="tip-fee-preview"]')?.textContent ?? '';
    expect(preview).toContain('11');
    expect(preview).toContain('112');

    await clickEl(findButton(h.container, 'Send super chat'));
    await flush();
    expect(h.container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(h.calls.filter((c) => c.method === 'tip')).toHaveLength(1);

    // 5,000 Pelica -> fee 500, total 5,500; opens confirmation dialog first
    await setInput(tipInput, '5000');
    await clickEl(findButton(h.container, 'Send super chat'));
    await flush();
    const dialog = h.container.querySelector('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('5,000');
    expect(dialog?.textContent).toContain('500');
    expect(h.calls.filter((c) => c.method === 'tip')).toHaveLength(1);

    await clickEl(findButton(dialog as HTMLElement, 'Confirm'));
    await flush();
    expect(h.calls.filter((c) => c.method === 'tip')).toHaveLength(2);
  });

  it('streamer flow: disables settle while open (D3), enables after lock, confirms settle/void/end', async () => {
    const streamerView = makeView({
      streamerId: VIEWER_ID,
      streamerName: 'You',
      round: null,
      me: { isStreamer: true, balance: 25_000, bet: null, betRoom: 0 },
    });
    const h = makeHarness({}, streamerView);
    await flush();

    // Open own stream via "Open my stream"
    await clickEl(findButton(h.container, 'Open my stream'));
    await flush();

    // Open a round with blank label -> falls back to "Next round"
    await clickEl(findButton(h.container, 'Open round'));
    await flush();
    expect(h.calls.some((c) => c.method === 'openRound')).toBe(true);
    expect(h.container.textContent).toContain('Next round');

    // D3: Settle buttons MUST be disabled while round is open
    expect(findButton(h.container, 'Settle: Win').disabled).toBe(true);
    expect(findButton(h.container, 'Settle: Lose').disabled).toBe(true);
    expect(h.container.querySelector('[data-testid="lock-first-hint"]')).not.toBeNull();
    expect(findButton(h.container, 'Void round').disabled).toBe(false);

    // Lock bets -> enables settle buttons
    await clickEl(findButton(h.container, 'Lock bets'));
    await flush();
    expect(findButton(h.container, 'Settle: Win').disabled).toBe(false);
    expect(findButton(h.container, 'Settle: Lose').disabled).toBe(false);

    // Settle Win requires confirmation dialog
    await clickEl(findButton(h.container, 'Settle: Win'));
    await flush();
    const settleDialog = h.container.querySelector('[role="alertdialog"]');
    expect(settleDialog).not.toBeNull();
    expect(h.calls.filter((c) => c.method === 'settle')).toHaveLength(0);
    await clickEl(findButton(settleDialog as HTMLElement, 'Confirm'));
    await flush();
    expect(h.calls.filter((c) => c.method === 'settle')).toHaveLength(1);
    expect(h.container.textContent).toContain('Last round result');

    // Open another round and void while open (requires confirm dialog)
    await clickEl(findButton(h.container, 'Open round'));
    await flush();
    await clickEl(findButton(h.container, 'Void round'));
    await flush();
    const voidDialog = h.container.querySelector('[role="alertdialog"]');
    expect(voidDialog).not.toBeNull();
    await clickEl(findButton(voidDialog as HTMLElement, 'Confirm'));
    await flush();
    expect(h.calls.filter((c) => c.method === 'voidRound')).toHaveLength(1);

    // End stream requires confirmation dialog
    await clickEl(findButton(h.container, 'End stream'));
    await flush();
    const endDialog = h.container.querySelector('[role="alertdialog"]');
    expect(endDialog).not.toBeNull();
    await clickEl(findButton(endDialog as HTMLElement, 'Confirm'));
    await flush();
    expect(h.calls.filter((c) => c.method === 'end')).toHaveLength(1);
    expect(h.container.textContent).toContain('This stream has ended.');
  });

  it('reuses idempotencyKey on transient retry and issues a fresh key after 4xx refusal', async () => {
    const betKeys: string[] = [];
    let attempt = 0;
    const h = makeHarness({
      bet: async (_input, key) => {
        betKeys.push(key);
        attempt += 1;
        if (attempt === 1) throw new StreamApiError('internal', 503);
        if (attempt === 2) {
          throw new StreamApiError('conflict', 409, { rule: 'stream_other_side' });
        }
        return {
          replayed: false,
          balance: 24_500,
          stream: makeView({
            me: {
              isStreamer: false,
              balance: 24_500,
              bet: { side: 'win', amount: 500 },
              betRoom: 9500,
            },
          }),
          side: 'win',
          total: 500,
        };
      },
    });
    await flush();
    await clickEl(h.container.querySelector('.bb-list__item') as Element);
    await flush();

    const betInput = findInputByLabel(h.container, 'Bet amount');
    await setInput(betInput, '500');

    // Attempt 1: 503 transient failure
    await clickEl(findButton(h.container, 'Streamer wins'));
    await flush();
    // Attempt 2: retry reuses exact same key, gets deterministic 409 refusal
    await clickEl(findButton(h.container, 'Streamer wins'));
    await flush();
    expect(h.container.textContent).toContain("can't switch sides");

    // Attempt 3: after 4xx refusal, a fresh key is generated
    await clickEl(findButton(h.container, 'Streamer wins'));
    await flush();

    expect(betKeys).toHaveLength(3);
    expect(betKeys[1]).toBe(betKeys[0]);
    expect(betKeys[2]).not.toBe(betKeys[1]);
  });

  it('shows feature-off banner when server returns feature_disabled and updates live via socket events', async () => {
    const h = makeHarness({
      start: async () => {
        throw new StreamApiError('feature_disabled', 403);
      },
    });
    await flush();

    const titleInput = findInputByLabel(h.container, 'Title');
    await setInput(titleInput, 'Evening stream');
    await clickEl(findButton(h.container, 'Start stream'));
    await flush();

    expect(h.container.textContent).toContain('Streams are currently turned off');

    // Enter existing stream and receive live StreamBetPlaced + StreamRoundSettled events
    await clickEl(h.container.querySelector('.bb-list__item') as Element);
    await flush();
    h.emit({
      type: 'StreamBetPlaced',
      guildId: GUILD_ID,
      at: NOW + 1000,
      streamId: 1,
      roundId: 10,
      side: 'lose',
      winTotal: 4000,
      loseTotal: 4000,
      bettors: 4,
    });
    await flush();
    expect(h.container.textContent).toContain('4 bettors');
    expect(h.container.querySelector('[data-testid="win-odds"]')?.textContent).toContain('1.95');

    h.emit({
      type: 'StreamRoundSettled',
      guildId: GUILD_ID,
      at: NOW + 2000,
      streamId: 1,
      streamerId: STREAMER_ID,
      result: {
        roundId: 10,
        label: 'Boss rush',
        outcome: 'win',
        refunded: false,
        cause: 'streamer',
        bettors: 4,
        winTotal: 4000,
        loseTotal: 4000,
        rake: 200,
        payoutCount: 2,
        payouts: [],
      },
    });
    await flush();
    expect(h.container.textContent).toContain('Last round result: Boss rush');
    expect(h.container.textContent).toContain('200');
  });

  it('treats an open round past autoLockAt as locked (D3) and refreshes recent tips on StreamTipped', async () => {
    const expiredOpen = makeView({
      streamerId: VIEWER_ID,
      streamerName: 'You',
      round: makeRound({ status: 'open', autoLockAt: NOW - 1000 }),
      me: { isStreamer: true, balance: 25_000, bet: null, betRoom: 0 },
    });
    const h = makeHarness({}, expiredOpen);
    await flush();
    await clickEl(findButton(h.container, 'Open my stream'));
    await flush();

    // Past autoLockAt -> effectively locked, so settle buttons are enabled even with raw status 'open'
    expect(h.container.textContent).toContain('Bets closed');
    expect(findButton(h.container, 'Settle: Win').disabled).toBe(false);
    expect(findButton(h.container, 'Settle: Lose').disabled).toBe(false);

    // Live StreamTipped updates totals immediately and triggers a background view refresh
    const viewCallsBefore = h.calls.filter((c) => c.method === 'view').length;
    h.emit({
      type: 'StreamTipped',
      guildId: GUILD_ID,
      at: NOW + 500,
      streamId: 1,
      streamerId: VIEWER_ID,
      tipperId: '200000000000000077',
      amount: 1000,
      fee: 100,
      message: 'Nice!',
      tips: 7500,
      tipCount: 3,
    });
    await flush();
    expect(h.calls.filter((c) => c.method === 'view').length).toBeGreaterThan(viewCallsBefore);
  });
});

describe('createStreamSocket', () => {
  it('joins stream room, filters domain events by guild, re-joins on reconnect, and leaves on cleanup', () => {
    const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
    const emitted: Array<{ event: string; payload: unknown }> = [];
    const snap = makeView();

    const fakeRaw = {
      connected: true,
      emit(event: string, payload: unknown, ack?: (r: AckResult<StreamView>) => void) {
        emitted.push({ event, payload });
        if (event === 'stream:join' && ack) ack({ ok: true, data: snap });
      },
      on(event: string, fn: (...args: unknown[]) => void) {
        let s = handlers.get(event);
        if (!s) handlers.set(event, (s = new Set()));
        s.add(fn);
      },
      off(event: string, fn: (...args: unknown[]) => void) {
        handlers.get(event)?.delete(fn);
      },
    } as unknown as CasinoSocket;

    const sock = createStreamSocket({
      getSocket: () => fakeRaw,
      getGuildId: () => GUILD_ID,
    });

    const snapshots: StreamView[] = [];
    const events: StreamDomainEvent[] = [];
    const leave = sock.join(1, (v) => snapshots.push(v));
    const off = sock.onEvent((e) => events.push(e));

    expect(emitted).toEqual([{ event: 'stream:join', payload: { streamId: 1 } }]);
    expect(snapshots).toHaveLength(1);

    // Trigger connect (reconnect) -> re-joins room
    for (const fn of handlers.get('connect') ?? []) fn();
    expect(emitted).toHaveLength(2);

    // Matching guild stream event arrives; wrong guild ignored
    const good: DomainEvent = {
      type: 'StreamRoundLocked',
      guildId: GUILD_ID,
      at: NOW,
      streamId: 1,
      streamerId: STREAMER_ID,
      roundId: 10,
      cause: 'auto',
    };
    const otherGuild: DomainEvent = { ...good, guildId: '999999999999999999' };
    for (const fn of handlers.get('domain:event') ?? []) {
      fn(good);
      fn(otherGuild);
    }
    expect(events).toEqual([good]);

    leave();
    off();
    expect(emitted.at(-1)).toEqual({ event: 'stream:leave', payload: { streamId: 1 } });
  });
});
