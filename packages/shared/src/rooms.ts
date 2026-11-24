import type { GameId } from './ids.ts';
import { isGameId } from './ids.ts';

export type GuildRoom = `guild:${string}`;
export type InstanceRoom = `instance:${string}`;
export type UserRoom = `user:${string}`;
export type TableRoom = `table:${string}:${GameId}`;
export type StreamRoom = `stream:${string}:${number}`;
export type RoomName = GuildRoom | InstanceRoom | UserRoom | TableRoom | StreamRoom;

/**
 * Socket.io room names. Every socket joins guild, instance and user rooms on connect;
 * table rooms are joined explicitly with `table:join`, stream rooms with `stream:join`.
 */
export const rooms = {
  guild: (guildId: string): GuildRoom => `guild:${guildId}`,
  instance: (instanceId: string): InstanceRoom => `instance:${instanceId}`,
  user: (userId: string): UserRoom => `user:${userId}`,
  table: (instanceId: string, game: GameId): TableRoom => `table:${instanceId}:${game}`,
  stream: (guildId: string, streamId: number): StreamRoom => `stream:${guildId}:${streamId}`,
} as const;

export type ParsedRoom =
  | { kind: 'guild'; guildId: string }
  | { kind: 'instance'; instanceId: string }
  | { kind: 'user'; userId: string }
  | { kind: 'table'; instanceId: string; game: GameId }
  | { kind: 'stream'; guildId: string; streamId: number };

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
  if (
    kind === 'stream' &&
    rest.length === 2 &&
    rest[0] &&
    /^[1-9][0-9]{0,15}$/.test(rest[1] ?? '')
  ) {
    return { kind, guildId: rest[0], streamId: Number(rest[1]) };
  }
  return null;
}

/** What a session is bound to (from the verified token; see `SocketData`). */
export interface RoomScope {
  userId: string;
  guildId: string;
  instanceId: string;
}

/**
 * Whether a session may join a room. The instance id in the token was verified at
 * `POST /api/token` to belong to the token's guild, so instance and table rooms are allowed
 * only for that one instance; guild and user rooms only for the token's own guild and user;
 * a stream room only for the token's own guild (the server also checks that the stream is live).
 */
export function canJoinRoom(scope: RoomScope, name: string): boolean {
  const room = parseRoom(name);
  if (!room) return false;
  switch (room.kind) {
    case 'guild':
    case 'stream':
      return room.guildId === scope.guildId;
    case 'user':
      return room.userId === scope.userId;
    case 'instance':
    case 'table':
      return room.instanceId === scope.instanceId;
  }
}
