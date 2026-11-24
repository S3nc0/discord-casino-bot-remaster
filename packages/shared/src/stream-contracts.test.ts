import { describe, expect, it } from 'vitest';
import type { TSchema } from 'typebox';
import { Value } from 'typebox/value';
import {
  DOMAIN_EVENT_TYPES,
  DomainEvent,
  LEDGER_REASONS,
  LEDGER_REASON_FLOW,
  LEDGER_REASON_SIGN,
  SCREEN_IDS,
  STREAM_LIMITS,
  STREAM_ODDS_ONE,
  STREAM_ROUTES,
  STREAM_RULES,
  STREAM_TIP_COLOR_DEFAULT,
  StreamAuditEntry,
  StreamBetRequest,
  StreamEndRequest,
  StreamError,
  StreamList,
  StreamOpenRequest,
  StreamRoundRequest,
  StreamSettleRequest,
  StreamSettleResponse,
  StreamSettleResult,
  StreamStartRequest,
  StreamTipRequest,
  StreamView,
  StreamViewQuery,
  canJoinRoom,
  isDeltaAllowed,
  parseRoom,
  rooms,
  streamOddsBps,
  streamTipColor,
  CLIENT_PAYLOADS,
} from './index.ts';
import { en, ja, screenMessageKey, t } from '../i18n/index.ts';

const GUILD = '123456789012345678';
const STREAMER = '234567890123456789';
const VIEWER = '345678901234567890';
const KEY = 'abcdefghijklmnop0123';
const AT = 1_790_000_000_000;

const result = {
  roundId: 7,
  label: 'Boss fight',
  outcome: 'win',
  refunded: false,
  cause: 'streamer',
  bettors: 3,
  winTotal: 4_000,
  loseTotal: 2_000,
  rake: 100,
  payoutCount: 2,
  payouts: [
    { userId: VIEWER, amount: 4_425 },
    { userId: STREAMER, amount: 1_475 },
  ],
} as const;

const view = {
  now: AT,
  id: 1,
  streamerId: STREAMER,
  streamerName: 'Streamer',
  streamerAvatar: null,
  title: 'Evening run',
  url: null,
  channelId: GUILD,
  location: { channelId: GUILD, source: 'activity' },
  status: 'live',
  startedAt: AT,
  endsAt: AT + STREAM_LIMITS.maxHours * 3_600_000,
  endedAt: null,
  tips: 1_000,
  tipCount: 2,
  round: {
    id: 7,
    label: 'Boss fight',
    status: 'open',
    openedAt: AT,
    autoLockAt: AT + STREAM_LIMITS.roundAutoLockMs,
    lockedAt: null,
    winTotal: 4_000,
    loseTotal: 2_000,
    bettors: 3,
    winOddsBps: 14_750,
    loseOddsBps: null,
  },
  recentTips: [{ tipperId: VIEWER, tipperName: 'Viewer', amount: 500, message: 'gg', at: AT }],
  me: { isStreamer: false, balance: 3_000, bet: { side: 'win', amount: 1_000 }, betRoom: 9_000 },
} as const;

describe('stream ledger reasons', () => {
  it('appends stream_bet, stream_payout and stream_refund after the earlier waves', () => {
    const at = LEDGER_REASONS.indexOf('quiz_author_pay');
    expect(LEDGER_REASONS.slice(at + 1, at + 4)).toEqual([
      'stream_bet',
      'stream_payout',
      'stream_refund',
    ]);
  });

  it('classifies them: the bet is a sink, payout and refund are faucets', () => {
    expect(LEDGER_REASON_FLOW.stream_bet).toBe('sink');
    expect(LEDGER_REASON_FLOW.stream_payout).toBe('faucet');
    expect(LEDGER_REASON_FLOW.stream_refund).toBe('faucet');
    expect(LEDGER_REASON_SIGN.stream_bet).toBe(-1);
    expect(LEDGER_REASON_SIGN.stream_payout).toBe(1);
    expect(LEDGER_REASON_SIGN.stream_refund).toBe(1);
  });

  it('allows only the right direction', () => {
    expect(isDeltaAllowed('stream_bet', -100)).toBe(true);
    expect(isDeltaAllowed('stream_bet', 100)).toBe(false);
    expect(isDeltaAllowed('stream_payout', 1_475)).toBe(true);
    expect(isDeltaAllowed('stream_payout', -1)).toBe(false);
    expect(isDeltaAllowed('stream_refund', 0)).toBe(false);
  });

  it('has an EN and a JA history label for each', () => {
    for (const r of ['stream_bet', 'stream_payout', 'stream_refund'] as const) {
      const key = `screen.casino.history.reason.${r}` as const;
      expect(en[key].length).toBeGreaterThan(0);
      expect(ja[key].length).toBeGreaterThan(0);
    }
  });
});

describe('stream screen, room and socket contracts', () => {
  it('adds the stream screen with a label in both languages', () => {
    expect(SCREEN_IDS).toContain('stream');
    expect(en[screenMessageKey('stream')]).toBe('Stream');
    expect(ja[screenMessageKey('stream')]).toBe('配信');
  });

  it('builds and parses the stream room', () => {
    expect(rooms.stream(GUILD, 12)).toBe(`stream:${GUILD}:12`);
    expect(parseRoom(rooms.stream(GUILD, 12))).toEqual({
      kind: 'stream',
      guildId: GUILD,
      streamId: 12,
    });
    for (const bad of [
      'stream:',
      `stream:${GUILD}`,
      `stream:${GUILD}:`,
      `stream:${GUILD}:0`,
      `stream:${GUILD}:x`,
      `stream:${GUILD}:1:2`,
    ]) {
      expect(parseRoom(bad)).toBeNull();
    }
  });

  it('lets a session join a stream room of its own guild only', () => {
    const scope = { userId: VIEWER, guildId: GUILD, instanceId: 'i-1' };
    expect(canJoinRoom(scope, rooms.stream(GUILD, 3))).toBe(true);
    expect(canJoinRoom(scope, rooms.stream('999999999999999999', 3))).toBe(false);
  });

  it('validates the stream join and leave payloads', () => {
    expect(Value.Check(CLIENT_PAYLOADS['stream:join'], { streamId: 5 })).toBe(true);
    expect(Value.Check(CLIENT_PAYLOADS['stream:join'], { streamId: 0 })).toBe(false);
    expect(Value.Check(CLIENT_PAYLOADS['stream:leave'], { streamId: 5, extra: 1 })).toBe(false);
  });
});

describe('stream domain events', () => {
  const base = { guildId: GUILD, at: AT };
  const events = [
    {
      ...base,
      type: 'StreamStarted',
      streamId: 1,
      streamerId: STREAMER,
      title: 'Evening run',
      url: 'https://example.com/live',
      channelId: GUILD,
    },
    {
      ...base,
      type: 'StreamTipped',
      streamId: 1,
      streamerId: STREAMER,
      tipperId: VIEWER,
      amount: 500,
      fee: 50,
      message: 'gg',
      tips: 500,
      tipCount: 1,
    },
    {
      ...base,
      type: 'StreamBetPlaced',
      streamId: 1,
      roundId: 7,
      side: 'lose',
      winTotal: 0,
      loseTotal: 1_000,
      bettors: 1,
    },
    {
      ...base,
      type: 'StreamRoundOpened',
      streamId: 1,
      streamerId: STREAMER,
      roundId: 7,
      label: 'Boss fight',
      autoLockAt: AT + STREAM_LIMITS.roundAutoLockMs,
    },
    {
      ...base,
      type: 'StreamRoundLocked',
      streamId: 1,
      streamerId: STREAMER,
      roundId: 7,
      cause: 'auto',
    },
    { ...base, type: 'StreamRoundSettled', streamId: 1, streamerId: STREAMER, result },
    {
      ...base,
      type: 'StreamEnded',
      streamId: 1,
      streamerId: STREAMER,
      cause: 'timeout',
      tips: 500,
      tipCount: 1,
    },
  ];

  it('registers every stream event once', () => {
    for (const e of events) expect(DOMAIN_EVENT_TYPES).toContain(e.type);
    const members = DomainEvent.anyOf.map((s) => s.properties.type.const as string);
    expect([...members].sort()).toEqual([...DOMAIN_EVENT_TYPES].sort());
  });

  it('validates each example and rejects a bad cause', () => {
    for (const e of events) expect(Value.Check(DomainEvent, e)).toBe(true);
    expect(Value.Check(DomainEvent, { ...events[4], cause: 'owner' })).toBe(false);
    expect(Value.Check(DomainEvent, { ...events[6], cause: 'owner' })).toBe(false);
  });

  it('never carries a userId, so the socket layer cannot route one to a single user', () => {
    for (const e of events) expect('userId' in e).toBe(false);
  });
});

describe('stream HTTP contracts', () => {
  it('lists the nine write/read routes under /api/stream, all different', () => {
    const paths = Object.values(STREAM_ROUTES);
    expect(Object.keys(STREAM_ROUTES).sort()).toEqual(
      ['bet', 'end', 'lock', 'open', 'settle', 'start', 'streams', 'tip', 'view', 'void'].sort(),
    );
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of paths) expect(p.startsWith('/api/stream')).toBe(true);
  });

  it('accepts a good request of every write and rejects unknown properties', () => {
    const ok: [TSchema, object][] = [
      [StreamStartRequest, { idempotencyKey: KEY, title: 'Evening run', url: 'https://x.test/y' }],
      [StreamTipRequest, { idempotencyKey: KEY, streamId: 1, amount: 100, message: 'gg' }],
      [
        StreamBetRequest,
        { idempotencyKey: KEY, streamId: 1, roundId: 7, side: 'win', amount: 100 },
      ],
      [StreamOpenRequest, { idempotencyKey: KEY, streamId: 1 }],
      [StreamRoundRequest, { idempotencyKey: KEY, streamId: 1, roundId: 7 }],
      [StreamSettleRequest, { idempotencyKey: KEY, streamId: 1, roundId: 7, winner: 'lose' }],
      [StreamEndRequest, { idempotencyKey: KEY, streamId: 1 }],
      [StreamViewQuery, { streamId: 1 }],
    ];
    for (const [schema, body] of ok) {
      expect(Value.Check(schema, body)).toBe(true);
      // a client cannot name the streamer, the winner of a bet or a payout
      expect(Value.Check(schema, { ...body, streamerId: STREAMER })).toBe(false);
    }
  });

  it('bounds title, message, label and side', () => {
    const long = (n: number) => 'x'.repeat(n);
    expect(Value.Check(StreamStartRequest, { idempotencyKey: KEY, title: '' })).toBe(false);
    expect(
      Value.Check(StreamStartRequest, {
        idempotencyKey: KEY,
        title: long(STREAM_LIMITS.titleMax + 1),
      }),
    ).toBe(false);
    expect(
      Value.Check(StreamTipRequest, {
        idempotencyKey: KEY,
        streamId: 1,
        amount: 100,
        message: long(STREAM_LIMITS.tipMessageMax + 1),
      }),
    ).toBe(false);
    expect(
      Value.Check(StreamOpenRequest, {
        idempotencyKey: KEY,
        streamId: 1,
        label: long(STREAM_LIMITS.roundLabelMax + 1),
      }),
    ).toBe(false);
    expect(
      Value.Check(StreamBetRequest, {
        idempotencyKey: KEY,
        streamId: 1,
        roundId: 7,
        side: 'draw',
        amount: 100,
      }),
    ).toBe(false);
  });

  it('names the round on lock, settle and void so a double click cannot hit the next round', () => {
    expect(Value.Check(StreamRoundRequest, { idempotencyKey: KEY, streamId: 1 })).toBe(false);
    expect(Value.Check(StreamSettleRequest, { idempotencyKey: KEY, streamId: 1, roundId: 7 })).toBe(
      false,
    );
  });

  it('validates the views, the settle result and the audit row', () => {
    expect(Value.Check(StreamView, view)).toBe(true);
    expect(Value.Check(StreamView, { ...view, round: null, location: null })).toBe(true);
    expect(Value.Check(StreamView, { ...view, round: { ...view.round, status: 'win' } })).toBe(
      false,
    );
    expect(
      Value.Check(StreamList, {
        now: AT,
        streams: [
          {
            id: 1,
            streamerId: STREAMER,
            streamerName: 'Streamer',
            streamerAvatar: null,
            title: 'Evening run',
            startedAt: AT,
            tips: 0,
            roundStatus: 'locked',
          },
        ],
        mine: null,
      }),
    ).toBe(true);
    expect(Value.Check(StreamSettleResult, result)).toBe(true);
    expect(
      Value.Check(StreamSettleResponse, { replayed: false, balance: 10, stream: view, result }),
    ).toBe(true);
    expect(
      Value.Check(StreamAuditEntry, {
        roundId: 7,
        streamId: 1,
        guildId: GUILD,
        streamerId: STREAMER,
        label: 'Boss fight',
        openedAt: AT,
        lockedAt: AT + 1_000,
        endedAt: AT + 2_000,
        outcome: 'void',
        cause: 'owner',
        actorId: VIEWER,
        reason: 'streamer threw the round',
        bettors: 3,
        winTotal: 4_000,
        loseTotal: 2_000,
        rake: 0,
        refunded: true,
        top: [],
      }),
    ).toBe(true);
  });

  it('carries a stream rule in the error body', () => {
    expect(
      Value.Check(StreamError, { error: 'conflict', rule: 'stream_not_locked', params: {} }),
    ).toBe(true);
  });
});

describe('stream rules and messages', () => {
  it('has no duplicate rule and includes the D3 additions', () => {
    expect(new Set(STREAM_RULES).size).toBe(STREAM_RULES.length);
    expect(STREAM_RULES).toContain('stream_not_locked');
    for (const r of STREAM_RULES) expect(r).toMatch(/^stream_[a-z_]+$/);
  });

  it('has an EN and a JA message for every rule', () => {
    for (const r of STREAM_RULES) {
      const key = `screen.stream.rule.${r}` as const;
      expect(en[key], key).toBeTruthy();
      expect(ja[key], key).toBeTruthy();
    }
  });

  it('keeps the upstream JA wording of the refusals', () => {
    expect(ja['screen.stream.rule.stream_self_bet']).toBe('配信者は、自分の勝負に賭けられません。');
    expect(t('ja', 'screen.stream.rule.stream_bet_max', { max: 10_000, already: 6_000 })).toBe(
      '1回の勝負に賭けられるのは、1人 10000ペリカ までです（いま 6000ペリカ 賭けています）。',
    );
    expect(t('en', 'screen.stream.rule.stream_tip_min', { min: 100 })).toBe(
      'Super chats start at 100 Pelica.',
    );
  });
});

describe('stream numbers and helpers', () => {
  it('pins the numbers of docs/spec/stream.md', () => {
    expect(STREAM_LIMITS).toMatchObject({
      titleMax: 100,
      maxHours: 24,
      tipMin: 100,
      tipMessageMax: 150,
      betMin: 100,
      betMax: 10_000,
      rakeBps: 500,
      roundLabelMax: 60,
      roundAutoLockMs: 600_000,
    });
  });

  it('colours a tip by tier', () => {
    expect(streamTipColor(99)).toBe(STREAM_TIP_COLOR_DEFAULT);
    expect(streamTipColor(100)).toBe(STREAM_TIP_COLOR_DEFAULT);
    expect(streamTipColor(500)).toBe(0x00e5ff);
    expect(streamTipColor(999)).toBe(0x00e5ff);
    expect(streamTipColor(1_000)).toBe(0x1de9b6);
    expect(streamTipColor(2_000)).toBe(0xffca28);
    expect(streamTipColor(5_000)).toBe(0xf57c00);
    expect(streamTipColor(10_000)).toBe(0xe91e63);
    expect(streamTipColor(20_000)).toBe(0xe62117);
    expect(streamTipColor(1_000_000)).toBe(0xe62117);
  });

  it('computes indicative odds from the worked example', () => {
    // win 1,000 + 3,000, lose 2,000: the pot is 1,900, so a win side pays 1 + 1,900 / 4,000.
    expect(streamOddsBps(4_000, 2_000, 'win')).toBe(STREAM_ODDS_ONE + 4_750);
    // lose side: 1 + (4,000 - 200) / 2,000 = 2.9
    expect(streamOddsBps(4_000, 2_000, 'lose')).toBe(STREAM_ODDS_ONE + 19_000);
  });

  it('has no odds while a side is empty', () => {
    expect(streamOddsBps(0, 1_000, 'win')).toBeNull();
    expect(streamOddsBps(1_000, 0, 'lose')).toBeNull();
    expect(streamOddsBps(0, 0, 'win')).toBeNull();
  });
});
