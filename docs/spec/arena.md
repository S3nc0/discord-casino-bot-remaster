**English** | [日本語](arena.ja.md)

# Underground Arena Specification (`arena`)

> Planned Owner: **B2-B** · Game ID: `arena` · Screen ID: `arena` · Ledger Reasons: `arena_bet`, `arena_payout`

## 1. Source Files

- `catalogs/arena.yaml` (L1–L36): schedule, fighter pool, base power, weapon scaling, odds, limits, spectator bets, subsidies
- `legacy/python/domain/arena.py` (L1–L158): pure logic for fighter generation, weapon bonus, odds, match simulation, HP battle frames, anti-inflation payout settlement
- `legacy/python/infra/db/arena.py` (L1–L275): daily tournament lifecycle, spectator seeding, betting, semi/final settlement
- `legacy/python/services/arena.py` (L1–L64): `ArenaService` facade
- `legacy/python/cogs/arena/cog.py` (L1–L248): `/闘技場 大会`, 30-second scheduler loop, battle animation, admin `host_now`
- `legacy/python/cogs/arena/embeds.py` (L1–L117): tournament board, HP bar, semi/final result embeds
- `legacy/python/cogs/arena/views.py` (L1–L108): `BetPanel`, `FighterSelect`, `StakeModal`
- `legacy/python/cogs/shared/messages/games.py` (L91–L95): failure messages
- `docs/arena.md` (L1–L70): original design doc

---

## 2. Formats & Daily Schedule

Each guild automatically hosts **both formats simultaneously every day** (separate tournament rows keyed by `(guild_id, day, format)` where `day` is local ISO date `YYYY-MM-DD`, `infra/db/arena.py:34-48`):

| Format Key | Label | Fighters | Semifinals | Final |
|---|---|---|---|---|
| `duel` | `🥊 1on1` | 4 | 2 groups × 2 fighters | 1 match (2 winners) |
| `royale` | `⚔️ バトルロイヤル` | 16 | 4 groups × 4 fighters | 1 match (4 winners) |

- **Schedule** (`catalogs/arena.yaml:1-2`, `cogs/arena/cog.py:83,219-223`):
  - Background loop checks every **30 seconds**.
  - On first tick of a new local day (if feature `arena` is enabled), both tournaments are created in `semi_betting` and announced.
  - **`SEMI_HOUR = 9`** (09:00 local): when `tz_hour >= 9` and `status == 'semi_betting'`, all semifinal groups resolve simultaneously → status becomes `final_betting`.
  - **`FINAL_HOUR = 13`** (13:00 local): when `tz_hour >= 13` and `status == 'final_betting'`, final resolves → status becomes `done`.
- Feature toggle: if `arena` is off, no new tournament is created, but an already-created tournament still advances and settles (`cogs/arena/cog.py:200-204`).

### State Machine
```
[ semi_betting ] ──(tz_hour >= 9)──► [ final_betting ] ──(tz_hour >= 13)──► [ done ]
  (all fighters stage='semi')         (winners stage='final',                (champion result='won',
                                       losers stage='out', result='lost')     final losers stage='out', result='lost')
```

---

## 3. Fighters, Weapons & Spectator Seeding

### 3.1 Fighter Generation (`domain/arena.py:78-84`, `catalogs/arena.yaml:3-4,19-35`)
- Count: `group_size(fmt) * semi_groups(fmt)` (`4` for `duel`, `16` for `royale`).
- Names sampled without replacement from the 16-name catalog `FIGHTER_NAMES`:
  `鉄拳のゴウ`, `灼熱のレイジ`, `黒影のクロウ`, `修羅のバキ`, `氷牙のユキ`, `雷鳴のライ`, `鬼哭のオニマル`, `疾風のハヤテ`, `剛腕のゴリウス`, `影狼のシノビ`, `爆砕のデストロ`, `不死身のゾンバ`, `蛇瞳のメデューサ`, `怒髪のバーサーカー`, `無敵のタイタン`, `影帝のシャドウキング` (fallback `f"無名の戦士{n}"`).
- `base_power = rng.randint(20, 80)` (`BASE_POWER_MIN=20`, `BASE_POWER_MAX=80`).
- Assigned sequentially to groups `group_no = i // group_size + 1`.

### 3.2 Weapon Bonus (`domain/arena.py:92-101`)
- Cumulative bets across the entire tournament (`bet_total`, including spectator bets and both semi & final bets) equip the fighter with stronger weapons:
  ```
  weapon_bonus(bet_total) = min(1.0, max(0.0, bet_total) / 50000)   # WEAPON_CAP=1.0, WEAPON_SCALE=50000
  effective_power = base_power * (1 + weapon_bonus(bet_total))
  ```
- At 50,000+ Pelica total bets, fighter reaches max `+100%` (`2.0× base_power`).

### 3.3 NPC Spectator Seeding (`infra/db/arena.py:96-114`, `catalogs/arena.yaml:13-17`)
- On tournament creation, NPC spectators (`user_id = -5`, `NPC_SPECTATOR`) place initial semifinal bets funded from Teiai Bank cash:
  - Budget per tournament: `topup_left = min(5000, int(bank_cash))` (`HOUSE_TOPUP_MAX = 5000`).
  - For each fighter: `rng.randint(3, 8)` bets (`SPECTATOR_COUNT = (3, 8)`), each `rng.randint(100, 3000)` (`SPECTATOR_BET = (100, 3000)`).
  - Any draw that would exceed `topup_left` is skipped (`continue`).
  - Total `spent` is deducted from `bank.cash` once at the end.
  - Spectator bets are never paid out on win (`user_id <= 0` filtered out in settlement), but losing spectator bets DO enter `losers_pool` as player profit funding.

---

## 4. Odds, Betting & Simulation

### 4.1 Betting Limits (`catalogs/arena.yaml:11-12`, `infra/db/arena.py:116-146`)
- Stake per bet: **`100` – `20,000`** Pelica (`MIN_STAKE`, `MAX_STAKE`). No per-match cap beyond balance; players may bet multiple times or on multiple fighters.
- Fighter must match current open stage (`stage == 'semi'` during `semi_betting`, `stage == 'final'` during `final_betting`; `stage == 'out'` rejected).
- Unlike horse racing, odds are **not** locked at bet time — payout uses the odds computed at match settlement time (including all bets & weapon bonuses accumulated up to resolution).

### 4.2 Odds Calculation (`domain/arena.py:58-75`)
- `win_weights`: proportional to `effective_power(base_power, bet_total)` among fighters in that match (`sum = 1.0`).
- Base odds per fighter: `max(1.0, min(20.0, floor((1 - 0.15) / p * 10) / 10))` (`TAKEOUT = 0.15`, `MAX_ODDS = 20.0`).
- **Final Boost**: Final match multiplies base odds by `FINAL_ODDS_BOOST = 1.3`, capped at `MAX_ODDS = 20.0`:
  `min(20.0, _odds(p, 0.15, 20.0) * 1.3)`.
  - Note: in semifinals expected RTP ≤ 85%; in final, boosted odds increase expected profit target up to `min(20.0, base * 1.3)` subject to the anti-inflation pool cap below.

### 4.3 Match Simulation (`domain/arena.py:104-113`)
- Weight per fighter: `max(0.01, effective_power(base_power, bet_total) * rng.gauss(1.0, 0.25))` (`LUCK = 0.25`).
- Winner selected via `rng.choices(range(len(fighters)), weights=weights, k=1)[0]`.

### 4.4 Anti-Inflation Settlement (`domain/arena.py:137-157`, `infra/db/arena.py:148-201`)
- `losers_pool` = sum of all `arena_bets.amount` in that match (`tournament_id, stage`) on losing fighters (includes both player and NPC spectator bets).
- For each winning **player** bet (`user_id > 0`) with stake `a`:
  - Principal `a` is **always returned**.
  - Target profit: `profit = max(0, round(a * rate) - a)`.
  - `due = sum(profits)`.
  - If `due > losers_pool`, Teiai Bank subsidizes `subsidy = min(due - losers_pool, min(5000, max(0, int(bank_cash))))` (`MATCH_SUBSIDY_MAX = 5000`; deducted from `bank.cash`).
  - `scale = min(1.0, (losers_pool + subsidy) / due)` (or `1.0` if `due <= 0`).
  - Paid profit per bet: `round(profit * scale)`. Total payout: `a + paid_profit`.
  - Ledger entry: `闘技場:勝利の配当`, `income = max(0, pay - a)`.
  - Unused `leftover = max(0, losers_pool + subsidy - sum(paid))` sends `int(leftover * teiai.LOSS_SHARE)` (20%) to Teiai Bank income (`infra/db/arena.py:191-194`).
  - **Note**: Arena bets do NOT increment `users.games_played` / `total_wagered` in `infra/db/arena.py` (unlike casino games and horse bets).

---

### 4.5 Runner-up (remaster addition, migration 0011)

The legacy result text has a slot for the others of the final (`arena.result.final_body`), but only the champion was stored. The remaster stores a real second place:

- When the final settles, second place is drawn by the same weighted match (4.3) among the fighters the winner beat, and stored as `arena_tournaments.runner_up_id` (an `arena_fighters.id` of that tournament) together with `champion_id`.
- It is `NULL` while the tournament is open, and for tournaments that finished before migration 0011 (their second place was never stored); those show the champion only.
- It changes no bet, odds or payout: bets settle on the winner of each match exactly as in 4.4. It is cosmetic and for history.
- It is carried as `ArenaTournament.runnerUpId` in the Activity API and shown in the result line of the arena screen and in the chat tournament embed (`bot.arena.runnerUp`), in English and Japanese.

---

## 5. Animation (`domain/arena.py:116-134`, `cogs/arena/cog.py:33-34,105-119`)
- Cosmetic only (winner already settled): `ANIM_FRAMES = 6` (`7` total frames starting from all 100 HP), `ANIM_STEP = 1.2s`.
- Per step: winner loses `uniform(0, 10)` clamped `>= 20.0`; losers lose `uniform(12, 25)` clamped `>= 0.0`; final frame forces losers to `0`.
- Rendered with 10-block HP bar (`🟥` / `⬛`).

---

## 6. Verbatim Japanese Strings

| Key ID | Verbatim Japanese String | Source |
|---|---|---|
| `arena.cmd.group_desc` | `🏛️ 地下闘技場（1日1回、1on1・バトロワの両方を開催・NPC戦士に賭ける）` | `cogs/arena/cog.py:66` |
| `arena.cmd.tournament_desc` | `今日の大会の状況を見る・賭ける` | `cogs/arena/cog.py:70` |
| `arena.fmt.duel` | `🥊 1on1` | `cogs/arena/embeds.py:10` |
| `arena.fmt.royale` | `⚔️ バトルロイヤル` | `cogs/arena/embeds.py:10` |
| `arena.stage.semi_betting` | `準決勝・受付中` | `cogs/arena/embeds.py:12` |
| `arena.stage.semi_done` | `準決勝・結果待ち` | `cogs/arena/embeds.py:13` |
| `arena.stage.final_betting` | `決勝・受付中` | `cogs/arena/embeds.py:14` |
| `arena.stage.done` | `終了` | `cogs/arena/embeds.py:15` |
| `arena.announce.start` | `🏛️ **地下闘技場** 今日の{fmt}の大会が始まりました！` | `cogs/arena/cog.py:213` |
| `arena.announce.admin_host` | `🏛️ **地下闘技場** 今日の{fmt}の大会です！` | `cogs/arena/cog.py:178` |
| `arena.anim.semi_title` | `⏳ 準決勝 第{group_no}組、開戦！` | `cogs/arena/cog.py:133` |
| `arena.anim.final_title` | `👑 決勝、開戦！` | `cogs/arena/cog.py:150` |
| `arena.embed.title` | `🏛️ 地下闘技場` | `cogs/arena/embeds.py:97` |
| `arena.embed.header` | `今日の形式: {fmt}　状態: **{status}**` | `cogs/arena/embeds.py:77` |
| `arena.embed.fighter_line` | `{mark} **{name}**　強さ {base_power}{weapon}　単勝 {odds:.1f}倍　賭け総額 {bet_total}` | `cogs/arena/embeds.py:38-39` |
| `arena.embed.spectator` | `観客` | `cogs/arena/embeds.py:29` |
| `arena.embed.final_tbd` | `（準決勝の結果で決まります）` | `cogs/arena/embeds.py:96` |
| `arena.result.semi_title` | `🏛️ 準決勝、決着！` | `cogs/arena/embeds.py:105` |
| `arena.result.semi_line` | `第{g}組: **{winner}** が勝利（敗: {losers}）` | `cogs/arena/embeds.py:103` |
| `arena.result.final_matchup` | `決勝は **{finalists}**` | `cogs/arena/embeds.py:106` |
| `arena.result.final_title` | `👑 決勝、決着！` | `cogs/arena/embeds.py:113` |
| `arena.result.final_body` | `優勝: **{champion}**（他: {runner_up}）` | `cogs/arena/embeds.py:114` |
| `arena.view.select_placeholder` | `賭ける戦士を選ぶ` | `cogs/arena/views.py:62` |
| `arena.view.modal_title` | `{name} に賭ける` | `cogs/arena/views.py:24` |
| `arena.view.modal_label` | `賭け金（{min:,}〜{max:,}ペリカ）` | `cogs/arena/views.py:27` |
| `arena.view.bet_ok_title` | `賭けました` | `cogs/arena/views.py:48` |
| `arena.view.bet_ok_body` | `**{name}** に {stake}（的中すれば、賭け金はそのまま戻り、オッズに応じた利益が上乗せされます）` | `cogs/arena/views.py:49` |
| `arena.view.bet_err_title` | `賭けられませんでした` | `cogs/arena/views.py:43` |
| `arena.err.stake_range` | `賭け金は {lo:,}〜{hi:,}ペリカ にしてください。` | `cogs/shared/messages/games.py:92` |
| `arena.err.fighter_not_found` | `その戦士は見つかりません。` | `cogs/shared/messages/games.py:93` |
| `arena.err.fighter_eliminated` | `その戦士は、すでに脱落しています。` | `cogs/shared/messages/games.py:94` |
| `arena.err.bet_closed` | `いまは、その段への賭けを受け付けていません。` | `cogs/shared/messages/games.py:95` |
| `arena.ledger.bet` | `闘技場:{name}に賭け` | `infra/db/arena.py:139` |
| `arena.ledger.payout` | `闘技場:勝利の配当` | `infra/db/arena.py:199` |
