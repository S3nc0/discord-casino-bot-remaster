import { Type, type Static } from 'typebox';
import { PublicUser } from './auth.ts';
import { EpochMs, InstanceId, Pelica, Snowflake } from './ids.ts';
import { LaunchIntent } from './launch.ts';
import { LocaleSchema } from './locale.ts';
import { InboxItem } from './notify.ts';
import { InboxRead } from './socket.ts';
import { LanguageSetting } from './settings.ts';

/**
 * HTTP routes. All are under `/api` (mapped through the Discord proxy with `/api` kept).
 * Every route except `health` and `token` needs `Authorization: Bearer <sessionToken>` and acts
 * only on the session's own user and guild: no route takes a user or guild id from the client.
 * Errors use `ApiError`.
 */
export const API_ROUTES = {
  /** GET, unauthenticated, not signature-checked. */
  health: '/api/health',
  /** POST `TokenRequest` → `TokenResponse`. */
  token: '/api/token',
  /** GET → `MeResponse`. Also the balance source: there is no separate balance route. */
  me: '/api/me',
  /** GET → `SettingsResponse`; PUT `SettingsUpdateRequest` → `SettingsResponse`. */
  settings: '/api/settings',
  /** GET (query `InboxQuery`) → `InboxPage`. */
  inbox: '/api/inbox',
  /** POST `InboxReadRequest` → `InboxReadResponse`. */
  inboxRead: '/api/inbox/read',
  /** POST `LaunchIntentConsumeRequest` → `LaunchIntentConsumeResponse`. */
  launchIntentConsume: '/api/launch-intent/consume',
} as const;
export type ApiRoute = (typeof API_ROUTES)[keyof typeof API_ROUTES];

const closed = { additionalProperties: false } as const;

// ---- GET /api/me ----

export const MeGuild = Type.Object({
  id: Snowflake,
  /** From `guilds.name`; null until the bot has seen the guild. */
  name: Type.Union([Type.String(), Type.Null()]),
});
export type MeGuild = Static<typeof MeGuild>;

/** Inputs the client needs to re-run `resolveLocale` after a settings change. */
export const LocaleHints = Type.Object({
  /** The user's language setting (`auto` = not chosen). */
  setting: LanguageSetting,
  /** The guild's preferred locale (`guild_config.locale`), if it is one we ship. */
  guild: Type.Union([LocaleSchema, Type.Null()]),
});
export type LocaleHints = Static<typeof LocaleHints>;

/**
 * Who am I, where, and how much do I have. One call after `POST /api/token` (and after a
 * reconnect) fills the shell; afterwards `balance:update` on the socket keeps the balance fresh.
 */
export const MeResponse = Type.Object({
  user: PublicUser,
  guild: MeGuild,
  instanceId: InstanceId,
  /** Balance in this guild (0 for a new member). */
  balance: Pelica,
  /** Resolved locale (same as the session token's `loc` claim). */
  locale: LocaleSchema,
  localeHints: LocaleHints,
  /** Session expiry, epoch ms. */
  expiresAt: EpochMs,
});
export type MeResponse = Static<typeof MeResponse>;

// ---- GET /api/inbox, POST /api/inbox/read ----

export const INBOX_PAGE_DEFAULT = 20;
export const INBOX_PAGE_MAX = 50;

/**
 * Query of `GET /api/inbox`. Query values arrive as strings, so the schema checks digit
 * strings; convert with `Number()` after `Value.Check`. Items are newest first; pass the last
 * page's `nextBefore` as `before` for the next (older) page.
 */
export const InboxQuery = Type.Object(
  {
    /** Only items with `id < before`. Omit for the newest page. */
    before: Type.Optional(Type.String({ pattern: '^[1-9][0-9]{0,15}$' })),
    /** Page size, 1..INBOX_PAGE_MAX; default INBOX_PAGE_DEFAULT. */
    limit: Type.Optional(Type.String({ pattern: '^(?:[1-9]|[1-4][0-9]|50)$' })),
    /** `1` = unread items only. */
    unread: Type.Optional(Type.Enum(['0', '1'])),
  },
  closed,
);
export type InboxQuery = Static<typeof InboxQuery>;

/** Inbox of the session's user in the session's guild. */
export const InboxPage = Type.Object({
  items: Type.Array(InboxItem, { maxItems: INBOX_PAGE_MAX }),
  /** Unread items in this guild in total (not just on this page). */
  unread: Type.Integer({ minimum: 0 }),
  /** `before` for the next page; null when there are no older items. */
  nextBefore: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
});
export type InboxPage = Static<typeof InboxPage>;

/**
 * Body of `POST /api/inbox/read`: the same `{ ids }` as the `inbox:read` socket event, or
 * `{ all: true }` for "mark all as read" in the session's guild. Ids of other users or guilds
 * are ignored.
 */
export const InboxReadAll = Type.Object({ all: Type.Literal(true) }, closed);
export type InboxReadAll = Static<typeof InboxReadAll>;

export const InboxReadRequest = Type.Union([InboxRead, InboxReadAll]);
export type InboxReadRequest = Static<typeof InboxReadRequest>;

/** Unread count after the change. The server also emits `inbox:unread` to `user:{id}`. */
export const InboxReadResponse = Type.Object({ unread: Type.Integer({ minimum: 0 }) });
export type InboxReadResponse = Static<typeof InboxReadResponse>;

// ---- POST /api/launch-intent/consume ----

/**
 * Body of `POST /api/launch-intent/consume`: empty (or no body). The Activity consumes only
 * its own intent: user and guild come from the session token, never from the request. Used
 * when an intent arrives while the Activity is already open (`POST /api/token` consumes the
 * one pending at launch).
 */
export const LaunchIntentConsumeRequest = Type.Object({}, closed);
export type LaunchIntentConsumeRequest = Static<typeof LaunchIntentConsumeRequest>;

export const LaunchIntentConsumeResponse = Type.Object({
  launchIntent: Type.Union([LaunchIntent, Type.Null()]),
});
export type LaunchIntentConsumeResponse = Static<typeof LaunchIntentConsumeResponse>;
