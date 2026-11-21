# Status board

Hard fork of fatcorn753/discord-casino-bot, rewritten in TypeScript as a Discord Activity plus chat bot. Updated by the Scribe from task reports.

Current wave: 2 — Features

## Wave 0 — Foundation

| Task | Scope | Owner | State |
| --- | --- | --- | --- |
| 0.1 | Rename fork, local clone, hooks, legacy move, design copy | O1 | done (PR #1) |
| 0.S1 | Status board | SC | done (PR #2) |
| 0.2 | Monorepo skeleton, shared contracts, DB schema plan, .env.example, CI, ARCHITECTURE.md | A1 | done (PR #3, review fixes in the same PR) |
| 0.3 | Review of 0.2 contracts | R1 | done (14 findings, all fixed) |
| Gate 0 | pnpm i && pnpm -r build && pnpm -r test green on a clean clone | Leader | passed (60 tests, clean clone) |

## Wave 1 — Groundwork

| Task | Scope | Owner | State |
| --- | --- | --- | --- |
| 1.1 | Spec extraction + legacy fixtures | S1 | done (PR #14) |
| 1.2 | Server core (Fastify, auth, sessions, Socket.io rooms, SQLite, EconomyService, importer skeleton) | B1 | done (PR #9, #12) |
| 1.3 | UI kit + ui-cheatsheet | F1 | done (PR #6) |
| 1.4 | Activity shell | F4 | done (PR #8, #13) |
| 1.5 | Ops (pi-sim, pi kit, tunnel template, dev runner, backups, arm64 CI) | O1 | done (PR #5, #7, #11) |
| 1.A1 | Contract update | A1 | done (PR #10) |
| 1.A1b | Ledger reasons + ids from spec | A1 | done (PR #16) |
| 1.A1c | Domain events | A1 | done (PR #17) |
| 1.B1c | Ledger reason signs | B1 | done (PR #18) |
| 1.D1 | Auth rejection logging | D1 | done (PR #20) |
| 1.D1b | Proxy signature policy | D1 | done (PR #21) |
| 1.B1d | Allowlist approval | B1 | done (PR #24) |
| 1.F4d | Mobile readability | F4 | done (PR #26) |
| 1.F1b | Token contrast | F1 | done (PR #27) |
| 1.SC | Owner docs (setup + testing guides) | SC | done (PR #19, #22, #23, #25, #28) |
| Checkpoint 1 | Owner checkpoint (Developer Portal, .env, Pages project, tunnel) | Owner | done |
| Gate 1 | Wave 1 gate | Leader | passed (desktop + mobile launch, auth, DB balance, socket, light/dark, EN/JA) |

## Wave 2 — Features

| Task | Scope | Owner | State |
| --- | --- | --- | --- |
| 2.D0 | Theme re-tune proposal | F2 | done (PR #32, round 2 approved; applying it to screens is part of 2.5) |
| 2.A0 | Horse breeding design | A1 | done (PR #30, owner decisions recorded) |
| 2.A1 | Wave 2 contract batch | A1 | done (PR #38) |
| 2.1 | Casino games | B2-A | server side done (PR #34, #40: games, services, handlers, daily event schedule, chinchiro lobby, insurance refunds); game screens remain |
| 2.2 | Races/arena/work/quiz/lottery/polls/missions/ranking/daily | B2-B | done (PR #37, breeding in PR #39) |
| 2.3 | Finance | B3 | done (PR #36: Teiai Bank, loans, kyosai, stocks/crypto, companies, player market) |
| 2.4 | Unit tests | T1 | todo (modules above ship their own tests) |
| 2.5 | Screens + motion | F2 | todo (theme to be applied, game screens) |
| 2.6 | Audio + FX + CREDITS.md | F3 | done (PR #31) |
| 2.7 | Slash commands (EN + JA) | B4 | in progress (registry PR #33, wired commands PR #42; remaining commands still to wire) |
| 2.8 | Announcer/webhooks/DM queue/launch buttons | B4 | done (notify module PR #35; notify runtime, launch buttons, admin notifications PR #42) |
| 2.W | Wire Wave 2 modules into the running server | B1 | done (PR #41) |
| 2.SC5 | Owner docs: bot is live, command registration, env pitfalls | SC | this PR |
| Gate 2 | Wave 2 gate | Leader | todo |

### Wave 2 progress

Merged: PR #33 to #42 (bot core and command registry, casino games, notify module, finance, horse/arena/labor/quiz/lottery/polls/shop, shared contract batch, horse breeding, casino daily events, server wiring, notify runtime with launch buttons and admin notifications).

The chat bot is live on the server. Owners register commands with `pnpm commands:deploy:guild` (see the [Owner Setup Guide](OWNER_SETUP.md#8-turn-the-chat-bot-on)) and verify them with the chat checklist in the [Owner Testing Checklist](OWNER_TESTING.md#10-chat-commands-wave-2).

Remaining before Gate 2:

- The rest of the chat commands (not yet wired to the bot).
- The approved theme applied across the Activity.
- Game screens and motion.
- Gate 2 itself.

## Wave 3 — Integration

| Task | Scope | Owner | State |
| --- | --- | --- | --- |
| 3.1 | E2E/multi-client/invariants | T2 | todo |
| 3.2 | Fixes | D1 | todo |
| 3.3 | Pi profiling | O1 | todo |
| 3.4 | Legacy import dry run | B1 | todo |
| 3.5 | Review + security pass | R1 | todo |
| Gate 3 | Wave 3 gate | Leader | todo |

## Wave 4 — Release

| Task | Scope | Owner | State |
| --- | --- | --- | --- |
| 4.1 | READMEs (EN/JA) + CHANGELOG | SC | todo |
| 4.2 | MAINTAINERS/CONTRIBUTING/SECURITY (EN/JA) | SC | todo |
| 4.3 | Delete legacy, tag v1.0.0, deploy | O1 | todo |
| 4.4 | Final tree check + push | Leader | todo |

## Blockers

None. The theme and the breeding design are approved; game screens and the remaining chat commands are the open Wave 2 work.

## Notes

Discord sends no proxy signature headers on Activity traffic; `REQUIRE_PROXY_SIGNATURE` stays `0`.
