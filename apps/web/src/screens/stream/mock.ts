import {
  STREAM_LIMITS,
  streamOddsBps,
  type StreamList,
  type StreamRoundView,
  type StreamSettleResult,
  type StreamSide,
  type StreamTipItem,
  type StreamView,
  type TransferView,
} from '@casino/shared';
import { currentLocale } from '../../shell/i18n.ts';
import { useBalanceStore } from '../../shell/stores/balance.ts';
import { useSessionStore } from '../../shell/stores/session.ts';
import { StreamApiError, type StreamDomainEvent } from './client.ts';
import type { StreamServices } from './services.tsx';
import { calcTipFee, DEFAULT_TIP_CONFIRM_FROM, DEFAULT_TIP_FEE_BPS } from './helpers.ts';

interface MockStreamRecord {
  id: number;
  streamerId: string;
  streamerName: string;
  streamerAvatar: string | null;
  title: string;
  url: string | null;
  channelId: string | null;
  location: { channelId: string; source: 'activity' } | null;
  status: 'live' | 'ended';
  startedAt: number;
  endsAt: number;
  endedAt: number | null;
  tips: number;
  tipCount: number;
  round: StreamRoundView | null;
  recentTips: StreamTipItem[];
  bets: Map<string, { side: StreamSide; amount: number }>;
}

const STREAMER_ID = '200000000000000010';
const MOCK_GUILD_ID = 'mock-guild';

function seedStrings() {
  if (currentLocale() === 'ja') {
    return {
      streamerName: 'ミナト',
      title: '深夜のランク戦配信',
      roundLabel: '次のボス戦',
      tips: [
        {
          tipperId: '200000000000000001',
          tipperName: 'ユイ',
          amount: 5000,
          message: 'ナイスプレイ！',
        },
        {
          tipperId: '200000000000000002',
          tipperName: 'レン',
          amount: 1200,
          message: '応援しています',
        },
        {
          tipperId: '200000000000000003',
          tipperName: 'ハル',
          amount: 300,
          message: '',
        },
      ],
    };
  }
  return {
    streamerName: 'Minato',
    title: 'Late-night ranked climb',
    roundLabel: 'Next boss fight',
    tips: [
      {
        tipperId: '200000000000000001',
        tipperName: 'Yui',
        amount: 5000,
        message: 'Nice clutch!',
      },
      {
        tipperId: '200000000000000002',
        tipperName: 'Ren',
        amount: 1200,
        message: 'Good luck on the climb',
      },
      {
        tipperId: '200000000000000003',
        tipperName: 'Haru',
        amount: 300,
        message: '',
      },
    ],
  };
}

const cached = new Map<string, StreamServices>();

function createMockStreamServices(): StreamServices {
  const now = Date.now();
  const s = seedStrings();
  const streams = new Map<number, MockStreamRecord>();
  let nextStreamId = 1;
  let nextRoundId = 1;
  let sentToday = 1500;
  const replayed = new Map<string, unknown>();
  const listeners = new Set<(event: StreamDomainEvent) => void>();

  const seeded: MockStreamRecord = {
    id: nextStreamId++,
    streamerId: STREAMER_ID,
    streamerName: s.streamerName,
    streamerAvatar: null,
    title: s.title,
    url: null,
    channelId: null,
    location: { channelId: '999000000000000001', source: 'activity' },
    status: 'live',
    startedAt: now - 35 * 60_000,
    endsAt: now + 23 * 3600_000,
    endedAt: null,
    tips: 6500,
    tipCount: 3,
    round: {
      id: nextRoundId++,
      label: s.roundLabel,
      status: 'open',
      openedAt: now - 90_000,
      autoLockAt: now + STREAM_LIMITS.roundAutoLockMs - 90_000,
      lockedAt: null,
      winTotal: 4200,
      loseTotal: 2800,
      bettors: 5,
      winOddsBps: streamOddsBps(4200, 2800, 'win'),
      loseOddsBps: streamOddsBps(4200, 2800, 'lose'),
    },
    recentTips: s.tips.map((item, idx) => ({ ...item, at: now - (idx + 1) * 120_000 })),
    bets: new Map(),
  };
  streams.set(seeded.id, seeded);

  const meId = () => useSessionStore.getState().user?.id ?? '100000000000000001';
  const meName = () => {
    const u = useSessionStore.getState().user;
    return u?.globalName ?? u?.username ?? (currentLocale() === 'ja' ? 'プレイヤー' : 'Player');
  };
  const balance = () => useBalanceStore.getState().balance ?? 50_000;
  const setBalance = (next: number) => useBalanceStore.getState().set(next);
  const emit = (event: StreamDomainEvent) => {
    for (const fn of listeners) fn(event);
  };

  const toView = (rec: MockStreamRecord): StreamView => {
    const uid = meId();
    const myBet = rec.round ? (rec.bets.get(uid) ?? null) : null;
    const isStreamer = rec.streamerId === uid;
    const betRoom =
      isStreamer || !rec.round || rec.status !== 'live'
        ? 0
        : Math.max(0, STREAM_LIMITS.betMax - (myBet?.amount ?? 0));
    return {
      now: Date.now(),
      id: rec.id,
      streamerId: rec.streamerId,
      streamerName: rec.streamerName,
      streamerAvatar: rec.streamerAvatar,
      title: rec.title,
      url: rec.url,
      channelId: rec.channelId,
      location: rec.location,
      status: rec.status,
      startedAt: rec.startedAt,
      endsAt: rec.endsAt,
      endedAt: rec.endedAt,
      tips: rec.tips,
      tipCount: rec.tipCount,
      round: rec.round ? { ...rec.round } : null,
      recentTips: [...rec.recentTips],
      me: {
        isStreamer,
        balance: balance(),
        bet: myBet ? { ...myBet } : null,
        betRoom,
      },
    };
  };

  const getStream = (streamId: number): MockStreamRecord => {
    const rec = streams.get(streamId);
    if (!rec) throw new StreamApiError('not_found', 404);
    return rec;
  };

  return {
    api: {
      async streams(): Promise<StreamList> {
        const uid = meId();
        const live = [...streams.values()].filter((r) => r.status === 'live');
        const mine = live.find((r) => r.streamerId === uid)?.id ?? null;
        return {
          now: Date.now(),
          streams: live.map((r) => ({
            id: r.id,
            streamerId: r.streamerId,
            streamerName: r.streamerName,
            streamerAvatar: r.streamerAvatar,
            title: r.title,
            startedAt: r.startedAt,
            tips: r.tips,
            roundStatus: r.round?.status ?? null,
          })),
          mine,
        };
      },

      async view(streamId: number): Promise<StreamView> {
        return toView(getStream(streamId));
      },

      async transfer(): Promise<TransferView> {
        return {
          now: Date.now(),
          balance: balance(),
          debt: 0,
          gamesPlayed: 20,
          minGames: 5,
          dailyLimit: 20_000,
          sentToday,
          feeBps: DEFAULT_TIP_FEE_BPS,
          confirmFrom: DEFAULT_TIP_CONFIRM_FROM,
          maxAmount: 20_000,
        };
      },

      async start({ title, url }, key) {
        if (replayed.has(key)) return { ...(replayed.get(key) as object), replayed: true } as never;
        const trimmed = title.trim();
        if (!trimmed || trimmed.length > STREAM_LIMITS.titleMax) {
          throw new StreamApiError('invalid_payload', 400, {
            rule: 'stream_bad_title',
            params: { max: STREAM_LIMITS.titleMax },
          });
        }
        const uid = meId();
        if ([...streams.values()].some((r) => r.status === 'live' && r.streamerId === uid)) {
          throw new StreamApiError('conflict', 409, { rule: 'stream_already_live' });
        }
        const t = Date.now();
        const rec: MockStreamRecord = {
          id: nextStreamId++,
          streamerId: uid,
          streamerName: meName(),
          streamerAvatar: null,
          title: trimmed,
          url: url?.trim() ? url.trim() : null,
          channelId: null,
          location: { channelId: '999000000000000001', source: 'activity' },
          status: 'live',
          startedAt: t,
          endsAt: t + STREAM_LIMITS.maxHours * 3600_000,
          endedAt: null,
          tips: 0,
          tipCount: 0,
          round: null,
          recentTips: [],
          bets: new Map(),
        };
        streams.set(rec.id, rec);
        const res = { replayed: false, balance: balance(), stream: toView(rec) };
        replayed.set(key, res);
        emit({
          type: 'StreamStarted',
          guildId: MOCK_GUILD_ID,
          at: rec.startedAt,
          streamId: rec.id,
          streamerId: rec.streamerId,
          title: rec.title,
          url: rec.url,
          channelId: rec.channelId,
        });
        return res;
      },

      async tip({ streamId, amount, message }, key) {
        if (replayed.has(key)) return { ...(replayed.get(key) as object), replayed: true } as never;
        const rec = getStream(streamId);
        if (rec.status !== 'live') {
          throw new StreamApiError('conflict', 409, { rule: 'stream_ended' });
        }
        if (rec.streamerId === meId()) {
          throw new StreamApiError('conflict', 409, { rule: 'stream_self_tip' });
        }
        if (amount < STREAM_LIMITS.tipMin) {
          throw new StreamApiError('invalid_payload', 400, {
            rule: 'stream_tip_min',
            params: { min: STREAM_LIMITS.tipMin },
          });
        }
        const fee = calcTipFee(amount, DEFAULT_TIP_FEE_BPS);
        const total = amount + fee;
        if (total > balance()) {
          throw new StreamApiError('insufficient_funds', 409, {
            rule: 'transfer_insufficient_balance',
          });
        }
        if (sentToday + amount > 20_000) {
          throw new StreamApiError('conflict', 409, {
            rule: 'transfer_daily_limit',
            params: { limit: 20_000, remaining: Math.max(0, 20_000 - sentToday) },
          });
        }
        setBalance(balance() - total);
        sentToday += amount;
        rec.tips += amount;
        rec.tipCount += 1;
        const cleanMsg = (message ?? '').trim().slice(0, STREAM_LIMITS.tipMessageMax);
        const at = Date.now();
        rec.recentTips = [
          {
            tipperId: meId(),
            tipperName: meName(),
            amount,
            message: cleanMsg,
            at,
          },
          ...rec.recentTips,
        ].slice(0, STREAM_LIMITS.recentTipsMax);
        const res = {
          replayed: false,
          balance: balance(),
          stream: toView(rec),
          amount,
          fee,
          received: amount,
          withheld: 0,
        };
        replayed.set(key, res);
        emit({
          type: 'StreamTipped',
          guildId: MOCK_GUILD_ID,
          at,
          streamId: rec.id,
          streamerId: rec.streamerId,
          tipperId: meId(),
          amount,
          fee,
          message: cleanMsg,
          tips: rec.tips,
          tipCount: rec.tipCount,
        });
        return res;
      },

      async bet({ streamId, roundId, side, amount }, key) {
        if (replayed.has(key)) return { ...(replayed.get(key) as object), replayed: true } as never;
        const rec = getStream(streamId);
        if (rec.status !== 'live') {
          throw new StreamApiError('conflict', 409, { rule: 'stream_ended' });
        }
        if (!rec.round || rec.round.id !== roundId) {
          throw new StreamApiError('conflict', 409, { rule: 'stream_round_changed' });
        }
        if (rec.round.status !== 'open' || Date.now() >= rec.round.autoLockAt) {
          throw new StreamApiError('conflict', 409, { rule: 'stream_no_open_round' });
        }
        if (rec.streamerId === meId()) {
          throw new StreamApiError('conflict', 409, { rule: 'stream_self_bet' });
        }
        if (amount < STREAM_LIMITS.betMin) {
          throw new StreamApiError('invalid_payload', 400, {
            rule: 'stream_bet_min',
            params: { min: STREAM_LIMITS.betMin },
          });
        }
        const prev = rec.bets.get(meId());
        if (prev && prev.side !== side) {
          throw new StreamApiError('conflict', 409, { rule: 'stream_other_side' });
        }
        const already = prev?.amount ?? 0;
        if (already + amount > STREAM_LIMITS.betMax) {
          throw new StreamApiError('conflict', 409, {
            rule: 'stream_bet_max',
            params: { max: STREAM_LIMITS.betMax, already },
          });
        }
        if (amount > balance()) {
          throw new StreamApiError('insufficient_funds', 409);
        }
        setBalance(balance() - amount);
        if (!prev) rec.round.bettors += 1;
        rec.bets.set(meId(), { side, amount: already + amount });
        if (side === 'win') rec.round.winTotal += amount;
        else rec.round.loseTotal += amount;
        rec.round.winOddsBps = streamOddsBps(rec.round.winTotal, rec.round.loseTotal, 'win');
        rec.round.loseOddsBps = streamOddsBps(rec.round.winTotal, rec.round.loseTotal, 'lose');
        const res = {
          replayed: false,
          balance: balance(),
          stream: toView(rec),
          side,
          total: already + amount,
        };
        replayed.set(key, res);
        emit({
          type: 'StreamBetPlaced',
          guildId: MOCK_GUILD_ID,
          at: Date.now(),
          streamId: rec.id,
          roundId: rec.round.id,
          side,
          winTotal: rec.round.winTotal,
          loseTotal: rec.round.loseTotal,
          bettors: rec.round.bettors,
        });
        return res;
      },

      async openRound({ streamId, label }, key) {
        if (replayed.has(key)) return { ...(replayed.get(key) as object), replayed: true } as never;
        const rec = getStream(streamId);
        if (rec.streamerId !== meId() || rec.status !== 'live') {
          throw new StreamApiError('forbidden', 403, { rule: 'stream_not_streamer' });
        }
        if (rec.round) {
          throw new StreamApiError('conflict', 409, { rule: 'stream_round_active' });
        }
        const t = Date.now();
        rec.round = {
          id: nextRoundId++,
          label: (label ?? '').trim().slice(0, STREAM_LIMITS.roundLabelMax),
          status: 'open',
          openedAt: t,
          autoLockAt: t + STREAM_LIMITS.roundAutoLockMs,
          lockedAt: null,
          winTotal: 0,
          loseTotal: 0,
          bettors: 0,
          winOddsBps: null,
          loseOddsBps: null,
        };
        rec.bets.clear();
        const res = { replayed: false, balance: balance(), stream: toView(rec) };
        replayed.set(key, res);
        emit({
          type: 'StreamRoundOpened',
          guildId: MOCK_GUILD_ID,
          at: rec.round.openedAt,
          streamId: rec.id,
          streamerId: rec.streamerId,
          roundId: rec.round.id,
          label: rec.round.label,
          autoLockAt: rec.round.autoLockAt,
        });
        return res;
      },

      async lock({ streamId, roundId }, key) {
        if (replayed.has(key)) return { ...(replayed.get(key) as object), replayed: true } as never;
        const rec = getStream(streamId);
        if (rec.streamerId !== meId() || rec.status !== 'live') {
          throw new StreamApiError('forbidden', 403, { rule: 'stream_not_streamer' });
        }
        if (!rec.round || rec.round.id !== roundId) {
          throw new StreamApiError('conflict', 409, { rule: 'stream_round_changed' });
        }
        const at = Date.now();
        rec.round.status = 'locked';
        rec.round.lockedAt = at;
        const res = { replayed: false, balance: balance(), stream: toView(rec) };
        replayed.set(key, res);
        emit({
          type: 'StreamRoundLocked',
          guildId: MOCK_GUILD_ID,
          at,
          streamId: rec.id,
          streamerId: rec.streamerId,
          roundId: rec.round.id,
          cause: 'streamer',
        });
        return res;
      },

      async settle({ streamId, roundId, winner }, key) {
        if (replayed.has(key)) return { ...(replayed.get(key) as object), replayed: true } as never;
        const rec = getStream(streamId);
        if (rec.streamerId !== meId() || rec.status !== 'live') {
          throw new StreamApiError('forbidden', 403, { rule: 'stream_not_streamer' });
        }
        if (!rec.round || rec.round.id !== roundId) {
          throw new StreamApiError('conflict', 409, { rule: 'stream_round_changed' });
        }
        if (rec.round.status !== 'locked' && Date.now() < rec.round.autoLockAt) {
          throw new StreamApiError('conflict', 409, { rule: 'stream_not_locked' });
        }
        const round = rec.round;
        const oneSided = round.winTotal === 0 || round.loseTotal === 0;
        const loserTotal = winner === 'win' ? round.loseTotal : round.winTotal;
        const rake = oneSided ? 0 : Math.floor((loserTotal * STREAM_LIMITS.rakeBps) / 10_000);
        const result: StreamSettleResult = {
          roundId: round.id,
          label: round.label,
          outcome: winner,
          refunded: oneSided,
          cause: 'streamer',
          bettors: round.bettors,
          winTotal: round.winTotal,
          loseTotal: round.loseTotal,
          rake,
          payoutCount: round.bettors,
          payouts: [],
        };
        rec.round = null;
        rec.bets.clear();
        const res = { replayed: false, balance: balance(), stream: toView(rec), result };
        replayed.set(key, res);
        emit({
          type: 'StreamRoundSettled',
          guildId: MOCK_GUILD_ID,
          at: Date.now(),
          streamId: rec.id,
          streamerId: rec.streamerId,
          result,
        });
        return res;
      },

      async voidRound({ streamId, roundId }, key) {
        if (replayed.has(key)) return { ...(replayed.get(key) as object), replayed: true } as never;
        const rec = getStream(streamId);
        if (rec.streamerId !== meId() || rec.status !== 'live') {
          throw new StreamApiError('forbidden', 403, { rule: 'stream_not_streamer' });
        }
        if (!rec.round || rec.round.id !== roundId) {
          throw new StreamApiError('conflict', 409, { rule: 'stream_round_changed' });
        }
        const round = rec.round;
        const result: StreamSettleResult = {
          roundId: round.id,
          label: round.label,
          outcome: 'void',
          refunded: true,
          cause: 'streamer',
          bettors: round.bettors,
          winTotal: round.winTotal,
          loseTotal: round.loseTotal,
          rake: 0,
          payoutCount: round.bettors,
          payouts: [],
        };
        rec.round = null;
        rec.bets.clear();
        const res = { replayed: false, balance: balance(), stream: toView(rec), result };
        replayed.set(key, res);
        emit({
          type: 'StreamRoundSettled',
          guildId: MOCK_GUILD_ID,
          at: Date.now(),
          streamId: rec.id,
          streamerId: rec.streamerId,
          result,
        });
        return res;
      },

      async end({ streamId }, key) {
        if (replayed.has(key)) return { ...(replayed.get(key) as object), replayed: true } as never;
        const rec = getStream(streamId);
        if (rec.streamerId !== meId() || rec.status !== 'live') {
          throw new StreamApiError('forbidden', 403, { rule: 'stream_not_streamer' });
        }
        let voided: StreamSettleResult | null = null;
        const at = Date.now();
        if (rec.round) {
          voided = {
            roundId: rec.round.id,
            label: rec.round.label,
            outcome: 'void',
            refunded: true,
            cause: 'stream_end',
            bettors: rec.round.bettors,
            winTotal: rec.round.winTotal,
            loseTotal: rec.round.loseTotal,
            rake: 0,
            payoutCount: rec.round.bettors,
            payouts: [],
          };
          rec.round = null;
          rec.bets.clear();
          emit({
            type: 'StreamRoundSettled',
            guildId: MOCK_GUILD_ID,
            at,
            streamId: rec.id,
            streamerId: rec.streamerId,
            result: voided,
          });
        }
        rec.status = 'ended';
        rec.endedAt = at;
        const res = { replayed: false, balance: balance(), stream: toView(rec), voided };
        replayed.set(key, res);
        emit({
          type: 'StreamEnded',
          guildId: MOCK_GUILD_ID,
          at,
          streamId: rec.id,
          streamerId: rec.streamerId,
          cause: 'streamer',
          tips: rec.tips,
          tipCount: rec.tipCount,
        });
        return res;
      },
    },
    socket: {
      join(streamId, onSnapshot) {
        const rec = streams.get(streamId);
        if (rec) queueMicrotask(() => onSnapshot(toView(rec)));
        return () => undefined;
      },
      onEvent(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
  };
}

export function getMockStreamServices(): StreamServices {
  const locale = currentLocale();
  let services = cached.get(locale);
  if (!services) {
    services = createMockStreamServices();
    cached.set(locale, services);
  }
  return services;
}
