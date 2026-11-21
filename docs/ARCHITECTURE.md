# Architecture

## Process and packages

One Node 24 process runs everything: Fastify (HTTP API), Socket.io (same HTTP server),
discord.js (chat bot, `Guilds` intent only), and a cron scheduler. Services talk through a typed
in-process `EventEmitter` bus (`DomainEventMap`). No Redis, no broker, no ORM. The server is
bundled by tsup into `dist/main.js` (workspace code inlined, npm dependencies external) and runs
with `node --max-old-space-size=192`. The web app is a Vite + React build served from Cloudflare
Pages.

| Package | Role |
| --- | --- |
| `packages/shared` | Contracts: TypeBox schemas, socket events, rooms, domain events, ledger reasons, ids, RNG/clock interfaces, i18n. |
| `packages/domain` | Pure rules. Imports only `@casino/shared`. |
| `packages/ui` | Bitbloom React components and assets. |
| `apps/server` | The single process above. |
| `apps/web` | The Activity. |

Workspace packages are consumed as TypeScript source. Code uses erasable TypeScript only and
`.ts` relative imports, so Node, Vite, Vitest and tsup read the same files.

## Auth flow

1. Activity: `discordSdk.ready()`, then `commands.authorize({ client_id, response_type: 'code',
   prompt: 'none', scope: ['identify', 'guilds'] })`.
2. `POST /api/token` with `TokenRequest` (`code`, `guildId`, `instanceId`, `clientLocale`).
3. Server exchanges the code with `DISCORD_CLIENT_SECRET`, calls `/users/@me` and
   `/users/@me/guilds`, checks the guild is in `ALLOWED_GUILD_IDS` (and approved when
   `REQUIRE_APPROVAL=1`), upserts `users` and `guild_members`, resolves the locale, consumes any
   launch intent, and returns `TokenResponse` with our session token (HS256 JWS over
   `SessionClaims`, `SESSION_SECRET`, 1 hour).
4. Activity: `commands.authenticate({ access_token })`, then connects Socket.io with
   `auth: { token }`. HTTP calls send `Authorization: Bearer <token>`. On expiry the Activity
   repeats the flow silently.

## URL mappings and the proxy

Developer Portal mappings: `/` → Pages domain, `/api` → API domain with the `/api` path kept, so
routes are identical in dev (Vite proxies `/api` to `localhost:3001`) and inside Discord.
Socket.io uses path `/api/socket.io` and `transports: ['websocket']`. Libraries that build their
own URLs go through `patchUrlMappings`. Fonts and all other assets are bundled; the iframe can
reach only mapped URLs. The server verifies the request-signature headers that Discord's proxy
adds, as described in Discord's Activity security guide, and rejects unsigned requests in
production.

## Server authority and idempotency

All randomness is on the server (`cryptoRng`, built on `crypto.randomInt`). Clients send intents
(`BetIntent`, `ActionIntent`), never results. Every intent carries an `idempotencyKey`; the
server stores the first response in `idempotency_keys` per (guild, user, key) inside the same
transaction as the money change, and replays it (`replayed: true`) for repeats. A reused key
with a different body is a `conflict`. Every client payload is validated with its schema from
`CLIENT_PAYLOADS`. Rate limits apply per user and per socket. Chat commands call the same
services in-process, so both surfaces share one economy.

## Domain purity

`packages/domain` functions take state, inputs and a `DomainContext` (`rng`, `clock`) and return
`Outcome<S>`: the next state plus domain events. No DB, no Discord, no network, no
`Date.now`, `new Date()` or `Math.random`. ESLint blocks these imports and globals, and
`purity.test.ts` fails CI on its own if they appear. Tests use `createSeededRng` and
`manualClock`, which makes parity tests against the original behaviour possible.

## Economy

`EconomyService` (server) is the only writer of balances. Each change inserts one `ledger` row
with a `LedgerReason`; triggers keep `balances` in step and reject edits (see
[DB_SCHEMA.md](DB_SCHEMA.md)). Balances are per guild. A change, its game state and its
idempotency record commit in one transaction; events are published after commit.

## Events and subscribers

Services publish `DomainEvent`s (per guild) on the bus after commit. Subscribers:

| Subscriber | Does |
| --- | --- |
| Socket rooms | Emits `domain:event`, `balance:update`, `table:state` to the right rooms. |
| Chat announcer | Posts selected events to the guild announce channel, rate-limited and batched. |
| Webhook personas | Posts race, market and bank news with their own name and avatar. |
| DM queue | Opt-in DMs per `NotificationKind`, with retry and per-user digest. |
| Inbox | Stores the same notifications for the Activity inbox (`inbox:new`). |
| Presence | Updates rich presence (screen and balance). |
| Stats, missions, ranking | Count `GameSettled` from both surfaces. |

## Rooms

`guild:{id}`, `instance:{instanceId}` and `user:{id}` are joined on connect from the verified
token. `table:{instanceId}:{game}` is joined with `table:join` for shared tables (roulette
wheel, blackjack seats, watch-together race). Names come from `rooms.*` in `packages/shared`.
Market ticks go out once per minute; races are sent as a timeline.

## Launch intents

A chat button answers with `LAUNCH_ACTIVITY` after the bot stores `LaunchIntent`
(`userId`, `guildId`, `screen`, `expires` = now + 2 min) through the in-process
`POST /api/launch-intent` handler. `POST /api/token` consumes it and returns it, and the Activity
opens on that screen.

## i18n

Typed dictionaries in `packages/shared/i18n/{en,ja}.ts` with flat dotted keys. `ja` is typed
against the `en` key set, and `pnpm i18n:check` fails CI on a missing or empty key or on
placeholder drift. Locale order: user setting, Discord client locale, guild preferred locale,
`en`.

## Legacy import

`apps/server/scripts/import-legacy.ts` reads the Python bot's `data/casino.db` (bot stopped) and
writes the new schema using the mapping in [DB_SCHEMA.md](DB_SCHEMA.md). Each balance starts with
one `legacy_import` ledger row. The run prints per-guild and per-user totals for every Pelica
bucket and fails on any difference. Never run the Python bot and the new bot on the same token at
the same time.

## Secrets and config

`.env` is created by the owner on their machine and never committed; `.env.example` holds
placeholders only. Config is validated at start-up. Logs redact anything that looks like a token. Times use `UTC_OFFSET_HOURS` (JST = 9). `ANNOUNCE_CHANNEL_ID` is the default;
`guild_config` overrides it per guild.

## Directory ownership

| Path | Owner |
| --- | --- |
| `packages/shared/`, root config, `docs/ARCHITECTURE.md`, `docs/DB_SCHEMA.md` | A1 (shared is frozen; changes need an A1 task) |
| `packages/domain/{casino,race,arena,work,quiz,lottery,poll}/` | B2 |
| `packages/domain/finance/` | B3 |
| `apps/server/src/{http,socket,db,auth}/`, `apps/server/scripts/` | B1 |
| `apps/server/src/bot/`, `apps/server/src/notify/` | B4 |
| `packages/ui/` | F1; `packages/ui/src/{audio,fx}` F3 |
| `apps/web/src/shell/` | F4 |
| `apps/web/src/screens/` | F2 |
| `**/*.test.ts` next to code | T1 |
| `tests/e2e/`, `tests/invariants/` | T2 |
| `ops/`, `.github/workflows/` | O1 |
| `docs/spec/` | S1 |
| `docs/STATUS.md`, READMEs | SC |
