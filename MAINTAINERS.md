**English** | [日本語](MAINTAINERS.ja.md)

# Maintainer guide

This is the handbook for whoever keeps the casino running and changes it: how the repository is laid out, how the pieces talk, how to run, release and back it up, how to add things, and what to do when something breaks. First-time owner setup is a separate click-by-click guide: [Owner Setup Guide](docs/OWNER_SETUP.md). How the code is built, in depth: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Related: [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), [CHANGELOG.md](CHANGELOG.md), [docs/STATUS.md](docs/STATUS.md).

## Contents

- [Who maintains this](#who-maintains-this)
- [Repository tour](#repository-tour)
- [How the pieces talk](#how-the-pieces-talk)
- [Running everything locally](#running-everything-locally)
- [Environment variables](#environment-variables)
- [Releasing](#releasing)
- [Migrations, backups and restore](#migrations-backups-and-restore)
- [Importing the legacy database](#importing-the-legacy-database)
- [Adding a new game](#adding-a-new-game)
- [Adding a translation key](#adding-a-translation-key)
- [Adding an announcement or DM type](#adding-an-announcement-or-dm-type)
- [Updating design tokens](#updating-design-tokens)
- [Regenerating pixel art](#regenerating-pixel-art)
- [Moving the server to a Raspberry Pi](#moving-the-server-to-a-raspberry-pi)
- [Rotating secrets after a leak](#rotating-secrets-after-a-leak)
- [Troubleshooting](#troubleshooting)
- [Upstream and credits](#upstream-and-credits)

## Who maintains this

[S3nc0](https://github.com/S3nc0) maintains this repository and runs the live bot. It is a hobby project: reviews and fixes happen when time allows, there is no support promise, and Pelica is play money with no cash value.

## Repository tour

| Path | What is in it |
| --- | --- |
| `apps/server/` | The one server process: Fastify HTTP API, Socket.io, the Discord chat bot, the scheduler, SQLite. Entry point `src/main.ts`. |
| `apps/server/src/` | `auth/` login and sessions, `db/` store, migrations and importer, `economy/` the ledger writer, `finance/` bank, loans, stocks, companies, market, `games/` every game, `stream/` stream panel, `http/` routes, `socket/` Socket.io, `bot/` slash commands, `notify/` announcements, DMs and inbox, `runtime/` boot, jobs, limits. |
| `apps/server/scripts/` | `import-legacy.ts` (legacy import) and `load.ts` (load generator). |
| `apps/web/` | The Discord Activity: React 19 + Vite. `src/shell/` is the frame (login, sockets, stores), `src/screens/` has one folder per group of screens. |
| `packages/shared/` | The contracts both sides agree on: ids, TypeBox schemas, socket and domain events, ledger reasons, env contract, and the EN/JA text in `i18n/`. |
| `packages/domain/` | Pure game rules. No I/O, no clock, no random source of its own. |
| `packages/ui/` | Bitbloom: components, design tokens, fonts, pixel icons and sprites, sound and effects. |
| `catalogs/` | The tunable numbers (payouts, prices, rates) as YAML. |
| `design/` | Bitbloom design tokens and the scripts that build them. |
| `tools/pixel-art/` | Generators for every icon, sprite and scene: `icons/`, `app-icon/`, `horse/`, `scenes/`, `casino/`, `social/`, `finance/` (see [Regenerating pixel art](#regenerating-pixel-art)). |
| `tests/` | `e2e/` (multi-client socket suites), `invariants/` (property tests on the ledger) and `fixtures/legacy/` (parity data recorded from the original bot). Unit tests sit next to the code. |
| `ops/` | `pi/` installer and systemd units, `cloudflared/` tunnel template, `pi-sim/` arm64 container and load test. |
| `docs/` | Owner guides (EN/JA), `ARCHITECTURE.md`, `DB_SCHEMA.md`, `STATUS.md`, `spec/` behaviour specs, `ui-cheatsheet.md`, game notes. |

The original Python bot is not in the tree; it is in git history before v1.0.0 (see [docs/spec/INDEX.md](docs/spec/INDEX.md) for how to read a file from it).

Workspace packages are consumed as TypeScript source: erasable syntax only (no enums or parameter properties) and relative imports that end in `.ts`. The server is bundled by `tsup` into `apps/server/dist/main.js`.

## How the pieces talk

```text
Discord client ──(Activity iframe)──▶ Cloudflare Pages (apps/web)
      │                                      │  fetch /api, socket /api/socket.io
      │ slash commands                       ▼
      ▼                          Discord proxy (URL mappings) ─▶ tunnel ─▶ server :3001
 Discord gateway ◀── discord.js ──────────────────────────────────────────┘
                                   one Node process: HTTP + Socket.io + bot + jobs
                                   one SQLite file (data/casino.sqlite)
```

- The **Activity** is a static site on Cloudflare Pages. Inside Discord it can only reach URLs you mapped in the Developer Portal: `/` goes to the Pages host, `/api` goes to the server through the tunnel, `/discord-cdn` goes to Discord's avatar CDN.
- **Login:** the Activity gets a code from Discord, sends it to `POST /api/token`, and gets back a one-hour session token. That token opens the HTTP routes and the socket. The server checks the guild, the live Activity instance and the user with Discord itself.
- The **chat bot** and the **Activity** are two front doors to the same services in the same process. A slash command and a button in the Activity call the same code, so balances and rules always agree.
- **Services** change money only through `EconomyService`, in one SQLite transaction together with the game state and the idempotency record. After the commit they publish **domain events** on an in-process bus.
- **Subscribers** of the bus: socket rooms (live updates in the Activity), the announcer and webhook personas, the DM queue, the inbox, presence, stats, missions and ranking.
- The **scheduler** runs the timed work: market ticks, races, daily reset, arena, lottery, loans, housekeeping.

The full picture, with the auth steps and the rules each layer enforces, is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Running everything locally

You need Node 24 (`.nvmrc`) and pnpm 12.21.0 (`packageManager` in `package.json`).

```sh
pnpm i
cp .env.example .env        # then fill in real values on your own machine
pnpm -r build
```

| Goal | Command |
| --- | --- |
| Server with rebuild on change | `pnpm dev:server` (reads `.env`) |
| Activity dev server (port 5173, proxies `/api` to `localhost:3001`) | `pnpm --filter @casino/web dev` |
| Activity without Discord (mock SDK and in-memory API) | `pnpm --filter @casino/web dev:mock`, then add `?screen=blackjack` or `?locale=ja` to the URL |
| Tunnel so Discord can reach your server | `pnpm dev:tunnel` (named tunnel) or `pnpm dev:tunnel:quick` |
| Register slash commands | `pnpm commands:deploy:guild` (to `TEST_GUILD_ID`, except DM commands such as `/admin`, which it creates or updates globally one by one; commands already global are skipped), `pnpm commands:deploy:global` (everything, keeps the Activity Entry Point command), or `pnpm commands:dry-run` to look first |
| Server without the chat bot | `BOT_DISABLED=1` in `.env` |

Before you push, everything CI runs:

```sh
pnpm -r build && pnpm -r test && pnpm -r typecheck
pnpm lint && pnpm format:check && pnpm i18n:check
pnpm exec vitest run --config tests/vitest.config.ts tests/e2e
INVARIANT_RUNS=300 pnpm exec vitest run --config tests/vitest.config.ts tests/invariants
```

- Add `INVARIANT_SEED=<number>` to replay a failing property run.
- Slow tests are skipped by default. Run them before a release, or when you touch horse breeding: `SLOW_TESTS=1 pnpm --filter @casino/server test` (today the full breeding range sweep, R-8).
- The browser flow (desktop and 390 px wide) needs Chrome: `pnpm --filter @casino/web exec vitest run --config e2e/vitest.config.ts`.
- The Pi load test needs Docker: `ops/pi-sim/perf.sh --duration 60` (see [docs/PI_SETUP.md](docs/PI_SETUP.md)).
- Never run two copies of the bot on one token. If the old Python bot or another machine is running, stop it first.

## Environment variables

Names only; the real values live in `.env` on the host and nowhere else. The commented template is `.env.example`, and the server checks the values at start-up and names the bad key if one is wrong.

| Variable | Secret? | Notes |
| --- | --- | --- |
| `DISCORD_TOKEN` | **yes** | Bot token. |
| `DISCORD_CLIENT_ID` | no | Application ID. Must match `VITE_DISCORD_CLIENT_ID` on Cloudflare Pages. |
| `DISCORD_CLIENT_SECRET` | **yes** | OAuth2 client secret (not the bot token). |
| `DISCORD_PUBLIC_KEY` | no | Hex public key, used to check Discord's proxy signatures. |
| `ALLOWED_GUILD_IDS` | no | Comma-separated server IDs that may use the Activity. |
| `OWNER_IDS` | no | Comma-separated user IDs allowed to use `/admin`. |
| `TEST_GUILD_ID` | no | Server that receives `commands:deploy:guild`. |
| `REQUIRE_APPROVAL` | no | Reserved for servers outside `ALLOWED_GUILD_IDS`; no effect today. |
| `UTC_OFFSET_HOURS` | no | Game-day offset (`9` for JST). Job schedules are read in it. |
| `SESSION_SECRET` | **yes** | At least 32 bytes, random. Signs session tokens. |
| `PUBLIC_API_ORIGIN` | no | Public origin of the API, no trailing slash. |
| `ANNOUNCE_CHANNEL_ID` | no | Default announcement channel (per-server override is stored in the database). |
| `REQUIRE_PROXY_SIGNATURE` | no | Keep `0`: Discord sends no signature headers on Activity traffic. |
| `HOST` | no | Keep `127.0.0.1`; the tunnel connects locally. |
| `PORT` | no | Default `3001`. |
| `DATABASE_PATH` | no | Default `./data/casino.sqlite`. Never the legacy `casino.db`. |
| `LOG_LEVEL` | no | One of `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`. |
| `BOT_DISABLED` | no | `0` logs the bot in, `1` keeps it offline. |
| `NODE_ENV` | no | Optional, default `production`. `development` switches the proxy signature check off. |

Other names you may meet: `VITE_DISCORD_CLIENT_ID` and `VITE_API_HOST` (Cloudflare Pages, public), `VITE_MOCK_DISCORD` (local mock mode), `INVARIANT_RUNS`, `INVARIANT_SEED` and `SLOW_TESTS` (tests), `CHROME_PATH` and `README_SHOTS` (screenshot scripts), `CLOUDFLARED_CONFIG` (`dev:tunnel`), `ART_OUT`, `ART_REF` and `ART_THEME` (pixel art tools). Never put a secret in a `VITE_` variable: it ends up in the public bundle.

## Releasing

There is no release pipeline: Pages builds from `main` by itself, and the server is updated by hand. For `vX.Y.Z`:

1. **Check `main`.** All CI jobs are green on the commit you want to release (check, invariants, e2e, pi-sim, and Perf if the server changed). Run the slow tests once too: `SLOW_TESTS=1 pnpm --filter @casino/server test`.
2. **Write the changelog.** In `CHANGELOG.md` and `CHANGELOG.ja.md`, replace `Unreleased` (`未リリース`) with the date, make sure the entry lists what changed in plain words in both languages, and merge that through a pull request.
3. **Tag.**

   ```sh
   git switch main && git pull
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```

   Optionally publish a GitHub release from the tag with the changelog entry as its text.
4. **Pages deploy.** Pushing to `main` already started the build. In Cloudflare, **Workers & Pages → your project → Deployments**, confirm the deployment of the release commit says **Success**, then open the Pages address in a browser. If the build failed, fix it and push; do not restart the server first. Settings are in [docs/DEPLOY_PAGES.md](docs/DEPLOY_PAGES.md).
5. **Server restart.** Take a backup first (see [below](#migrations-backups-and-restore)), because new migrations run when the server starts.
   - On the Pi: update the clone you installed from, then run `sudo bash ops/pi/install.sh` again. It syncs the code, installs, rebuilds and restarts the service. Keep your `.env` and `data/`; the script does not touch them.
   - On a Mac: stop the server, `git pull`, `pnpm i`, then `pnpm dev:server`.
6. **Commands.** If slash commands were added or renamed, run `pnpm commands:deploy:guild` (and `pnpm commands:deploy:global` for other servers).
7. **Smoke test.** `curl https://<your-api-host>/api/health` answers 200, the log shows `casino server listening`, then run the [Owner Testing Checklist](docs/OWNER_TESTING.md).

Breaking changes to the API or socket contract need the web build and the server to change together; keep contract changes additive where you can, so a visitor with an old tab keeps working until they reload.

## Migrations, backups and restore

**Migrations.** The schema is a list of numbered SQL files in `apps/server/src/db/migrations/`, listed in `index.ts` and applied in order when the server starts, one transaction each. Each applied file's checksum is stored in `schema_migrations`.

- Never edit a migration that has merged. Add the next number instead. The server refuses to start if an applied file was edited, or if the database has a migration this build does not know (a newer build wrote it; do not run an older build on that file).
- The latest is `0013_stream` (`streams`, `stream_rounds`, `stream_bets` and `stream_round_audit` for the stream panel). Before it, `0012_pinned_posts` added `pinned_posts` (which poll, kyosai motion and raffle posts the bot has pinned, so the sweep can unpin them), and `0011_arena_runner_up` added a nullable `arena_tournaments.runner_up_id`: second place of the final; empty for tournaments that finished earlier.
- Money columns are integers, rates are basis points, prices are fixed point. Rules and tables: [docs/DB_SCHEMA.md](docs/DB_SCHEMA.md).

**Backups.** On the Pi, a systemd timer runs `ops/pi/backup.sh` every night at about 03:30 and keeps seven days in `/var/backups/discord-casino/`. It uses SQLite's online `.backup`, so it is safe while the server runs. To take one right now:

```sh
sudo systemctl start discord-casino-backup.service
ls -lh /var/backups/discord-casino/
```

On a Mac, with the server running or not: `sqlite3 data/casino.sqlite ".backup 'casino-backup.sqlite'"`. Do not copy `casino.sqlite` with `cp` while the server runs: the live state is partly in the `-wal` file next to it. Copy a backup off the machine now and then (a different disk or computer).

**Restore.**

```sh
sudo systemctl stop discord-casino.service
sudo -u casino rm -f /opt/discord-casino/data/casino.sqlite-wal /opt/discord-casino/data/casino.sqlite-shm
sudo -u casino cp /var/backups/discord-casino/casino-YYYYMMDD-HHMMSS.sqlite /opt/discord-casino/data/casino.sqlite
sudo systemctl start discord-casino.service
sudo journalctl -u discord-casino.service -n 50 --no-pager
```

The leftover `-wal` and `-shm` files belong to the file you are replacing; if they stay, SQLite may try to apply them to the restored copy. After a restore, everything since the backup is gone: players keep their Pelica as of that moment, so tell them. Test a restore on a spare copy once, before you need it.

## Importing the legacy database

The importer carries the **wallets** of the old Python bot over: each player's balance (one opening `legacy_import` ledger row), refunds for stakes held in unfinished games, server approval status and membership, and the old ledger as read-only history. Everything else (horses, stocks, companies, items and so on) starts fresh; the table-by-table mapping and the proof that no Pelica moves are in [docs/DB_SCHEMA.md](docs/DB_SCHEMA.md#legacy-table-mapping).

**For v1.0.0 the owner chose to skip the dry run**, so this has been tested on fixtures but not on the real `casino.db`. Run it like this whenever you do it, and read the dry-run output before applying:

1. Stop the Python bot and the new server. Make a copy of `casino.db` and use the copy; never point anything at the only original.
2. **Dry run** (writes nothing). It prints each server and each player with the balance, the refunded stakes and the expected total, plus warnings and errors:

   ```sh
   node apps/server/scripts/import-legacy.ts --legacy data/casino.db
   ```

3. Fix anything it reports as an `error` (for example a negative legacy balance stops the import). Compare the totals with what the old bot showed.
4. **Apply** into the new database file. It writes everything in one transaction, checks every player and server total, and exits non-zero without writing if any Pelica amount differs:

   ```sh
   node apps/server/scripts/import-legacy.ts --legacy data/casino.db --target data/casino.sqlite --apply
   ```

5. Run it again: a second `--apply` on the same data is a no-op (the source digest is recorded in `legacy_import_runs`). Then start the server.

Keep a copy of `casino.db` somewhere safe and out of git (`data/` is ignored). The importer only reads that file and never needs the original bot's code, which is no longer in the repository.

## Adding a new game

Work in this order; each step has a test beside it. Look at an existing game (blackjack is the fullest example) as you go.

1. **Contracts** (`packages/shared`): add the id to `GAME_IDS` in `src/ids.ts` (`SCREEN_IDS` follows), the intent and table shapes in `src/intents.ts` and `src/socket.ts` if the game is live, any new `ErrorCode`, and the `LEDGER_REASONS` the game needs in `src/ledger.ts` with its flow class and sign (reasons are append-only; never rename or remove one). Add a `GameSettled` tag name if missions or announcements should see it.
2. **Rules** (`packages/domain/src/<game>/`): pure functions that take state, inputs and `DomainContext` (`rng`, `clock`) and return an `Outcome`. No I/O, wall clock or ambient random: lint and `purity.test.ts` enforce it. Put the tunable numbers in `catalogs/` and mirror them as integers in the domain constants.
3. **Service** (`apps/server/src/games/<game>/`): load state, call the domain function, and in **one** `store.transaction` change the balance through `EconomyService` (with the request's idempotency key), save the game state and the idempotency record. Publish events with `afterCommit`. Register it in `games/index.ts` (casino games) or `games/progression/register.ts` (others) and wire it in `runtime/server.ts`.
4. **Socket events or HTTP routes**: casino-style rounds use the existing `game:bet` / `game:action` intents (`games/casino/handlers.ts`); other screens add a route file in `http/activity/` and register it in `http/activity/index.ts`. Never take a user, server or instance from the request body; use the session's. Name each route once in `packages/shared/src/activity/` (for example `FINANCE_ROUTES`) and give every write an idempotency key; `POST /api/finance/listings/create` (escrow an owned, tradable item into a player-market listing, fed by the `sellable` list of `GET /api/finance/listings`) is a small example to copy.
5. **Screen** (`apps/web/src/screens/<group>/`): the component, its API hook, a mock for `dev:mock`, CSS, and a lazy entry in `screens/routes.tsx`. Use `@casino/ui` components and tokens only. Draw a game icon in `tools/pixel-art/icons/` and, if the screen has a scene, a generator next to the others in `tools/pixel-art/` that writes its `*-art.ts` beside the screen (see [below](#regenerating-pixel-art)).
6. **Slash command** (`apps/server/src/bot/`): add the command to `COMMAND_SPECS` in `commands.ts` with English and Japanese names and descriptions, write the handler in the matching chat module, add the path to `WIRED_COMMAND_PATHS`, then run `pnpm commands:deploy:guild`.
7. **i18n**: every new string in both `en.ts` and `ja.ts` (screen name `screen.<id>`, bot replies `bot.*`, errors `error.<code>`). `pnpm i18n:check` must pass.
8. **Tests**: domain unit tests, a service test (including a replayed idempotency key), a socket or route test, and, if money moves, a command in `tests/invariants/commands.ts` so the property test plays it. Add a behaviour note to `docs/` and a line to `CHANGELOG.md`.

## Adding a translation key

1. Add the key to `packages/shared/i18n/en.ts` **and** `packages/shared/i18n/ja.ts`, with the same `{placeholders}` in both. Keys are flat and dotted by area: `bot.*` (chat replies), `notify.*` (announcements, DMs, inbox notes), `horse.*`, `finance.*`, `error.<code>`, `screen.<id>`, `inbox.kind.<kind>`.
2. Use it: `t(locale, 'some.key', { name })` on the server, `useT()` in the Activity. No module keeps its own dictionary and no string is hard-coded.
3. Run `pnpm i18n:check`. It fails on a missing key, an empty text or different placeholders. Types also fail if an error code, screen id or inbox kind has no label.
4. Write the Japanese as a Japanese speaker would say it, not as a word-for-word copy of the English.

## Adding an announcement or DM type

Announcements, toasts, DMs and the inbox all start from a **domain event**.

1. **Event** (`packages/shared/src/events.ts`): add the type to the union and `DOMAIN_EVENT_TYPES`. Every event carries `guildId` and `at`. Publish it from the service after the commit.
2. **Who may see it live** (`apps/server/src/socket/domain-audience.ts`): events are private to the users they name unless you add the type to the public allowlist `GUILD_PUBLIC`. Add it there only if every member of the server may see it.
3. **Announcement** (`apps/server/src/notify/messages.ts`): add the type to `SUBSCRIBED_EVENT_TYPES` and an `EVENT_META` entry (title and body keys, colour role, persona, whether it is announced by default, notification kind, toast tone). Add `notify.event.<Type>.title` and `.body` in both languages and a renderer if the text needs fields.
4. **Opt-in DM and inbox kind** (`packages/shared/src/notify.ts`): add the kind to `NOTIFICATION_KINDS` and map it to its source event in `NOTIFICATION_SOURCE`. Add `inbox.kind.<kind>` in both languages. A system notice that is not backed by an event goes in `SYSTEM_INBOX_KINDS` instead (it has no DM preference and is never DMed).
5. **Tests**: `notify/messages.test.ts`, the announcer and DM tests, and a check that the audience is what you meant.

## Updating design tokens

Colours, spacing and type come from the Bitbloom tokens. Do not edit generated CSS by hand.

1. Change the theme in `design/bitbloom/build_tokens.py`, then run `python3 design/bitbloom/build_tokens.py`. It rebuilds `design/bitbloom/tokens.json` and `tokens.css` from the original palette in `design/bitbloom/proposal/archive/`.
2. Run `python3 design/bitbloom/contrast_check.py`. Every colour pair must pass in both themes.
3. Bring the result into the app: `packages/ui/src/styles/tokens.css` is the generated CSS passed through Prettier, with the Japanese font fallbacks kept. A test checks that it matches `tokens.json`, and `contrast.test.ts` repeats the contrast rules against the CSS the app loads.
4. Discord embed colours mirror the tokens in `apps/server/src/notify/theme.ts`; its test fails if they drift.
5. Run `pnpm --filter @casino/ui test` and `pnpm --filter @casino/server test`, then look at the Activity in light and dark, on a phone width.

## Regenerating pixel art

Every icon, sprite and scene is generated, never hand-edited. The commands, inputs, previews and outputs are in [tools/pixel-art/README.md](tools/pixel-art/README.md). The layout of `tools/pixel-art/`:

| Folder | Draws | Writes (`apps/web/src/screens/` unless noted) |
| --- | --- | --- |
| `icons/` | The 36 game icons | `packages/ui/src/pixel/icon-art.ts` and the icon fills in `packages/ui/src/styles/bundle.css` |
| `app-icon/` | App icon (`512x512`) and Activity favicons (`32x32`, `16x16`) | `docs/images/app-icon-512.png`, `apps/web/public/favicon-32.png`, `apps/web/public/favicon-16.png` |
| `horse/` | The eight-frame race horse (needs a reference) | `horse/horse-art.ts` and the coat and silks colours in `horse/horse.css` |
| `scenes/` | Race, stable, breeding, arena (16 fighters), mine (miner, ores, relics), shop, inventory | `horse/race-art.ts`, `stable-art.ts`, `arena-art.ts`; `life/mine-art.ts`, `shop-art.ts`, `inventory-art.ts` |
| `casino/` | Slots, chinchiro, blackjack, roulette, pachinko, chips | `casino/art/*-art.ts` |
| `social/` | Quiz, lottery, poll, missions, ranking, relics, transfer, daily, history, profile | `life/*-art.ts`, `casino/daily-art.ts`, `casino/history-art.ts`, `profile/profile-art.ts` |
| `finance/` | Bank, loans, kyosai, stocks, crypto, companies, market, coins, badges, gavel | `finance/art/*.ts` |
| `lib/` | Shared helpers: palette step names (`palette.js`), the 8x drawing helper (`hi.js`), output folders (`env.js`) | |
| `vendor/` | The codixel core (`pixel.js`, MIT) for PNG, GIF and sheet previews | |

To regenerate, from the repository root (each `ship.js` formats what it writes; a re-run with no change to the generator gives no diff):

```sh
node tools/pixel-art/icons/build.js
node tools/pixel-art/app-icon/build.js
ART_OUT=/some/folder ART_REF=/some/folder/ref node tools/pixel-art/horse/ship.js
ART_REF=/some/folder/ref node tools/pixel-art/scenes/ship.js
node tools/pixel-art/casino/ship.js
node tools/pixel-art/social/ship.js
node tools/pixel-art/finance/ship.js
```

- **How art ships.** Art is data, not images: each sprite is a list of row strings plus a legend that maps each character to a pair of palette tokens, `[light, dark]`. `PixelScene` and `useSceneFrame` / `useSceneOnce` in `packages/ui/src/pixel/` (or the screen's own `CasinoScene` / `FinanceScene`) fill each character with the active theme's token, at a whole-number scale, so light is day and dark is night. Moving parts ship as small overlays; frame 0 is the still frame that reduced motion shows.
- **Lazy per screen.** Each `*-art.ts` sits next to the screen that uses it and is imported only by that screen, which `screens/routes.tsx` loads lazily. Home (the `index` chunk) loads none of it, so adding a scene never slows the first screen. Keep it that way: never import a screen's art from the shell or from `@casino/ui`.
- The horse, the stable portrait, the fighters and the miner come from references that are **not** stored in the repository; the README says how to fetch the files that are needed. Any reference must be public domain or CC0, and must be credited in [CREDITS.md](CREDITS.md) and [CREDITS.ja.md](CREDITS.ja.md) (title, author, licence, source, how it was used).
- Use only palette steps from `design/bitbloom/tokens.css` (`tools/pixel-art/lib/palette.js` names them).
- After a run: `pnpm format`, `pnpm --filter @casino/ui test`, and `pnpm --filter @casino/web test`.

## Moving the server to a Raspberry Pi

Follow [docs/PI_SETUP.md](docs/PI_SETUP.md) ([日本語](docs/PI_SETUP.ja.md)). In short: finish the owner setup with a **named** tunnel, run `ops/pi/install.sh` on a 64-bit Pi, create `/opt/discord-casino/.env` (mode 600), place the tunnel credentials in `/etc/cloudflared/`, stop the server on the old machine **before** starting the Pi (one bot per token, one writer per database), copy a clean `.backup` of `casino.sqlite` over, then start both services and check `/api/health`. No code change is needed. The guide also holds the measured memory and CPU numbers for the Pi.

## Rotating secrets after a leak

Treat any secret that was pasted in chat, a screenshot, an issue, a log or a commit as leaked. Rotate first; clean up afterwards. Details of what each secret does are in [SECURITY.md](SECURITY.md).

| Secret | How to rotate | What happens next |
| --- | --- | --- |
| `DISCORD_TOKEN` | Developer Portal → **Bot** → **Reset Token**. Put the new value in `.env` and restart. | The old token stops working at once; the bot is offline until you restart. |
| `DISCORD_CLIENT_SECRET` | Developer Portal → **OAuth2** → **Reset Secret**. Update `.env` and restart. | Logins fail with `code_exchange_failed:401` until the server has the new value. |
| `SESSION_SECRET` | Make a new one with `openssl rand -hex 32`, update `.env`, restart. | Every session ends; players reopen the Activity. Nothing else is lost. |
| Tunnel credentials | Delete and recreate the tunnel in Cloudflare (or rotate its token), update `/etc/cloudflared/` and `config.yml`, restart `cloudflared`. | The API is unreachable until the new tunnel runs; update the `/api` URL mapping if the host changed. |
| `DISCORD_PUBLIC_KEY`, `DISCORD_CLIENT_ID` | These are public, not secrets. | Nothing to rotate. |

Then: check `git log` and `git grep` for the old value; if it was committed, rotating is still the fix (rewriting history does not undo a leak); look at the server log and Developer Portal for use you did not make; and write down what happened.

## Troubleshooting

Start with the server log (`journalctl -u discord-casino.service -f` on the Pi, the terminal running `pnpm dev:server` on a Mac). Auth failures print one line `auth rejected: <reason>`; the reasons and fixes are in the [Owner Setup Guide, step 10](docs/OWNER_SETUP.md#10-troubleshooting).

**Blank or stuck Activity, or "refused to connect", or CSP errors.** Inside Discord the Activity runs in an iframe behind a strict content security policy: it can load only what the URL mappings expose, so any request to another host is blocked.
- Open the developer tools of the Discord desktop client and read the Console. A line such as "Refused to connect to / load … Content Security Policy" names the blocked host.
- The app must never name an external host: fonts and images are bundled, and `pnpm --filter @casino/web build` fails (`scripts/check-bundle.js`) if the bundle mentions an unlisted host. A test also bans external URLs in CSS.
- Check the three mappings in the Developer Portal (`/` → the Pages host, `/api` → the API host, `/discord-cdn` → `cdn.discordapp.com`), with no `https://` and no trailing slash, and that you pressed **Save Changes**.
- A quick tunnel gets a new host every time it restarts; update the `/api` mapping.
- Confirm the latest Pages deployment succeeded and that `VITE_DISCORD_CLIENT_ID` is set there.
- Run `pnpm --filter @casino/web dev:mock` to tell "the app is broken" from "the Discord setup is broken".

**Socket does not connect.** The socket is `/api/socket.io`, websocket only. The tunnel must pass websockets, and the `/api` mapping must keep the `/api` prefix. A refused handshake logs `socket_auth_failed` with a detail. A user can hold at most five sockets at once (the sixth is refused with `rate_limited`), so a runaway reconnect loop in one client looks like this. After the session token's hour ends, the client reconnects with a fresh one on its own; if it does not, look for `session_expired`.

**Rate limits.** `rate_limited` or HTTP 429 means a limit was hit: 600 HTTP requests per address and 240 per user per minute, 30 per address per minute on `POST /api/token`, 100 socket events per user per 10 seconds (shared by all of that user's sockets), and per-game limits on bets and actions. The server believes exactly one proxy hop for the client address, so if the tunnel were misconfigured and everyone appeared to come from one address, they would share one budget. Limits live in memory and reset when the server restarts.

**SQLite busy or locked.** The server opens the file once, with a 5-second busy timeout. `SQLITE_BUSY` almost always means a second process has the file open for writing: another copy of the server (for example the Mac and the Pi), a `sqlite3` shell with an open transaction, or a script such as the importer. Stop the other process. Backups with `.backup` are safe. Do not copy the file with `cp` while the server runs.

**Slash commands missing, or the bot answers twice.** Missing: run `pnpm commands:deploy:guild` again and check `TEST_GUILD_ID`; for `/admin` in a DM, restart Discord (`Ctrl+R` / `Cmd+R`). Shown twice in the test server after a global deploy: run `pnpm commands:deploy:guild` once more (it drops guild copies of global commands). Twice: another process is logged in on the same `DISCORD_TOKEN`; stop it.

**Server will not start.** `invalid environment: <KEY> is invalid` names the key; fix `.env` (no quotes, no trailing comments). `migration N … was edited` or `database has migration N, which this build does not know` means the code and the database file do not match; restore the matching version of one of them.

## Upstream and credits

This project is a hard fork of [fatcorn753/discord-casino-bot](https://github.com/fatcorn753/discord-casino-bot), the original Python bot and the source of the game rules. Both authors are named in [LICENSE](LICENSE) (MIT). Third-party code, fonts and the public-domain and CC0 references behind the horse, the stable portrait, the fighters and the miner are listed with their licences in [CREDITS.md](CREDITS.md); keep it and [CREDITS.ja.md](CREDITS.ja.md) current whenever you add an asset.
