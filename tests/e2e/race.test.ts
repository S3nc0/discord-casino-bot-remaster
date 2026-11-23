import { afterEach, describe, expect, it } from 'vitest';
import { Value } from 'typebox/value';
import { HorseTimeline, type DomainEvent } from '../../packages/shared/src/index.ts';
import { Inventory } from '../../apps/server/src/games/shop/inventory.ts';
import { connectClient, newKey, settle, type TestClient } from './support/clients.ts';
import {
  ALICE,
  BOB,
  CAROL,
  DAVE,
  GUILD_A,
  GUILD_B,
  INSTANCE_A2,
  INSTANCE_B1,
  startStack,
  type Person,
  type Stack,
} from './support/stack.ts';

let stack: Stack;
const clients: TestClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await stack?.close();
});

/** Friday 2027-01-15 at `hour:minute` JST: the server's UTC+9 race day. */
const jst = (hour: number, minute = 0): number => Date.UTC(2027, 0, 15, hour - 9, minute);
const look = { coat: '鹿毛', silks: '🟦' };

async function connect(person: Person, options: Parameters<typeof connectClient>[2] = {}) {
  const client = await connectClient(stack, person, options);
  clients.push(client);
  return client;
}

async function http<T = Record<string, unknown>>(
  c: TestClient,
  method: 'GET' | 'POST',
  url: string,
  payload?: object,
): Promise<{ status: number; body: T }> {
  const res = await stack.app.inject({
    method,
    url,
    headers: c.headers(),
    ...(payload === undefined ? {} : { payload }),
  });
  return { status: res.statusCode, body: res.json<T>() };
}

describe('live race', () => {
  it('runs one race for the guild: same result, same timeline, nothing for another guild', async () => {
    stack = await startStack({ sessionTtlSeconds: 86_400 });
    const owners = [await connect(ALICE), await connect(BOB), await connect(CAROL)];
    const sameGuildOtherInstance = await connect(DAVE, { instanceId: INSTANCE_A2 });
    const otherGuild = await connect(DAVE, { guildId: GUILD_B, instanceId: INSTANCE_B1 });
    const everyone = [...owners, sameGuildOtherInstance, otherGuild];

    // Every client reads the same server clock, whichever instance it is in.
    const clocks = await Promise.all(
      everyone.map((c) => c.socket.emitWithAck('time:ping') as unknown as Promise<number>),
    );
    expect(new Set(clocks).size).toBe(1);

    stack.clock.set(jst(19, 30)); // the 21:00 race takes entries from 19:00 to 20:00
    const inventory = new Inventory(stack.store);
    const horses = new Map<string, number>();
    for (const [i, c] of owners.entries()) {
      stack.economy.credit({
        guildId: GUILD_A,
        userId: c.person.id,
        amount: 10_000,
        reason: 'admin_grant',
        idempotencyKey: `grant-${c.person.id}`,
      });
      inventory.add(GUILD_A, c.person.id, 'horse_voucher', 1);
      const created = await http<{ horse: { id: number } }>(c, 'POST', '/api/horse/create', {
        idempotencyKey: newKey('mk'),
        name: `Horse${i}`,
        ...look,
      });
      expect(created.status).toBe(200);
      horses.set(c.person.id, created.body.horse.id);
    }

    const card = await http<{ races: { id: number; phase: string; major: boolean }[] }>(
      owners[0] as TestClient,
      'GET',
      '/api/horse/card',
    );
    const target = card.body.races.find((r) => r.phase === 'entry_open');
    expect(target).toBeDefined();
    const raceId = (target as { id: number }).id;
    for (const c of owners) {
      const entered = await http(c, 'POST', `/api/horse/races/${raceId}/enter`, {
        idempotencyKey: newKey('en'),
        horseId: horses.get(c.person.id),
      });
      expect(entered.status).toBe(200);
    }

    // Entries close at 20:00: the field is drawn and everybody sees the same lanes and odds.
    stack.clock.set(jst(20, 1));
    stack.games.race.tick(GUILD_A);
    type Detail = {
      race: { phase: string; startsAt?: number; placings?: number[] };
      runners: { lane: number; name: string; mine: boolean }[];
      odds: unknown;
    };
    const details = await Promise.all(
      everyone.slice(0, 4).map((c) => http<Detail>(c, 'GET', `/api/horse/races/${raceId}`)),
    );
    for (const d of details) {
      expect(d.status).toBe(200);
      expect(d.body.race.phase).toBe('betting');
      expect(d.body.runners.map((r) => [r.lane, r.name])).toEqual(
        details[0]?.body.runners.map((r) => [r.lane, r.name]),
      );
      expect(d.body.odds).toEqual(details[0]?.body.odds);
    }
    for (const [i, c] of owners.entries()) {
      const mine = details[i]?.body.runners.filter((r) => r.mine);
      expect(mine).toHaveLength(1);
      const bet = await http(c, 'POST', `/api/horse/races/${raceId}/bet`, {
        idempotencyKey: newKey('bt'),
        kind: 'win',
        lanes: [mine?.[0]?.lane],
        stake: 500,
      });
      expect(bet.status).toBe(200);
    }

    // The race runs once, on the server's clock.
    stack.clock.set(jst(21, 1));
    stack.games.race.tick(GUILD_A);
    const finished = (c: TestClient): DomainEvent | undefined =>
      c.seen.domain.find((e) => e.type === 'RaceFinished' && e.raceId === raceId);
    for (const c of [...owners, sameGuildOtherInstance]) {
      await c.waitFor(() => finished(c) !== undefined, 'RaceFinished');
    }
    const events = [...owners, sameGuildOtherInstance].map(finished);
    for (const e of events) expect(e).toEqual(events[0]);
    expect(events[0]).toMatchObject({ type: 'RaceFinished', guildId: GUILD_A, raceId });
    await settle();
    expect(otherGuild.seen.domain.some((e) => e.type === 'RaceFinished')).toBe(false);
    expect(otherGuild.seen.domain.some((e) => e.type === 'RaceScheduled')).toBe(false);

    // Timeline and placings: identical for every viewer (apart from "mine").
    const timelines = await Promise.all(
      [...owners, sameGuildOtherInstance].map((c) =>
        http<HorseTimeline>(c, 'GET', `/api/horse/races/${raceId}/timeline`),
      ),
    );
    for (const t of timelines) {
      expect(t.status).toBe(200);
      expect(Value.Check(HorseTimeline, t.body)).toBe(true);
      expect(t.body.frames).toEqual(timelines[0]?.body.frames);
      expect(t.body.placings).toEqual(timelines[0]?.body.placings);
      expect(t.body.runners.map((r) => r.name)).toEqual(
        timelines[0]?.body.runners.map((r) => r.name),
      );
    }
    const first = timelines[0]?.body as HorseTimeline;
    // The timeline ends where it says: the leader of the last frame is first in the placings.
    const lastFrame = first.frames.at(-1) as number[];
    const winnerLane = first.placings[0] as number;
    const winnerIdx = first.runners.findIndex((r) => r.lane === winnerLane);
    expect(lastFrame[winnerIdx]).toBe(Math.max(...lastFrame));
    for (const frames of first.frames) expect(frames).toHaveLength(first.runners.length);

    const done = await Promise.all(
      [...owners, sameGuildOtherInstance].map((c) =>
        http<Detail>(c, 'GET', `/api/horse/races/${raceId}`),
      ),
    );
    for (const d of done) expect(d.body.race.placings).toEqual(done[0]?.body.race.placings);

    // The other guild has neither the race nor its timeline.
    const outsider = await http(otherGuild, 'GET', `/api/horse/races/${raceId}/timeline`);
    expect(outsider.status).toBeGreaterThanOrEqual(400);
  });
});
