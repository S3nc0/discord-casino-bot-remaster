import type {
  LotteryView,
  MarketLotView,
  MissionsView,
  PollItem,
  PollsView,
  QuizItem,
  QuizMine,
  NetWorthView,
  RankingView,
  SeizedLotView,
  ShopItem,
  ToolWire,
  TransferMember,
  WorkView,
  WorkerKindWire,
} from '@casino/shared';
import { useBalanceStore } from '../../shell/stores/balance.ts';
import { LifeApiError, type LifeApi } from './client.ts';

/**
 * In-memory stand-in for the life routes, used by the mock shell (`VITE_MOCK_DISCORD=1`), the
 * screenshot run and previews. It keeps the rules that shape the screens (costs, limits, one
 * answer per quiz) but none of the server's maths. Loaded only in mock mode.
 */
export function createMockLifeApi(now: () => number = () => Date.now()): LifeApi {
  const rule = (name: string, code: 'conflict' | 'insufficient_funds' = 'conflict'): never => {
    throw new LifeApiError(code, 409, { rule: name });
  };
  let balance = useBalanceStore.getState().balance ?? 12_400;
  const spend = (amount: number) => {
    if (amount > balance) rule('insufficient_balance', 'insufficient_funds');
    balance -= amount;
    useBalanceStore.getState().set(balance);
  };
  const earn = (amount: number) => {
    balance += amount;
    useBalanceStore.getState().set(balance);
  };
  const min = 60_000;

  // ---- labor
  const work = {
    pick: 2,
    glove: 1,
    dorm: 0,
    fatigue: 35,
    clicks: 120,
    dayClicks: 120,
    pot: 1240,
    lastClick: 0,
    drinks: 3,
    workers: [
      { id: 1, kind: 'miner' as WorkerKindWire, expiresAt: now() + 20 * 60 * min, renew: true },
      { id: 2, kind: 'apprentice' as WorkerKindWire, expiresAt: now() + 7 * 60 * min, renew: true },
    ],
    ores: { coal: 7, copper: 2 } as Record<string, number>,
    relics: { relic_fossil: 1 } as Record<string, number>,
    held: { relic_fossil: 12, relic_bone: 3, relic_vase_s1: 1 } as Record<string, number>,
  };
  const UP = [150, 400, 900, 1800, 3500, 7000, 14_000, 28_000, 56_000, 112_000];
  const DORM = [2000, 6000, 15_000, 40_000, 100_000];
  const HIRE = [
    { kind: 'apprentice' as const, fee: 150, hourly: 1.8 },
    { kind: 'miner' as const, fee: 520, hourly: 10.05 },
    { kind: 'craftsman' as const, fee: 1160, hourly: 23.55 },
    { kind: 'foreman' as const, fee: 640, hourly: 0 },
  ];
  const workView = (): WorkView => ({
    now: now(),
    balance,
    pick: work.pick,
    glove: work.glove,
    dorm: work.dorm,
    slots: 5 + work.dorm,
    fatigue: work.fatigue,
    clicks: work.clicks,
    dayClicks: work.dayClicks,
    dayCap: 500,
    clickPay: Math.max(1, Math.round((10 + 4 * work.pick) * (1 - 0.8 * (work.fatigue / 100)))),
    pot: work.pot,
    terrain: 'hit',
    upgrade: {
      pick: UP[work.pick] ?? null,
      glove: UP[work.glove] ?? null,
      dorm: DORM[work.dorm] ?? null,
    },
    maxLevel: 10,
    dormMax: 5,
    workers: structuredClone(work.workers),
    hire: HIRE,
    ores: { ...work.ores },
    relics: { ...work.relics },
    held: { ...work.held },
    buffs: { click: 0.12, wage: 0.03, luck: 0, recovery: 0.1, daily: 0, prize: 0 },
    mergeCount: 10,
    starMax: 3,
    drinks: work.drinks,
    skimBps: 300,
  });
  const ok = () => ({ replayed: false, balance });

  // ---- quiz
  const quizzes: (QuizItem & { answer: number; explanation: string })[] = [
    {
      id: 11,
      question: 'Which planet has the most moons?',
      choices: ['Mars', 'Saturn', 'Venus', 'Mercury'],
      answer: 1,
      explanation: 'Saturn has more than 140 confirmed moons.',
      reward: 150,
      expiresAt: now() + 2 * 60 * min,
      authorName: 'Mika',
    },
    {
      id: 12,
      question: 'How many sides does a hexagon have?',
      choices: ['5', '6', '7', '8'],
      answer: 1,
      explanation: '',
      reward: 100,
      expiresAt: null,
      authorName: null,
    },
  ];
  const mine: QuizMine[] = [
    {
      id: 21,
      question: 'Largest ocean on Earth?',
      reward: 100,
      expiresAt: now() + 40 * min,
      answers: 4,
      correct: 2,
      earned: 310,
    },
  ];

  // ---- lottery
  const raffle = {
    id: 5,
    fee: 1000,
    closesAt: now() + 25 * min,
    entrants: ['Aki', 'Ren', 'Sora', 'Mika', 'Yuu'],
    joined: false,
  };

  // ---- polls
  const polls: PollItem[] = [
    {
      id: 3,
      creatorName: 'Ren',
      mine: false,
      title: 'Should the weekly ranking pay a bonus?',
      closesAt: now() + 5 * 60 * min,
      status: 'open',
      yes: 6,
      no: 2,
      voters: 8,
      myVote: null,
      verdict: 'yes',
    },
    {
      id: 2,
      creatorName: 'You',
      mine: true,
      title: 'Pizza or sushi on Friday?',
      closesAt: now() + 50 * min,
      status: 'open',
      yes: 3,
      no: 3,
      voters: 6,
      myVote: 'yes',
      verdict: 'tie',
    },
    {
      id: 1,
      creatorName: 'Aki',
      mine: false,
      title: 'Add a night mode to the arena?',
      closesAt: now() - 3 * 60 * min,
      status: 'closed',
      yes: 9,
      no: 12,
      voters: 21,
      myVote: 'no',
      verdict: 'no',
    },
  ];

  // ---- shop
  const item = (
    id: string,
    kind: ShopItem['kind'],
    price: number,
    over: Partial<ShopItem> = {},
  ): ShopItem => ({
    id,
    kind,
    price,
    owned: 0,
    available: null,
    unique: kind !== 'consumable' && kind !== 'racing',
    confirm: price >= 10_000,
    ...over,
  });
  const items: ShopItem[] = [
    item('title_rookie', 'title', 2000, { owned: 1 }),
    item('title_regular', 'title', 5000),
    item('title_lucky', 'title', 20_000),
    item('title_emperor', 'title', 100_000),
    item('cardcolor_red', 'card_color', 3000),
    item('cardcolor_gold', 'card_color', 3000),
    item('cardicon_gem', 'card_icon', 3000),
    item('daily_double', 'consumable', 3000, { owned: 1 }),
    item('insurance', 'consumable', 2000),
    item('streak_guard', 'consumable', 16_000),
    item('labor_drink', 'consumable', 300, { available: 8, owned: 3 }),
    item('horse_voucher', 'racing', 30_000),
    item('carrot', 'racing', 1000),
    item('skin_kuro', 'skin_dice', 30_000),
    item('col_beer', 'collection', 13_500),
    item('role_gold', 'color_role', 20_000),
  ];
  let colorRole: string | null = null;
  const market: MarketLotView[] = [
    {
      id: 1,
      itemId: '?',
      black: true,
      mode: 'fixed',
      qty: 2,
      price: 4200,
      expiresAt: now() + 5 * 60 * min,
      confirm: true,
    },
    {
      id: 2,
      itemId: 'insurance',
      black: false,
      mode: 'auction',
      qty: 3,
      price: 1300,
      expiresAt: now() + 3 * 60 * min,
      confirm: false,
    },
  ];
  const seized: SeizedLotView[] = [
    { id: 7, itemId: 'cardcolor_dark', qty: 1, price: 2700 },
    { id: 8, itemId: 'skin_gold_dice', qty: 1, price: 105_000 },
  ];

  // ---- transfer
  const members: TransferMember[] = ['Aki', 'Ren', 'Sora', 'Mika', 'Yuu'].map((name, i) => ({
    userId: `20000000000000010${i}`,
    name,
    avatar: null,
  }));
  let sentToday = 2000;
  const fee = (amount: number) => Math.ceil(amount / 10);

  const api: LifeApi = {
    work: () => Promise.resolve(workView()),
    workClick: () => {
      const t = now();
      if (t - work.lastClick < 1000) {
        return Promise.resolve({
          ...ok(),
          tooFast: true,
          pay: 0,
          crit: false,
          combo: false,
          ore: null,
          capped: false,
          fatigue: work.fatigue,
        });
      }
      work.lastClick = t;
      const pay = Math.max(1, Math.round((10 + 4 * work.pick) * (1 - 0.8 * (work.fatigue / 100))));
      const crit = work.clicks % 7 === 0;
      work.fatigue = Math.min(100, work.fatigue + 2.6);
      work.clicks += 1;
      work.dayClicks += 1;
      earn(crit ? pay * 5 : pay);
      return Promise.resolve({
        ...ok(),
        tooFast: false,
        pay: crit ? pay * 5 : pay,
        crit,
        combo: false,
        ore: crit ? 'copper' : null,
        capped: false,
        fatigue: work.fatigue,
      });
    },
    workCollect: () => {
      if (work.pot <= 0 && Object.keys(work.relics).length === 0) rule('labor_nothing_to_collect');
      const amount = work.pot;
      const skimmed = Math.round(amount * 0.03);
      const out = {
        amount,
        skimmed,
        withheld: 0,
        net: amount - skimmed,
        ores: { ...work.ores },
        relics: { ...work.relics },
      };
      earn(amount - skimmed);
      for (const [id, n] of Object.entries(work.relics)) work.held[id] = (work.held[id] ?? 0) + n;
      work.pot = 0;
      work.ores = {};
      work.relics = {};
      return Promise.resolve({ ...ok(), ...out });
    },
    workDrink: () => {
      if (work.fatigue < 1) rule('labor_not_tired');
      if (work.drinks < 1) rule('labor_no_drink');
      work.drinks -= 1;
      work.fatigue = Math.max(0, work.fatigue - 60);
      return Promise.resolve({ ...ok(), fatigue: work.fatigue });
    },
    workUpgrade: (tool: ToolWire | 'dorm') => {
      const level = work[tool];
      const cost = (tool === 'dorm' ? DORM : UP)[level];
      if (cost === undefined) rule('labor_max_level');
      spend(cost as number);
      work[tool] = level + 1;
      return Promise.resolve({ ...ok(), level: level + 1 });
    },
    workHire: (kind) => {
      if (work.workers.length >= 5 + work.dorm) rule('labor_dorm_full');
      spend(HIRE.find((h) => h.kind === kind)?.fee ?? 0);
      const id = Math.max(0, ...work.workers.map((w) => w.id)) + 1;
      work.workers.push({ id, kind, expiresAt: now() + 24 * 60 * min, renew: true });
      return Promise.resolve({ ...ok(), workerId: id });
    },
    workDismiss: (kind) => {
      const i = work.workers.findIndex((w) => w.kind === kind);
      if (i < 0) rule('labor_no_worker');
      work.workers.splice(i, 1);
      return Promise.resolve(ok());
    },
    workRenew: (renew) => {
      for (const w of work.workers) w.renew = renew;
      return Promise.resolve(ok());
    },
    workMerge: (itemId) => {
      if ((work.held[itemId] ?? 0) < 10) rule('relic_need_more');
      const m = /^(.*?)(?:_s(\d))?$/.exec(itemId);
      const star = Number(m?.[2] ?? 0);
      if (star >= 3) rule('relic_max_star');
      const to = `${m?.[1]}_s${star + 1}`;
      work.held[itemId] = (work.held[itemId] ?? 0) - 10;
      work.held[to] = (work.held[to] ?? 0) + 1;
      return Promise.resolve({ ...ok(), itemId: to });
    },
    workRanking: (period) =>
      Promise.resolve({
        period,
        rows: [
          {
            rank: 1,
            userId: '200000000000000101',
            name: 'Aki',
            clicks: 480,
            earned: period === 'today' ? 5400 : 91_200,
          },
          {
            rank: 2,
            userId: '200000000000000001',
            name: 'Mock Player',
            clicks: 230,
            earned: period === 'today' ? 3100 : 54_000,
          },
          {
            rank: 3,
            userId: '200000000000000102',
            name: 'Ren',
            clicks: 310,
            earned: period === 'today' ? 2250 : 40_800,
          },
        ],
        self: {
          rank: 2,
          userId: '200000000000000001',
          name: 'Mock Player',
          clicks: 230,
          earned: period === 'today' ? 3100 : 54_000,
        },
        total: 7,
      }),

    quiz: () => {
      const next = quizzes[0];
      return Promise.resolve({
        now: now(),
        balance,
        next: next
          ? {
              id: next.id,
              question: next.question,
              choices: next.choices,
              reward: next.reward,
              expiresAt: next.expiresAt,
              authorName: next.authorName,
            }
          : null,
        mine: structuredClone(mine),
        limits: {
          openLimit: 2,
          dailyLimit: 3,
          minGames: 3,
          questionMax: 500,
          choiceMax: 80,
          explanationMax: 800,
          minMinutes: 1,
          maxMinutes: 10_080,
          defaultMinutes: 4320,
        },
        gamesPlayed: 12,
      });
    },
    quizAnswer: (quizId, choice) => {
      const q = quizzes.find((x) => x.id === quizId);
      if (!q) return rule('quiz_not_found');
      quizzes.splice(quizzes.indexOf(q), 1);
      const correct = choice === q.answer;
      if (correct) earn(q.reward);
      return Promise.resolve({
        ...ok(),
        correct,
        answer: q.answer,
        explanation: q.explanation,
        reward: correct ? q.reward : 0,
        rewardBlocked: false,
      });
    },
    quizPost: (input) => {
      if (new Set(input.choices.map((c) => c.trim())).size !== 4) rule('choice_duplicate');
      if (mine.length >= 2) rule('open_limit');
      spend(input.reward);
      const id = 100 + mine.length;
      mine.push({
        id,
        question: input.question,
        reward: input.reward,
        expiresAt: now() + (input.minutes ?? 4320) * min,
        answers: 0,
        correct: 0,
        earned: 0,
      });
      return Promise.resolve({ ...ok(), quizId: id });
    },
    quizWithdraw: (quizId) => {
      const i = mine.findIndex((q) => q.id === quizId);
      if (i < 0) rule('forbidden');
      mine.splice(i, 1);
      return Promise.resolve(ok());
    },

    lottery: () =>
      Promise.resolve<LotteryView>({
        now: now(),
        balance,
        current: {
          id: raffle.id,
          hostName: 'Aki',
          fee: raffle.fee,
          closesAt: raffle.closesAt,
          pot: raffle.fee * raffle.entrants.length,
          entrantCount: raffle.entrants.length,
          entrants: [...raffle.entrants],
          joined: raffle.joined,
        },
        last: {
          id: 4,
          outcome: 'won',
          cancelled: false,
          winnerName: 'Sora',
          iWon: false,
          iEntered: true,
          prize: 4000,
          fee: 500,
          entrantCount: 8,
        },
        minEntrants: 2,
      }),
    lotteryJoin: () => {
      if (raffle.joined) rule('raffle_already_joined');
      spend(raffle.fee);
      raffle.joined = true;
      raffle.entrants.push('Mock Player');
      return Promise.resolve(ok());
    },

    polls: () =>
      Promise.resolve<PollsView>({
        now: now(),
        polls: structuredClone(polls),
        limits: { titleMax: 200, defaultMinutes: 1440, maxMinutes: 43_200, maxOpen: 5 },
      }),
    pollCreate: (input) => {
      if (input.title.trim().length === 0) rule('poll_title_invalid');
      const poll: PollItem = {
        id: 10 + polls.length,
        creatorName: 'You',
        mine: true,
        title: input.title,
        closesAt: now() + (input.minutes ?? 1440) * min,
        status: 'open',
        yes: 0,
        no: 0,
        voters: 0,
        myVote: null,
        verdict: 'tie',
      };
      polls.unshift(poll);
      return Promise.resolve({ ...ok(), poll });
    },
    pollVote: (pollId, yes) => {
      const p = polls.find((x) => x.id === pollId);
      if (!p || p.status !== 'open') return rule('poll_closed');
      if (p.myVote === 'yes') p.yes -= 1;
      if (p.myVote === 'no') p.no -= 1;
      p.myVote = yes ? 'yes' : 'no';
      if (yes) p.yes += 1;
      else p.no += 1;
      p.verdict = p.yes > p.no ? 'yes' : p.no > p.yes ? 'no' : 'tie';
      return Promise.resolve({ ...ok(), poll: structuredClone(p) });
    },

    shop: () =>
      Promise.resolve({
        now: now(),
        balance,
        debt: 0,
        confirmFrom: 10_000,
        items: structuredClone(items),
        market: structuredClone(market),
        seized: structuredClone(seized),
        colorRole,
      }),
    shopBuy: (itemId) => {
      const it = items.find((x) => x.id === itemId);
      if (!it) return rule('unknown_item');
      if (it.unique && it.owned > 0) rule('already_owned');
      spend(it.price);
      it.owned += 1;
      if (it.available !== null) it.available -= 1;
      return Promise.resolve({ ...ok(), itemId, price: it.price });
    },
    shopColorRole: (itemId) => {
      if (itemId !== null && !items.some((x) => x.id === itemId && x.owned > 0))
        return rule('not_owned');
      colorRole = itemId;
      return Promise.resolve({ ...ok(), colorRole });
    },
    shopMarketBuy: (lotId) => {
      const lot = market.find((x) => x.id === lotId);
      if (!lot) return rule('lot_gone', 'conflict');
      spend(lot.price);
      lot.qty -= 1;
      if (lot.qty < 1) market.splice(market.indexOf(lot), 1);
      return Promise.resolve({
        ...ok(),
        itemId: lot.black ? 'gold_carrot' : lot.itemId,
        price: lot.price,
        ...(lot.black ? { revealed: 'better' as const } : {}),
      });
    },
    shopSeizedBuy: (lotId) => {
      const lot = seized.find((x) => x.id === lotId);
      if (!lot) return rule('lot_gone');
      spend(lot.price);
      seized.splice(seized.indexOf(lot), 1);
      return Promise.resolve({ ...ok(), itemId: lot.itemId, price: lot.price });
    },

    missions: () =>
      Promise.resolve<MissionsView>({
        now: now(),
        day: '2026-11-22',
        resetAt: now() + 9 * 60 * min,
        missions: [
          {
            id: 'play5',
            kind: 'play',
            target: 5,
            reward: 300,
            progress: 5,
            done: true,
            game: null,
            tag: null,
          },
          {
            id: 'game_ブラックジャック',
            kind: 'play_game',
            target: 3,
            reward: 300,
            progress: 2,
            done: false,
            game: 'blackjack',
            tag: null,
          },
          {
            id: 'big3x',
            kind: 'big_win',
            target: 3,
            reward: 600,
            progress: 1,
            done: false,
            game: null,
            tag: null,
          },
        ],
        bonus: 500,
        minBet: 100,
        winStreak: 2,
        bestStreak: 6,
      }),
    netWorth: (view) => {
      const sheet = (
        id: string,
        name: string,
        liquid: number,
        fixed: number,
        liabilities: number,
        status: 'katagi' | 'wealthy' | 'underground' | 'bankrupt',
      ) => ({
        userId: id,
        name,
        status,
        groups: {
          liquid,
          fixed,
          gross: liquid + fixed,
          liabilities,
          net: liquid + fixed - liabilities,
        },
      });
      const all = [
        sheet('200000000000000101', 'Aki', 84_000, 62_000, 0, 'katagi'),
        sheet('200000000000000001', 'Mock Player', 18_640, 41_500, 3_000, 'underground'),
        sheet('200000000000000103', 'Sora', 52_300, 0, 0, 'katagi'),
        sheet('200000000000000102', 'Ren', 9_800, 30_000, 12_000, 'underground'),
        sheet('200000000000000104', 'Mika', 4_100, 2_000, 0, 'katagi'),
      ];
      const ranked = [...all]
        .map((r) => ({ ...r, value: r.groups[view] }))
        .sort((a, b) => b.value - a.value || (a.userId < b.userId ? -1 : 1))
        .map((r, i) => ({ ...r, rank: i + 1 }));
      const me = ranked.find((r) => r.userId === '200000000000000001')!;
      return Promise.resolve<NetWorthView>({
        now: now(),
        view,
        total: 9,
        rows: ranked,
        self: {
          rank: me.rank,
          value: me.value,
          groups: me.groups,
          status: me.status,
          parts: {
            cash: 12_400,
            deposit: 5_000,
            crypto: 0,
            bonds: 0,
            options: 0,
            pot: 1_240,
            escrow: 0,
            loans_lent: 0,
            items: 7_000,
            relics: 4_000,
            horses: 30_500,
            company: 0,
            tools: 0,
            debt: -3_000,
            loans_owed: 0,
          },
        },
      });
    },
    ranking: () =>
      Promise.resolve<RankingView>({
        now: now(),
        week: '2026-11-16',
        weekEnd: '2026-11-22',
        endsAt: now() + 9 * 60 * min,
        rows: [
          {
            rank: 1,
            userId: '200000000000000101',
            name: 'Aki',
            net: 18_400,
            plays: 31,
            qualified: true,
            status: 'katagi',
          },
          {
            rank: 2,
            userId: '200000000000000001',
            name: 'Mock Player',
            net: 6200,
            plays: 12,
            qualified: true,
            status: 'katagi',
          },
          {
            rank: 3,
            userId: '200000000000000103',
            name: 'Sora',
            net: 2100,
            plays: 4,
            qualified: false,
            status: 'katagi',
          },
          {
            rank: 4,
            userId: '200000000000000102',
            name: 'Ren',
            net: -900,
            plays: 9,
            qualified: false,
            status: 'underground',
          },
          {
            rank: 5,
            userId: '200000000000000104',
            name: 'Mika',
            net: -4300,
            plays: 15,
            qualified: false,
            status: 'katagi',
          },
        ],
        self: { rank: 2, net: 6200, plays: 12, total: 9 },
        minPlays: 5,
        champion: {
          userId: '200000000000000103',
          name: 'Sora',
          week: '2026-11-09',
          net: 22_000,
          wins: 3,
        },
        selfStatus: balance >= 1_000_000 ? 'wealthy' : 'katagi',
      }),

    transfer: () =>
      Promise.resolve({
        now: now(),
        balance,
        debt: 0,
        gamesPlayed: 12,
        minGames: 3,
        sentToday,
        dailyLimit: 20_000,
        feeBps: 1000,
        confirmFrom: 5000,
        maxAmount: 1_000_000,
      }),
    transferMembers: (q) =>
      Promise.resolve({
        members: members.filter((m) => m.name.toLowerCase().includes(q.toLowerCase())),
      }),
    transferPreview: (receiverId, amount) => {
      if (sentToday + amount > 20_000) {
        return Promise.resolve({
          ok: false,
          rule: 'transfer_daily_limit',
          params: { daily_limit: 20_000, sent_today: sentToday },
        });
      }
      if (balance < amount + fee(amount)) {
        return Promise.resolve({
          ok: false,
          rule: 'transfer_insufficient_balance',
          params: { need: amount + fee(amount), balance },
        });
      }
      void receiverId;
      return Promise.resolve({
        ok: true,
        amount,
        fee: fee(amount),
        total: amount + fee(amount),
        needsConfirm: amount >= 5000,
        receiverWithheld: 0,
      });
    },
    transferSend: (_receiverId, amount) => {
      spend(amount + fee(amount));
      sentToday += amount;
      return Promise.resolve({ ...ok(), amount, fee: fee(amount), received: amount, withheld: 0 });
    },
  };
  return api;
}
