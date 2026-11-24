import { afterEach, describe, expect, it } from 'vitest';
import {
  GUILD,
  OTHER_USER,
  USER,
  command,
  createTestServer,
  embedOf,
  makeHandler,
} from './chat-test-kit.ts';
import type { TestServer } from '../runtime/test-kit.ts';

let server: TestServer | null = null;
afterEach(async () => {
  if (server) await server.close();
  server = null;
});

const voidCommand = (strings: Record<string, string>) =>
  command({ name: 'admin', sub: 'stream-void', guildId: null, channelId: null, strings });

describe('/admin stream-void', () => {
  it('voids the round with a reason, refunds and writes the audit row', async () => {
    server = createTestServer({ casinoHandlers: true });
    const s = server;
    const handler = makeHandler(s, { stream: s.stream });
    const who = (userId: string) => ({ guildId: GUILD, userId });
    const stream = s.stream.start(who(OTHER_USER), { title: 'Boss', idempotencyKey: 'a' }).stream;
    const roundId = s.stream.openRound(who(OTHER_USER), {
      streamId: stream.id,
      idempotencyKey: 'b',
    }).stream.round!.id;
    s.economy.ensureMember(GUILD, USER);
    s.stream.bet(who(USER), {
      streamId: stream.id,
      roundId,
      side: 'lose',
      amount: 700,
      idempotencyKey: 'c',
    });

    const bad = voidCommand({ guild_id: GUILD, target: 'round:999', reason: 'x' });
    await handler(bad.interaction as never);
    expect(embedOf(bad.out[0]!.options)).toMatchObject({
      title: 'Could not void the round',
      description: 'No stream or round matches that id.',
    });

    const ok = voidCommand({
      guild_id: GUILD,
      target: `stream:${stream.id}`,
      reason: 'thrown fight',
    });
    await handler(ok.interaction as never);
    const e = embedOf(ok.out[0]!.options);
    expect(e.title).toBe('↩️ Round voided');
    expect(e.description).toContain('Reason: thrown fight');
    expect(e.description).toContain('700');
    expect(s.economy.getBalance(GUILD, USER)).toBe(3000);
    expect(s.stream.auditOf(GUILD, roundId)).toMatchObject({
      cause: 'owner',
      actorId: USER,
      reason: 'thrown fight',
    });
  });
});
