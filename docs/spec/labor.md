# Underground Labor Specification (`labor`)

> Planned Owner: **B2-B** · Screen ID: `work` · Ledger Reasons: `work_collect`, `work_upgrade`, `work_hire`, `work_dorm`

## 1. Source Files

- `catalogs/labor.yaml` (L1–L178): tools, click cap, fatigue, crits, terrain, workers, ores, relics, dorm, anti-macro thresholds
- `catalogs/teiai.yaml` (L3): `labor_skim_rate: 0.03` (3% Teiai skim on collect)
- `legacy/python/domain/labor.py` (L1–L421): pure clicker math, terrain, crits, worker settlement, ore/relic rolls, anti-macro CV detection
- `legacy/python/infra/db/labor.py` (L1–L590): `LaborRepo` persistence, click, collect, drink, upgrade, hire/dismiss, dorm, renew, rankings, click hour logging
- `legacy/python/services/labor.py` (L1–L67): `LaborService` facade
- `legacy/python/cogs/labor/cog.py` (L1–L80): `/地下 作業` and `/地下 ランキング`
- `legacy/python/cogs/labor/embeds.py` (L1–L168): work panel, hire panel, mining ranking embeds
- `legacy/python/cogs/labor/views.py` (L1–L253): `LaborView` interactive tabs/buttons
- `legacy/python/cogs/shared/messages/games.py` (L62–L71): failure messages
- `docs/labor.md` (L1–L118): original design doc

> **Doc Discrepancy Note**: `docs/teiai.md:46` mentions 1% labor skim, while `catalogs/teiai.yaml:3` and `docs/labor.md:18` use **`labor_skim_rate = 0.03` (3%)**. Follow `catalogs/teiai.yaml:3` (3%).

---

## 2. Clicker Mechanics (Manual Digging)

### 2.1 Pay, Fatigue & Recovery (`domain/labor.py:18-90`, `catalogs/labor.yaml:2-29`)
- **Click cooldown**: `CLICK_INTERVAL = 1.0` second (`now - last_click < 1.0` returns quiet failure `"押すのが早すぎます。"`).
- **Tools** (`MAX_LEVEL = 10`, levels `0..10`):
  - `pick` (`⛏ ツルハシ`): `pay_per_click(pick) = 10 + 4 * clamp_level(pick)` (`BASE_PAY = 10`, `PAY_PER_LEVEL = 4`; Lv0 = `10`, Lv10 = `50`).
  - `glove` (`🧤 手袋`): reduces fatigue gain per click:
    ```
    early = min(glove, 5)
    fatigue_gain(glove) = 3.0 - 0.4 * early - 0.1 * (glove - early)
    ```
    (Lv0 = `3.0`, Lv5 = `1.0`, Lv10 = `0.5`).
  - Upgrade cost (`UPGRADE_COST`, same table for both tools, `catalogs/labor.yaml:13`):
    `[150, 400, 900, 1800, 3500, 7000, 14000, 28000, 56000, 112000]` (total to Lv10 = `223,750`).
- **Fatigue (`0.0` – `100.0`)**:
  - Passive recovery: `RECOVER_PER_SEC = 0.1`/sec (`fatigue_now = clamp(fatigue - dt * 0.1 * (1 + recovery_buff), 0, 100)` where `recovery_buff` is from `relic_vase`).
  - Pay multiplier: `pay_rate(fatigue) = 1.0 - 0.8 * (fatigue / 100.0)` (`MIN_PAY_RATE = 0.2`, range `100%` down to `20%`).
  - Base click pay: `click_pay(pick, fatigue) = max(1, round(pay_per_click(pick) * pay_rate(fatigue)))`.
  - Relic `click` buff (`relic_fossil`): `pay = max(1, relics.chance_round(base_pay * (1 + click_buff)))`.
  - Fatigue labels (`cogs/labor/embeds.py:10-11`): `<25`: `元気`, `<50`: `ふつう`, `<75`: `疲れ気味`, `>=75`: `ぐったり`.
- **Energy Drink (`labor_drink` / 栄養ドリンコ)**:
  - Fails if `fatigue < 1` (`labor_not_tired`) or none in inventory (`labor_no_drink`).
  - Consumes 1 drink, reduces fatigue by `DRINK_RECOVER = 60.0` (clamped to `0.0`).

### 2.2 Daily Click Cap, Crits, Combos & Daily Terrain (`domain/labor.py:92-140`, `infra/db/labor.py:372-419`)
- **Daily Click Cap**: `MAX_CLICKS_PER_DAY = 500` (resets when local date `day` changes).
  - If `day_click >= 500` OR `auto_click_suspected` is True: click pays `OVER_CAP_PAY = 1`, no crit, no ore, no combo.
- **Daily Terrain (`terrain_today(day)`)**: deterministic across all guilds/users from `random.Random(f"terrain:{day}").choice(["hit", "fatigue", "silver", "none"])`:
  - `hit`: `⛏ 鉱脈ヒット率 +5%` (`TERRAIN_HIT_BONUS = 0.05`)
  - `fatigue`: `😌 疲労の溜まりが20%軽い` (`TERRAIN_FATIGUE_CUT = 0.20`, multiplies fatigue gain by `0.80`)
  - `silver`: `⚪ 銀が2倍出やすい（手掘り）` (`TERRAIN_SILVER_MULT = 2`, doubles silver weight in crit ore roll)
  - `none`: `特になし`
- **Vein Crit (`鉱脈ヒット`)**:
  - Chance: `min(0.30, 0.05 + 0.01 * pick + 0.002 * active_workers + (0.05 if terrain == 'hit' else 0))` (`CRIT_BASE=0.05`, `CRIT_PER_LEVEL=0.01`, `CRIT_WORKER_BONUS=0.002`, `CRIT_MAX=0.30`).
  - On crit: `pay *= 5` (`CRIT_MULT = 5`).
  - Secondary ore roll (`CRIT_ORE_CHANCE = 0.15`): picks weighted ore from `CRIT_ORES` (`coal` w=45 v=3, `copper` w=40 v=60, `silver` w=12 [×2 on `silver` terrain] v=240, `gold` w=3 v=1200). Ore value is added immediately to `pay` and tracked in `row["ores"]`.
- **10-Click Combo**: every 10th lifetime click (`(clicks + 1) % 10 == 0`, `COMBO_SIZE = 10`) multiplies `pay = round(pay * 1.20)` (`COMBO_BONUS = 0.20`). Applied AFTER crit & crit ore value!

### 2.3 Anti-Macro Click Monitor (`domain/labor.py:358-420`, `infra/db/labor.py:421-455`)
- Records per-hour aggregates in `labor_click_hours` (`clicks, pay, gaps, sum_gap, sum_gap2, min_gap`), keeping `CLICK_LOG_DAYS = 14` days; gaps counted only if `0 < gap <= 600.0` (`CLICK_GAP_MAX`).
- `is_mechanical_hour(h)`: `gaps >= 2` AND `clicks >= 100` (`MECH_MIN_CLICKS`) AND `stddev(gap) / mean(gap) < 0.1` (`MECH_CV_MAX`).
- `auto_click_suspected(rows, current_hour)`: True if all `SUSPECT_HOURS = 3` completed preceding hours (`[current_hour - 3, current_hour - 1]`) are mechanical. Soft-caps click pay to `1` Pelica (no ban).

---

## 3. Idle Workers, Dormitory, Ores & Relics

### 3.1 Workers & Dormitory (`catalogs/labor.yaml:66-98,169-172`, `domain/labor.py:145-206`)
- Dormitory capacity: `slots(dorm) = 5 + clamp(dorm, 0, 5)` (`SLOTS_BASE = 5`, `DORM_MAX = 5`, max `10` slots).
- Dormitory upgrade costs (`DORM_COST`): `[2000, 6000, 15000, 40000, 100000]` (total `163,000`).
- Contract length: **`CONTRACT_DAYS = 1`** day (`86,400s`). Auto-renew defaults to **ON (`renew = 1`)**.
- Idle cap: **`STOCK_HOURS = 24.0`** hours (`min(24.0, (now - idle_at) / 3600.0)`).

| Key | Name | Icon | Wage/hr (`rate`) | Contract Fee (1d) | `ore_power` | `relic_power` | Special |
|---|---|---|---|---|---|---|---|
| `apprentice` | `見習い` | `🧒` | `1.8` | `150` | `0.12` | `0.5` | — |
| `miner` | `坑夫` | `👷` | `10.05` | `520` | `0.415` | `0.8` | — |
| `craftsman` | `職人` | `🧑‍🔧` | `23.55` | `1,160` | `0.95` | `1.0` | — |
| `foreman` | `監督` | `🕴️` | `0` | `640` | `0.0` | `0.0` | `+25%` luck per foreman (`FOREMAN_LUCK = 0.25`) |

- Dismissing a worker removes the one with the earliest `expires_at` of that `kind`; contract fee is **not** refunded (`infra/db/labor.py:549-561`).

### 3.2 Ore & Relic Drops (`catalogs/labor.yaml:98-167`, `domain/labor.py:208-261`)
- Worker rolls `n = int(hours) + (1 if rng.random() < hours - int(hours) else 0)` times per settlement.
- Combined luck: `luck = 0.25 * num_foremen + relic_buffs.get("luck", 0.0)` (`relic_meteor`).
- **Ores** (single uniform draw `x = rng.random()` subtracting cumulative intervals in exact order; `coal` is flat probability `0.40`, all others scaled by `ore_power * (1 + luck)`):
  | Order | ID | Name | Icon | Base `prob` | Value | Big Announce |
  |---|---|---|---|---|---|---|
  | 1 | `copper` | `銅` | `🟤` | `0.06` | `60` | No |
  | 2 | `silver` | `銀` | `⚪` | `0.015` | `240` | No |
  | 3 | `gold` | `金` | `🟡` | `0.003` | `1,200` | No |
  | 4 | `diamond` | `ダイヤ` | `💎` | `0.0004` | `9,000` | **Yes** |
  | 5 | `legend` | `伝説の鉱石` | `🌟` | `0.00004` | `90,000` | **Yes** |
  | 6 | `coal` | `石炭` | `⚫` | `0.40` (flat) | `3` | No |
- **Relics** (separate uniform draw per hour, scaled by `relic_power * (1 + luck)`; see `docs/spec/relics.md` for buffs & merging):
  | Order | ID (`item_id`) | Name | Icon | Base `prob` | Reference Value | Big Announce |
  |---|---|---|---|---|---|---|
  | 1 | `fossil` (`relic_fossil`) | `三葉虫の化石` | `🐚` | `0.0033` | `1,500` | No |
  | 2 | `bone` (`relic_bone`) | `恐竜の骨` | `🦴` | `0.0017` | `4,000` | No |
  | 3 | `meteor` (`relic_meteor`) | `隕石の欠片` | `☄️` | `0.00067` | `10,000` | No |
  | 4 | `vase` (`relic_vase`) | `古代文明の壺` | `🏺` | `0.00027` | `25,000` | No |
  | 5 | `crown` (`relic_crown`) | `王家の黄金冠` | `👑` | `0.000067` | `60,000` | **Yes** |
  | 6 | `tear` (`relic_tear`) | `竜の涙` | `🔮` | `0.000017` | `100,000` | **Yes** |

### 3.3 Idle Settlement (`settle_plan`, `domain/labor.py:268-354`)
- Triggered automatically before every state-mutating labor action (`_labor_row`).
- `hours = idle_hours(idle_at, now)` if `idle_at > 0` else `0.0`; `start = now - hours * 3600`.
- Active workers (`expires_at > now`) contribute provisional wage `int(idle_rate(active) * (1 + wage_bonus) * hours)` to `avail_pot = pot + provisional_wage` (`wage_bonus` from `relic_bone`).
- Expired workers (`expires_at <= now`) sorted by descending `contract_fee`:
  - If `renew` is True and `avail_pot + (balance - balance_spent) >= fee`: pays from `avail_pot` first (`pot_spent`), remainder from wallet (`balance_spent`), renews to `now + 86400`.
  - Otherwise marked `removed` (works only `max(0.0, min(now, expires_at) - start) / 3600.0` hours before retiring).
- Staying workers (active + renewed) earn wages and dig ores/relics for `hours`. Removed workers earn/dig for their partial `worked` hours.
- Total `gain = int(total_wage) + ore_gain(ores)`. Finds history keeps latest `FINDS_KEEP = 40` rows per user (`labor_finds`, excluding `coal` on display).

### 3.4 Collecting (`labor_collect`, `infra/db/labor.py:227-250,457-491`)
- Can collect even when `pot == 0` if `relics` are pending.
- **Teiai Skim (`labor_skim`)**: `skimmed = round(amount * 0.03)` (`teiai.LABOR_SKIM_RATE = 0.03`, `catalogs/teiai.yaml:3`).
  - Credited to Teiai house account (`house_income_for(gid, skimmed)`); logged as a 0-delta ledger line `"慈善団体への寄付（地下作業のピンハネ {skimmed:,}ペリカ）"`; added to `labor.donated`.
- Net `amount - skimmed` applied to user wallet with `income = net` (triggers debt auto-withholding if user is in debt!).
- Pending `relics` added to `inventory`; `labor_finds.collected` set to `1`.
- Big ores (`diamond`, `legend`) and big relics (`crown`, `tear`) trigger a public channel announcement.

---

## 4. State Machine & Rankings

- Interactive panel (`LaborView`, timeout `900s`): two tabs `work` (click, collect, drink, tool upgrades, relic merge select) and `hire` (back, collect, auto-renew toggle, 4 worker hire buttons, dorm upgrade, dismiss select). Opening a new `/地下 作業` deletes the user's previous panel message in the guild (`cogs/labor/cog.py:50-60`).
- `/地下 ランキング`: sorts by `day_earned DESC, clicks ASC, user_id ASC` (`today`) or `earned_total DESC, clicks ASC, user_id ASC` (`total`), top 10 + caller's own rank if outside top 10.

---

## 5. Verbatim Japanese Strings

| Key ID | Verbatim Japanese String | Source |
|---|---|---|
| `labor.cmd.group_desc` | `⛏ ペリカが尽きたときの、地下の仕事` | `cogs/labor/cog.py:44` |
| `labor.cmd.work_desc` | `ボタンを押して稼ぐ（元手は0）。稼いだら、作業員を雇って放置でも稼ぐ` | `cogs/labor/cog.py:46` |
| `labor.cmd.ranking_desc` | `⛏ 採掘ランキング（稼いだペリカの多い順）` | `cogs/labor/cog.py:64` |
| `labor.view.not_owner` | `` これは他の人の作業場です。`/地下 作業` で自分の作業場を開けます。 `` | `cogs/labor/views.py:25` |
| `labor.embed.title` | `⛏ 地下作業` | `cogs/labor/embeds.py:53` |
| `labor.embed.default_note` | `「働く」を押すと、ペリカが貯まります。` | `cogs/labor/embeds.py:53` |
| `labor.embed.capped_note` | `（上限に達しました。{pay}ペリカずつ）` | `cogs/labor/embeds.py:65` |
| `labor.embed.footer` | `🪨 今日の地層: {terrain}\n疲労は時間で回復します。「受け取る」で、貯まった分をまとめて手元に移します。\n総寄付金額：{donated_all:,}ペリカ` | `cogs/labor/embeds.py:102-104` |
| `labor.hire.title` | `👷 作業員の雇用` | `cogs/labor/embeds.py:114` |
| `labor.hire.default_desc` | `雇った作業員は、放置で働き、1時間ごとに鉱石を掘ります。レア鉱石を引けば、大きく黒字です。` | `cogs/labor/embeds.py:117` |
| `labor.hire.full_warn` | `⚠ 人数がいっぱいです。寮を強化するか、誰かを解雇しよう。` | `cogs/labor/embeds.py:112` |
| `labor.hire.footer` | `契約は{days}日ごと。作業員の稼ぎだけでは赤字で、平均でも契約料に届きません。当たり次第です。貯まるのは最大{hours:.0f}時間分。` | `cogs/labor/embeds.py:145` |
| `labor.action.too_fast` | `押すのが早すぎます。` | `infra/db/labor.py:371` |
| `labor.action.crit` | `💥 鉱脈ヒット！！ ⛏ **+{pay:,}**` | `cogs/labor/views.py:155-157` |
| `labor.action.crit_ore` | `（さらに {mark}{name} も！）` | `cogs/labor/views.py:159` |
| `labor.action.combo` | `🔥 {size}回コンボ！（+{bonus:.0%}）` | `cogs/labor/views.py:161` |
| `labor.action.drink_ok` | `🥤 ぐいっと飲んだ。疲労が {recover:.0f} 回復した！` | `cogs/labor/views.py:168` |
| `labor.action.collect_ok` | `💰 **{amount:,}** ペリカを、まとめて手元に移しました。` | `cogs/labor/views.py:174` |
| `labor.action.collect_skim` | `🎗️ ピンハネされた **{skimmed:,}** ペリカは、慈善団体に寄付されます` | `cogs/labor/views.py:176` |
| `labor.action.big_find` | `🎉 {mention} の作業員が、**{label}** を掘り当てた！` | `cogs/labor/views.py:185,190` |
| `labor.action.hired` | `{mark} **{name}** を雇った！` | `cogs/labor/views.py:205` |
| `labor.action.dismissed` | `**{name}** を解雇した。` | `cogs/labor/views.py:216` |
| `labor.action.renew_on` | `🔁 自動更新を **オン** にした。契約が切れたら、貯まった稼ぎから契約料を払います。` | `cogs/labor/views.py:224` |
| `labor.action.renew_off` | `🔁 自動更新を **オフ** にした。契約が切れた作業員は、退職します。` | `cogs/labor/views.py:226` |
| `labor.action.dorm_ok` | `🏠 寮を強化した！　雇える人数が増えた。` | `cogs/labor/views.py:232` |
| `labor.action.merge_ok` | `🧬 合体した！　**{mark}{name}** ができた。{buff_text}` | `cogs/labor/views.py:240` |
| `labor.action.upgrade_ok` | `{mark} **{name}** を強化した！（{effect}）` | `cogs/labor/views.py:247` |
| `labor.err.not_tired` | `疲れていません。` | `cogs/shared/messages/games.py:62` |
| `labor.err.no_drink` | `栄養ドリンコを持っていません（ショップの消耗品で買えます）。` | `cogs/shared/messages/games.py:63` |
| `labor.err.unknown_tool` | `そんな工具はありません。` | `cogs/shared/messages/games.py:64` |
| `labor.err.tool_max` | `{tool_name}は、もう最大です。` | `cogs/shared/messages/games.py:65` |
| `labor.err.insufficient_balance` | `ペリカが足りません（{cost:,} 必要）。` | `cogs/shared/messages/games.py:66` |
| `labor.err.unknown_worker` | `そんな作業員はいません。` | `cogs/shared/messages/games.py:67` |
| `labor.err.slots_full` | `人数がいっぱいです（寮を強化するか、誰かを解雇してください）。` | `cogs/shared/messages/games.py:68` |
| `labor.err.hire_insufficient_balance` | `ペリカが足りません（契約料 {cost:,} 必要）。` | `cogs/shared/messages/games.py:69` |
| `labor.err.worker_absent` | `{worker_name}は、いません。` | `cogs/shared/messages/games.py:70` |
| `labor.err.dorm_max` | `寮は、もう最大です。` | `cogs/shared/messages/games.py:71` |
| `labor.ledger.collect` | `地下作業:稼ぎ` | `infra/db/labor.py:244` |
| `labor.ledger.skim` | `慈善団体への寄付（地下作業のピンハネ {skimmed:,}ペリカ）` | `infra/db/labor.py:241` |
| `labor.ledger.renew` | `地下作業:契約の更新` | `infra/db/labor.py:174` |
| `labor.ledger.upgrade` | `地下作業:{tool_name}の強化` | `infra/db/labor.py:521` |
| `labor.ledger.hire` | `地下作業:{worker_name}と契約` | `infra/db/labor.py:541` |
| `labor.ledger.dorm` | `地下作業:寮の強化` | `infra/db/labor.py:576` |
