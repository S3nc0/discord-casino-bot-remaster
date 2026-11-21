# Architecture

## Process and packages

One Node 24 process: Fastify (HTTP API), Socket.io (same server), discord.js (chat bot, `Guilds`
intent only) and a cron scheduler, talking through a typed in-process `EventEmitter` bus
(`DomainEventMap`). No Redis, broker or ORM. tsup bundles the server into `dist/main.js`
(workspace code inlined, npm deps external); it runs with `--max-old-space-size=192`. The web app
is a Vite + React build on Cloudflare Pages.

`packages/shared` holds the contracts (TypeBox schemas, socket events, rooms, domain events,
ledger reasons, ids, env contract, proxy verifier and RNG/clock interfaces, i18n).
`packages/domain` holds pure rules, `packages/ui` the Bitbloom components. Workspace packages are
consumed as TypeScript source: erasable syntax only, `.ts` relative imports.

## Auth flow

1. Activity: `discordSdk.ready()`, then `commands.authorize({ client_id, response_type: 'code',
   prompt: 'none', scope: AUTHORIZE_SCOPES })` = `identify`, `guilds` (the server reads
   `/users/@me` and `/users/@me/guilds`) and `rpc.activities.write` (`commands.setActivity` for
   rich presence). The server needs only `REQUIRED_SERVER_SCOPES` (`identify`, `guilds`) in
   the grant.
2. `POST /api/token` with `TokenRequest`. Nothing in it is trusted as given.
3. The server exchanges the code (`DISCORD_CLIENT_SECRET`), reads `/users/@me` and
   `/users/@me/guilds`, and requires: `guildId` is in the user's guild list **and** in
   `ALLOWED_GUILD_IDS` (and approved if `REQUIRE_APPROVAL=1`); `instanceId` is a live instance
   per `GET /applications/{app}/activity-instances/{instanceId}`, its location's guild is
   `guildId`, and the user is in its user list. Then it upserts `users`/`guild_members`,
   resolves the locale, consumes this user's launch intent for this guild, and returns
   `TokenResponse` with an HS256 session token over `SessionClaims` (`SESSION_SECRET`, 1 h).
4. Activity: `commands.authenticate({ access_token })`, connects Socket.io with
   `auth: { token }`; HTTP uses `Authorization: Bearer`. On expiry it repeats the flow silently.

**Socket sessions.** `SocketData` carries `expiresAt` and `jti`. The server checks
`isSessionExpired` on every incoming event and disconnects at `expiresAt`, emitting
`session:error` `{ error: 'expired' }` first. Every room join, automatic or via `table:join`,
passes `canJoinRoom`: guild and user rooms only for the token's guild and user, instance and table
rooms only for the token's instance (verified above to belong to that guild).

## URL mappings and proxy signatures

Developer Portal: `/` → Pages domain, `/api` → API domain with `/api` kept, so routes match dev
(Vite proxies `/api` to `localhost:3001`), and `/discord-cdn` → `cdn.discordapp.com`
(`DISCORD_CDN_PREFIX`, `DISCORD_URL_MAPPINGS`) for avatars: `avatarUrl(user, { base:
'/.proxy/discord-cdn' })` inside Discord, the CDN origin outside. Socket.io: path
`/api/socket.io`, websocket only. Libraries that build URLs use `patchUrlMappings` with
`DISCORD_URL_MAPPINGS`. All other assets are bundled.

Every request through the Discord proxy carries `X-Signature-Ed25519`, `X-Signature-Timestamp`
and `X-Discord-Proxy-Payload` (base64 JSON with `created_at`, `expires_at`, Unix seconds).
`ProxySignatureVerifier` (shared) rejects, in order: missing headers; a payload that is not
`ProxyPayload`; `String(created_at) !== timestamp`; `created_at` more than 60 s in the future;
`expires_at <= now`; an Ed25519 signature (hex or base64) over the decoded payload bytes that
does not verify with `DISCORD_PUBLIC_KEY` (`node:crypto`). It runs as a Fastify `onRequest` hook
for `/api/*` and in Socket.io `allowRequest` for the upgrade. It fails closed (401) unless
`NODE_ENV=development`.

## Server authority and idempotency

All randomness is server-side (`cryptoRng`, `crypto.randomInt`). Clients send intents
(`BetIntent`, `ActionIntent` with `roundId`), never results. Inbound schemas reject unknown
properties. Each intent's `idempotencyKey` is stored with its first response in
`idempotency_keys` in the same transaction as the money change and replayed on repeats; a reused
key with a different body is `conflict`; a stale `roundId` is `conflict`. Rate limits per user
and per socket. Chat commands call the same services in-process.

## Domain purity and economy

`packages/domain` functions take state, inputs and `DomainContext` (`rng`, `clock`) and return
`Outcome<S>` (state + events). No I/O, wall clock, ambient RNG or path imports out of the
package: ESLint blocks them and `purity.test.ts` fails CI on its own.

`EconomyService` is the only writer of balances: one `ledger` row per change, triggers keep
`balances` in step and reject edits, replaces and upserts; balances never go below zero (debt
has its own tables). All money, rates, prices and quantities are integers (Pelica, bps, fixed
point). The change, its game state and its idempotency record commit together; events are
published after commit. See [DB_SCHEMA.md](DB_SCHEMA.md).

## HTTP API

Routes are `API_ROUTES` (`packages/shared/src/api.ts`); bodies and responses are TypeBox
schemas there and in `settings.ts`. Everything but `health` and `token` needs the session token
and acts only on the token's own user and guild: no route takes a user or guild id.

| Route | Request → response |
| --- | --- |
| `GET /api/health` | → `{ status, db }` (no signature check) |
| `POST /api/token` | `TokenRequest` → `TokenResponse` |
| `GET /api/me` | → `MeResponse`: user, guild, instance, balance, resolved locale, `localeHints`, expiry |
| `GET /api/settings` / `PUT /api/settings` | → `SettingsResponse` / `SettingsUpdateRequest` (whole document) → `SettingsResponse` |
| `GET /api/inbox` | `InboxQuery` (digit strings) → `InboxPage` (newest first, `unread`, `nextBefore`) |
| `POST /api/inbox/read` | `InboxReadRequest` (`{ ids }` or `{ all: true }`) → `InboxReadResponse` |
| `POST /api/launch-intent/consume` | `LaunchIntentConsumeRequest` (`{}`) → `LaunchIntentConsumeResponse` |

**Decision: `/api/me` is the balance source.** There is no `/api/balance`: the shell needs user,
guild, balance and locale together at start and after a reconnect, and `balance:update` keeps
the balance fresh afterwards. One call, one schema.

**Decision: settings are global per user.** `UserSettings` (language `auto|en|ja`, theme
`discord|light|dark`, sound on/off with SFX and music volume 0–100, default 30, motion on/off)
describes the person and their device, not an account in one guild's economy; a player in two
guilds expects the same app. Audio stays muted until the first user gesture even when sound is
on. After a change the client re-runs `resolveLocale` with `localeHints`; the token's `loc`
catches up at the next silent refresh.

**Inbox.** Per user and guild. New items arrive as `inbox:new` on `user:{id}`, followed by
`inbox:unread` (`{ guildId, unread }`), which is also sent after every read (HTTP or the
`inbox:read` socket event), so every open instance shows the same count.

## Events, rooms, launch intents

After commit, per-guild `DomainEvent`s go to subscribers: socket rooms (`domain:event`,
`balance:update`, `table:state`), chat announcer (rate-limited, batched), webhook personas, DM
queue (opt-in, retry, digest), inbox, presence, and stats/missions/ranking. Rooms: `guild:{id}`,
`instance:{instanceId}`, `user:{id}` on connect; `table:{instanceId}:{game}` via `table:join`.
Payloads on `user:{id}` carry `guildId` so a client in two guilds can filter. Market ticks once
a minute; races as a timeline.

Launch intents are created in-process only (`LaunchIntentService`); there is no HTTP route to
create one. The bot calls `create({ userId, guildId, screen })` (expires in 2 min) and answers
with `LAUNCH_ACTIVITY`; `POST /api/token` calls `consume` for the session's own user and guild.
An Activity that is already open consumes a newer intent with `POST /api/launch-intent/consume`
(empty body; user and guild come from the session token), so it only ever consumes its own.

`instance:participants` (`Participants`: guild, instance, `PublicUser[]`) goes to
`instance:{instanceId}` as the full list whenever a user joins or leaves the instance, and to a
socket right after it joins.

## i18n, legacy import, secrets

Dictionaries `packages/shared/i18n/{en,ja}.ts`, flat keys; `ja` is typed against `en`, every
`ErrorCode` has `error.<code>`, and `pnpm i18n:check` fails CI on drift. Locale: user setting,
client locale, guild locale, `en`.

`apps/server/scripts/import-legacy.ts` imports `data/casino.db` (Python bot stopped) per
DB_SCHEMA.md and fails on any Pelica difference. Never run both bots on one token.

`.env` lives only on the owner's machine; `.env.example` holds placeholders and must satisfy
`ServerEnv` (tested). The server validates env at start-up. Optional keys have
`SERVER_ENV_DEFAULTS`: `PORT` 3001, `HOST` `127.0.0.1`, `DATABASE_PATH` `./data/casino.db`,
`LOG_LEVEL` `info`, `NODE_ENV` `production`. `HOST` stays on loopback: the tunnel connects
locally and `trustProxy` is on, so a directly reachable server would accept forged
`X-Forwarded-For` (a container is the only reason to bind elsewhere). Pino `redact.paths`:
`req.headers.authorization`, `req.headers.cookie`, `req.headers["x-discord-proxy-payload"]`,
`*.code`, `*.accessToken`, `*.access_token`, `*.sessionToken`, `*.token`, `*.secret`; a
serializer also masks `Bearer …`, JWS-shaped strings and bot-token-shaped strings in messages.

## Directory ownership

| Path | Owner |
| --- | --- |
| `packages/shared/`, root config, these two docs | A1 (shared frozen; changes need an A1 task) |
| `packages/domain/casino/` | B2-A |
| `packages/domain/{race,arena,work,quiz,lottery,poll,shop}/` | B2-B |
| `packages/domain/finance/` (incl. player market) | B3 |
| `apps/server/src/{http,socket,db,auth}/`, `apps/server/scripts/` | B1 |
| `apps/server/src/{bot,notify}/` | B4 |
| `packages/ui/` (`src/{audio,fx}`: F3) | F1 |
| `apps/web/src/shell/` / `apps/web/src/screens/` | F4 / F2 |
| `**/*.test.ts` next to code / `tests/e2e/`, `tests/invariants/` | T1 / T2 |
| `ops/`, `.github/workflows/` | O1 |
| `docs/spec/` / `docs/STATUS.md`, READMEs | S1 / SC |

## Known follow-ups

- arm64 CI job on `ubuntu-24.04-arm` (O1, task 1.5).
- Proxy verifier, socket expiry and room checks are contracts here; B1 implements them in Wave 1.
