**English** | [日本語](horse.ja.md)

# Horse Racing Specification (`horse`)

> Planned Owner: **B2-B** · Game ID: `horse` · Screen ID: `horse` · Ledger Reasons: `horse_bet`, `horse_payout`, `horse_entry_fee`, `horse_prize`, `horse_retire` (note: `horse_upkeep` in `packages/shared/src/ledger.ts` has no legacy counterpart — legacy has no periodic upkeep)

## 1. Source Files

- `catalogs/horse.yaml` (L1–L175): stats, coats, silks, tracks, goings, forms, styles, odds, stakes, prizes, schedule, retirement, NPC names, banned chars
- The original Python bot (see git history before v1.0.0), paths relative to its folder:
  - `domain/horse.py` (L1–L523): pure domain rules, stat validation/mutation, simulation engine, odds calculation, payout, schedule, retirement
  - `infra/db/horse.py` (L1–L253): stable CRUD, carrot/gold-carrot, style, retire, bankruptcy seizure & auction
  - `infra/db/race.py` (L1–L532): race scheduling, entry/withdraw, entry close + NPC fill, odds persistence, betting, settlement
  - `services/horse.py` (L1–L165): `HorseDesk` / `HorseService` facade
  - `cogs/horse/cog.py` (L1–L423): `/競馬` slash commands, 5-second background loop, race animation, commentary, result embed
  - `cogs/horse/cards.py` (L1–L163): race card embed & persistent `RaceButton`
  - `cogs/horse/betting.py` (L1–L269): `BetPanel` & `StakeModal`
  - `cogs/horse/stable.py` (L1–L449): `Stable`, `NameModal`, `AppearanceView`, `StyleView`, `GoldCarrotView`, `RetireView`
  - `cogs/shared/horse_display.py` (L1–L13): stat bar formatting
  - `cogs/shared/messages/games.py` (L11–L57, L105–L107): failure messages
- `docs/horse.md` (L1–L104): original design doc

> **Note on Breeding**: Legacy Python has **no breeding mechanic**. Horses are obtained only by consuming a `horse_voucher` shop item (or buying seized horses at Teiai auction / P2P player market), tuned via `carrot` and `gold_carrot`, and retired manually or automatically at 32 races.
> **Doc/String Discrepancy**: `cogs/horse/cog.py:188` command description says `毎日2回` (leftover string), while `catalogs/horse.yaml:107-108` schedules **5 races/day on weekdays** and **4 races/day on weekends**.

---

## 2. Horse Ownership, Stats & Training

### 2.1 Acquisition & Limits
- Max owned horses per user per guild: **`MAX_HORSES = 3`** (`catalogs/horse.yaml:29`). Count includes active P2P market listings (`horse_count_for`, `infra/db/horse.py:43-52`).
- Requires consuming 1 `horse_voucher` (`競走馬（購入券）`, shop price **30,000** Pelica, `catalogs/shop.yaml:192`, `infra/db/horse.py:20,75`).
- Name rules (`domain/horse.py:513-522`): stripped, non-empty, `len <= 12` (`NAME_MAX = 12`), cannot contain any char in `"@<>`*_~|\\\n\r\t#:/"` or substring `"http"` (case-insensitive).
- Appearance choices (`catalogs/horse.yaml:31-32`):
  - `COATS`: `["栗毛", "鹿毛", "黒鹿毛", "青毛", "芦毛", "白毛", "栃栗毛", "月毛"]`
  - `SILKS`: `["🟥", "🟧", "🟨", "🟩", "🟦", "🟪", "⬛", "⬜", "🟫"]`

### 2.2 Stats & Carrots
- 4 stats (`catalogs/horse.yaml:2-25`): `speed` (`スピード`), `stamina` (`スタミナ`), `power` (`パワー`), `guts` (`根性`).
- Default on creation: `{speed: 50, stamina: 50, power: 50, guts: 50}`, base sum `STAT_TOTAL = 200`.
- Clamps: `STAT_MIN = 20`, `STAT_MAX = 80`.
- **Normal Carrot (`carrot`)** (`domain/horse.py:165-177`, `infra/db/horse.py:97-113`):
  - Consumes 1 `carrot`. Moves **`CARROT_POINTS = 5`** points from `src` to `dst` (`src != dst`).
  - Fails if `stats[src] - 5 < 20` or `stats[dst] + 5 > 80`. Total stat sum stays unchanged.
- **Gold Carrot (`gold_carrot`)** (`domain/horse.py:152-162`, `infra/db/horse.py:159-184`):
  - Consumes 1 `gold_carrot`. Adds **`GOLD_CARROT_POINTS = 5`** to `first` and `+5` to `second` (may pick the same stat for `+10`), increasing total by `+10`.
  - Max per horse: **`GOLD_CARROT_MAX = 1`** (tracked by `horses.bonus >= 1 * 2 * 5 = 10`).
  - Fails if resulting stat `> 80`.

### 2.3 Running Style (`脚質`)
- 4 styles (`catalogs/horse.yaml:63-83`):
  | Key | Name | Icon | Early (`p < 0.35`) | Late (`p >= 0.70`) | Auto Trigger Stat |
  |---|---|---|---|---|---|
  | `nige` | `逃げ` | `🏃` | `+0.025` | `-0.015` | `speed` |
  | `senko` | `先行` | `🚶` | `+0.012` | `0.000` | `power` |
  | `sashi` | `差し` | `🎯` | `-0.010` | `+0.018` | `stamina` |
  | `oikomi` | `追込` | `💨` | `-0.022` | `+0.030` | `guts` |
- Default `style = None` (auto). `style_of(stats)` picks highest stat with tie-break order `speed → stamina → power → guts` (`STAT_KEYS` index order, `domain/horse.py:124-127`).
- Owner may set explicit style or reset to `None` (`auto`) anytime; snapshot is copied at entry close (`infra/db/race.py:215`).

### 2.4 Retirement & Seizure
- **Retirement Value** (`domain/horse.py:139-149`):
  ```
  value = wins * 5000 + max(0, places - wins) * 2000 - max(0, races - places) * 2000
  retire_value = clamp(value, -20000, +60000)
  ```
  (`RETIRE_WIN=5000`, `RETIRE_PLACE=2000`, `RETIRE_LOSS=2000`, `RETIRE_MAX=60000`, `RETIRE_FEE_MAX=20000`).
  - Positive value → owner receives payout (`income=value`). Negative value → owner pays fee (manual retire fails if `balance < -value`; auto-retirement at 32 races applies fee even if it sends balance negative).
  - Retired horse sets `owner_id = -2`. Cannot manually retire while entered in an `entry` or `betting` race (`infra/db/horse.py:125-131`).
- **Mandatory Retirement**: After running **`MAX_RACES = 32`** races, horse is automatically retired during race settlement (`infra/db/race.py:476-488`).
- **Asset Valuation** (`infra/db/horse.py:58-60`): `horse_worth = max(0, 30000 + retire_value(races, wins, places))`.
- **Bankruptcy Seizure** (`infra/db/horse.py:186-202`): sets `owner_id = -1, listed_at = now`, deletes unclosed registrations (`lane < 0`, entry fee NOT refunded), converts already-drawn `entry`/`betting` entries into NPC (`owner_id=0, horse_id=0`), returns `count * 30000` seizure credit. Sold via Teiai auction at `max(1, round(30000 * teiai.auction_rate(listed_at, now)))` to Katagi only (`infra/db/horse.py:222-252`).

---

## 3. Schedule & Race State Machine

### 3.1 Schedule (`catalogs/horse.yaml:107-111`, `domain/horse.py:468-481`)
- Local timezone (guild/bot `tz_hours`, default JST UTC+9):
  - **Weekdays (Mon–Fri)**: 5 races/day at **`09:00, 12:00, 15:00, 18:00, 21:00`**.
  - **Weekends (Sat–Sun)**: 4 races/day at **`09:00, 13:00, 17:00, 21:00`**.
  - **Major Race (`🏆重賞`)**: Any `regular` race with local `start_at.hour == 21` (`MAJOR_HOUR = 21`, `domain/horse.py:63-66`).
- Timeline relative to `start_at`:
  - Entry opens: `start_at - 120 min` (`ENTRY_OPEN_MIN = 120`).
  - Entry closes & odds published: `start_at - 60 min` (`ENTRY_LEAD_MIN = 60`).
  - Betting closes: `start_at - 120 sec` (`BET_LEAD_SEC = 120`).
  - Race runs & settles: `start_at`.
- **Special Race (`kind='special'`, admin-created)** (`infra/db/race.py:103-114`):
  - `entry_close = now + entry_min * 60`
  - `bet_close = entry_close + bet_min * 60`
  - `start_at = bet_close + 120` (`BET_LEAD_SEC`)
- Background tick runs every **5 seconds** (`cogs/horse/cog.py:369`). If feature `horse` is disabled, no new regular race is created, but already-open races finish normally (`cogs/horse/cog.py:386-388`).

### 3.2 State Machine
```
(scheduled / special created)
        │
        ▼
    [ entry ]  ──(players register/withdraw; entry_fee = 1,000; lane = -1)
        │  now >= entry_close
        ▼
    [ betting ] ──(snapshot player stats; fill to 8 with NPCs; shuffle lanes 1..8;
        │          assign form & track; compute & store fixed odds; players buy tickets
        │          until now >= bet_close)
        │  now >= bet_close  ──(card edited to "発売終了", betting rejected)
        │  now >= start_at
        ▼
     [ done ]   ──(simulate once, settle prizes, retirements, bets, bank income;
                   play animation frames in channel, post result embed)
```

---

## 4. Entry, NPC Fill, Track & Form

### 4.1 Entry Rules (`infra/db/race.py:134-192`)
- Entry fee: **`ENTRY_FEE = 1,000`** Pelica (refunded in full on withdrawal before `entry_close`).
- Limits:
  - 1 horse per owner per race (`race_one_horse_per_owner`).
  - Max `FIELD_SIZE = 8` registered horses (`race_field_full`).
  - No duplicate horse names in the same race (`race_duplicate_name`).
  - Horse must have `races < 32` (`horse_retired_by_age`).
  - Regular race rejects a horse already in an open `regular` race (`race_horse_busy`); `special` races bypass this check (`infra/db/race.py:154-164`).

### 4.2 Entry Close & NPC Generation (`infra/db/race.py:194-258`, `domain/horse.py:180-203,332-337`)
- Copies each registered horse's current stats, record `(races, wins, places)`, and `style`.
- Fills remaining slots up to `FIELD_SIZE = 8` with NPC horses (`horse_id=0, owner_id=0, style=None`):
  - **Name**: shuffled from 30 `NPC_NAMES` excluding already-used names (fallback `f"帝愛{len(rows)}号"`).
  - **Stats (`random_stats`)**: draws `raw = [rng.random() ** 3.0 + 0.08 for _ in 4]`, scales to `STAT_TOTAL=200` in `unit=5` steps above `STAT_MIN=20`, adjusts `vals[0]` for exact sum `200`, retries until all stats in `[20, 80]`.
  - **Silks**: random choice among least-used silks colors so far. **Coat**: uniform random from `COATS`.
  - **Synthetic NPC Record (`npc_record`)**: `races = rng.randint(0, 12)`, `wins = Binomial(races, 1/8)`, `places = wins + Binomial(races - wins, 2/7)`.
- Shuffles all 8 runners into lanes `1..8`.
- **Form (`random_form`)**: `1 (◎)`, `0 (○)`, `-1 (△)` with weights `[2, 5, 2]` (2/9, 5/9, 2/9).
- **Track (`random_track`)**:
  - Distance: uniform from `[1000, 1200, 1600, 1800, 2000, 2400, 3000]` m.
  - Going: weighted from `良` (60, penalty 0.0), `稍重` (25, penalty 0.012), `重` (11, penalty 0.03), `不良` (4, penalty 0.05).

---

## 5. Simulation Engine (`domain/horse.py:206-286`)

- Constants: `TICKS = 60`, `MAX_TICKS = 140`, `FATIGUE_MAX = 0.22`, `NOISE = 0.03`, `LUCK = 0.03`, `PACE_FACTOR = 0.05`.
- Pre-race draws per runner `i`:
  - `luck[i] = rng.gauss(0, 0.03)`
  - `spurt[i] = max(0.0, (guts - 20) / 60 * 0.12 * rng.uniform(0.5, 1.5))`
  - `pace = count(style in ('nige', 'senko')) / n`, `pace_shift = (pace - 0.5) * 0.05`.
- Per-tick multiplier `_mult(r, p, track, luck, spurt, style, pace_shift)`:
  1. Speed: `m = 1 + (speed - 50) / 50 * min(0.09, 0.042 * 1800 / distance)`
  2. Early acceleration (power): `m *= 1 + (power - 50) / 50 * 0.10 * max(0.0, 1 - p / 0.3)`
  3. Stamina & fatigue: `reach = min(1.0, max(0.25, 0.8 * (stamina / 50) / (distance / 1800)))`. If `p > reach` and `reach < 1.0`:
     - `fatigue = 0.22 * (p - reach) / (1 - reach)`
     - `m *= (1 - fatigue) * (1 + min(spurt, fatigue))`
  4. Style curve (`style_curve`):
     - `p < 0.35`: `STYLE_EARLY[style] - (pace_shift if style in ('nige','senko') else 0)`
     - `p >= 0.70`: `STYLE_LATE[style] + (pace_shift if style in ('sashi','oikomi') else 0)`
     - `0.35 <= p < 0.70`: linear interpolation between `STYLE_EARLY` and `STYLE_LATE` (`t = (p - 0.35) / 0.35`, without `pace_shift`).
     - `m *= 1 + style_curve(...)`
  5. Going penalty: `m *= 1 - GOING_PENALTY[going] * (1 - (power - 20) / 60)`
  6. Form & race luck: `m *= FORM_MULT[form] * (1 + luck)` (`◎: 1.015`, `○: 1.0`, `△: 0.985`).
- Step at tick `t in 1..140`: `step = _mult(...) * (1 + rng.gauss(0, 0.03)) / 60`; `new = pos[i] + max(0.0, step)`.
- When `new >= 1.0`, interpolated finish time is `t - 1 + (1.0 - pos[i]) / max(1e-9, new - pos[i])`, `pos[i] = 1.0`. Stops early once all finish.
- Unfinished fallback time: `140 + (1 - pos[i])`. Tie-break: `(final_times[i], rng.random())`.

---

## 6. Odds, Betting & Payouts

### 6.1 Odds Formula (`domain/horse.py:326-465`)
- **Record-based win probability (`_win_weights`)**:
  - `ability_share[i] = sum_stats[i] / sum(sum_stats)`
  - `prior[i] = 0.3 * ability_share[i] + 0.7 * (1 / n)` (`ABILITY_PRIOR_WEIGHT = 0.3`)
  - `p = (wins + 4 * prior[i]) / (races + 4)` (`RECORD_PRIOR_RUNS = 4`)
  - If `races == 0`: `p *= 0.75` (`FIRST_RUN_FACTOR = 0.75`).
  - `raw[i] = p * FORM_ODDS[form]` (`◎: 1.15`, `○: 1.0`, `△: 0.85`), normalized to sum 1.
- **Record-based place probability (`_place_probs`)**: same with `flat = min(3, n) / n`, `prior = 0.3 * (share * min(3, n)) + 0.7 * flat`, normalized to sum `min(3, n)`, capped at `PLACE_CAP = 0.95`.
- **Simulation blend (`_blended_probs`)**: runs `estimate(runners, track, sims=600, seed=0)` (**fixed seed 0**!) and blends `0.7 * sim_prob + 0.3 * record_prob` (`ODDS_SIM_WEIGHT = 0.7`; place capped at `0.95`).
- **Conversion (`_odds`)**: `max(1.0, min(cap, floor((1 - takeout) / prob * 10) / 10))`.
  - Singles (`win`, `place`): `TAKEOUT = 0.15`, `MAX_ODDS = 99.9` (expected RTP ≈ **85%**).
  - Combos (`quinella`, `wide`, `exacta`, `trio`): Harville formula from blended `win_probs`, `COMBO_TAKEOUT = 0.20`, `MAX_COMBO_ODDS = 100.0` (expected RTP ≈ **80%**).
- **Fixed Odds**: Locked at ticket purchase time (`make_all_odds` calculated once at entry close).

### 6.2 Ticket Types & Limits (`catalogs/horse.yaml:91-93,113-128`, `infra/db/race.py:307-409`)
| Kind | Japanese | Picks | Key Format | Hit Condition | Multi-select in UI |
|---|---|---|---|---|---|
| `win` | `単勝` | 1 | `lane` | `lane == order[0]` | Yes (each gets `stake`) |
| `place` | `複勝` | 1 | `lane` | `lane in order[:3]` | Yes (each gets `stake`) |
| `quinella` | `馬連` | 2 (unordered) | `"a-b"` (`a<b`) | `set(picks) == set(order[:2])` | No |
| `wide` | `ワイド` | 2 (unordered) | `"a-b"` (`a<b`) | `set(picks) <= set(order[:3])` | No |
| `exacta` | `馬単` | 2 (ordered) | `"a>b"` | `picks == order[:2]` | No |
| `trio` | `三連複` | 3 (unordered) | `"a-b-c"` | `set(picks) == set(order[:3])` | No |

- Stake per ticket: **`100` – `50,000`** Pelica (`MIN_STAKE`, `MAX_STAKE`).
- Total stake per user per race: **`150,000`** Pelica (`MAX_RACE_STAKE`).
- Payout on hit: **`int(stake * odds)`** (`domain/horse.py:464-465`).
- Losing stakes contribute `int(total_lost * teiai.LOSS_SHARE)` (20%) to Teiai Bank income (`infra/db/race.py:516-518`).
- Stats update: `total_wagered += stake` on bet; on settlement `games_played += 1`, `total_won += pay`, `biggest_win = max(biggest_win, pay - stake)` per ticket (`infra/db/race.py:352-355,509-513`).

### 6.3 Owner Prizes (`domain/horse.py:55-78`, `infra/db/race.py:423-475`)
- Base prize tables (1st / 2nd / 3rd):
  - Regular race: **`[12,000, 5,000, 2,000]`**
  - Major race (21:00 regular): **`[24,000, 10,000, 4,000]`**
- **Anti-inflation Prize Pool Scaling**:
  - Let `real_entries` = player-owned horses in race, `placed_total` = sum of table prizes for player-owned horses finishing 1st–3rd.
  - For Major races only: if `placed_total > real_entries * 1000`, Teiai Bank cash tops up `topup = min(shortfall, int(bank_cash), 10000)` (`MAJOR_HOUSE_TOPUP = 10000`).
  - `scale = min(1.0, (real_entries * 1000 + topup) / placed_total)`.
  - Each player horse finishing in top 3 receives `prize = round(table[place-1] * scale)`, then boosted by relic `prize` buff `round(prize * (1 + relic_buffs.get("prize", 0.0)))` (竜の涙), then skimmed by `teiai.HORSE_PRIZE_SKIM_RATE` (`0.0` in `catalogs/teiai.yaml:4`).

---

## 7. Animation & Commentary (`cogs/horse/cog.py:34-124`)
- `TRACK_W = 22`, `STEP = 1.4s`, `GAP_ZOOM = 3.0`, `anim_frames(distance) = max(8, round(24 * distance / 1800))`, `laps = max(1, distance // 1000)`.
- `display_frames` truncates at winner crossing `1.0`, zooms leader gap by `3.0` monotonically, adjusts final frame by finish-time deltas.
- Seasonal skin: if `owner_id == 0`, `skins.house_horse_icon(now)` (e.g. `🦌` during Christmas) replaces `🐎`.

---

## 8. Verbatim Japanese Strings

| Key ID | Verbatim Japanese String | Source |
|---|---|---|
| `horse.cmd.group_desc` | `🏇 競走馬を育てて走らせる・馬券を買う（毎日2回）` | `cogs/horse/cog.py:188` |
| `horse.cmd.stable_desc` | `自分の馬・ステータスの配分・出走の申し込み` | `cogs/horse/cog.py:217` |
| `horse.cmd.card_desc` | `いまのレースの出馬表・オッズ（馬券もここから）` | `cogs/horse/cog.py:226` |
| `horse.announce.entry_open` | `🏇 **競馬** の出走申し込みが始まりました！` | `cogs/horse/cog.py:288` |
| `horse.announce.odds_ready` | `🏇 **出馬表とオッズが出ました！** 馬券は、発走の2分前まで買えます。` | `cogs/horse/cog.py:322` |
| `horse.card.no_open_race` | `いま、開催中のレースはありません。次の発走は <t:{ts}:t>（<t:{ts}:R>）です。` | `cogs/horse/cog.py:235` |
| `horse.card.race_title` | `🏇 第{num}競走{tag}` (`tag`: `（臨時）` / `🏆重賞` / `""`) | `cogs/horse/cards.py:33-34` |
| `horse.card.entry_closed` | `出走の申し込みは、<t:{ts}:t> に締め切りました。` | `cogs/horse/cards.py:86` |
| `horse.card.entry_open_line` | `出走の申し込み: **{when}** まで（出走料 {fee}）` | `cogs/horse/cards.py:89` |
| `horse.card.entry_hint` | `` `/競馬 厩舎` から、馬を申し込めます。足りない分は、帝愛の馬が走ります。 `` | `cogs/horse/cards.py:92` |
| `horse.card.bet_closed` | `馬券の発売は、<t:{ts}:t> に締め切りました。` | `cogs/horse/cards.py:102` |
| `horse.card.bet_open_line` | `馬券の発売: **{when}** まで（単勝=1着・複勝=3着以内。**オッズは成績で決まり、賭けた時点で確定**）` | `cogs/horse/cards.py:107` |
| `horse.card.footer` | `調子 ◎好調 ○普通 △不調　控除 {takeout:.0%}　スピードは短距離、スタミナは長距離、パワーは重い馬場に効く` | `cogs/horse/cards.py:122` |
| `horse.btn.bet` | `🎫 馬券を買う` | `cogs/horse/cards.py:140` |
| `horse.btn.card` | `📋 出馬表` | `cogs/horse/cards.py:141` |
| `horse.comment.goal` | `🏁 **ゴール！！** 1着は **{name}**！` | `cogs/horse/cog.py:108` |
| `horse.comment.start` | `🔔 ゲートが開いた！ **スタート！**` | `cogs/horse/cog.py:110` |
| `horse.comment.spurt` | `💪 **{name}** が根性のラストスパートで逆転！！` | `cogs/horse/cog.py:115` |
| `horse.comment.overtake` | `🔥 **{name}** が先頭に立った！` | `cogs/horse/cog.py:116` |
| `horse.comment.finish_fight` | `📣 ゴール前の叩き合い！ **{name}** 先頭！` | `cogs/horse/cog.py:118` |
| `horse.comment.stretch` | `📣 **最後の直線！** 先頭は {name}！` | `cogs/horse/cog.py:120` |
| `horse.comment.backstretch` | `向こう正面。先頭は {name}。` | `cogs/horse/cog.py:122` |
| `horse.comment.lead` | `先頭は {name}。` | `cogs/horse/cog.py:123` |
| `horse.result.no_winners` | `的中者はいませんでした。` | `cogs/horse/cog.py:138` |
| `horse.result.retired` | `💐 **{silks} {name}** が定年（{max_races}戦）で名誉引退` | `cogs/horse/cog.py:148` |
| `horse.bet.panel_footer` | `単勝=1着 複勝=3着以内 馬連=1・2着(順不同) ワイド=3着以内の2頭 馬単=1・2着(順番) 三連複=1〜3着(順不同)` | `cogs/horse/betting.py:239` |
| `horse.bet.modal_title` | `馬券の金額` | `cogs/horse/betting.py:20` |
| `horse.bet.bought_title` | `馬券を買いました` | `cogs/horse/betting.py:46,84` |
| `horse.bet.not_owner` | `この画面を使えるのは、開いた本人だけです。` | `cogs/horse/betting.py:116` |
| `horse.stable.not_owner` | `` これは他の人の厩舎です。`/競馬 厩舎` で自分の厩舎を開けます。 `` | `cogs/horse/stable.py:266` |
| `horse.stable.created_title` | `🐴 競走馬を迎えました` | `cogs/horse/stable.py:95` |
| `horse.stable.retire_warn` | `引退した馬は、もう戻りません。` | `cogs/horse/stable.py:225` |
| `horse.err.select_stat_to_add` | `増やすステータスを選んでください。` | `cogs/shared/messages/games.py:12` |
| `horse.err.select_distinct_stats` | `動かす元と先は、別のステータスを選んでください。` | `cogs/shared/messages/games.py:13` |
| `horse.err.stat_at_min` | `{stat_name} は、これ以上は減らせません（最低 {min}）。` | `cogs/shared/messages/games.py:14` |
| `horse.err.stat_at_max` | `{stat_name} は、これ以上は増やせません（最高 {max}）。` | `cogs/shared/messages/games.py:15` |
| `horse.err.name_empty` | `名前を入れてください。` | `cogs/shared/messages/games.py:16` |
| `horse.err.name_too_long` | `名前は {max} 文字までです。` | `cogs/shared/messages/games.py:17` |
| `horse.err.name_invalid_chars` | `名前に使えない文字（@ < > ` * _ ~ | # : / など）か、リンクが入っています。` | `cogs/shared/messages/games.py:18` |
| `horse.err.invalid_look` | `毛色と勝負服の色を、選び直してください。` | `cogs/shared/messages/games.py:19` |
| `horse.err.max_owned` | `持てる馬は {max_horses} 頭までです。` | `cogs/shared/messages/games.py:20` |
| `horse.err.no_voucher` | `「競走馬（購入券）」を持っていません。ショップで買えます。` | `cogs/shared/messages/games.py:21` |
| `horse.err.select_own` | `自分の馬を選んでください。` | `cogs/shared/messages/games.py:22` |
| `horse.err.no_carrot` | `「にんじん」を持っていません。ショップで買えます。` | `cogs/shared/messages/games.py:23` |
| `horse.err.select_style` | `脚質を選んでください。` | `cogs/shared/messages/games.py:24` |
| `horse.err.busy_no_retire` | `出走予定のレースが終わるまで、引退できません。` | `cogs/shared/messages/games.py:25` |
| `horse.err.retire_fee_short` | `引退費用 {fee:,}ペリカ が足りません（残高 {balance:,}ペリカ）。` | `cogs/shared/messages/games.py:26` |
| `horse.err.gold_carrot_max` | `この馬には、金にんじんをもう使えません（1頭に {max_count} 本まで）。` | `cogs/shared/messages/games.py:27` |
| `horse.err.no_gold_carrot` | `「金にんじん」を持っていません。ショップで買えます。` | `cogs/shared/messages/games.py:28` |
| `horse.err.entry_closed` | `このレースの申し込みは、もう締め切りました。` | `cogs/shared/messages/games.py:29` |
| `horse.err.retired_by_age` | `この馬は定年（{max_races}戦）に達したので、出走できません（引退済みのはずです）。` | `cogs/shared/messages/games.py:31` |
| `horse.err.one_horse_per_owner` | `1人が1つのレースに出せる馬は、1頭までです。` | `cogs/shared/messages/games.py:33` |
| `horse.err.field_full` | `出走枠が埋まりました。` | `cogs/shared/messages/games.py:34` |
| `horse.err.duplicate_name` | `同じ名前の馬がすでに出走します。` | `cogs/shared/messages/games.py:35` |
| `horse.err.horse_busy` | `この馬は、ほかのレースに出走予定です。` | `cogs/shared/messages/games.py:36` |
| `horse.err.entry_fee_short` | `出走料 {fee:,}ペリカ が足りません（残高 {balance:,}ペリカ）。` | `cogs/shared/messages/games.py:37` |
| `horse.err.not_entered` | `この馬は、申し込んでいません。` | `cogs/shared/messages/games.py:38` |
| `horse.err.select_bet_kind` | `馬券の種類を選んでください。` | `cogs/shared/messages/games.py:39` |
| `horse.err.select_distinct_horses` | `{kind_name}は、違う馬を {need} 頭選んでください。` | `cogs/shared/messages/games.py:41` |
| `horse.err.stake_range` | `賭け金は {min_stake:,}〜{max_stake:,}ペリカ にしてください。` | `cogs/shared/messages/games.py:43` |
| `horse.err.bet_unavailable` | `このレースの馬券は、まだ（またはもう）買えません。` | `cogs/shared/messages/games.py:44` |
| `horse.err.bet_closed` | `馬券の発売は、締め切りました。` | `cogs/shared/messages/games.py:45` |
| `horse.err.lane_not_running` | `その馬は出走しません。` | `cogs/shared/messages/games.py:46` |
| `horse.err.odds_pending` | `オッズを計算中です。少し待ってから、もう一度買ってください。` | `cogs/shared/messages/games.py:47` |
| `horse.err.max_stake` | `1つのレースに賭けられるのは、合計 {max_race_stake:,}ペリカ までです。` | `cogs/shared/messages/games.py:48` |
| `horse.err.multi_only` | `まとめて買えるのは、単勝と複勝だけです。` | `cogs/shared/messages/games.py:49` |
| `horse.err.select_horses` | `馬を選んでください。` | `cogs/shared/messages/games.py:50` |
| `horse.err.max_stake_many` | `1つのレースに賭けられるのは、合計 {max_race_stake:,}ペリカ までです（今回は {total:,}、すでに {spent:,}）。` | `cogs/shared/messages/games.py:52-53` |
| `horse.err.insufficient_balance_many` | `残高が足りません（合計 {total:,}ペリカ 必要。いまの残高: {balance:,}ペリカ）。` | `cogs/shared/messages/games.py:56` |
| `horse.err.partial_bought` | `{inner}（先の {bought} 頭ぶんは買えています）` | `cogs/shared/messages/games.py:106` |
| `horse.ledger.entry_fee` | `競馬:出走料（{name}）` | `infra/db/race.py:170` |
| `horse.ledger.entry_refund` | `競馬:出走料の返金` | `infra/db/race.py:191` |
| `horse.ledger.bet` | `競馬:馬券（{kind_name}・{label}）` | `infra/db/race.py:351` |
| `horse.ledger.prize` | `競馬賞金:{name}（{place}着）` | `infra/db/race.py:468` |
| `horse.ledger.payout` | `競馬:払い戻し` | `infra/db/race.py:505` |
| `horse.ledger.retire` | `競馬:引退{金|費用}（{name}）` / `競馬:定年引退{金|費用}（{name}）` | `infra/db/horse.py:142`, `infra/db/race.py:484` |
