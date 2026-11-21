import { describe, expect, it } from 'vitest';
import { LAUNCH_INTENT_TTL_MS, manualClock } from '@casino/shared';
import {
  GUILD,
  OTHER_GUILD,
  OTHER_USER,
  START_MS,
  USER,
  memoryStore,
} from '../runtime/test-kit.ts';
import { SqliteLaunchIntentService } from './launch-intents.ts';

function setup() {
  const clock = manualClock(START_MS);
  return { clock, service: new SqliteLaunchIntentService(memoryStore(), clock) };
}

describe('launch intents', () => {
  it('expire after two minutes', () => {
    expect(LAUNCH_INTENT_TTL_MS).toBe(120_000);
    const { clock, service } = setup();
    const intent = service.create({ userId: USER, guildId: GUILD, screen: 'slots' });
    expect(intent).toEqual({
      userId: USER,
      guildId: GUILD,
      screen: 'slots',
      expires: START_MS + 120_000,
    });
    clock.advance(119_999);
    expect(service.consume(USER, GUILD)).toEqual(intent);
    const second = service.create({ userId: USER, guildId: GUILD, screen: 'bank' });
    clock.advance(120_000);
    expect(service.consume(USER, GUILD)).toBeNull();
    expect(second.expires).toBe(START_MS + 119_999 + 120_000);
  });

  it('are consumed once', () => {
    const { service } = setup();
    service.create({ userId: USER, guildId: GUILD, screen: 'daily' });
    expect(service.consume(USER, GUILD)?.screen).toBe('daily');
    expect(service.consume(USER, GUILD)).toBeNull();
  });

  it('only the matching user and guild can consume', () => {
    const { service } = setup();
    service.create({ userId: USER, guildId: GUILD, screen: 'daily' });
    expect(service.consume(OTHER_USER, GUILD)).toBeNull();
    expect(service.consume(USER, OTHER_GUILD)).toBeNull();
    expect(service.consume(USER, GUILD)?.screen).toBe('daily');
  });

  it('a newer intent replaces the older one, even a consumed one', () => {
    const { service } = setup();
    service.create({ userId: USER, guildId: GUILD, screen: 'daily' });
    service.create({ userId: USER, guildId: GUILD, screen: 'shop' });
    expect(service.consume(USER, GUILD)?.screen).toBe('shop');
    service.create({ userId: USER, guildId: GUILD, screen: 'bank' });
    expect(service.consume(USER, GUILD)?.screen).toBe('bank');
  });

  it('purge removes expired and consumed rows', () => {
    const { clock, service } = setup();
    service.create({ userId: USER, guildId: GUILD, screen: 'daily' });
    service.create({ userId: OTHER_USER, guildId: GUILD, screen: 'shop' });
    service.consume(USER, GUILD);
    expect(service.purge()).toBe(1);
    clock.advance(LAUNCH_INTENT_TTL_MS);
    expect(service.purge()).toBe(1);
  });
});
