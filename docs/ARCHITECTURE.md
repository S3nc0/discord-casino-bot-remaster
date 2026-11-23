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
   `ALLOWED_GUILD_IDS` (a listed guild counts as approved: a `pending` row is set to `approved`
   on sight; only an explicit `denied` blocks it, as `guild_not_allowed`. `REQUIRE_APPROVAL`
   has no effect on this route; it is reserved for guilds outside the list once the bot can
   admit them); `instanceId` is a live instance
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

**Limits per user.** All sockets of one user share one event budget (`eventsPer10s`, default 100
per 10 s, then `rate_limited`), so opening more sockets never raises it. At most
`maxSocketsPerUser` (default 5) sockets of one user are live at once; the next handshake is refused
with `rate_limited`, and a handshake that slips past the check concurrently is dropped on
connection. Upgrade attempts are also capped per client address (`upgradesPerMinute`, default 300).

**Guild revoke.** `/admin server-revoke` (owner only, never for a guild in `ALLOWED_GUILD_IDS`)
sets the guild to `denied` and then calls the `onGuildRevoked` hook. `startBot` wires that hook to
`SessionService.revokeGuild`, so every live socket of the guild is disconnected at once. Nothing
else needs to be told: HTTP routes, new token requests and new socket handshakes read the `denied`
status through `isGuildDenied` and answer 403 `guild_not_allowed`, and a socket that somehow
survives is ended on its next event. A failing hook is logged and never blocks the revoke.

## URL mappings and proxy signatures

Developer Portal: `/` → Pages domain, `/api` → API domain with `/api` kept, so routes match dev
(Vite proxies `/api` to `localhost:3001`), and `/discord-cdn` → `cdn.discordapp.com`
(`DISCORD_CDN_PREFIX`, `DISCORD_URL_MAPPINGS`) for avatars: `avatarUrl(user, { base:
'/.proxy/discord-cdn' })` inside Discord, the CDN origin outside. Socket.io: path
`/api/socket.io`, websocket only. Libraries that build URLs use `patchUrlMappings` with
`DISCORD_URL_MAPPINGS`. All other assets are bundled.

Discord's docs describe `X-Signature-Ed25519`, `X-Signature-Timestamp` and
`X-Discord-Proxy-Payload` (base64 JSON with `created_at`, `expires_at`, Unix seconds) as
optional. **Observed on 2026-11-21 on real Activity traffic: none of the three signature headers
arrive either before or after `sdk.authenticate` (neither on HTTP routes nor on the socket
upgrade).** The policy stays **verify-if-present** with `REQUIRE_PROXY_SIGNATURE` kept `false`
(`0`), and our signed session tokens (plus `POST /api/token`'s Discord code exchange and live
instance check) are the real auth boundary.

`ProxySignatureVerifier` (shared) rejects, in order: missing headers; a payload that is not
`ProxyPayload`; `String(created_at) !== timestamp`; `created_at` more than 60 s in the future;
`expires_at <= now`; an Ed25519 signature (hex or base64) over the decoded payload bytes that
does not verify with `DISCORD_PUBLIC_KEY` (`node:crypto`). Policy (`auth/proxy-policy.ts`), as a
Fastify `onRequest` hook for `/api/*` and in Socket.io `allowRequest` for the upgrade:

- `GET /api/health` and `POST /api/token` are exempt. `token` stands on its own checks (Discord
  code exchange with the client secret, `/users/@me`, guild in `ALLOWED_GUILD_IDS`, live
  instance) and its rate limits.
- Everywhere else: **verify if present.** If any of the three headers is present, all must be
  present and valid, else 401. If none is present the request is allowed, because every such
  route still needs our session token (`me`, `settings`, `inbox`, `inbox/read`,
  `launch-intent/consume`, and the socket handshake).
- `REQUIRE_PROXY_SIGNATURE=1` (optional, default `0`) additionally answers 401
  `proxy_signature_missing` when none is present, on every route except `health` and `token`.
- `NODE_ENV=development` switches the check off entirely.

The first authenticated request and the first socket connect of each session log one info line,
`proxy signature: present=valid|absent` (field `transport`), never header values.

Every 401/403 on the auth path logs one warn line `auth rejected: <reason>` with a stable
`reason` and no secrets: `proxy_signature_missing:<absent headers>`, `proxy_signature_invalid`,
`proxy_payload_invalid`, `timestamp_skew`, `proxy_expired`, `bearer_missing`, `session_invalid`,
`session_revoked`, `session_expired`, `socket_auth_failed` (with `detail`), `scope_missing`,
`user_not_in_guild`, `guild_not_allowed`, `guild_pending`, `instance_mismatch` and
`code_exchange_failed:<status>` / `user_fetch_failed:<status>` / `guilds_fetch_failed:<status>` /
`instance_fetch_failed:<status>` (Discord's HTTP status, or `network`). The response body carries
`reason` only when `NODE_ENV` is not `production`.

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

### Ledger reasons

`LEDGER_REASONS` (`packages/shared/src/ledger.ts`) is append-only: values are added through an
A1 task and never renamed or removed. Each reason has one flow class in `LEDGER_REASON_FLOW` and
one direction in `LEDGER_REASON_SIGN`; a test fails if a reason lacks either. Classes are seen
from player balances, which are the only ledger accounts:

- `faucet` (credit): the Pelica does not come from another player's balance in the same
  transaction: system grants, Teiai bank or house account, company funds, escrows, positions,
  pots.
- `sink` (debit): the Pelica does not go to another player's balance in the same transaction.
  Escrow holds and positions are sinks too; their release or close is a faucet.
- `transfer` (either direction, fixed per reason): one leg of a player-to-player move. The
  transfer rows of one transaction sum to zero. A fee on top is its own sink row, never netted
  into a leg.

Rules for callers:

- `isDeltaAllowed(reason, delta)` must hold for every row. When a legacy flow had one string
  for both directions there are two reasons (`horse_retirement` / `horse_retirement_fee`,
  `quiz_author_reward` / `quiz_author_clawback`, `admin_grant` / `admin_revoke`).
- Wave 2 additions: `horse_breeding_fee` (sink, the 15,000 breeding fee), `quiz_author_pay`
  (sink: a user author pays a correct answer's reward; the answerer's `quiz_reward` is a faucet
  because a shortfall becomes the author's Teiai debt, so the rows need not sum to zero) and
  `game_insurance_refund` (faucet, see below).
- **Decision: the insurance refund is a faucet, `game_insurance_refund`.** No player pays it in
  the same transaction (the item's price already left as `shop_buy`), so it is not a transfer.
  It is not `game_refund` either: that one returns the stake of a voided round, and history
  (`保険券で半額返金:{game}`), stats and the supply check must tell the two apart.
- Gross then deduction: credit the gross amount, then debit the cut as its own sink row
  (`teiai_skim` on daily and labor income, `capital_gains_tax` on profitable sells and margin
  closes, `marketplace_fee` / `kyosai_fee` on sale proceeds, `debt_withholding` on income).
  Legacy wrote 0-delta lines for skims; the ledger rejects 0-delta rows.
- The stock market and the `cs` crypto ticker share one spot book: both use `stock_buy`,
  `stock_sell` and `trade_fee`, with the ticker in `ref_id`. Teiai trust deposits are
  `bank_deposit` / `bank_withdraw` / `bank_interest`. Chat-only and screen-only variants of a
  movement use the same reason; `ref_type` / `ref_id` tell them apart.
- Fixed-price market sales are `marketplace_buy` → `marketplace_sale` in one transaction. Auction
  bids are `marketplace_hold` / `marketplace_release`, and the seller of a won auction gets
  `marketplace_auction_sale`. P2P loans: `p2p_lend` → `p2p_borrow`, and `p2p_repay` or
  `p2p_garnishment` → `p2p_collect`; lenders paid from a bankruptcy pool get
  `p2p_bankruptcy_payout`.
- Not ledger movements (no reason, recorded in their own tables): changes to debt alone (Toichi
  interest, the overseas-escape fine, P2P late penalties, unpaid shortfalls), moves inside Teiai
  bank, house account or company funds (arena pool subsidy, company upkeep and shipment skim,
  kyosai auction proceeds), and trust haircuts. When such a step takes player cash it uses the
  matching sink (`debt_seizure` for forced execution, `bankruptcy_writeoff` for cash seized into
  a bankruptcy pool).

Wave 3 supply check: per guild, `SUM(delta)` over faucet rows plus over sink rows equals the
change in total balances, and transfer rows sum to zero per transaction.

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
`discord|light|dark`, sound on/off with SFX and music volume 0–100, default 30, motion
`system|full|reduced`, where `system` follows `prefers-reduced-motion`)
describes the person and their device, not an account in one guild's economy; a player in two
guilds expects the same app. Audio stays muted until the first user gesture even when sound is
on. After a change the client re-runs `resolveLocale` with `localeHints`; the token's `loc`
catches up at the next silent refresh.

**Inbox.** Per user and guild. `InboxItem.kind` is an `InboxKind`: the opt-in
`NOTIFICATION_KINDS` (each sourced from one domain event, `NOTIFICATION_SOURCE`; `horse_foaled`
← `HorseFoaled`) plus `SYSTEM_INBOX_KINDS`. **Decision: the closed-DM notice is the kind
`dm_disabled`.** It names what the user sees (their DMs were switched off); `dm_closed` stays
only the DM send-failure reason (Discord 50007) and the notice's `reason` field. It is
inbox-only, has no DM preference, and its `event` is a `DmDisabledNotice`, not a domain
event. New items arrive as `inbox:new` on `user:{id}`, followed by
`inbox:unread` (`{ guildId, unread }`), which is also sent after every read (HTTP or the
`inbox:read` socket event), so every open instance shows the same count.

## Events, rooms, launch intents

After commit, per-guild `DomainEvent`s go to subscribers: socket rooms (`domain:event`,
`balance:update`, `table:state`), chat announcer (rate-limited, batched), webhook personas, DM
queue (opt-in, retry, digest), inbox, presence, and stats/missions/ranking. Rooms: `guild:{id}`,
`instance:{instanceId}`, `user:{id}` on connect; `table:{instanceId}:{game}` via `table:join`.
Payloads on `user:{id}` carry `guildId` so a client in two guilds can filter. Market ticks once
a minute; races as a timeline.

The union (`DOMAIN_EVENT_TYPES`, `packages/shared/src/events.ts`): `GameSettled`, `BigWin`,
`Jackpot`, `RaceScheduled`, `RaceFinished`, `HorseRetired`, `MarketTick`, `MarketMove`,
`LoanDue`, `BankruptcyGraceStarted`, `BankruptcyDeclared`, `MissionCompleted`, `TitleAwarded`,
`OrderFilled`, `MarketplaceOutbid`, `DailyReady`, `CompanyBankrupt`, `LotteryDrawn`,
`HorseFoaled` (a bred foal, [horse-breeding.md](spec/horse-breeding.md) §5; announced only at
`statTotal >= FOAL_ANNOUNCE_MIN_TOTAL` = 205). Every event carries `guildId` and `at`.
`GameSettled.tags` (optional, snake_case, at most 16) carries the round's game-specific labels
(`natural`, `double_win`, `jackpot`, …) for missions and the announcer, so a chat round and an
Activity round count the same. **Decision: bankruptcy is two events.** `BankruptcyGraceStarted`
opens the 24 h window and can end without a bankruptcy (debt repaid below the threshold);
`BankruptcyDeclared` (`cause`: `voluntary`, `forced`, `escape`) is the bankruptcy itself, with
debt before and after compression. A phase field on one event would make its other fields
optional and its consumers branch.

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
`ErrorCode` has `error.<code>`, every `InboxKind` has `inbox.kind.<kind>`, and `pnpm i18n:check`
fails CI on drift. Server-side text lives there too: `bot.*` (chat replies), `notify.*`
(announcements, personas, DMs, inbox notes), `horse.*` (breeding), `finance.*` (toasts); no
module keeps a local dictionary. Locale: user setting,
client locale, guild locale, `en`.

`apps/server/scripts/import-legacy.ts` imports `data/casino.db` (Python bot stopped) per
DB_SCHEMA.md and fails on any Pelica difference. Never run both bots on one token.

`.env` lives only on the owner's machine; `.env.example` holds placeholders and must satisfy
`ServerEnv` (tested). The server validates env at start-up. Optional keys have
`SERVER_ENV_DEFAULTS`: `PORT` 3001, `HOST` `127.0.0.1`, `DATABASE_PATH` `./data/casino.sqlite`
(never the legacy `data/casino.db`, which only the importer reads), `LOG_LEVEL` `info`,
`NODE_ENV` `production`, `BOT_DISABLED` `0` (`1` skips the chat bot's gateway login; HTTP,
Socket.io and jobs still run). `HOST` stays on loopback: the tunnel connects
locally and `trustProxy` is set to one trusted hop (`TRUSTED_PROXY_HOPS = 1`, not `true`), so only
the address the tunnel appended to `X-Forwarded-For` is believed and a chain written by the client
is ignored; a directly reachable server would still see the wrong peer (a container is the only
reason to bind elsewhere). Pino `redact.paths`:
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
