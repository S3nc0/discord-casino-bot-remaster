**English** | [日本語](CHANGELOG.ja.md)

# Changelog

All notable changes to this project are written here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-11-24

The remaster: the original Python chat bot rewritten in TypeScript as a Discord Activity plus a chat bot, in one repository, with one server process and one SQLite file.

### Added

- **The Activity.** A full-screen mini app that runs inside Discord on desktop and mobile, with live tables, race cards and presence, in a pixel look with light and dark themes (the Bitbloom UI kit).
- **Casino games.** Chinchiro, slots, pachinko, blackjack and roulette, in chat and in the Activity, with an event schedule and insurance tickets.
- **Horse racing.** Races four times a day with bets, a stable, retirement, and breeding with foals that mature over time. A new eight-frame gallop sprite.
- **Underground Arena.** A daily tournament of NPC fighters to bet on. The result names the champion and the runner-up of the final, in the Activity and in chat; tournaments that finished earlier show the champion only (#63).
- **Finance.** Teiai Bank with deposits, loans, debt and bankruptcy; kyosai (mutual aid) units and auctions; stocks and a crypto ticker with margin; companies; player-to-player loans; and a player market with fixed-price listings and auctions, where a form lets you pick an item from your inventory and list it (#63).
- **Everyday play.** Daily bonus with streaks, underground labor, quizzes, lottery, polls, shop and inventory, missions, titles, weekly ranking, transfers, relics and history.
- **English and Japanese** everywhere: the Activity, slash commands (Discord shows each user the names in their language), announcements and direct messages.
- **Owner tools.** `/admin` commands to approve or revoke servers, adjust balances, start events, tune payout levels and manage quizzes, plus guides for setup, testing, IDs and admin use in both languages.
- **Notifications.** Announcements in a channel, webhook personas, opt-in direct messages with retry, an in-app inbox and live toasts.
- **Sound and art.** Synthesized sound effects and music, 35 pixel game icons, and generators in `tools/pixel-art` so the art can be rebuilt.
- **Detailed pixel scenes on every screen**, drawn for day (light) and night (dark), with short stepped animations that stay on a still frame under reduced motion. Each screen loads its own art lazily, so Home does not grow.
  - Casino (#68): a slot cabinet with chasing bulbs and a lever, chinchiro on tatami with a donburi bowl, a blackjack table with 52 drawn card faces, a numbered roulette wheel and betting board, and a pachinko machine with falling balls.
  - Races, arena and life (#66): grandstand, tote board and starting gate on the race screen, horse portraits in the stable and over the breeding fence, the arena pit with 16 original fighters, the mine with a swinging miner, the shop shelves and the storeroom.
  - Social and player (#69): the quiz stage, lottery counter, voting corner, quest board, podium, relic museum, street, daily bonus room, history ledger and a profile card with the player's Discord avatar.
  - Finance (#71): the bank hall, loan office, kyosai office, trading floor with a scrolling price board, mining room, office skyline and market street, plus pixel candlestick charts, symbol coins and company badges.
- **Hosting kit.** One-command Raspberry Pi installer, systemd services, nightly SQLite backups with seven days of history, a tunnel template and an arm64 container that simulates the Pi.
- **Checks.** Unit tests, multi-client socket tests, a property test that plays random command sequences against the ledger, a browser flow on desktop and phone widths, and a load test with measured targets (30 players on 512 MB).
- **Docs.** Modern READMEs, behaviour specs extracted from the original bot, architecture and database notes, and these maintainer, contributing and security guides. Every document has a Japanese version (#67, #70), including this changelog and the credits.

### Changed

- **Hard fork of the original bot**, rewritten from Python to TypeScript on Node 24, with Fastify, Socket.io, discord.js and SQLite. The original game rules were kept; see the specs in `docs/spec/`.
- **Money is exact.** Every amount is a whole number of Pelica, rates are in basis points and prices are fixed point. Every change is one row in an append-only ledger, and balances never go below zero.
- **Balances are per server**, everyone starts with 3,000 Pelica, and settings (language, theme, sound, motion) are one per person across servers.
- **Servers listed in `ALLOWED_GUILD_IDS` count as approved.** Only an explicit denial blocks them.
- **Discord proxy signatures are checked when present**, and `POST /api/token` is exempt. Discord was observed not to send them on Activity traffic, so the session token is the real boundary.
- **Theme re-tune.** A new palette for both themes with checked contrast, readable mobile layouts and larger touch targets.
- **Pixel art v2** (#62). A 48 by 32 gallop horse and 35 game icons drawn in one style, and a new README banner and screenshots.

### Removed

- **The original Python bot** left the tree (this release). It stays in git history before v1.0.0; the specs explain how to read it, the parity fixtures stay as data, and the database importer still reads an old `casino.db` without it.

### Fixed

- Every refused login on the auth path now logs one stable reason without secrets.
- Replaying an idempotency key can no longer mint assets or erase debt in the finance services, and race entry fees, transfers and breeding previews are keyed and checked per caller and per server.
- The bank's loss share was counted twice, and withheld debt was not repaid correctly.
- Admin tools, leaderboards, buttons, menus and autocomplete now check that they act inside the right server, and set-balance runs in one transaction.
- Socket replies and process-level errors no longer crash the server; idle tables are cleaned up and rankings are computed with bounded queries.
- Sound switch labels in Settings are translated, and low contrast on disabled controls and outlines is fixed.
- Listing the last copy of an equipped cosmetic on the player market unequips it; a cancelled or expired listing returns it unequipped (#65).
- Numbers read correctly everywhere (#72). Pixelify Sans draws 2 like 8 and 5 like S, so 12,400 could read as 18,400. Every number now uses Atkinson Hyperlegible digits (`--font-numeric`, and a digit-only face in display titles) with no new font file. Tonal and danger buttons now get their own border colour instead of the primary green one.
- The casino screens load behind a titled, busy placeholder, which also removes a flaky route test (#73).
- Tests: the breeding range check (R-8) is fast and deterministic on every run; the full sweep runs with `SLOW_TESTS=1` (#74).

### Security

- **Server-authoritative money.** Clients send intents, never results; the server owns all randomness, and the ledger rejects any row whose sign its reason does not allow.
- **Sessions.** Tokens expire after one hour, are checked on every socket event, and are tied to one user, server and Activity instance. Rooms can only be joined for your own server, user and instance.
- **Revoking a server** with `/admin server-revoke` disconnects its open sockets at once and refuses new requests.
- **Limits.** One shared event budget per user, at most five sockets per user, a cap on socket upgrades per address, and rate limits on every route. Only one proxy hop is trusted for client addresses.
- **Domain events are private by default.** Only a short allowlist of event types reaches a whole server; everything else goes to the players it names.
- **No secrets in logs or in the bundle.** Tokens, codes, bearer strings and webhook URLs are redacted; the web build fails if it names an unlisted host.
- **Ops.** The tunnel binary is pinned and verified by checksum, and the backup script validates its settings.
- **Private vulnerability reporting** is on: report from the repository's Security tab (see [SECURITY.md](SECURITY.md)).
