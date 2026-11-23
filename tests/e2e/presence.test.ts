import { afterEach, describe, expect, it } from 'vitest';
import { connectClient, settle, type TestClient } from './support/clients.ts';
import {
  ALICE,
  BOB,
  CAROL,
  DAVE,
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

async function connect(person: Person, options: Parameters<typeof connectClient>[2] = {}) {
  const client = await connectClient(stack, person, options);
  clients.push(client);
  return client;
}
const ids = (c: TestClient): string[] | undefined =>
  c.seen.participants.at(-1)?.users.map((u) => u.id);

describe('instance participants', () => {
  it('sends the full list, in join order, to everybody in the instance', async () => {
    stack = await startStack();
    const alice = await connect(ALICE);
    await alice.waitFor(() => ids(alice)?.length === 1, 'own entry');
    expect(ids(alice)).toEqual([ALICE.id]);

    const bob = await connect(BOB);
    const carol = await connect(CAROL);
    for (const c of [alice, bob, carol]) {
      await c.waitFor(() => ids(c)?.length === 3, 'three participants');
      expect(ids(c)).toEqual([ALICE.id, BOB.id, CAROL.id]);
    }
    const last = alice.seen.participants.at(-1);
    expect(last).toMatchObject({ guildId: alice.guildId, instanceId: alice.instanceId });
    expect(last?.users[0]).toMatchObject({ id: ALICE.id, username: 'alice' });

    // The last socket of a user leaving shrinks the list for the others.
    bob.close();
    await alice.waitFor(() => ids(alice)?.length === 2, 'Bob gone');
    expect(ids(alice)).toEqual([ALICE.id, CAROL.id]);
    expect(ids(carol)).toEqual([ALICE.id, CAROL.id]);
  });

  it('counts a user once for several sockets and drops them with the last one', async () => {
    stack = await startStack();
    const alice = await connect(ALICE);
    const bob = await connect(BOB);
    const bobTab = await connect(BOB);
    await alice.waitFor(() => ids(alice)?.length === 2, 'two people');
    expect(ids(alice)).toEqual([ALICE.id, BOB.id]);
    await settle(); // the second tab's connect pushes the same list once more
    const lists = alice.seen.participants.length;
    bob.close();
    await settle();
    // Bob still has a tab open: nobody is told he left.
    expect(alice.seen.participants.length).toBe(lists);
    expect(ids(alice)).toEqual([ALICE.id, BOB.id]);
    bobTab.close();
    await alice.waitFor(() => ids(alice)?.length === 1, 'Bob left');
    expect(ids(alice)).toEqual([ALICE.id]);
  });

  it('never leaks a participant to another instance or another guild', async () => {
    stack = await startStack();
    const alice = await connect(ALICE);
    const bob = await connect(BOB);
    const sameGuildOther = await connect(DAVE, { instanceId: INSTANCE_A2 });
    const otherGuild = await connect(CAROL, { guildId: GUILD_B, instanceId: INSTANCE_B1 });
    await settle();
    expect(ids(sameGuildOther)).toEqual([DAVE.id]);
    expect(ids(otherGuild)).toEqual([CAROL.id]);
    expect(ids(alice)).toEqual([ALICE.id, BOB.id]);
    for (const outsider of [sameGuildOther, otherGuild]) {
      const everyone = outsider.seen.participants.flatMap((p) => p.users.map((u) => u.id));
      expect(everyone).not.toContain(ALICE.id);
      expect(everyone).not.toContain(BOB.id);
      expect(outsider.seen.participants.every((p) => p.instanceId === outsider.instanceId)).toBe(true);
    }
    // Leaving in one instance does not disturb the other.
    const before = sameGuildOther.seen.participants.length;
    alice.close();
    await bob.waitFor(() => ids(bob)?.length === 1, 'Alice gone');
    await settle();
    expect(sameGuildOther.seen.participants.length).toBe(before);
  });

  it('keeps a joiner out of rooms they are not entitled to', async () => {
    stack = await startStack();
    const alice = await connect(ALICE);
    const rooms = [...stack.io.sockets.sockets.values()].flatMap((s) => [...s.rooms]);
    expect(rooms.some((r) => r.startsWith('instance:') && r !== `instance:${alice.instanceId}`)).toBe(false);
    expect(rooms).toContain(`user:${ALICE.id}`);
    expect(rooms).toContain(`guild:${alice.guildId}`);
  });
});
