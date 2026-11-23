import { afterEach, describe, expect, it } from 'vitest';
import { buildLaunchButtonId } from '../notify/discord-port.ts';
import {
  GUILD,
  OTHER_USER,
  USER,
  autocomplete,
  button,
  command,
  createTestServer,
  makeHandler,
  makeUser,
  modalSubmit,
  select,
} from './chat-test-kit.ts';
import type { TestServer } from '../runtime/test-kit.ts';

let server: TestServer | null = null;
afterEach(async () => {
  if (server) await server.close();
  server = null;
});

const member = () => makeUser(OTHER_USER, 'bob');

function setup() {
  server = createTestServer({ casinoHandlers: true });
  server.economy.ensureMember(GUILD, USER);
  server.economy.ensureMember(GUILD, OTHER_USER);
  return { s: server, handler: makeHandler(server) };
}

describe('guild access on components, modals and autocomplete', () => {
  it('R-6: a denied guild cannot press buttons, use selects or modals, or autocomplete', async () => {
    const { s, handler } = setup();
    const buy = command({
      name: 'market',
      group: 'order',
      sub: 'spot',
      strings: { symbol: 'cs' },
      integers: { amount: 2000 },
      user: member(),
    });
    await handler(buy.interaction as never);
    const open = autocomplete('market', { name: 'position', value: '' }, {}, { user: member() });
    await handler(open.interaction as never);
    expect(open.responses[0]).toEqual([expect.objectContaining({ value: 'spot:cs' })]);

    s.identity.setGuildStatus(GUILD, 'denied', USER);

    const launch = button(buildLaunchButtonId('home'), { user: member() });
    await handler(launch.interaction as never);
    expect(launch.interaction.launchActivity).not.toHaveBeenCalled();
    expect(s.launchIntents.consume(OTHER_USER, GUILD)).toBeNull();
    expect(launch.out).toHaveLength(1);

    const chatButton = button('b:fin:x:1', { user: member() });
    await handler(chatButton.interaction as never);
    expect(chatButton.out).toHaveLength(1);

    const menu = select('b:qz:x', ['a'], { user: member() });
    await handler(menu.interaction as never);
    expect(menu.out).toHaveLength(1);

    const modal = modalSubmit('b:qzp:x', { question: 'q' }, { user: member() });
    await handler(modal.interaction as never);
    expect(modal.out).toHaveLength(1);

    const again = autocomplete('market', { name: 'position', value: '' }, {}, { user: member() });
    await handler(again.interaction as never);
    expect(again.responses[0]).toEqual([]);
  });

  it('R-6: an owner still gets through a denied guild', async () => {
    const { s, handler } = setup();
    s.identity.setGuildStatus(GUILD, 'denied', USER);
    const launch = button(buildLaunchButtonId('home'));
    await handler(launch.interaction as never);
    expect(launch.interaction.launchActivity).toHaveBeenCalledOnce();
  });
});
