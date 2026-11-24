/**
 * An in-memory casino for `VITE_MOCK_DISCORD=1`, the screenshot runs and component tests. It
 * follows the server's shapes (the contracts in `@casino/shared`) but not its odds exactly:
 * it exists so the screens can be seen and clicked without a server. Never part of a
 * production path: `services.tsx` loads it only in mock mode, through a dynamic import.
 */
import type {
  ActionIntent,
  BlackjackSeatView,
  BlackjackView,
  CardView,
  CasinoOverview,
  ChinchiroKind,
  ChinchiroRollView,
  ChinchiroTableData,
  ChinchiroView,
  DailyClaimResponse,
  DailyStatus,
  GameId,
  HistoryEntry,
  HistoryPage,
  LedgerReason,
  PachinkoResultView,
  PachinkoSetView,
  RecentRound,
  RouletteBetAccepted,
  RouletteLineView,
  RouletteTableData,
  SettlementView,
  SlotsResultView,
  SpinFrameView,
  TableSnapshot,
} from '@casino/shared';
import { CARD_RANKS, CARD_SUITS } from '@casino/shared';
import { useBalanceStore } from '../../shell/stores/balance.ts';
import { useSessionStore } from '../../shell/stores/session.ts';
import type { CasinoApi } from './api.ts';
import {
  GameError,
  type BetOutcome,
  type BetRequest,
  type CasinoClient,
  type TableListener,
} from './client.ts';
import type { CasinoServices } from './services.tsx';

const BOT_A = '200000000000000002';
const BOT_B = '200000000000000003';
const MIN_BET = 10;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createMock(): CasinoServices {
  const seedParam =
    typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('seed');
  const random = seedParam ? mulberry32(Number(seedParam) || 1) : Math.random;
  const int = (n: number) => Math.floor(random() * n);
  const me = () => useSessionStore.getState().user?.id ?? '200000000000000001';
  const guildId = () => useSessionStore.getState().guildId ?? '100000000000000001';
  const instanceId = () => useSessionStore.getState().instanceId ?? 'mock-instance';

  // ---- money -------------------------------------------------------------------------------
  let ledgerId = 1000;
  let pool = 48_200;
  const ledger: HistoryEntry[] = [];
  const recent: RecentRound[] = [];
  const balance = () => useBalanceStore.getState().balance ?? 12_400;

  const post = (delta: number, reason: LedgerReason, refType: string | null = null) => {
    if (delta === 0) return;
    const after = balance() + delta;
    ledgerId += 1;
    ledger.unshift({
      id: ledgerId,
      delta,
      balanceAfter: after,
      reason,
      refType,
      createdAt: Date.now(),
    });
    useBalanceStore.getState().apply({ balance: after, delta, ledgerId });
  };

  const seedReasons: [LedgerReason, number][] = [
    ['game_stake', -200],
    ['game_payout', 440],
    ['daily_bonus', 1100],
    ['game_stake', -500],
    ['mission_reward', 600],
    ['transfer_in', 1500],
    ['game_stake', -100],
    ['game_payout', 150],
    ['shop_buy', -2400],
    ['work_earnings', 380],
  ];
  let running = balance();
  for (let i = 0; i < 48; i += 1) {
    const [reason, delta] = seedReasons[i % seedReasons.length] as [LedgerReason, number];
    running -= delta;
    ledger.push({
      id: 900 - i,
      delta,
      balanceAfter: running + delta,
      reason,
      refType: reason.startsWith('game') ? 'round' : null,
      createdAt: Date.now() - (i + 1) * 47 * 60_000,
    });
  }

  const debit = (stake: number) => {
    if (stake < MIN_BET) throw new GameError('invalid_payload');
    if (balance() < stake) throw new GameError('insufficient_funds');
    post(-stake, 'game_stake', 'round');
  };

  let roundCounter = 0;
  const newRound = (prefix: string) => `${prefix}_mock${(roundCounter += 1)}`;

  const settle = (
    game: SettlementView['game'],
    roundId: string,
    stake: number,
    payout: number,
    penalty = 0,
  ): SettlementView => {
    if (payout > 0) post(payout, 'game_payout', 'round');
    if (penalty > 0) post(-Math.min(penalty, balance()), 'game_penalty', 'round');
    const net = payout - stake - penalty;
    pool += Math.max(0, Math.floor(-net * 0.05));
    const tier = net >= stake * 10 ? 'big' : null;
    recent.unshift({
      roundId,
      game: game as RecentRound['game'],
      stake,
      payout,
      net,
      settledAt: Date.now(),
    });
    recent.length = Math.min(recent.length, 10);
    return {
      roundId,
      game,
      stake,
      payout,
      net,
      eventBonus: 0,
      insured: 0,
      penalty,
      penaltyShortfall: 0,
      withheld: 0,
      jackpot: 0,
      jackpotPool: pool,
      balance: balance(),
      tier,
    };
  };

  const outcome = <T>(result: T, roundId?: string): BetOutcome<T> => ({
    balance: balance(),
    roundId,
    result,
    replayed: false,
  });

  // ---- daily -------------------------------------------------------------------------------
  let dailyOpen = true;
  let streak = 3;
  let nextSlotAt = Date.now() + 3 * 3_600_000 + 12 * 60_000;
  const api: CasinoApi = {
    overview: () =>
      Promise.resolve<CasinoOverview>({
        minBet: MIN_BET,
        jackpotPool: pool,
        disabled: [],
        recent: structuredClone(recent),
      }),
    daily: () => Promise.resolve<DailyStatus>({ claimable: dailyOpen, nextSlotAt, streak }),
    claimDaily: () => {
      if (!dailyOpen) return Promise.reject(new GameError('conflict'));
      dailyOpen = false;
      streak += 1;
      const amount = 1000 + 100 * Math.min(streak - 1, 20);
      post(amount, 'daily_bonus', 'daily');
      nextSlotAt = Date.now() + 6 * 3_600_000;
      const response: DailyClaimResponse = {
        replayed: false,
        amount,
        skimmed: 0,
        repaid: 0,
        streak,
        boosted: false,
        guarded: 0,
        balance: balance(),
        nextSlotAt,
      };
      return Promise.resolve(response);
    },
    history: (query = {}) => {
      const limit = query.limit ?? 20;
      const rows = ledger.filter((e) => query.before === undefined || e.id < query.before);
      const items = rows.slice(0, limit);
      const last = items[items.length - 1];
      const page: HistoryPage = {
        items: structuredClone(items),
        nextBefore: rows.length > limit && last ? last.id : null,
      };
      return Promise.resolve(page);
    },
  };

  // ---- table plumbing ----------------------------------------------------------------------
  const listeners = new Map<GameId, Set<TableListener>>();
  const seqs = new Map<GameId, number>();
  const snapshots = new Map<GameId, () => TableSnapshot>();
  const emit = (game: GameId) => {
    const build = snapshots.get(game);
    if (!build) return;
    seqs.set(game, (seqs.get(game) ?? 0) + 1);
    const snapshot = build();
    for (const l of listeners.get(game) ?? []) l(snapshot);
  };
  const snap = (
    game: GameId,
    roundId: string | null,
    phase: string,
    seats: { index: number; userId: string | null }[],
    data: unknown,
  ): TableSnapshot => ({
    guildId: guildId(),
    instanceId: instanceId(),
    game,
    seq: seqs.get(game) ?? 0,
    roundId,
    phase,
    seats,
    data,
  });
  const later = (ms: number, fn: () => void) => void setTimeout(fn, ms);

  // ---- slots -------------------------------------------------------------------------------
  const SLOT_WEIGHTS: [string, number, number][] = [
    ['🍒', 10, 5],
    ['🍋', 8, 8],
    ['🍇', 6, 15],
    ['🔔', 4, 30],
    ['💎', 2, 100],
    ['7️⃣', 1, 500],
  ];
  const drawSymbol = () => {
    let x = random() * 31;
    for (const [symbol, weight] of SLOT_WEIGHTS) {
      if (x < weight) return symbol;
      x -= weight;
    }
    return '🍒';
  };
  const playSlots = (stake: number): SlotsResultView => {
    debit(stake);
    const reels = [drawSymbol(), drawSymbol(), drawSymbol()] as SlotsResultView['reels'];
    let multiplier = 0;
    let label: SlotsResultView['label'] = { kind: 'miss' };
    if (reels[0] === reels[1] && reels[1] === reels[2]) {
      multiplier = SLOT_WEIGHTS.find(([s]) => s === reels[0])?.[2] ?? 0;
      label = reels[0] === '7️⃣' ? { kind: 'jackpot' } : { kind: 'triple', symbol: reels[0] };
    } else {
      const cherries = reels.filter((r) => r === '🍒').length;
      if (cherries === 2) [multiplier, label] = [1.5, { kind: 'cherry2' }];
      else if (cherries === 1) [multiplier, label] = [0.3, { kind: 'cherry1' }];
    }
    const roundId = newRound('sl');
    const payout = Math.floor(stake * multiplier);
    return {
      roundId,
      reels,
      multiplier,
      label,
      settlement: settle('slots', roundId, stake, payout),
    };
  };

  // ---- pachinko ----------------------------------------------------------------------------
  const rollSet = (): PachinkoSetView => {
    let starts = 0;
    for (let i = 0; i < 100; i += 1) if (random() < 0.07) starts += 1;
    const spins = Array.from({ length: starts }, () => {
      const omen = (['', '', '', 'blue', 'red', 'gold'] as const)[int(6)] ?? '';
      const tier = (['', '', '', '', 'normal', 'super'] as const)[int(6)] ?? '';
      const hit = random() < 0.0132 + (omen === 'gold' ? 0.08 : 0) + (tier === 'super' ? 0.12 : 0);
      const rounds: number[] = [];
      if (hit) {
        do rounds.push(([2, 2, 2, 10, 10, 30] as const)[int(6)] ?? 2);
        while (random() < 0.5);
      }
      return { omen, tier, hitProb: 0.0132, hit, rounds };
    });
    return {
      starts,
      spins,
      raw: spins.reduce((n, s) => n + s.rounds.reduce((a, b) => a + b, 0), 0),
    };
  };
  const playPachinko = (bet: number, sets: number): PachinkoResultView => {
    const count = Math.max(1, Math.min(10, sets));
    debit(bet * count);
    const rolled = Array.from({ length: count }, rollSet);
    const roundId = newRound('pa');
    const payout = rolled.reduce((n, s) => n + s.raw * bet, 0);
    return {
      roundId,
      bet,
      sets: rolled,
      topRound: Math.max(0, ...rolled.flatMap((s) => s.spins.flatMap((p) => p.rounds))),
      settlement: settle('pachinko', roundId, bet * count, payout),
    };
  };

  // ---- chinchiro ---------------------------------------------------------------------------
  type Dice = [number, number, number];
  const classify = (dice: Dice): ChinchiroRollView['hand'] => {
    const [a, b, c] = [...dice].sort((x, y) => x - y) as Dice;
    if (a === b && b === c)
      return a === 1 ? { kind: 'pinzoro', value: 0 } : { kind: 'arashi', value: a };
    if (a === 4 && b === 5 && c === 6) return { kind: 'shigoro', value: 0 };
    if (a === 1 && b === 2 && c === 3) return { kind: 'hifumi', value: 0 };
    if (a === b) return { kind: 'me', value: c };
    if (b === c) return { kind: 'me', value: a };
    return { kind: 'menashi', value: 0 };
  };
  const rollOnce = (): ChinchiroRollView => {
    const dice: Dice = [1 + int(6), 1 + int(6), 1 + int(6)];
    return { dice, hand: classify(dice) };
  };
  const rollHand = (): ChinchiroRollView[] => {
    const rolls: ChinchiroRollView[] = [];
    while (rolls.length < 3) {
      const r = rollOnce();
      rolls.push(r);
      if (r.hand.kind !== 'menashi') break;
    }
    return rolls;
  };
  const strength = (h: ChinchiroRollView['hand']): number =>
    ({ pinzoro: 100, arashi: 90, shigoro: 80, me: 10, menashi: 0, hifumi: -1 })[h.kind] + h.value;
  const MULT: Record<ChinchiroKind, number> = {
    pinzoro: 5,
    arashi: 3,
    shigoro: 2,
    me: 1,
    menashi: 1,
    hifumi: 1,
  };
  const verdictOf = (
    player: ChinchiroRollView['hand'],
    dealer: ChinchiroRollView['hand'],
    stake: number,
  ) => {
    const p = strength(player);
    const d = strength(dealer);
    if (p === d) return { result: 'draw' as const, multiplier: 0, payout: stake, penalty: 0 };
    if (p > d) {
      const multiplier = MULT[player.kind] * (dealer.kind === 'hifumi' ? 2 : 1);
      return { result: 'win' as const, multiplier, payout: stake + stake * multiplier, penalty: 0 };
    }
    const multiplier = MULT[dealer.kind] * (player.kind === 'hifumi' ? 2 : 1);
    return { result: 'lose' as const, multiplier, payout: 0, penalty: stake * (multiplier - 1) };
  };

  let solo: { view: ChinchiroView; dealer: ChinchiroRollView[] } | null = null;
  const startSolo = (stake: number): ChinchiroView => {
    debit(stake);
    const dealerRolls = rollHand();
    const view: ChinchiroView = {
      roundId: newRound('ch'),
      stake,
      status: 'player_turn',
      dealerRolls,
      playerRolls: [],
      rollsLeft: 3,
      deadline: Date.now() + 60_000,
    };
    solo = { view, dealer: dealerRolls };
    return structuredClone(view);
  };
  const rollSolo = (roundId: string): ChinchiroView => {
    if (!solo || solo.view.roundId !== roundId || solo.view.status !== 'player_turn') {
      throw new GameError('conflict');
    }
    const view = solo.view;
    const roll = rollOnce();
    view.playerRolls.push(roll);
    view.rollsLeft = 3 - view.playerRolls.length;
    if (roll.hand.kind !== 'menashi' || view.rollsLeft === 0) {
      const dealerHand = (view.dealerRolls[view.dealerRolls.length - 1] as ChinchiroRollView).hand;
      const v = verdictOf(roll.hand, dealerHand, view.stake);
      view.status = 'settled';
      view.deadline = null;
      view.rollsLeft = 0;
      view.result = {
        outcome: v.result,
        multiplier: v.multiplier,
        payout: v.payout,
        penalty: v.penalty,
        settlement: settle('chinchiro', view.roundId, view.stake, v.payout, v.penalty),
      };
    }
    return structuredClone(view);
  };

  // chinchiro table: winner takes all, 10 % fee on the losers' stakes
  const CH_STEP = 900;
  const CH_ROLL_MS = 45_000;
  const CH_MIN_SEATS = 2;
  const CH_RAKE_BPS = 1000;
  type ChHand = NonNullable<ChinchiroTableData['hands']>[number];
  const ch = {
    phase: 'idle' as 'idle' | 'lobby' | 'rolling' | 'result',
    roundId: null as string | null,
    bet: 0,
    hostId: '',
    seats: [] as string[],
    deadline: null as number | null,
    folded: false,
    hands: [] as ChHand[],
    results: [] as NonNullable<ChinchiroTableData['results']>,
    rake: 0,
    timer: 0 as unknown,
  };
  snapshots.set('chinchiro', () =>
    snap(
      'chinchiro',
      ch.roundId,
      ch.phase,
      Array.from({ length: 6 }, (_, index) => ({ index, userId: ch.seats[index] ?? null })),
      {
        minBet: MIN_BET,
        minSeats: CH_MIN_SEATS,
        rakeBps: CH_RAKE_BPS,
        stepMs: CH_STEP,
        deadline: ch.deadline,
        folded: ch.folded,
        ...(ch.phase === 'idle' ? {} : { hostId: ch.hostId, bet: ch.bet }),
        ...(ch.phase === 'rolling' || ch.phase === 'result' ? { hands: ch.hands } : {}),
        ...(ch.phase === 'result' ? { results: ch.results, rake: ch.rake, refunded: false } : {}),
      } satisfies ChinchiroTableData,
    ),
  );
  const finishChTable = () => {
    if (ch.phase !== 'rolling') return;
    clearTimeout(ch.timer as number);
    for (const h of ch.hands) {
      if (!h.rolled) Object.assign(h, { rolled: true, rolls: rollHand() });
    }
    const power = ch.hands.map((h) =>
      strength((h.rolls[h.rolls.length - 1] as ChinchiroRollView).hand),
    );
    const best = Math.max(...power);
    const winners = power.filter((p) => p === best).length;
    const losers = power.length - winners;
    const share = Math.floor(
      Math.floor((ch.bet * losers * (10_000 - CH_RAKE_BPS)) / 10_000) / winners,
    );
    const order = ch.hands
      .map((_, i) => i)
      .sort((x, y) => (power[y] ?? 0) - (power[x] ?? 0) || x - y);
    ch.results = order.map((i) => {
      const h = ch.hands[i] as ChHand;
      const isWinner = power[i] === best;
      const payout = isWinner ? ch.bet + share : 0;
      if (h.userId === me()) settle('chinchiro', h.roundId, ch.bet, payout);
      return { userId: h.userId, isWinner, payout, net: payout - ch.bet, settled: true };
    });
    ch.rake = ch.bet * ch.hands.length - ch.results.reduce((n, r) => n + r.payout, 0);
    ch.phase = 'result';
    ch.deadline = null;
    emit('chinchiro');
    later(10_000, () => {
      Object.assign(ch, { phase: 'idle', roundId: null, seats: [], hands: [], results: [] });
      emit('chinchiro');
    });
  };
  const rollChTable = (roundId: string) => {
    if (ch.roundId !== roundId || ch.phase === 'result') throw new GameError('conflict');
    const hand = ch.hands.find((h) => h.userId === me());
    if (ch.phase !== 'rolling' || !hand || hand.rolled) throw new GameError('conflict');
    Object.assign(hand, { rolled: true, rolls: rollHand() });
    const finished = ch.hands.every((h) => h.rolled);
    if (finished) finishChTable();
    else emit('chinchiro');
    return { tableRound: roundId, rolls: hand.rolls, finished };
  };
  const startChTable = () => {
    if (ch.phase !== 'lobby') return;
    clearTimeout(ch.timer as number);
    if (ch.seats.length < CH_MIN_SEATS) {
      if (ch.seats.includes(me())) post(ch.bet, 'game_refund', 'round');
      Object.assign(ch, { phase: 'idle', roundId: null, seats: [], deadline: null, folded: true });
      emit('chinchiro');
      return;
    }
    ch.hands = ch.seats.map((userId, i) => ({
      userId,
      roundId: `ch_seat${i}_${roundCounter}`,
      rolled: false,
      rolls: [],
    }));
    ch.phase = 'rolling';
    ch.deadline = Date.now() + CH_ROLL_MS;
    emit('chinchiro');
    // the other seats roll after a moment; the rest is rolled when the window ends
    ch.hands.forEach((h, i) => {
      if (h.userId === me()) return;
      later(1_500 + i * 1_200, () => {
        if (ch.phase !== 'rolling' || h.rolled) return;
        Object.assign(h, { rolled: true, rolls: rollHand() });
        if (ch.hands.every((x) => x.rolled)) finishChTable();
        else emit('chinchiro');
      });
    });
    ch.timer = setTimeout(finishChTable, CH_ROLL_MS);
  };
  const sitChTable = (
    stake: number,
    roundId?: string,
  ): { tableRound: string; roundId: string; host: boolean; deadline: number | null } => {
    if (ch.phase === 'rolling' || ch.phase === 'result') throw new GameError('conflict');
    if (ch.phase === 'lobby') {
      if (roundId !== undefined && roundId !== ch.roundId) throw new GameError('conflict');
      if (ch.seats.includes(me())) throw new GameError('conflict');
      if (stake !== ch.bet) throw new GameError('invalid_payload');
      debit(stake);
      ch.seats.push(me());
      emit('chinchiro');
      return {
        tableRound: ch.roundId as string,
        roundId: newRound('ch'),
        host: false,
        deadline: ch.deadline,
      };
    }
    debit(stake);
    Object.assign(ch, {
      phase: 'lobby',
      roundId: newRound('cht'),
      bet: stake,
      hostId: me(),
      seats: [me()],
      deadline: Date.now() + 20_000,
      folded: false,
    });
    ch.timer = setTimeout(startChTable, 20_000);
    later(3_000, () => {
      if (ch.phase === 'lobby' && ch.seats.length < 6) {
        ch.seats.push(BOT_A);
        emit('chinchiro');
      }
    });
    later(7_000, () => {
      if (ch.phase === 'lobby' && ch.seats.length < 6) {
        ch.seats.push(BOT_B);
        emit('chinchiro');
      }
    });
    emit('chinchiro');
    return {
      tableRound: ch.roundId as string,
      roundId: newRound('ch'),
      host: true,
      deadline: ch.deadline,
    };
  };

  // ---- roulette ----------------------------------------------------------------------------
  const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const MULT_BY_KIND: Record<string, number> = {
    red: 2,
    black: 2,
    even: 2,
    odd: 2,
    low: 2,
    high: 2,
    dozen1: 3,
    dozen2: 3,
    dozen3: 3,
    number: 36,
  };
  const wins = (line: RouletteLineView, n: number): boolean => {
    switch (line.kind) {
      case 'red':
        return RED.has(n);
      case 'black':
        return n !== 0 && !RED.has(n);
      case 'even':
        return n !== 0 && n % 2 === 0;
      case 'odd':
        return n % 2 === 1;
      case 'low':
        return n >= 1 && n <= 18;
      case 'high':
        return n >= 19;
      case 'dozen1':
        return n >= 1 && n <= 12;
      case 'dozen2':
        return n >= 13 && n <= 24;
      case 'dozen3':
        return n >= 25;
      default:
        return line.number === n;
    }
  };
  const rl = {
    phase: 'idle' as 'idle' | 'betting' | 'spinning' | 'result',
    roundId: null as string | null,
    deadline: null as number | null,
    bets: [] as { userId: string; roundId: string; stake: number; lines: RouletteLineView[] }[],
    result: null as number | null,
    timeline: null as SpinFrameView[] | null,
    history: [17, 4, 32, 0, 21, 8, 29] as number[],
    payouts: [] as { userId: string; payout: number; net: number }[],
  };
  snapshots.set('roulette', () => {
    const bettors = [...new Set(rl.bets.map((b) => b.userId))];
    const show = rl.phase === 'spinning' || rl.phase === 'result';
    return snap(
      'roulette',
      rl.roundId,
      rl.phase,
      bettors.map((userId, index) => ({ index, userId })),
      {
        deadline: rl.deadline,
        minBet: MIN_BET,
        history: rl.history,
        bets: rl.bets,
        ...(show && rl.result !== null
          ? {
              result: rl.result,
              color: rl.result === 0 ? 'green' : RED.has(rl.result) ? 'red' : 'black',
              timeline: rl.timeline,
            }
          : {}),
        ...(rl.phase === 'result' ? { payouts: rl.payouts } : {}),
      } satisfies RouletteTableData,
    );
  });
  const spinRoulette = () => {
    if (rl.phase !== 'betting') return;
    const result = int(37);
    rl.result = result;
    rl.timeline = [
      { atMs: 0, kind: 'start' },
      { atMs: 900, kind: 'bounce', pocket: int(37) },
      { atMs: 1800, kind: 'slow', pocket: int(37) },
      { atMs: 2700, kind: 'result', pocket: result },
    ];
    rl.phase = 'spinning';
    rl.deadline = Date.now() + 2700;
    emit('roulette');
    later(2700, () => {
      rl.payouts = rl.bets.map((b) => {
        const payout = b.lines.reduce(
          (n, l) => n + (wins(l, result) ? l.stake * (MULT_BY_KIND[l.kind] ?? 0) : 0),
          0,
        );
        if (b.userId === me()) settle('roulette', b.roundId, b.stake, payout);
        return { userId: b.userId, payout, net: payout - b.stake };
      });
      rl.history = [result, ...rl.history].slice(0, 12);
      rl.phase = 'result';
      rl.deadline = null;
      emit('roulette');
      later(6_000, () => {
        Object.assign(rl, {
          phase: 'idle',
          roundId: null,
          bets: [],
          result: null,
          timeline: null,
          payouts: [],
        });
        emit('roulette');
      });
    });
  };
  const placeRoulette = (request: BetRequest): RouletteBetAccepted => {
    if (rl.phase === 'spinning' || rl.phase === 'result') throw new GameError('conflict');
    if (rl.phase === 'betting' && request.roundId !== undefined && request.roundId !== rl.roundId) {
      throw new GameError('conflict');
    }
    const lines: RouletteLineView[] = (request.bets ?? []).map((b) => ({
      kind: b.kind as RouletteLineView['kind'],
      ...(b.kind === 'number' ? { number: Number(b.targets[0]) } : {}),
      stake: b.stake,
    }));
    if (lines.length === 0 || lines.reduce((n, l) => n + l.stake, 0) !== request.stake) {
      throw new GameError('invalid_payload');
    }
    debit(request.stake);
    if (rl.phase === 'idle') {
      Object.assign(rl, {
        phase: 'betting',
        roundId: newRound('rlt'),
        deadline: Date.now() + 12_000,
        bets: [],
      });
      later(12_000, spinRoulette);
      later(4_000, () => {
        if (rl.phase !== 'betting') return;
        rl.bets.push({
          userId: BOT_A,
          roundId: 'rl_bot_a',
          stake: 200,
          lines: [{ kind: 'red', stake: 200 }],
        });
        emit('roulette');
      });
    }
    const roundId = newRound('rl');
    rl.bets.push({ userId: me(), roundId, stake: request.stake, lines });
    emit('roulette');
    return { tableRound: rl.roundId as string, roundId, lines, deadline: rl.deadline };
  };

  // ---- blackjack ---------------------------------------------------------------------------
  const valueOf = (cards: readonly (CardView | null)[]): number => {
    let total = 0;
    let aces = 0;
    for (const c of cards) {
      if (!c) continue;
      if (c.rank === 'A') {
        aces += 1;
        total += 11;
      } else total += ['J', 'Q', 'K'].includes(c.rank) ? 10 : Number(c.rank);
    }
    while (total > 21 && aces > 0) {
      total -= 10;
      aces -= 1;
    }
    return total;
  };
  const bjResult = (cards: CardView[], dealer: CardView[]): BlackjackSeatView['result'] => {
    const p = valueOf(cards);
    const d = valueOf(dealer);
    const pBJ = cards.length === 2 && p === 21;
    const dBJ = dealer.length === 2 && d === 21;
    if (pBJ) return dBJ ? 'push' : 'blackjack';
    if (dBJ) return 'lose';
    if (p > 21) return 'bust';
    if (d > 21 || p > d) return 'win';
    return p === d ? 'push' : 'lose';
  };
  interface BjSeat {
    userId: string;
    stake: number;
    cards: CardView[];
    doubled: boolean;
    status: 'playing' | 'done';
    roundId: string;
    settlement?: SettlementView;
  }
  const bj = {
    phase: 'idle' as 'idle' | 'betting' | 'player' | 'settled',
    id: null as string | null,
    seats: [] as BjSeat[],
    dealer: [] as CardView[],
    deck: [] as CardView[],
    turn: -1,
    deadline: null as number | null,
    timer: 0 as unknown,
  };
  const bjView = (): BlackjackView => {
    const hidden = bj.phase === 'player';
    const settled = bj.phase === 'settled';
    return {
      roundId: bj.id as string,
      shared: true,
      phase: bj.phase as BlackjackView['phase'],
      dealer: hidden ? [bj.dealer[0] ?? null, null] : [...bj.dealer],
      dealerValue: hidden ? null : valueOf(bj.dealer),
      seats: bj.seats.map((s, index) => {
        const result = settled ? bjResult(s.cards, bj.dealer) : undefined;
        return {
          index,
          userId: s.userId,
          cards: s.cards,
          value: valueOf(s.cards),
          stake: s.stake,
          doubled: s.doubled,
          status: s.status,
          ...(result ? { result } : {}),
          ...(s.settlement ? { payout: s.settlement.payout, settlement: s.settlement } : {}),
        };
      }),
      turn: bj.turn,
      deadline: bj.deadline,
    };
  };
  snapshots.set('blackjack', () =>
    snap(
      'blackjack',
      bj.id,
      bj.phase,
      Array.from({ length: 5 }, (_, index) => ({ index, userId: bj.seats[index]?.userId ?? null })),
      bj.phase === 'idle' ? { minBet: MIN_BET } : bjView(),
    ),
  );
  const draw = (): CardView => bj.deck.pop() as CardView;
  const bjAdvance = () => {
    clearTimeout(bj.timer as number);
    const next = bj.seats.findIndex((s) => s.status === 'playing');
    if (next < 0) {
      bj.turn = -1;
      bj.deadline = null;
      while (valueOf(bj.dealer) < 17) bj.dealer.push(draw());
      bj.phase = 'settled';
      for (const s of bj.seats) {
        const result = bjResult(s.cards, bj.dealer);
        const payout =
          result === 'blackjack'
            ? Math.floor((s.stake * 5) / 2)
            : result === 'win'
              ? s.stake * 2
              : result === 'push'
                ? s.stake
                : 0;
        if (s.userId === me()) s.settlement = settle('blackjack', s.roundId, s.stake, payout);
        else
          s.settlement = {
            roundId: s.roundId,
            game: 'blackjack',
            stake: s.stake,
            payout,
            net: payout - s.stake,
            eventBonus: 0,
            insured: 0,
            penalty: 0,
            penaltyShortfall: 0,
            withheld: 0,
            jackpot: 0,
            jackpotPool: pool,
            balance: 0,
            tier: null,
          };
      }
      emit('blackjack');
      later(8_000, () => {
        Object.assign(bj, {
          phase: 'idle',
          id: null,
          seats: [],
          dealer: [],
          turn: -1,
          deadline: null,
        });
        emit('blackjack');
      });
      return;
    }
    bj.turn = next;
    bj.deadline = Date.now() + 30_000;
    emit('blackjack');
    const seat = bj.seats[next] as BjSeat;
    if (seat.userId !== me()) {
      bj.timer = setTimeout(() => {
        if (valueOf(seat.cards) < 17) seat.cards.push(draw());
        if (valueOf(seat.cards) >= 17) seat.status = 'done';
        bjAdvance();
      }, 1_200);
    } else {
      bj.timer = setTimeout(() => {
        seat.status = 'done';
        bjAdvance();
      }, 30_000);
    }
  };
  const bjDeal = () => {
    if (bj.phase !== 'betting') return;
    clearTimeout(bj.timer as number);
    bj.deck = SUITS_RANKS().sort(() => random() - 0.5);
    for (const s of bj.seats) s.cards = [draw(), draw()];
    bj.dealer = [draw(), draw()];
    bj.phase = 'player';
    for (const s of bj.seats) if (valueOf(s.cards) === 21) s.status = 'done';
    bjAdvance();
  };
  const SUITS_RANKS = (): CardView[] =>
    CARD_SUITS.flatMap((suit) => CARD_RANKS.map((rank) => ({ rank, suit })));
  const bjBet = (stake: number, roundId?: string): BlackjackView => {
    if (bj.phase === 'player' || bj.phase === 'settled') throw new GameError('conflict');
    if (bj.phase === 'betting' && roundId !== undefined && roundId !== bj.id)
      throw new GameError('conflict');
    if (bj.seats.some((s) => s.userId === me())) throw new GameError('conflict');
    debit(stake);
    if (bj.phase === 'idle') {
      Object.assign(bj, {
        phase: 'betting',
        id: newRound('bjt'),
        seats: [],
        dealer: [],
        turn: -1,
        deadline: Date.now() + 10_000,
      });
      bj.timer = setTimeout(bjDeal, 10_000);
      later(3_000, () => {
        if (bj.phase !== 'betting') return;
        bj.seats.push({
          userId: BOT_A,
          stake: 100,
          cards: [],
          doubled: false,
          status: 'playing',
          roundId: 'bj_bot_a',
        });
        emit('blackjack');
      });
    }
    bj.seats.push({
      userId: me(),
      stake,
      cards: [],
      doubled: false,
      status: 'playing',
      roundId: newRound('bj'),
    });
    emit('blackjack');
    return bjView();
  };
  /** Teiai's seed cap: the most it lends for a double (docs/spec/blackjack.md, Double). */
  const TEIAI_SEED = 3_000;
  const bjAct = (roundId: string, action: string, args?: ActionIntent['args']): BlackjackView => {
    const seat = bj.seats.find((s) => s.userId === me());
    if (!seat || bj.id !== roundId || bj.phase !== 'player') throw new GameError('conflict');
    if (action === 'deal') throw new GameError('conflict');
    if (bj.seats[bj.turn] !== seat) throw new GameError('conflict');
    if (action === 'hit') {
      seat.cards.push(draw());
      if (valueOf(seat.cards) >= 21) seat.status = 'done';
    } else if (action === 'stand') seat.status = 'done';
    else if (action === 'double') {
      if (seat.cards.length !== 2 || seat.doubled) throw new GameError('conflict');
      const need = seat.stake - balance();
      if (need > 0) {
        // Short of cash: only with `credit`, and only up to the seed cap, Teiai lends the rest.
        if (args?.['credit'] !== true || need > TEIAI_SEED)
          throw new GameError('insufficient_funds');
        post(need, 'loan_borrow', 'casino_double_credit');
      }
      debit(seat.stake);
      seat.stake *= 2;
      seat.doubled = true;
      seat.cards.push(draw());
      seat.status = 'done';
    } else throw new GameError('invalid_payload');
    bjAdvance();
    return bjView();
  };

  // ---- the client --------------------------------------------------------------------------
  const client: CasinoClient = {
    bet<T>(game: GameId, request: BetRequest): Promise<BetOutcome<T>> {
      try {
        let result: unknown;
        let roundId: string | undefined;
        switch (game) {
          case 'slots': {
            const r = playSlots(request.stake);
            [result, roundId] = [r, r.roundId];
            break;
          }
          case 'pachinko': {
            const sets = request.args?.['sets'];
            const r = playPachinko(request.stake, typeof sets === 'number' ? sets : 1);
            [result, roundId] = [r, r.roundId];
            break;
          }
          case 'chinchiro':
            if (request.args?.['table'] === true) {
              const r = sitChTable(request.stake, request.roundId);
              [result, roundId] = [r, r.roundId];
            } else {
              const r = startSolo(request.stake);
              [result, roundId] = [r, r.roundId];
            }
            break;
          case 'roulette': {
            const r = placeRoulette(request);
            [result, roundId] = [r, r.roundId];
            break;
          }
          case 'blackjack': {
            const r = bjBet(request.stake, request.roundId);
            [result, roundId] = [r, r.roundId];
            break;
          }
          default:
            throw new GameError('feature_disabled');
        }
        return Promise.resolve(outcome(result as T, roundId));
      } catch (error) {
        return Promise.reject(error);
      }
    },
    action<T>(
      game: GameId,
      roundId: string,
      action: string,
      args?: ActionIntent['args'],
    ): Promise<BetOutcome<T>> {
      try {
        if (game === 'chinchiro' && action === 'table_roll') {
          return Promise.resolve(outcome(rollChTable(roundId) as T, roundId));
        }
        if (game === 'chinchiro' && action === 'roll') {
          return Promise.resolve(outcome(rollSolo(roundId) as T, roundId));
        }
        if (game === 'chinchiro' && (action === 'stand' || action === 'begin')) {
          if (ch.roundId !== roundId || ch.phase !== 'lobby') throw new GameError('conflict');
          if (action === 'begin') {
            if (ch.hostId !== me()) throw new GameError('forbidden');
            startChTable();
            return Promise.resolve(
              outcome({ tableRound: roundId, seats: ch.seats.length } as T, roundId),
            );
          }
          if (!ch.seats.includes(me())) throw new GameError('conflict');
          ch.seats = ch.seats.filter((s) => s !== me());
          post(ch.bet, 'game_refund', 'round');
          emit('chinchiro');
          return Promise.resolve(outcome({ tableRound: roundId, refunded: ch.bet } as T, roundId));
        }
        if (game === 'blackjack' && action === 'deal') {
          if (bj.id !== roundId) throw new GameError('conflict');
          bjDeal();
          return Promise.resolve(outcome(bjView() as T, roundId));
        }
        if (game === 'blackjack')
          return Promise.resolve(outcome(bjAct(roundId, action, args) as T, roundId));
        throw new GameError('invalid_payload');
      } catch (error) {
        return Promise.reject(error);
      }
    },
    watchTable(game, listener) {
      const set = listeners.get(game) ?? new Set<TableListener>();
      set.add(listener);
      listeners.set(game, set);
      const build = snapshots.get(game);
      if (build) later(0, () => set.has(listener) && listener(build()));
      return () => {
        set.delete(listener);
      };
    },
    clockOffsetMs: () => 0,
  };

  return { api, client };
}

let instance: CasinoServices | null = null;

/** One mock server per page: the screens and Home share its balance, rounds and tables. */
export function getMockServices(): CasinoServices {
  instance ??= createMock();
  return instance;
}
