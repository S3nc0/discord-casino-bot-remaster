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
   prompt: 'none', scope: ['identify', 'guilds'] })`.
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
(Vite proxies `/api` to `localhost:3001`). Socket.io: path `/api/socket.io`, websocket only.
Libraries that build URLs use `patchUrlMappings`. All assets are bundled.

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

## Events, rooms, launch intents

After commit, per-guild `DomainEvent`s go to subscribers: socket rooms (`domain:event`,
`balance:update`, `table:state`), chat announcer (rate-limited, batched), webhook personas, DM
queue (opt-in, retry, digest), inbox, presence, and stats/missions/ranking. Rooms: `guild:{id}`,
`instance:{instanceId}`, `user:{id}` on connect; `table:{instanceId}:{game}` via `table:join`.
Payloads on `user:{id}` carry `guildId` so a client in two guilds can filter. Market ticks once
a minute; races as a timeline.

Launch intents are in-process only (`LaunchIntentService`); there is no HTTP route. The bot calls
`create({ userId, guildId, screen })` (expires in 2 min) and answers with `LAUNCH_ACTIVITY`;
`POST /api/token` calls `consume` for the session's own user and guild.

## i18n, legacy import, secrets

Dictionaries `packages/shared/i18n/{en,ja}.ts`, flat keys; `ja` is typed against `en`, every
`ErrorCode` has `error.<code>`, and `pnpm i18n:check` fails CI on drift. Locale: user setting,
client locale, guild locale, `en`.

`apps/server/scripts/import-legacy.ts` imports `data/casino.db` (Python bot stopped) per
DB_SCHEMA.md and fails on any Pelica difference. Never run both bots on one token.

`.env` lives only on the owner's machine; `.env.example` holds placeholders and must satisfy
`ServerEnv` (tested). The server validates env at start-up. Pino `redact.paths`:
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
