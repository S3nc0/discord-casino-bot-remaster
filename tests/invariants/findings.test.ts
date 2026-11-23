// Defects the property suites turned up, each reduced to the smallest reproduction and kept as
// `it.fails`: the test passes while the defect exists and starts failing (CI red) the moment it
// is fixed, which is the cue to turn it into a plain `it`. Product code is not changed here.
import { afterEach, describe, expect, it } from 'vitest';
import { GUILDS, USERS, createWorld, type World } from './world.ts';

const [GUILD] = GUILDS;
const [ALICE, BOB, CAROL] = USERS;

let w: World | undefined;
afterEach(async () => {
  await w?.close();
  w = undefined;
});

/** A player with three finished games, the minimum for sending Pelica. */
function experienced(world: World, userId: string): void {
  for (let i = 0; i < 3; i++) {
    world.timers.advance(10_000);
    world.server.casino.slots.play(
      { guildId: GUILD, userId, source: 'chat' },
      { stake: 10, idempotencyKey: `warm-${userId.slice(-2)}-${i}`.padEnd(16, '_') },
    );
  }
}

const grant = (world: World, userId: string, amount: number, n: number): void => {
  world.server.economy.credit({
    guildId: GUILD,
    userId,
    amount,
    reason: 'admin_grant',
    idempotencyKey: `grant-${userId.slice(-2)}-${n}`,
  });
};

describe('findings', () => {
  // F-T2-01 (medium): `ProgressionService.transfer` finds an already executed transfer only in
  // the sender's newest 50 ledger rows (`economy.history(.., 50)` in the failing-plan branch,
  // apps/server/src/games/progression/service.ts, "A retry of an already executed transfer must
  // not turn into a limit error"). A client that retries after more than 50 newer rows gets
  // `transfer_daily_limit` (or `debt_blocks`, `transfer_insufficient_balance`) for a transfer
  // that DID go through, and the replay answer reports fee 0.
  it('F-T2-01: a retried transfer is a replay however many rows came after it', () => {
    w = createWorld(1);
    experienced(w, ALICE as string);
    grant(w, ALICE as string, 30_000, 0);
    const send = () =>
      (w as World).server.games.progression.transfer({
        guildId: GUILD as string,
        senderId: ALICE as string,
        receiverId: BOB as string,
        amount: 20_000,
        idempotencyKey: 'transfer-key-0001__',
      });
    const first = send();
    expect(first).toMatchObject({ ok: true, amount: 20_000, fee: 2_000 });
    for (let n = 1; n <= 60; n++) grant(w, ALICE as string, 1, n); // 60 newer ledger rows
    const retry = send();
    expect(retry).toMatchObject({ ok: true, amount: 20_000, fee: 2_000 });
    expect(w.server.economy.getBalance(GUILD as string, BOB as string)).toBe(3_000 + 20_000);
  });

  // F-T2-02 (low): the receiver's ledger row is keyed `${key}:in` inside the RECEIVER's account,
  // so two different senders that use the same client key collide: the second transfer throws
  // `conflict` although the sender's own idempotency scope (guild, sender, key) is unused.
  it.fails('F-T2-02: two senders may use the same idempotency key toward one receiver', () => {
    w = createWorld(1);
    experienced(w, ALICE as string);
    experienced(w, CAROL as string);
    const send = (senderId: string, amount: number) =>
      (w as World).server.games.progression.transfer({
        guildId: GUILD as string,
        senderId,
        receiverId: BOB as string,
        amount,
        idempotencyKey: 'shared-client-key-1',
      });
    expect(send(ALICE as string, 100)).toMatchObject({ ok: true });
    expect(send(CAROL as string, 200)).toMatchObject({ ok: true });
  });
});
