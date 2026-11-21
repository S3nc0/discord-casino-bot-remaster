# Legacy Parity Fixtures

This document describes how deterministic parity fixtures are generated from `legacy/python/`, their JSON layout, how to verify byte-for-byte reproducibility, and which legacy features cannot be driven with fixed inputs.

## Regeneration Command

Run from the repository root using the synced `uv` environment in `legacy/python`:

```sh
uv --directory legacy/python run python ../../tests/fixtures/legacy/generate/generate.py
```

The generator writes 26 JSON files into `tests/fixtures/legacy/<module>/<file>.json`.

## Bootstrap & Determinism Rules

1. **Zero edits to `legacy/python/`**:
   `legacy/python/infra/paths.py` defaults to `legacy/python/catalogs`, while the live YAML catalogs reside at `<repo_root>/catalogs`. Before importing `domain.*` or `infra.db.*`, `generate.py` patches `infra.paths.CATALOGS_DIR`, `infra.catalogs.loader.CATALOG_DIR`, and `infra.catalogs.CATALOG_DIR` in memory and calls `infra.catalogs.bind_catalogs()`.
2. **Fixed clock (`FrozenClock`)**:
   Every repository test uses `open_repositories(":memory:", strict=True, clock=FrozenClock(BASE_DT))` anchored at `2025-01-06 09:00:00+09:00` (`BASE_TS = 1736121600.0`, Monday, JST `UTC+9`). Time advances explicitly via `clock.set_ts(...)` and explicit `now` arguments.
3. **Fixed PRNG seeds**:
   Every randomized function receives an isolated `random.Random(<seed>)` instance (seeds `1001`–`1007` for B2-A, `2001`–`2015` for B2-B, `3001`–`3004` for B3). For `LaborRepo.labor_collect`, whose underlying `domain.labor.settle_plan(..., rng=None)` falls back to `random.SystemRandom()`, `generate.py` applies a scoped monkeypatch replacing `domain.labor.random.SystemRandom` with `random.Random(20110)` solely for that call and restores it in a `finally` block.
4. **Canonical JSON serialization**:
   All output files are written with `json.dumps(serialize(payload), ensure_ascii=False, indent=2, sort_keys=True) + "\n"`, rounding floats to 10 decimal places and converting dataclasses, sets, dates, and SQLite rows deterministically.

## Byte-for-Byte Reproducibility Check

Running the generator twice and comparing SHA-256 digests verifies zero hidden entropy or wall-clock leakage:

```sh
H1=$(find tests/fixtures/legacy -type f -name '*.json' | sort | xargs shasum -a 256)
uv --directory legacy/python run python ../../tests/fixtures/legacy/generate/generate.py >/dev/null
H2=$(find tests/fixtures/legacy -type f -name '*.json' | sort | xargs shasum -a 256)
test "$H1" = "$H2" && echo "BYTE-FOR-BYTE IDENTICAL"
```

Verified result: **26/26 JSON files byte-for-byte identical** across consecutive runs.

## Legacy Baseline Test Count

Running the existing legacy Python test suite (with the same in-memory catalog-path patch and zero edits to `legacy/python/`):

- **Result**: `1354 passed, 1 skipped, 8 warnings in 27.00s`

## Fixture Format Overview

Every JSON file has a top-level `"module"` string and optional `"seed"` / `"seeds"` metadata, followed by pure domain input/output vectors and (where applicable) `"db_flow"` end-to-end repository state transitions using synthetic snowflakes (`GUILD_A = 100000000000000001`, `GUILD_B = 100000000000000002`, `USER_1..3 = 200000000000000001..3`):

| Module | Fixture File | Covered Inputs & Outputs |
| --- | --- | --- |
| `casino-common` | `tests/fixtures/legacy/casino-common/formulas.json` | Jackpot chance/contribution/draws; RTP levels `1`–`6` across all 5 casino games; daily event schedule, active window, and bonus payout math. |
| `chinchiro` | `tests/fixtures/legacy/chinchiro/hands.json` | All hand classifications, 9 pairwise matchups with payouts, and 15 seeded multi-roll player vs dealer rounds. |
| `pachinko` | `tests/fixtures/legacy/pachinko/spins.json` | Theoretical hit rates (overall, by omen, by tier), RTP, 30 seeded spins, 8 seeded sets, and 15 round rolls. |
| `slots` | `tests/fixtures/legacy/slots/spins.json` | Theoretical RTP, 8 explicit reel combos, and 40 seeded reel spins with multipliers and labels. |
| `blackjack` | `tests/fixtures/legacy/blackjack/hands.json` | Soft/hard hand evaluations, natural blackjack checks, full payout table, 10 seeded hit/stand games, and 1 double-down game. |
| `roulette` | `tests/fixtures/legacy/roulette/spins.json` | Color map (`0`–`36`), per-kind RTPs, win/payout matrix across 11 bet specs × 6 wheel outcomes, and 30 seeded spins. |
| `horse` | `tests/fixtures/legacy/horse/races.json` | Daily 4-race schedule, seeded track & 8 runners, odds, full simulation, all 7 bet-combo checks, retirement values, stat ops, and DB horse creation + registration + odds + bet + race run. |
| `arena` | `tests/fixtures/legacy/arena/tournaments.json` | `duel` and `royale` fighter generation, odds, weapon bonus, payout scaling & subsidy caps, match sim, and DB tournament bet → semis → final flow. |
| `labor` | `tests/fixtures/legacy/labor/work.json` | Pick/glove/dorm costs, click outcomes, fatigue decay, terrain, idle rate, 6h `settle_plan`, anti-bot detection (`mechanical` vs `normal`), and DB click/upgrade/hire/4h collect. |
| `relics` | `tests/fixtures/legacy/relics/buffs.json` | Relic ID/star parsing, multi-relic buff stacking, `chance_round` sequence, and DB 10-to-1 `relic_merge` (`relic_fossil` → `relic_fossil_s1`). |
| `quiz` | `tests/fixtures/legacy/quiz/rewards.json` | Solver base reward, accuracy factor, bonus, participation, author payout across 6 cases, plus `parse_bulk` parsing. |
| `lottery` | `tests/fixtures/legacy/lottery/draws.json` | DB raffle open, multi-user join, duplicate-join rejection, seeded winner draw, and cancel-with-refund flow. |
| `polls` | `tests/fixtures/legacy/polls/outcomes.json` | `shown(real, adj)` clamping and DB poll create, vote, paid vote rigging, and scheduled close. |
| `shop` | `tests/fixtures/legacy/shop/purchases.json` | Refill stock math, Teiai seized auction decay (`0`–`72h`), Teiai black-market daily plan & price decay, and DB shop + auction purchases. |
| `missions` | `tests/fixtures/legacy/missions/progress.json` | Deterministic daily mission selection for two consecutive dates, jackpot threshold checks, and DB play progress + mission claim status. |
| `weekly-ranking` | `tests/fixtures/legacy/weekly-ranking/titles.json` | ISO week helpers, `min_plays = 5` qualification filter, weekly leaderboard ranking, and champion award settlement. |
| `daily` | `tests/fixtures/legacy/daily/claims.json` | 6h JST slot streak progression, duplicate-slot rejection, `daily_double` consumption, and debtor `20%` skim + `30%` withholding. |
| `transfer` | `tests/fixtures/legacy/transfer/transfers.json` | `min_games = 3` block, `10%` ceiling fee (`1005 → 101`), `30%` debtor-receiver withholding, `20,000` daily principal cap, and debtor-sender block. |
| `economy-core` | `tests/fixtures/legacy/economy-core/core.json` | Per-guild isolation (`GUILD_A` vs `GUILD_B`), `3,000` initial balance, zero floor clamp, history summarization, and 15-part asset balance sheet. |
| `stocks` | `tests/fixtures/legacy/stocks/market.json` | Covariance & Cholesky `L`, 10 seeded 1-min ticks, ±30% daily limits & pin states, progressive capital gains tax, margin formulas, Black-Scholes & Margrabe options, earnings jump & memo, volatility events, CIR `r_f` step, and bond pricing/default hazard. |
| `crypto` | `tests/fixtures/legacy/crypto/spot.json` | `buy_quote`, `sell_quote`, milli-unit average cost, and DB multi-buy + partial sell with capital gains tax. |
| `teiai` | `tests/fixtures/legacy/teiai/bank_debt.json` | Skim/withhold/CDS odds math, thermostat inflow/shock/decay, and DB trust deposit/accrual/withdraw, seed borrow, CDS purchase, 3d Toichi interest, overseas escape, and forced bankruptcy with CDS payout. |
| `p2p-loans` | `tests/fixtures/legacy/p2p-loans/loans.json` | Daily simple interest, overdue penalty (`max(1.5x, 2%/day)`, `2x` cap), and DB offer → accept → partial repay → maturity auto-collect. |
| `kyosai` | `tests/fixtures/legacy/kyosai/operations.json` | Hamilton `split`, `dividend_pool`, liquidity `gate_locked`, `motion_passes`, and DB auction open/bid/settle + P2P unit transfer with `5%` fee. |
| `player-market` | `tests/fixtures/legacy/player-market/listings.json` | `tradable`, `5%` fee, price bounds, `min_next_bid`, anti-snipe `end_after_bid`, and DB fixed buy + 6h auction bid/outbid/settlement. |
| `companies` | `tests/fixtures/legacy/companies/operations.json` | Output/storage/upkeep/upgrade/stake-cap formulas, deterministic `day_state`, continuous 12h `produce`, full & budget-capped `sale`, `dividend_split`, `stake_values`, and DB found/invest/stake/dividend/ship/settle flow. |

## Modules & Aspects Not Drivable with Fixed Inputs

The following legacy modules or behaviors depend on live Discord Gateway / HTTP interactions or wall-clock event loops and therefore do **not** have deterministic JSON fixtures:

1. **`admin` (`docs/spec/admin.md`)**:
   Guild approval flows, slash-command permission gates (`manage_guild` / bot owner checks), Discord channel bindings, feature-flag UI toggles, and operator audit messages are thin Discord-cog wrappers around repository calls already covered by `economy-core`, `casino-common`, and `teiai`.
2. **Discord UI, Rich Presentation & Gateway Side Effects**:
   Interactive Discord Views/Buttons/Modals, view timeouts, per-user command cooldowns, live chart message edits (`swap_chart_post`), Discord nickname title synchronization (`domain/nick.py` applies pure string rules, while Discord API `member.edit(nick=...)` and role-color sync depend on live Guild/Member state), and DM/channel announcement delivery.
3. **Background Scheduler Loop Timing**:
   `discord.ext.tasks` polling intervals (1-minute stock tick loop, scheduled race announcements, hourly trust accrual, daily company upkeep sweeps) are represented in fixtures by invoking the underlying repository tick methods directly with explicit `FrozenClock` timestamps rather than sleeping on wall-clock timers.
