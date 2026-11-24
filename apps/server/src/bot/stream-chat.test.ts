import { STREAM_PANEL_COLOR_LIVE, type DomainEvent } from '@casino/shared';
import { MessageFlags } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TestServer } from '../runtime/test-kit.ts';
import {
  GUILD,
  OTHER_USER,
  USER,
  allText,
  button,
  command,
  createTestServer,
  customIds,
  embedOf,
  fakeChannel,
  fakeClient,
  makeHandler,
  makeUser,
  modalSubmit,
} from './chat-test-kit.ts';
import { STREAM_PANEL_DEBOUNCE_MS, createStreamPanelRefresher, panelEmbed } from './stream-chat.ts';

const VIEWER_B = '333333333333333333';

let server: TestServer | null = null;
afterEach(async () => {
  vi.useRealTimers();
  if (server) await server.close();
  server = null;
});

function setup() {
  server = createTestServer({ casinoHandlers: true });
  const s = server;
  const streamer = makeUser(USER, 'streamer', 'Streamer');
  const viewer = makeUser(OTHER_USER, 'viewer', 'Viewer');
  const viewerB = makeUser(VIEWER_B, 'viewerb', 'Viewer B');
  const handler = makeHandler(s);

  const grant = (userId: string, amount: number, tag: string) => {
    s.economy.credit({
      guildId: GUILD,
      userId,
      amount,
      reason: 'admin_grant',
      idempotencyKey: `grant:${userId}:${tag}`,
    });
  };

  const setGames = (userId: string, count: number) => {
    s.economy.ensureMember(GUILD, userId);
    s.store
      .stmt(
        `INSERT INTO play_state (guild_id, user_id, games_played) VALUES (?, ?, ?)
         ON CONFLICT (guild_id, user_id) DO UPDATE SET games_played = excluded.games_played`,
      )
      .run(GUILD, userId, count);
  };

  const featureOff = () => {
    s.store
      .stmt(`INSERT INTO guild_features_off (guild_id, feature) VALUES (?, 'stream')`)
      .run(GUILD);
  };

  return { s, streamer, viewer, viewerB, handler, grant, setGames, featureOff };
}

function modalJson(modal: unknown): {
  custom_id: string;
  title: string;
  components: Array<{ components: Array<{ custom_id: string; value?: string }> }>;
} {
  return (modal as { toJSON(): never }).toJSON();
}

describe('stream chat bot', () => {
  it('/stream start posts a live red panel with persistent buttons, launch button, and attaches panel ids', async () => {
    const { s, streamer, handler } = setup();
    const start = command({
      name: 'stream',
      sub: 'start',
      id: 'start-1',
      channelId: 'chan-stream',
      user: streamer,
      strings: { title: 'Boss Rush', url: 'https://example.com/live' },
    });
    await handler(start.interaction as never);

    expect(start.out).toHaveLength(1);
    expect(start.out[0]!.kind).toBe('reply');
    expect(start.out[0]!.options.flags).toBeUndefined();

    const rawEmbed = (
      start.out[0]!.options.embeds[0] as { toJSON(): Record<string, unknown> }
    ).toJSON();
    expect(rawEmbed.color).toBe(STREAM_PANEL_COLOR_LIVE);
    expect(rawEmbed.title).toBe('🔴 Live: Boss Rush');
    expect(rawEmbed.description).toContain(`<@${USER}>`);
    expect(rawEmbed.description).toContain('📺 https://example.com/live');
    expect(rawEmbed.description).not.toContain('Location:');
    expect((rawEmbed.footer as { text: string }).text).toContain('5%');

    const stream = s.stream.list({ guildId: GUILD, userId: USER }).streams[0]!;
    expect(s.stream.panel(GUILD, stream.id)).toEqual({
      channelId: 'chan-stream',
      messageId: 'reply-start-1',
      status: 'live',
    });

    const ids = customIds(start.out[0]!.options);
    expect(ids).toEqual([
      `b:stm:tip:${stream.id}`,
      `b:stm:win:${stream.id}`,
      `b:stm:lose:${stream.id}`,
      `b:stm:menu:${stream.id}`,
      'launch:stream',
    ]);

    // Launch button creates a stream launch intent and launches the Activity.
    const launch = button('launch:stream', { user: streamer });
    await handler(launch.interaction as never);
    expect(launch.interaction.launchActivity).toHaveBeenCalledTimes(1);
    expect(s.launchIntents.consume(USER, GUILD)?.screen).toBe('stream');

    // Duplicate live stream & bad URL are refused ephemerally (test JA locale too).
    const dup = command({
      name: 'stream',
      sub: 'start',
      user: streamer,
      locale: 'ja',
      strings: { title: 'Second' },
    });
    await handler(dup.interaction as never);
    expect(dup.out[0]!.options.flags).toBe(MessageFlags.Ephemeral);
    expect(embedOf(dup.out[0]!.options).description).toContain('配信中のパネルがあります');

    const badUrl = command({
      name: 'stream',
      sub: 'start',
      user: makeUser(OTHER_USER),
      strings: { title: 'Bad URL', url: 'ftp://example.com' },
    });
    await handler(badUrl.interaction as never);
    expect(badUrl.out[0]!.options.flags).toBe(MessageFlags.Ephemeral);
    expect(embedOf(badUrl.out[0]!.options).description).toContain('https://');
  });

  it('shows location on panel only when the service already has one from the Activity', () => {
    const { s } = setup();
    const res = s.stream.start(
      { guildId: GUILD, userId: USER },
      { title: 'VC Stream', location: { channelId: 'vc-999' }, idempotencyKey: 'vc-start' },
    );
    const en = panelEmbed('en', res.stream).toJSON();
    const ja = panelEmbed('ja', res.stream).toJSON();
    expect(en.description).toContain('📍 Location: <#vc-999>');
    expect(ja.description).toContain('📍 場所: <#vc-999>');

    const chatRes = s.stream.start(
      { guildId: GUILD, userId: OTHER_USER },
      { title: 'Chat Stream', idempotencyKey: 'chat-start' },
    );
    expect(panelEmbed('en', chatRes.stream).toJSON().description).not.toContain('Location:');
  });

  it('handles tip button, modal, under-5000 instant tip, >=5000 confirm/cancel, and rule refusals', async () => {
    const { s, streamer, viewer, handler, grant, setGames } = setup();
    const events: DomainEvent[] = [];
    s.bus.onAnyDomain((e) => events.push(e));

    const stream = s.stream.start(
      { guildId: GUILD, userId: USER },
      { title: 'Tips', channelId: 'chan-1', idempotencyKey: 'st-tip' },
    ).stream;
    grant(OTHER_USER, 20_000, 'tips');

    // Tip button opens modal with amount & message inputs.
    const pressTip = button(`b:stm:tip:${stream.id}`, { user: viewer });
    await handler(pressTip.interaction as never);
    expect(pressTip.out[0]!.kind).toBe('modal');
    const modal = modalJson(pressTip.out[0]!.options);
    expect(modal.custom_id).toBe(`b:stm:mtip:${stream.id}`);
    expect(modal.components.flatMap((r) => r.components.map((c) => c.custom_id))).toEqual([
      'amount',
      'message',
    ]);

    // Non-numeric amount refused.
    const nan = modalSubmit(
      `b:stm:mtip:${stream.id}`,
      { amount: 'abc', message: '' },
      { user: viewer },
    );
    await handler(nan.interaction as never);
    expect(nan.out[0]!.options.flags).toBe(MessageFlags.Ephemeral);
    expect(embedOf(nan.out[0]!.options).description).toBe('Enter a number.');

    // Transfer rule (< 3 games) refused ephemerally in JA locale.
    setGames(OTHER_USER, 1);
    const lowGames = modalSubmit(
      `b:stm:mtip:${stream.id}`,
      { amount: '200', message: 'hi' },
      { user: viewer, locale: 'ja' },
    );
    await handler(lowGames.interaction as never);
    expect(lowGames.out[0]!.options.flags).toBe(MessageFlags.Ephemeral);
    expect(embedOf(lowGames.out[0]!.options).description).toContain('3');

    // Self-tip refused.
    setGames(USER, 3);
    const selfTip = modalSubmit(
      `b:stm:mtip:${stream.id}`,
      { amount: '200', message: '' },
      { user: streamer },
    );
    await handler(selfTip.interaction as never);
    expect(embedOf(selfTip.out[0]!.options).description).toContain(
      "can't send a super chat to your own stream",
    );

    // Debt refused.
    setGames(OTHER_USER, 3);
    s.finance.teiai.adminSetDebt(GUILD, OTHER_USER, 500);
    const debtTip = modalSubmit(
      `b:stm:mtip:${stream.id}`,
      { amount: '200', message: '' },
      { user: viewer },
    );
    await handler(debtTip.interaction as never);
    expect(embedOf(debtTip.out[0]!.options).description).toContain('debt');
    s.finance.teiai.adminSetDebt(GUILD, OTHER_USER, 0);

    // Below 5,000 tips immediately.
    const small = modalSubmit(
      `b:stm:mtip:${stream.id}`,
      { amount: '500', message: 'gl!' },
      { user: viewer, id: 'tip-small' },
    );
    await handler(small.interaction as never);
    expect(small.out[0]!.options.flags).toBe(MessageFlags.Ephemeral);
    expect(embedOf(small.out[0]!.options).title).toBe('Super chat sent');
    expect(s.stream.view({ guildId: GUILD, userId: USER }, stream.id).tips).toBe(500);

    // >= 5,000 asks for confirmation first and does NOT move money yet.
    const balBeforeBig = s.economy.getBalance(GUILD, OTHER_USER);
    const big = modalSubmit(
      `b:stm:mtip:${stream.id}`,
      { amount: '5000', message: 'huge hype!' },
      { user: viewer, id: 'tip-big' },
    );
    await handler(big.interaction as never);
    expect(big.out[0]!.options.flags).toBe(MessageFlags.Ephemeral);
    expect(embedOf(big.out[0]!.options).title).toBe('Send this super chat?');
    expect(embedOf(big.out[0]!.options).fields?.[0]?.value).toBe('huge hype!');
    expect(customIds(big.out[0]!.options)).toEqual([`b:stm:tipok:${stream.id}:5000`, 'b:stm:no']);
    expect(s.economy.getBalance(GUILD, OTHER_USER)).toBe(balBeforeBig);

    // Cancel aborts cleanly without moving money.
    const cancel = button('b:stm:no', { user: viewer });
    await handler(cancel.interaction as never);
    expect(cancel.out[0]!.kind).toBe('update');
    expect(embedOf(cancel.out[0]!.options).description).toBe('Cancelled.');
    expect(s.economy.getBalance(GUILD, OTHER_USER)).toBe(balBeforeBig);

    // Confirm sends the tip and preserves the message from the confirm embed field.
    const confirm = button(`b:stm:tipok:${stream.id}:5000`, {
      user: viewer,
      id: 'tip-big-ok',
      message: { embeds: big.out[0]!.options.embeds },
    });
    await handler(confirm.interaction as never);
    expect(confirm.out[0]!.kind).toBe('update');
    expect(embedOf(confirm.out[0]!.options).title).toBe('Super chat sent');
    expect(s.stream.view({ guildId: GUILD, userId: USER }, stream.id).tips).toBe(5500);

    const tipEvents = events.filter((e) => e.type === 'StreamTipped');
    expect(tipEvents).toHaveLength(2);
    expect(tipEvents[1]!.message).toBe('huge hype!');
  });

  it('handles bet buttons, default-100 modal, idempotency replay, and bet rule refusals', async () => {
    const { s, streamer, viewer, handler, grant } = setup();
    const stream = s.stream.start(
      { guildId: GUILD, userId: USER },
      { title: 'Bets', idempotencyKey: 'st-bet' },
    ).stream;
    grant(OTHER_USER, 15_000, 'bets');

    // No open round -> refused ephemerally.
    const early = button(`b:stm:win:${stream.id}`, { user: viewer });
    await handler(early.interaction as never);
    expect(early.out[0]!.options.flags).toBe(MessageFlags.Ephemeral);
    expect(embedOf(early.out[0]!.options).description).toBe('Bets are not open right now.');

    const roundId = s.stream.openRound(
      { guildId: GUILD, userId: USER },
      { streamId: stream.id, label: 'Fight 1', idempotencyKey: 'open-1' },
    ).stream.round!.id;

    // Open round -> opens BetModal with default 100.
    const pressWin = button(`b:stm:win:${stream.id}`, { user: viewer });
    await handler(pressWin.interaction as never);
    expect(pressWin.out[0]!.kind).toBe('modal');
    const modal = modalJson(pressWin.out[0]!.options);
    expect(modal.custom_id).toBe(`b:stm:mbet:${stream.id}:${roundId}:win`);
    expect(modal.components[0]!.components[0]!.value).toBe('100');

    // Place bet + replay with same interaction id does not double-charge.
    const bal0 = s.economy.getBalance(GUILD, OTHER_USER);
    const bet1 = modalSubmit(
      `b:stm:mbet:${stream.id}:${roundId}:win`,
      { amount: '1000' },
      { user: viewer, id: 'bet-ix-1' },
    );
    await handler(bet1.interaction as never);
    expect(bet1.out[0]!.options.flags).toBe(MessageFlags.Ephemeral);
    expect(embedOf(bet1.out[0]!.options).title).toBe('Bet placed');
    expect(s.economy.getBalance(GUILD, OTHER_USER)).toBe(bal0 - 1000);

    const replay = modalSubmit(
      `b:stm:mbet:${stream.id}:${roundId}:win`,
      { amount: '1000' },
      { user: viewer, id: 'bet-ix-1' },
    );
    await handler(replay.interaction as never);
    expect(s.economy.getBalance(GUILD, OTHER_USER)).toBe(bal0 - 1000);

    // Switching sides refused.
    const otherSide = modalSubmit(
      `b:stm:mbet:${stream.id}:${roundId}:lose`,
      { amount: '100' },
      { user: viewer },
    );
    await handler(otherSide.interaction as never);
    expect(embedOf(otherSide.out[0]!.options).description).toContain('other side');

    // Exceeding 10,000 cap refused with already amount.
    const overMax = modalSubmit(
      `b:stm:mbet:${stream.id}:${roundId}:win`,
      { amount: '9500' },
      { user: viewer },
    );
    await handler(overMax.interaction as never);
    expect(embedOf(overMax.out[0]!.options).description).toContain('1000');

    // Streamer self-bet refused.
    const selfBet = modalSubmit(
      `b:stm:mbet:${stream.id}:${roundId}:win`,
      { amount: '100' },
      { user: streamer },
    );
    await handler(selfBet.interaction as never);
    expect(embedOf(selfBet.out[0]!.options).description).toContain("can't bet on their own round");

    // Non-number bet refused.
    const badNum = modalSubmit(
      `b:stm:mbet:${stream.id}:${roundId}:lose`,
      { amount: 'nope' },
      { user: viewer },
    );
    await handler(badNum.interaction as never);
    expect(embedOf(badNum.out[0]!.options).description).toBe('Enter a number.');

    // Lose button opens lose BetModal; debt blocks betting.
    const viewerB = makeUser(VIEWER_B, 'viewerb', 'Viewer B');
    const pressLose = button(`b:stm:lose:${stream.id}`, { user: viewerB });
    await handler(pressLose.interaction as never);
    expect(pressLose.out[0]!.kind).toBe('modal');
    expect(modalJson(pressLose.out[0]!.options).custom_id).toBe(
      `b:stm:mbet:${stream.id}:${roundId}:lose`,
    );
    s.economy.ensureMember(GUILD, VIEWER_B);
    s.finance.teiai.adminSetDebt(GUILD, VIEWER_B, 100);
    const debtBet = modalSubmit(
      `b:stm:mbet:${stream.id}:${roundId}:lose`,
      { amount: '100' },
      { user: viewerB },
    );
    await handler(debtBet.interaction as never);
    expect(embedOf(debtBet.out[0]!.options).description).toContain('debt');
  });

  it('enforces streamer-only menu, D3 win/lose hidden while open, and confirm steps on settle/void/end', async () => {
    const { s, streamer, viewer, handler } = setup();
    const stream = s.stream.start(
      { guildId: GUILD, userId: USER },
      { title: 'Boss', idempotencyKey: 'st-menu' },
    ).stream;
    s.economy.ensureMember(GUILD, OTHER_USER);
    s.economy.ensureMember(GUILD, VIEWER_B);

    // Non-streamer cannot open menu or invoke menu actions.
    const nonStreamer = button(`b:stm:menu:${stream.id}`, { user: viewer });
    await handler(nonStreamer.interaction as never);
    expect(nonStreamer.out[0]!.options.flags).toBe(MessageFlags.Ephemeral);
    expect(embedOf(nonStreamer.out[0]!.options).description).toContain('streamer only');

    const forgedEnd = button(`b:stm:end:${stream.id}`, { user: viewer });
    await handler(forgedEnd.interaction as never);
    expect(embedOf(forgedEnd.out[0]!.options).description).toContain('Only the streamer');

    // Streamer menu with no round offers only open + end.
    const menuEmpty = button(`b:stm:menu:${stream.id}`, { user: streamer });
    await handler(menuEmpty.interaction as never);
    expect(menuEmpty.out[0]!.options.flags).toBe(MessageFlags.Ephemeral);
    expect(customIds(menuEmpty.out[0]!.options)).toEqual([
      `b:stm:open:${stream.id}`,
      `b:stm:end:${stream.id}`,
    ]);

    // Open round via button -> modal -> submit (empty label uses default).
    const pressOpen = button(`b:stm:open:${stream.id}`, { user: streamer });
    await handler(pressOpen.interaction as never);
    expect(pressOpen.out[0]!.kind).toBe('modal');
    expect(modalJson(pressOpen.out[0]!.options).custom_id).toBe(`b:stm:mopen:${stream.id}`);

    const submitOpen = modalSubmit(`b:stm:mopen:${stream.id}`, { label: '' }, { user: streamer });
    await handler(submitOpen.interaction as never);
    expect(submitOpen.out[0]!.options.flags).toBe(MessageFlags.Ephemeral);
    expect(embedOf(submitOpen.out[0]!.options).title).toContain('Next round');

    const round1 = s.stream.view({ guildId: GUILD, userId: USER }, stream.id).round!;

    // D3: While round is OPEN, win and lose MUST be hidden from streamer menu.
    const menuOpen = button(`b:stm:menu:${stream.id}`, { user: streamer });
    await handler(menuOpen.interaction as never);
    const openIds = customIds(menuOpen.out[0]!.options);
    expect(openIds).toEqual([
      `b:stm:lock:${stream.id}:${round1.id}`,
      `b:stm:void:${stream.id}:${round1.id}`,
      `b:stm:end:${stream.id}`,
    ]);
    expect(openIds.some((id) => id.includes(':swin:') || id.includes(':slose:'))).toBe(false);

    // Forged settle while open is refused with stream_not_locked.
    const forgedWin = button(`b:stm:swin:${stream.id}:${round1.id}`, { user: streamer });
    await handler(forgedWin.interaction as never);
    expect(embedOf(forgedWin.out[0]!.options).description).toContain('Close the bets first');

    // Place opposing bets so settle pays out.
    s.stream.bet(
      { guildId: GUILD, userId: OTHER_USER },
      { streamId: stream.id, roundId: round1.id, side: 'win', amount: 500, idempotencyKey: 'b1' },
    );
    s.stream.bet(
      { guildId: GUILD, userId: VIEWER_B },
      { streamId: stream.id, roundId: round1.id, side: 'lose', amount: 500, idempotencyKey: 'b2' },
    );

    // Lock reveals swin + slose alongside void + end.
    const lockBtn = button(`b:stm:lock:${stream.id}:${round1.id}`, { user: streamer });
    await handler(lockBtn.interaction as never);
    expect(lockBtn.out[0]!.kind).toBe('update');
    expect(customIds(lockBtn.out[0]!.options)).toEqual([
      `b:stm:swin:${stream.id}:${round1.id}`,
      `b:stm:slose:${stream.id}:${round1.id}`,
      `b:stm:void:${stream.id}:${round1.id}`,
      `b:stm:end:${stream.id}`,
    ]);

    // Win confirm step (check JA text '取り消せません。' too).
    const askWin = button(`b:stm:swin:${stream.id}:${round1.id}`, {
      user: streamer,
      locale: 'ja',
    });
    await handler(askWin.interaction as never);
    expect(askWin.out[0]!.kind).toBe('update');
    expect(embedOf(askWin.out[0]!.options).description).toContain('取り消せません。');
    expect(customIds(askWin.out[0]!.options)).toEqual([
      `b:stm:cwin:${stream.id}:${round1.id}`,
      'b:stm:no',
    ]);

    // Confirm win settles the round.
    const confirmWin = button(`b:stm:cwin:${stream.id}:${round1.id}`, { user: streamer });
    await handler(confirmWin.interaction as never);
    expect(embedOf(confirmWin.out[0]!.options).description).toBe('Settled.');
    expect(s.stream.view({ guildId: GUILD, userId: USER }, stream.id).round).toBeNull();
    expect(s.economy.getBalance(GUILD, OTHER_USER)).toBe(3000 + 475);

    // Second round: lock and settle as lose via slose -> close confirm path.
    const roundLose = s.stream.openRound(
      { guildId: GUILD, userId: USER },
      { streamId: stream.id, label: 'Fight Lose', idempotencyKey: 'open-lose' },
    ).stream.round!.id;
    s.stream.lock(
      { guildId: GUILD, userId: USER },
      { streamId: stream.id, roundId: roundLose, idempotencyKey: 'lock-lose' },
    );
    const askLose = button(`b:stm:slose:${stream.id}:${roundLose}`, { user: streamer });
    await handler(askLose.interaction as never);
    expect(embedOf(askLose.out[0]!.options).description).toContain('This cannot be undone.');
    expect(customIds(askLose.out[0]!.options)).toEqual([
      `b:stm:close:${stream.id}:${roundLose}`,
      'b:stm:no',
    ]);
    const confirmLose = button(`b:stm:close:${stream.id}:${roundLose}`, { user: streamer });
    await handler(confirmLose.interaction as never);
    expect(embedOf(confirmLose.out[0]!.options).description).toBe('Settled.');

    // Third round: void with confirm step, then end stream with confirm step.
    const round2 = s.stream.openRound(
      { guildId: GUILD, userId: USER },
      { streamId: stream.id, label: 'Fight 2', idempotencyKey: 'open-2' },
    ).stream.round!.id;
    s.stream.bet(
      { guildId: GUILD, userId: OTHER_USER },
      { streamId: stream.id, roundId: round2, side: 'lose', amount: 400, idempotencyKey: 'b3' },
    );

    const askVoid = button(`b:stm:void:${stream.id}:${round2}`, { user: streamer });
    await handler(askVoid.interaction as never);
    expect(embedOf(askVoid.out[0]!.options).description).toContain('This cannot be undone.');
    const confirmVoid = button(`b:stm:cvoid:${stream.id}:${round2}`, { user: streamer });
    await handler(confirmVoid.interaction as never);
    expect(embedOf(confirmVoid.out[0]!.options).description).toBe('Settled.');
    expect(s.economy.getBalance(GUILD, OTHER_USER)).toBe(3475);

    const askEnd = button(`b:stm:end:${stream.id}`, { user: streamer });
    await handler(askEnd.interaction as never);
    expect(embedOf(askEnd.out[0]!.options).title).toBe('End the stream?');
    const confirmEnd = button(`b:stm:cend:${stream.id}`, { user: streamer });
    await handler(confirmEnd.interaction as never);
    expect(embedOf(confirmEnd.out[0]!.options).description).toBe('The stream has ended.');
    expect(s.stream.list({ guildId: GUILD, userId: USER }).streams).toHaveLength(0);
  });

  it('refuses start, tip and bet when stream feature is off while keeping streamer menu working', async () => {
    const { s, streamer, viewer, handler, featureOff, setGames } = setup();
    const stream = s.stream.start(
      { guildId: GUILD, userId: USER },
      { title: 'Pre-off', idempotencyKey: 'pre-off' },
    ).stream;
    const roundId = s.stream.openRound(
      { guildId: GUILD, userId: USER },
      { streamId: stream.id, idempotencyKey: 'pre-round' },
    ).stream.round!.id;
    setGames(OTHER_USER, 3);
    s.stream.bet(
      { guildId: GUILD, userId: OTHER_USER },
      { streamId: stream.id, roundId, side: 'win', amount: 300, idempotencyKey: 'pre-bet' },
    );

    featureOff();

    // Start refused.
    const start = command({
      name: 'stream',
      sub: 'start',
      user: viewer,
      strings: { title: 'Blocked' },
    });
    await handler(start.interaction as never);
    expect(embedOf(start.out[0]!.options).description).toContain('turned off');

    // Tip button & modal refused.
    const tipBtn = button(`b:stm:tip:${stream.id}`, { user: viewer });
    await handler(tipBtn.interaction as never);
    expect(tipBtn.out[0]!.kind).toBe('reply');
    expect(embedOf(tipBtn.out[0]!.options).description).toContain('turned off');

    const tipSub = modalSubmit(
      `b:stm:mtip:${stream.id}`,
      { amount: '100', message: '' },
      { user: viewer },
    );
    await handler(tipSub.interaction as never);
    expect(embedOf(tipSub.out[0]!.options).description).toContain('turned off');

    // Bet button & modal refused.
    const betBtn = button(`b:stm:win:${stream.id}`, { user: viewer });
    await handler(betBtn.interaction as never);
    expect(betBtn.out[0]!.kind).toBe('reply');
    expect(embedOf(betBtn.out[0]!.options).description).toContain('turned off');

    const betSub = modalSubmit(
      `b:stm:mbet:${stream.id}:${roundId}:win`,
      { amount: '100' },
      { user: viewer },
    );
    await handler(betSub.interaction as never);
    expect(embedOf(betSub.out[0]!.options).description).toContain('turned off');

    // Streamer menu lock -> void -> end STILL work while feature is off.
    const menu = button(`b:stm:menu:${stream.id}`, { user: streamer });
    await handler(menu.interaction as never);
    expect(customIds(menu.out[0]!.options)).toContain(`b:stm:lock:${stream.id}:${roundId}`);

    const lock = button(`b:stm:lock:${stream.id}:${roundId}`, { user: streamer });
    await handler(lock.interaction as never);
    expect(customIds(lock.out[0]!.options)).toContain(`b:stm:swin:${stream.id}:${roundId}`);

    const cvoid = button(`b:stm:cvoid:${stream.id}:${roundId}`, { user: streamer });
    await handler(cvoid.interaction as never);
    expect(embedOf(cvoid.out[0]!.options).description).toBe('Settled.');
    expect(s.economy.getBalance(GUILD, OTHER_USER)).toBe(3000);

    const cend = button(`b:stm:cend:${stream.id}`, { user: streamer });
    await handler(cend.interaction as never);
    expect(embedOf(cend.out[0]!.options).description).toBe('The stream has ended.');
  });

  it('coalesces rapid panel updates within the debounce window, removes buttons on end, and ignores deleted messages', async () => {
    vi.useFakeTimers();
    const { s, setGames } = setup();
    const channel = fakeChannel('chan-panel', ['panel-1']);
    const client = fakeClient([channel]);

    const refresher = createStreamPanelRefresher(
      client as never,
      s.stream,
      s.identity,
      s.logger,
      STREAM_PANEL_DEBOUNCE_MS,
    );

    const stream = s.stream.start(
      { guildId: GUILD, userId: USER },
      { title: 'Debounce', channelId: 'chan-panel', idempotencyKey: 'db-start' },
    ).stream;
    s.stream.attachPanel(GUILD, stream.id, 'chan-panel', 'panel-1');
    expect(channel.edits).toHaveLength(0);

    // Burst of changes: tip, open round, two bets within < 2.5 s -> ONE panel edit with latest totals.
    setGames(OTHER_USER, 3);
    s.economy.ensureMember(GUILD, VIEWER_B);
    s.stream.tip(
      { guildId: GUILD, userId: OTHER_USER },
      { streamId: stream.id, amount: 200, message: 'yo', idempotencyKey: 'db-tip' },
    );
    const roundId = s.stream.openRound(
      { guildId: GUILD, userId: USER },
      { streamId: stream.id, label: 'Quick', idempotencyKey: 'db-open' },
    ).stream.round!.id;
    s.stream.bet(
      { guildId: GUILD, userId: OTHER_USER },
      { streamId: stream.id, roundId, side: 'win', amount: 400, idempotencyKey: 'db-b1' },
    );
    s.stream.bet(
      { guildId: GUILD, userId: VIEWER_B },
      { streamId: stream.id, roundId, side: 'lose', amount: 600, idempotencyKey: 'db-b2' },
    );

    expect(refresher.pendingTimers()).toBe(1);
    expect(channel.edits).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(STREAM_PANEL_DEBOUNCE_MS);
    expect(refresher.pendingTimers()).toBe(0);
    expect(channel.edits).toHaveLength(1);
    const firstEdit = channel.edits[0]!.options as { embeds: unknown[]; components: unknown[] };
    const text = allText(firstEdit);
    expect(text).toContain('200');
    expect(text).toContain('400');
    expect(text).toContain('600');
    expect(text).toContain('Quick');
    expect(firstEdit.components.length).toBeGreaterThan(0);

    // Ending the stream clears any pending timer immediately and removes panel buttons.
    s.stream.end(
      { guildId: GUILD, userId: USER },
      { streamId: stream.id, idempotencyKey: 'db-end' },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(refresher.pendingTimers()).toBe(0);
    expect(channel.edits).toHaveLength(2);
    const endEdit = channel.edits[1]!.options as { embeds: unknown[]; components: unknown[] };
    expect(embedOf(endEdit).title).toBe('⏹️ Stream ended: Debounce');
    expect(endEdit.components).toEqual([]);

    // Deleted / missing panel message is handled quietly without throwing.
    const stream2 = s.stream.start(
      { guildId: GUILD, userId: OTHER_USER },
      { title: 'Deleted panel', channelId: 'chan-panel', idempotencyKey: 'db-start-2' },
    ).stream;
    s.stream.attachPanel(GUILD, stream2.id, 'chan-panel', 'missing-msg');
    s.stream.openRound(
      { guildId: GUILD, userId: OTHER_USER },
      { streamId: stream2.id, idempotencyKey: 'db-open-2' },
    );
    await vi.advanceTimersByTimeAsync(STREAM_PANEL_DEBOUNCE_MS);
    expect(channel.edits).toHaveLength(2);

    // stop() clears pending timers and unsubscribes.
    s.stream.end(
      { guildId: GUILD, userId: OTHER_USER },
      { streamId: stream2.id, idempotencyKey: 'db-end-2' },
    );
    const stream3 = s.stream.start(
      { guildId: GUILD, userId: USER },
      { title: 'Stop test', channelId: 'chan-panel', idempotencyKey: 'db-start-3' },
    ).stream;
    s.stream.attachPanel(GUILD, stream3.id, 'chan-panel', 'panel-1');
    s.stream.openRound(
      { guildId: GUILD, userId: USER },
      { streamId: stream3.id, idempotencyKey: 'db-open-3' },
    );
    expect(refresher.pendingTimers()).toBe(1);
    refresher.stop();
    expect(refresher.pendingTimers()).toBe(0);
    await vi.advanceTimersByTimeAsync(STREAM_PANEL_DEBOUNCE_MS);
    expect(channel.edits).toHaveLength(2);
  });

  it('keeps old panel buttons working after restart and never posts duplicate tip/round/result cards', async () => {
    const { s, streamer, viewer, setGames } = setup();
    const channel = fakeChannel('chan-live', ['reply-start-r']);
    const client = fakeClient([channel]);

    // First process starts the stream panel.
    const handler1 = makeHandler(s);
    const start = command({
      name: 'stream',
      sub: 'start',
      id: 'start-r',
      channelId: 'chan-live',
      user: streamer,
      client,
      strings: { title: 'Restart Proof' },
    });
    await handler1(start.interaction as never);
    const stream = s.stream.list({ guildId: GUILD, userId: USER }).streams[0]!;

    // Simulate restart: brand-new interaction handler with zero in-memory state.
    const handler2 = makeHandler(s);
    setGames(OTHER_USER, 3);

    // Old tip button works on fresh handler.
    const tipBtn = button(`b:stm:tip:${stream.id}`, { user: viewer, client });
    await handler2(tipBtn.interaction as never);
    expect(tipBtn.out[0]!.kind).toBe('modal');
    const tipSub = modalSubmit(
      `b:stm:mtip:${stream.id}`,
      { amount: '200', message: 'after restart' },
      { user: viewer, client },
    );
    await handler2(tipSub.interaction as never);
    expect(embedOf(tipSub.out[0]!.options).title).toBe('Super chat sent');

    // Old menu button works on fresh handler: open -> bet -> lock -> settle.
    const openSub = modalSubmit(
      `b:stm:mopen:${stream.id}`,
      { label: 'After restart' },
      { user: streamer, client },
    );
    await handler2(openSub.interaction as never);
    const roundId = s.stream.view({ guildId: GUILD, userId: USER }, stream.id).round!.id;

    const betBtn = button(`b:stm:win:${stream.id}`, { user: viewer, client });
    await handler2(betBtn.interaction as never);
    expect(betBtn.out[0]!.kind).toBe('modal');
    const betSub = modalSubmit(
      `b:stm:mbet:${stream.id}:${roundId}:win`,
      { amount: '200' },
      { user: viewer, client },
    );
    await handler2(betSub.interaction as never);
    expect(embedOf(betSub.out[0]!.options).title).toBe('Bet placed');

    const lockBtn = button(`b:stm:lock:${stream.id}:${roundId}`, { user: streamer, client });
    await handler2(lockBtn.interaction as never);
    const settleBtn = button(`b:stm:cwin:${stream.id}:${roundId}`, { user: streamer, client });
    await handler2(settleBtn.interaction as never);
    expect(embedOf(settleBtn.out[0]!.options).description).toBe('Settled.');

    // Chat handlers must NOT post tip cards, round-opened notices, or result posts
    // (those are sent exclusively by notify/stream-posts.ts).
    expect(channel.sent).toHaveLength(0);
  });
});
