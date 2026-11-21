# Status board

Hard fork of fatcorn753/discord-casino-bot, rewritten in TypeScript as a Discord Activity plus chat bot. Updated by the Scribe from task reports.

Current wave: 0 — Foundation

## Wave 0 — Foundation

| Task | Scope | Owner | State |
| --- | --- | --- | --- |
| 0.1 | Rename fork, local clone, hooks, legacy move, design copy | O1 | done (PR #1) |
| 0.S1 | Status board | SC | in progress |
| 0.2 | Monorepo skeleton, shared contracts, DB schema plan, .env.example, CI, ARCHITECTURE.md | A1 | todo (waiting on owner prerequisites) |
| 0.3 | Review of 0.2 contracts | R1 | todo |
| Gate 0 | pnpm i && pnpm -r build && pnpm -r test green on a clean clone | Leader | todo |

## Wave 1 — Groundwork

| Task | Scope | Owner | State |
| --- | --- | --- | --- |
| 1.1 | Spec extraction + legacy fixtures | S1 | todo |
| 1.2 | Server core (Fastify, auth, sessions, Socket.io rooms, SQLite, EconomyService, importer skeleton) | B1 | todo |
| 1.3 | UI kit + ui-cheatsheet | F1 | todo |
| 1.4 | Activity shell | F4 | todo |
| 1.5 | Ops (pi-sim, pi kit, tunnel template, dev runner, backups, arm64 CI) | O1 | todo |
| Checkpoint 1 | Owner checkpoint (Developer Portal, .env, Pages project, tunnel) | Owner | todo |
| Gate 1 | Wave 1 gate | Leader | todo |

## Wave 2 — Features

| Task | Scope | Owner | State |
| --- | --- | --- | --- |
| 2.1 | Casino games | B2-A | todo |
| 2.2 | Races/arena/work/quiz/lottery/polls/missions/ranking/daily | B2-B | todo |
| 2.3 | Finance | B3 | todo |
| 2.4 | Unit tests | T1 | todo |
| 2.5 | Screens + motion | F2 | todo |
| 2.6 | Audio + FX + CREDITS.md | F3 | todo |
| 2.7 | Slash commands (EN + JA) | B4 | todo |
| 2.8 | Announcer/webhooks/DM queue/launch buttons | B4 | todo |
| Gate 2 | Wave 2 gate | Leader | todo |

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

- 0.2 waits on: owner turns off commit/PR co-author trailers in local tool settings; pnpm and Node 24 installed.
