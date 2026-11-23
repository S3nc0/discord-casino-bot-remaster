[English](labor.md) | **日本語**

# 地下労働仕様（`labor`）

> 担当：**B2-B** · 画面 ID：`work` · 台帳の理由：`work_collect`、`work_upgrade`、`work_hire`、`work_dorm`

## 1. 元ファイル

- `catalogs/labor.yaml`（L1–L178）：工具、クリックの上限、疲労、クリティカル、地形、ワーカー、鉱石、発掘品、寮、マクロ対策の閾値
- `catalogs/teiai.yaml`（L3）：`labor_skim_rate: 0.03`（受け取り時の帝愛のピンハネ 3%）
- 元の Python ボット（v1.0.0 より前の git 履歴を参照）。パスはそのフォルダからの相対パスです：
  - `domain/labor.py`（L1–L421）：純粋なクリッカーの計算、地形、クリティカル、ワーカーの精算、鉱石と発掘品の抽選、マクロ対策の CV の検出
  - `infra/db/labor.py`（L1–L590）：`LaborRepo` の永続化、クリック、受け取り、ドリンク、強化、雇用と解雇、寮、更新、ランキング、クリックの時間別ログ
  - `services/labor.py`（L1–L67）：`LaborService` のファサード
  - `cogs/labor/cog.py`（L1–L80）：`/地下 作業` と `/地下 ランキング`
  - `cogs/labor/embeds.py`（L1–L168）：作業パネル、雇用パネル、採掘ランキングの埋め込み
  - `cogs/labor/views.py`（L1–L253）：`LaborView` の対話型のタブとボタン
  - `cogs/shared/messages/games.py`（L62–L71）：失敗メッセージ
- `docs/labor.md`（L1–L118）：元の設計ドキュメント

> **ドキュメントのずれ**：`docs/teiai.md:46` は労働のピンハネを 1% としていますが、`catalogs/teiai.yaml:3` と `docs/labor.md:18` は **`labor_skim_rate = 0.03`（3%）** です。`catalogs/teiai.yaml:3`（3%）に従います。

---

## 2. クリッカーの仕組み（手掘り）

### 2.1 報酬、疲労、回復（`domain/labor.py:18-90`、`catalogs/labor.yaml:2-29`）
- **クリックのクールダウン**：`CLICK_INTERVAL = 1.0` 秒（`now - last_click < 1.0` なら、黙って失敗します：`"押すのが早すぎます。"`）。
- **工具**（`MAX_LEVEL = 10`、レベル `0..10`）：
  - `pick`（`⛏ ツルハシ`）：`pay_per_click(pick) = 10 + 4 * clamp_level(pick)`（`BASE_PAY = 10`、`PAY_PER_LEVEL = 4`。Lv0 ＝ `10`、Lv10 ＝ `50`）。
  - `glove`（`🧤 手袋`）：クリックごとの疲労の増え方を減らします：
    ```
    early = min(glove, 5)
    fatigue_gain(glove) = 3.0 - 0.4 * early - 0.1 * (glove - early)
    ```
    （Lv0 ＝ `3.0`、Lv5 ＝ `1.0`、Lv10 ＝ `0.5`）。
  - 強化の費用（`UPGRADE_COST`。2 つの工具で同じ表、`catalogs/labor.yaml:13`）：
    `[150, 400, 900, 1800, 3500, 7000, 14000, 28000, 56000, 112000]`（Lv10 までの合計 ＝ `223,750`）。
- **疲労（`0.0`〜`100.0`）**：
  - 自然回復：`RECOVER_PER_SEC = 0.1`/秒（`fatigue_now = clamp(fatigue - dt * 0.1 * (1 + recovery_buff), 0, 100)`。`recovery_buff` は `relic_vase` から）。
  - 報酬の倍率：`pay_rate(fatigue) = 1.0 - 0.8 * (fatigue / 100.0)`（`MIN_PAY_RATE = 0.2`。`100%` から `20%` まで）。
  - クリックの基本報酬：`click_pay(pick, fatigue) = max(1, round(pay_per_click(pick) * pay_rate(fatigue)))`。
  - 発掘品の `click` バフ（`relic_fossil`）：`pay = max(1, relics.chance_round(base_pay * (1 + click_buff)))`。
  - 疲労のラベル（`cogs/labor/embeds.py:10-11`）：`<25`：`元気`、`<50`：`ふつう`、`<75`：`疲れ気味`、`>=75`：`ぐったり`。
- **栄養ドリンク（`labor_drink` / 栄養ドリンコ）**：
  - `fatigue < 1`（`labor_not_tired`）か、持ち物にないとき（`labor_no_drink`）は失敗します。
  - 1 本を消費し、疲労を `DRINK_RECOVER = 60.0` 減らします（`0.0` で止めます）。

### 2.2 1 日のクリック上限、クリティカル、コンボ、毎日の地形（`domain/labor.py:92-140`、`infra/db/labor.py:372-419`）
- **1 日のクリック上限**：`MAX_CLICKS_PER_DAY = 500`（ローカル日付 `day` が変わるとリセット）。
  - `day_click >= 500` または `auto_click_suspected` が True なら、クリックの報酬は `OVER_CAP_PAY = 1` になり、クリティカル、鉱石、コンボはありません。
- **毎日の地形（`terrain_today(day)`）**：`random.Random(f"terrain:{day}").choice(["hit", "fatigue", "silver", "none"])` から決まり、全サーバー・全ユーザーで共通です：
  - `hit`：`⛏ 鉱脈ヒット率 +5%`（`TERRAIN_HIT_BONUS = 0.05`）
  - `fatigue`：`😌 疲労の溜まりが20%軽い`（`TERRAIN_FATIGUE_CUT = 0.20`。疲労の増え方に `0.80` をかけます）
  - `silver`：`⚪ 銀が2倍出やすい（手掘り）`（`TERRAIN_SILVER_MULT = 2`。クリティカルの鉱石抽選で、銀の重みを 2 倍にします）
  - `none`：`特になし`
- **鉱脈ヒット（`鉱脈ヒット`）**：
  - 確率：`min(0.30, 0.05 + 0.01 * pick + 0.002 * active_workers + (0.05 if terrain == 'hit' else 0))`（`CRIT_BASE=0.05`、`CRIT_PER_LEVEL=0.01`、`CRIT_WORKER_BONUS=0.002`、`CRIT_MAX=0.30`）。
  - クリティカルのとき：`pay *= 5`（`CRIT_MULT = 5`）。
  - 2 回目の鉱石の抽選（`CRIT_ORE_CHANCE = 0.15`）：`CRIT_ORES` から重み付きで鉱石を選びます（`coal` w=45 v=3、`copper` w=40 v=60、`silver` w=12［`silver` の地形では ×2］v=240、`gold` w=3 v=1200）。鉱石の価値は、すぐに `pay` に足され、`row["ores"]` に記録されます。
- **10 クリックのコンボ**：通算 10 回目のクリックごと（`(clicks + 1) % 10 == 0`、`COMBO_SIZE = 10`）に、`pay = round(pay * 1.20)` をかけます（`COMBO_BONUS = 0.20`）。クリティカルと、クリティカルの鉱石の価値を足した**あと**に適用します。

### 2.3 マクロ対策のクリック監視（`domain/labor.py:358-420`、`infra/db/labor.py:421-455`）
- 1 時間ごとの集計を `labor_click_hours`（`clicks, pay, gaps, sum_gap, sum_gap2, min_gap`）に記録し、`CLICK_LOG_DAYS = 14` 日分を保持します。間隔は `0 < gap <= 600.0`（`CLICK_GAP_MAX`）のものだけ数えます。
- `is_mechanical_hour(h)`：`gaps >= 2` かつ `clicks >= 100`（`MECH_MIN_CLICKS`）かつ `stddev(gap) / mean(gap) < 0.1`（`MECH_CV_MAX`）。
- `auto_click_suspected(rows, current_hour)`：直前に終わった `SUSPECT_HOURS = 3` 時間（`[current_hour - 3, current_hour - 1]`）がすべて機械的なら True です。クリックの報酬を `1` ペリカに抑えます（BAN はしません）。

---

## 3. 放置ワーカー、寮、鉱石、発掘品

### 3.1 ワーカーと寮（`catalogs/labor.yaml:66-98,169-172`、`domain/labor.py:145-206`）
- 寮の定員：`slots(dorm) = 5 + clamp(dorm, 0, 5)`（`SLOTS_BASE = 5`、`DORM_MAX = 5`、最大 `10` 枠）。
- 寮の強化費用（`DORM_COST`）：`[2000, 6000, 15000, 40000, 100000]`（合計 `163,000`）。
- 契約の長さ：**`CONTRACT_DAYS = 1`** 日（`86,400s`）。自動更新の既定は**オン（`renew = 1`）**です。
- 放置の上限：**`STOCK_HOURS = 24.0`** 時間（`min(24.0, (now - idle_at) / 3600.0)`）。

| キー | 名前 | アイコン | 時給（`rate`） | 契約料（1 日） | `ore_power` | `relic_power` | 特記 |
|---|---|---|---|---|---|---|---|
| `apprentice` | `見習い` | `🧒` | `1.8` | `150` | `0.12` | `0.5` | — |
| `miner` | `坑夫` | `👷` | `10.05` | `520` | `0.415` | `0.8` | — |
| `craftsman` | `職人` | `🧑‍🔧` | `23.55` | `1,160` | `0.95` | `1.0` | — |
| `foreman` | `監督` | `🕴️` | `0` | `640` | `0.0` | `0.0` | 監督 1 人につき運 `+25%`（`FOREMAN_LUCK = 0.25`） |

- ワーカーを解雇すると、その `kind` のうち `expires_at` が最も早い 1 人が外れます。契約料は返金**されません**（`infra/db/labor.py:549-561`）。

### 3.2 鉱石と発掘品のドロップ（`catalogs/labor.yaml:98-167`、`domain/labor.py:208-261`）
- ワーカーは、精算のたびに `n = int(hours) + (1 if rng.random() < hours - int(hours) else 0)` 回、抽選します。
- 合算した運：`luck = 0.25 * num_foremen + relic_buffs.get("luck", 0.0)`（`relic_meteor`）。
- **鉱石**（一様な乱数 `x = rng.random()` を 1 回引き、決まった順に累積の区間を引いていきます。`coal` は固定確率 `0.40`、ほかはすべて `ore_power * (1 + luck)` でスケールします）：
  | 順番 | ID | 名前 | アイコン | 基本の `prob` | 価値 | 大きな告知 |
  |---|---|---|---|---|---|---|
  | 1 | `copper` | `銅` | `🟤` | `0.06` | `60` | なし |
  | 2 | `silver` | `銀` | `⚪` | `0.015` | `240` | なし |
  | 3 | `gold` | `金` | `🟡` | `0.003` | `1,200` | なし |
  | 4 | `diamond` | `ダイヤ` | `💎` | `0.0004` | `9,000` | **あり** |
  | 5 | `legend` | `伝説の鉱石` | `🌟` | `0.00004` | `90,000` | **あり** |
  | 6 | `coal` | `石炭` | `⚫` | `0.40`（固定） | `3` | なし |
- **発掘品**（1 時間ごとに別の一様な抽選を行い、`relic_power * (1 + luck)` でスケールします。バフと合成は `docs/spec/relics.ja.md` を参照）：
  | 順番 | ID（`item_id`） | 名前 | アイコン | 基本の `prob` | 参考価値 | 大きな告知 |
  |---|---|---|---|---|---|---|
  | 1 | `fossil`（`relic_fossil`） | `三葉虫の化石` | `🐚` | `0.0033` | `1,500` | なし |
  | 2 | `bone`（`relic_bone`） | `恐竜の骨` | `🦴` | `0.0017` | `4,000` | なし |
  | 3 | `meteor`（`relic_meteor`） | `隕石の欠片` | `☄️` | `0.00067` | `10,000` | なし |
  | 4 | `vase`（`relic_vase`） | `古代文明の壺` | `🏺` | `0.00027` | `25,000` | なし |
  | 5 | `crown`（`relic_crown`） | `王家の黄金冠` | `👑` | `0.000067` | `60,000` | **あり** |
  | 6 | `tear`（`relic_tear`） | `竜の涙` | `🔮` | `0.000017` | `100,000` | **あり** |

### 3.3 放置の精算（`settle_plan`、`domain/labor.py:268-354`）
- 状態を変えるすべての労働の操作の前に、自動で実行されます（`_labor_row`）。
- `idle_at > 0` なら `hours = idle_hours(idle_at, now)`、そうでなければ `0.0`。`start = now - hours * 3600`。
- 契約中のワーカー（`expires_at > now`）は、暫定の賃金 `int(idle_rate(active) * (1 + wage_bonus) * hours)` を `avail_pot = pot + provisional_wage` に足します（`wage_bonus` は `relic_bone` から）。
- 契約が切れたワーカー（`expires_at <= now`）は、`contract_fee` の大きい順に並べます：
  - `renew` が True で `avail_pot + (balance - balance_spent) >= fee` なら、まず `avail_pot` から払い（`pot_spent`）、足りない分はウォレットから払い（`balance_spent`）、`now + 86400` まで更新します。
  - そうでなければ `removed` とします（退職するまで、`max(0.0, min(now, expires_at) - start) / 3600.0` 時間だけ働きます）。
- 残るワーカー（契約中 ＋ 更新済み）は、`hours` の間、賃金を稼ぎ、鉱石と発掘品を掘ります。外れたワーカーは、働いた分の `worked` 時間だけ稼ぎ、掘ります。
- 合計 `gain = int(total_wage) + ore_gain(ores)`。発見の履歴は、ユーザーごとに最新の `FINDS_KEEP = 40` 行を保持します（`labor_finds`。表示では `coal` を除外）。

### 3.4 受け取り（`labor_collect`、`infra/db/labor.py:227-250,457-491`）
- `pot == 0` でも、`relics` が保留中なら受け取れます。
- **帝愛のピンハネ（`labor_skim`）**：`skimmed = round(amount * 0.03)`（`teiai.LABOR_SKIM_RATE = 0.03`、`catalogs/teiai.yaml:3`）。
  - 帝愛の胴元口座に入金し（`house_income_for(gid, skimmed)`）、差額 0 の台帳の行 `"慈善団体への寄付（地下作業のピンハネ {skimmed:,}ペリカ）"` として記録し、`labor.donated` に足します。
- 純額 `amount - skimmed` を、`income = net` でユーザーのウォレットに入金します（ユーザーが債務中なら、債務の自動天引きが発動します）。
- 保留中の `relics` を `inventory` に足し、`labor_finds.collected` を `1` にします。
- 大きな鉱石（`diamond`、`legend`）と大きな発掘品（`crown`、`tear`）は、チャンネルへの公開告知が出ます。

---

## 4. 状態機械とランキング

- 対話型のパネル（`LaborView`、タイムアウト `900s`）：2 つのタブ、`work`（クリック、受け取り、ドリンク、工具の強化、発掘品の合成の選択）と、`hire`（戻る、受け取り、自動更新の切り替え、4 つのワーカーの雇用ボタン、寮の強化、解雇の選択）です。新しく `/地下 作業` を開くと、そのサーバーにある、ユーザーの前のパネルのメッセージを削除します（`cogs/labor/cog.py:50-60`）。
- `/地下 ランキング`：`day_earned DESC, clicks ASC, user_id ASC`（`today`）、または `earned_total DESC, clicks ASC, user_id ASC`（`total`）で並べ、上位 10 人と、上位 10 位より下なら呼び出した本人の順位を出します。

---

## 5. 日本語文言（原文のまま）

| キー ID | 日本語文言（原文） | 出典 |
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
