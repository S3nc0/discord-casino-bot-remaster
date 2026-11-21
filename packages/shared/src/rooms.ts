import type { GameId } from './ids.ts';
import { isGameId } from './ids.ts';

export type GuildRoom = `guild:${string}`;
export type InstanceRoom = `instance:${string}`;
export type UserRoom = `user:${string}`;
export type TableRoom = `table:${string}:${GameId}`;
export type RoomName = GuildRoom | InstanceRoom | UserRoom | TableRoom;

/**
 * Socket.io room names. Every socket joins guild, instance and user rooms on connect;
 * table rooms are joined explicitly with `table:join`.
 */
export const rooms = {
  guild: (guildId: string): GuildRoom => `guild:${guildId}`,
  instance: (instanceId: string): InstanceRoom => `instance:${instanceId}`,
  user: (userId: string): UserRoom => `user:${userId}`,
  table: (instanceId: string, game: GameId): TableRoom => `table:${instanceId}:${game}`,
} as const;

export type ParsedRoom =
  | { kind: 'guild'; guildId: string }
  | { kind: 'instance'; instanceId: string }
  | { kind: 'user'; userId: string }
  | { kind: 'table'; instanceId: string; game: GameId };

export function parseRoom(name: string): ParsedRoom | null {
  const [kind, ...rest] = name.split(':');
  if (kind === 'guild' && rest.length === 1 && rest[0]) return { kind, guildId: rest[0] };
  if (kind === 'user' && rest.length === 1 && rest[0]) return { kind, userId: rest[0] };
  if (kind === 'instance' && rest.length >= 1) {
    const instanceId = rest.join(':');
    return instanceId ? { kind, instanceId } : null;
  }
  if (kind === 'table' && rest.length >= 2) {
    const game = rest[rest.length - 1] ?? '';
    const instanceId = rest.slice(0, -1).join(':');
    return instanceId && isGameId(game) ? { kind, instanceId, game } : null;
  }
  return null;
}
