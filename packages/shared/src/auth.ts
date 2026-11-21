import { Type, type Static } from 'typebox';
import { EpochMs, InstanceId, Snowflake } from './ids.ts';
import { LaunchIntent } from './launch.ts';
import { LocaleSchema } from './locale.ts';

/**
 * Scopes the Activity passes to `discordSdk.commands.authorize`. `identify` and `guilds` let the
 * server read `/users/@me` and `/users/@me/guilds` in `POST /api/token`; `rpc.activities.write`
 * lets the Activity call `commands.setActivity` (rich presence). The server accepts a grant that
 * contains at least `identify` and `guilds` (`REQUIRED_SERVER_SCOPES`).
 */
export const AUTHORIZE_SCOPES = ['identify', 'guilds', 'rpc.activities.write'] as const;
export type AuthorizeScope = (typeof AUTHORIZE_SCOPES)[number];

/** Scopes the server itself needs from the exchanged token. */
export const REQUIRED_SERVER_SCOPES = [
  'identify',
  'guilds',
] as const satisfies readonly AuthorizeScope[];

/** Lifetime of our own session token. The Activity re-runs the silent auth flow on expiry. */
export const SESSION_TTL_SECONDS = 60 * 60;

/**
 * Claims inside our session token (compact HS256 JWS signed with SESSION_SECRET).
 * Times are in seconds, as in JWT. One token is bound to one user, guild and Activity instance.
 */
export const SessionClaims = Type.Object({
  v: Type.Literal(1),
  sub: Snowflake,
  gid: Snowflake,
  iid: InstanceId,
  loc: LocaleSchema,
  iat: Type.Integer({ minimum: 0 }),
  exp: Type.Integer({ minimum: 0 }),
  jti: Type.String({ minLength: 8, maxLength: 64 }),
});
export type SessionClaims = Static<typeof SessionClaims>;

/** POST /api/token: the Activity sends the OAuth2 code from `discordSdk.commands.authorize`. */
/**
 * The server trusts none of these fields as given: `guildId` must be in the user's
 * `/users/@me/guilds` and in ALLOWED_GUILD_IDS, and `instanceId` must be a live Activity
 * instance in that guild with this user in it (Discord's activity-instance endpoint).
 */
export const TokenRequest = Type.Object(
  {
    code: Type.String({ minLength: 1, maxLength: 512 }),
    guildId: Snowflake,
    instanceId: InstanceId,
    /** SDK user locale, used for locale resolution when the user has no setting. */
    clientLocale: Type.Optional(Type.String({ maxLength: 16 })),
  },
  { additionalProperties: false },
);
export type TokenRequest = Static<typeof TokenRequest>;

export const PublicUser = Type.Object({
  id: Snowflake,
  username: Type.String(),
  globalName: Type.Union([Type.String(), Type.Null()]),
  avatar: Type.Union([Type.String(), Type.Null()]),
});
export type PublicUser = Static<typeof PublicUser>;

export const TokenResponse = Type.Object({
  /** Discord access token, passed to `discordSdk.commands.authenticate`. */
  accessToken: Type.String(),
  /** Our session token. Sent as `Authorization: Bearer` and in the Socket.io handshake. */
  sessionToken: Type.String(),
  expiresAt: EpochMs,
  user: PublicUser,
  guildId: Snowflake,
  locale: LocaleSchema,
  /** The pending launch intent for this user and guild, consumed by this call. */
  launchIntent: Type.Union([LaunchIntent, Type.Null()]),
});
export type TokenResponse = Static<typeof TokenResponse>;
