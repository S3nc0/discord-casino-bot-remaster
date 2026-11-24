**English** | [日本語](INDEX.ja.md)

# Legacy Behaviour Spec Index

Master index mapping every legacy module to its behaviour specification, deterministic parity fixture directory, and planned porting owner.

> **Where the original code lives.** The original Python bot was removed from the tree for v1.0.0; it stays in git history. Every `.py` path in these specs (`domain/…`, `infra/…`, `services/…`, `cogs/…`, `manage.py`) is relative to that bot's folder, with line numbers as of then. To read one: `git show "$(git log --diff-filter=D --format=%H -1 -- legacy/python)^:legacy/python/domain/horse.py"`. The rules and numbers here are what the remaster implements; where the remaster differs, the spec says so.

- **B2-A**: Casino games (`chinchiro`, `pachinko`, `slots`, `blackjack`, `roulette`, plus shared `casino-common` mechanics).
- **B2-B**: Non-casino games, progression, social games, shop, and core economy (`horse`, `arena`, `labor`, `relics`, `quiz`, `lottery`, `polls`, `shop`, `missions`, `weekly-ranking`, `daily`, `transfer`, `economy-core`, `admin`).
- **B3**: Finance, securities, banking, credit, mutual fund, companies, and player market (`stocks`, `crypto`, `teiai`, `p2p-loans`, `kyosai`, `player-market`, `companies`).

## Reference Documents

- [glossary.md](glossary.md) — Canonical EN / JA terminology table.
- [parity-fixtures.md](parity-fixtures.md) — Fixture generation command, `FrozenClock` / seed determinism rules, JSON formats, legacy pytest count (`1354 passed, 1 skipped`), and non-drivable aspects.

## Module Map

| Module | Spec File | Fixture Dir | Planned Owner | Notes |
| --- | --- | --- | --- | --- |
| Casino Common (RTP levels, jackpot, events, escrow) | [casino-common.md](casino-common.md) | `tests/fixtures/legacy/casino-common/` | B2-A | Shared helpers used across all 5 casino games. |
| Chinchiro | [chinchiro.md](chinchiro.md) | `tests/fixtures/legacy/chinchiro/` | B2-A | 3-dice game vs dealer (`pinzoro`–`hifumi`), plus 2–6 seat winner-takes-all table pots (`10%` fee, `/casino chinchiro-table`). |
| Pachinko | [pachinko.md](pachinko.md) | `tests/fixtures/legacy/pachinko/` | B2-A | Multi-spin set machine with omens, tiers, and round multipliers. |
| Slots | [slots.md](slots.md) | `tests/fixtures/legacy/slots/` | B2-A | 3-reel weighted slot machine. |
| Blackjack | [blackjack.md](blackjack.md) | `tests/fixtures/legacy/blackjack/` | B2-A | Standard 21 with hit, stand, and double down. |
| Roulette | [roulette.md](roulette.md) | `tests/fixtures/legacy/roulette/` | B2-A | Single-zero European wheel (`0`–`36`). |
| Horse Racing (betting, retirement, 4 races/day) | [horse.md](horse.md) | `tests/fixtures/legacy/horse/` | B2-B | Covers ownership, stat carrots, 7 bet types, retirement, and 4 daily JST races. **Note**: Horse breeding does not exist in legacy Python. |
| Horse Breeding (new, no legacy) | [horse-breeding.md](horse-breeding.md) | *(none — new feature; property tests instead)* | B2-B | Approved 2026-11-21: own × own pairing, `15,000` breeding fee sink, foal stats regress to the mean with a `210` total cap, 48 h maturity, 72 h cooldown. |
| Arena (daily NPC tournaments) | [arena.md](arena.md) | `tests/fixtures/legacy/arena/` | B2-B | Daily `duel` and `royale` NPC brackets with weapon bonuses and pool subsidies. |
| Labor (clicker / worker) | [labor.md](labor.md) | `tests/fixtures/legacy/labor/` | B2-B | Manual mining, fatigue, tool/dorm upgrades, idle workers, anti-bot checks, `3%` Teiai skim. |
| Relics | [relics.md](relics.md) | `tests/fixtures/legacy/relics/` | B2-B | Excavation drops, 10-to-1 star merges (`★1`–`★5`), and passive buff stacking. |
| Quiz | [quiz.md](quiz.md) | `tests/fixtures/legacy/quiz/` | B2-B | User-authored trivia, accuracy/participant reward formulas, and bulk import. |
| Lottery / Raffle | [lottery.md](lottery.md) | `tests/fixtures/legacy/lottery/` | B2-B | Guild ticket pool raffle with single winner or full cancel refund. |
| Polls | [polls.md](polls.md) | `tests/fixtures/legacy/polls/` | B2-B | Timed yes/no polls with paid hidden vote rigging (`500` Pelica to Teiai Bank). |
| Shop (catalog, Teiai auction & black market) | [shop.md](shop.md) | `tests/fixtures/legacy/shop/` | B2-B | Official catalog, timed refills, seized auction decay, and daily Teiai black market. |
| Missions | [missions.md](missions.md) | `tests/fixtures/legacy/missions/` | B2-B | Deterministic daily mission roster, progress hooks, and reward claims. |
| Weekly Ranking Titles | [weekly-ranking.md](weekly-ranking.md) | `tests/fixtures/legacy/weekly-ranking/` | B2-B | Weekly net-profit ranking (`min_plays = 5`) and champion title awards. |
| Daily (with streaks, 6h JST reset) | [daily.md](daily.md) | `tests/fixtures/legacy/daily/` | B2-B | 4 slots/day JST, streak scaling, `daily_double`/`streak_guard`/`relic_crown`, debtor skim & withholding. |
| Transfer (`10%` fee, daily cap, `3`-game min) | [transfer.md](transfer.md) | `tests/fixtures/legacy/transfer/` | B2-B | `10%` ceiling fee, `20,000` daily principal cap, `3`-game minimum, debtor blocks & receiver withholding. |
| Economy Core (per-guild economy, `3,000` start) | [economy-core.md](economy-core.md) | `tests/fixtures/legacy/economy-core/` | B2-B | Merges **per-guild economy** and **3,000 start** along with ledger, floor clamp, history grouping, the balance sheet (net assets, current assets), and player statuses. |
| Admin Tools | [admin.md](admin.md) | *(none — see [parity-fixtures.md](parity-fixtures.md))* | B2-B | Discord permission/moderation/guild-approval flows cannot be driven with fixed inputs; underlying mutations are covered by `economy-core` and `casino-common`. |
| Stocks (4 tickers, margin, options, bonds, 1-min ticks) | [stocks.md](stocks.md) | `tests/fixtures/legacy/stocks/` | B3 | Correlated Cholesky ticks, ±30% daily limits, capital gains tax, cross-margin, Black-Scholes & Margrabe options, earnings, events, CIR `r_f`, and bonds. |
| Crypto (`CSトークン`) | [crypto.md](crypto.md) | `tests/fixtures/legacy/crypto/` | B3 | Consolidated into `/証券` in legacy (`cs` ticker, `CryptoRepo` milli-unit spot holdings & collateral lock); cross-referenced with [stocks.md](stocks.md). |
| Teiai Bank (reserve ratio, bankruptcy grace, CDS, trust) | [teiai.md](teiai.md) | `tests/fixtures/legacy/teiai/` | B3 | Fractional reserve, thermostat, trust deposits, Toichi debt, `15,000` bankruptcy grace, forced execution, overseas escape, and CDS. |
| P2P Loans | [p2p-loans.md](p2p-loans.md) | `tests/fixtures/legacy/p2p-loans/` | B3 | Split from Teiai Bank for clarity; player-to-player offers, simple interest, overdue penalty, maturity auto-collect, and garnishment. |
| Teiai Kyosai | [kyosai.md](kyosai.md) | `tests/fixtures/legacy/kyosai/` | B3 | Split from Teiai Bank for clarity; unit auctions, Hamilton dividends, excess-loss charges, P2P unit transfers (`5%` fee), and governance motions. |
| Player Market / Auction / Escrow | [player-market.md](player-market.md) | `tests/fixtures/legacy/player-market/` | B3 | Fixed-price and timed-auction listings (`5%` fee, anti-snipe, grace pull-back), plus Teiai's daily dug-up relic auction (`1` unstarred relic/day, 24 h auction, skips `100,000`/24 h pair cap); game wager escrow is in [casino-common.md](casino-common.md). |
| Companies | [companies.md](companies.md) | `tests/fixtures/legacy/companies/` | B3 | Deterministic daily states, continuous output, budget-capped sales, external stakes, dividends, and 3-day unpaid upkeep bankruptcy. |
| Stream Panel (shipped in v1.1.0, upstream catch-up) | [stream.md](stream.md) | *(none — new feature; property tests instead)* | S0–S3 | Super chats (transfer rules, shares `20,000`/day cap) and parimutuel win/lose bets (`5%` rake, `10,000` per person per round) via the Activity Streams screen or `/stream start`. Owner decisions 2026-11-24: a round must be locked before win or lose, bets auto-lock after 10 minutes, `/admin stream-void` with an audit log, no auto-created voice channels. |

## Merged / Split Module Notes

- **Per-guild economy** and **3,000 start** are merged into [economy-core.md](economy-core.md) because they share the same `AccountCore` / `WalletRepo` initialization path and `users` table schema.
- **Teiai Bank** sub-systems **P2P Loans** ([p2p-loans.md](p2p-loans.md)) and **Teiai Kyosai** ([kyosai.md](kyosai.md)) are given dedicated spec files and fixture directories alongside [teiai.md](teiai.md) because each has an independent domain module, database schema, and state machine.
- **Horse breeding** does not exist anywhere in the original Python bot; [horse.md](horse.md) documents its absence, and the remaster's own design is [horse-breeding.md](horse-breeding.md).
- **Crypto** (`/暗号`) was merged into `/証券` (`cs` = `CSトークン`) in legacy; [crypto.md](crypto.md) documents the `CryptoRepo` spot ledger and cross-references [stocks.md](stocks.md) for market ticks and margin.
- **Casino Common** ([casino-common.md](casino-common.md)) extracts shared RTP-level, jackpot, bonus-event, and escrow rules once so the 5 individual casino specs avoid duplication.
