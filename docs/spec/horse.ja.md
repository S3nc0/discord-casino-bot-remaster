[English](horse.md) | **日本語**

# 競馬仕様（`horse`）

> 担当：**B2-B** · ゲーム ID：`horse` · 画面 ID：`horse` · 台帳の理由：`horse_bet`、`horse_payout`、`horse_entry_fee`、`horse_prize`、`horse_retire`（注：`packages/shared/src/ledger.ts` の `horse_upkeep` に対応する旧版の仕組みはありません。旧版には定期的な維持費がありません）

## 1. 元ファイル

- `catalogs/horse.yaml`（L1–L175）：能力、毛色、勝負服、コース、馬場状態、調子、脚質、オッズ、重賞、賞金、スケジュール、引退、NPC の名前、使えない文字
- `legacy/python/domain/horse.py`（L1–L523）：純粋なドメインルール、能力の検証と変更、シミュレーションエンジン、オッズの計算、配当、スケジュール、引退
- `legacy/python/infra/db/horse.py`（L1–L253）：厩舎の CRUD、にんじんと黄金のにんじん、脚質、引退、破産時の差し押さえとオークション
- `legacy/python/infra/db/race.py`（L1–L532）：レースのスケジュール、出走登録と取り消し、登録の締め切りと NPC の補充、オッズの保存、賭け、精算
- `legacy/python/services/horse.py`（L1–L165）：`HorseDesk` / `HorseService` のファサード
- `legacy/python/cogs/horse/cog.py`（L1–L423）：`/競馬` のスラッシュコマンド、5 秒間隔のバックグラウンドループ、レースのアニメーション、実況、結果の埋め込み
- `legacy/python/cogs/horse/cards.py`（L1–L163）：出馬表の埋め込みと、永続の `RaceButton`
- `legacy/python/cogs/horse/betting.py`（L1–L269）：`BetPanel` と `StakeModal`
- `legacy/python/cogs/horse/stable.py`（L1–L449）：`Stable`、`NameModal`、`AppearanceView`、`StyleView`、`GoldCarrotView`、`RetireView`
- `legacy/python/cogs/shared/horse_display.py`（L1–L13）：能力バーの整形
- `legacy/python/cogs/shared/messages/games.py`（L11–L57、L105–L107）：失敗メッセージ
- `docs/horse.md`（L1–L104）：元の設計ドキュメント

> **配合について**：旧 Python には**配合の仕組みがありません**。馬を手に入れる方法は、ショップの `horse_voucher` を使うか（または帝愛オークションやプレイヤーマーケットで、差し押さえられた馬を買うか）だけです。育成は `carrot` と `gold_carrot` で行い、手動で、または 32 戦で自動で引退します。
> **ドキュメントと文言のずれ**：`cogs/horse/cog.py:188` のコマンドの説明は `毎日2回` ですが（古い文言の名残）、`catalogs/horse.yaml:107-108` では**平日は 1 日 5 レース**、**週末は 1 日 4 レース**です。

---

## 2. 馬の所有、能力、育成

### 2.1 入手と上限
- 1 人がサーバーごとに持てる馬の最大数：**`MAX_HORSES = 3`**（`catalogs/horse.yaml:29`）。進行中の P2P マーケットの出品も数えます（`horse_count_for`、`infra/db/horse.py:43-52`）。
- `horse_voucher`（`競走馬（購入券）`、ショップ価格 **30,000** ペリカ。`catalogs/shop.yaml:192`、`infra/db/horse.py:20,75`）を 1 枚消費します。
- 名前のルール（`domain/horse.py:513-522`）：前後の空白を除き、空でなく、`len <= 12`（`NAME_MAX = 12`）。`"@<>`*_~|\\\n\r\t#:/"` のどの文字も、部分文字列 `"http"`（大文字小文字を区別しない）も含められません。
- 見た目の選択肢（`catalogs/horse.yaml:31-32`）：
  - `COATS`：`["栗毛", "鹿毛", "黒鹿毛", "青毛", "芦毛", "白毛", "栃栗毛", "月毛"]`
  - `SILKS`：`["🟥", "🟧", "🟨", "🟩", "🟦", "🟪", "⬛", "⬜", "🟫"]`

### 2.2 能力とにんじん
- 4 つの能力（`catalogs/horse.yaml:2-25`）：`speed`（`スピード`）、`stamina`（`スタミナ`）、`power`（`パワー`）、`guts`（`根性`）。
- 作成時の既定：`{speed: 50, stamina: 50, power: 50, guts: 50}`、基本の合計は `STAT_TOTAL = 200`。
- 範囲：`STAT_MIN = 20`、`STAT_MAX = 80`。
- **通常のにんじん（`carrot`）**（`domain/horse.py:165-177`、`infra/db/horse.py:97-113`）：
  - `carrot` を 1 本消費します。`src` から `dst` へ **`CARROT_POINTS = 5`** ポイントを移します（`src != dst`）。
  - `stats[src] - 5 < 20` または `stats[dst] + 5 > 80` なら失敗します。能力の合計は変わりません。
- **黄金のにんじん（`gold_carrot`）**（`domain/horse.py:152-162`、`infra/db/horse.py:159-184`）：
  - `gold_carrot` を 1 本消費します。`first` に **`GOLD_CARROT_POINTS = 5`**、`second` に `+5` を足します（同じ能力を選んで `+10` にもできます）。合計は `+10` 増えます。
  - 1 頭あたりの上限：**`GOLD_CARROT_MAX = 1`**（`horses.bonus >= 1 * 2 * 5 = 10` で管理）。
  - 結果の能力が `> 80` になるなら失敗します。

### 2.3 脚質（`脚質`）
- 4 つの脚質（`catalogs/horse.yaml:63-83`）：
  | キー | 名前 | アイコン | 序盤（`p < 0.35`） | 終盤（`p >= 0.70`） | 自動で決まる条件の能力 |
  |---|---|---|---|---|---|
  | `nige` | `逃げ` | `🏃` | `+0.025` | `-0.015` | `speed` |
  | `senko` | `先行` | `🚶` | `+0.012` | `0.000` | `power` |
  | `sashi` | `差し` | `🎯` | `-0.010` | `+0.018` | `stamina` |
  | `oikomi` | `追込` | `💨` | `-0.022` | `+0.030` | `guts` |
- 既定は `style = None`（自動）。`style_of(stats)` は、最も高い能力を選び、同点なら `speed → stamina → power → guts`（`STAT_KEYS` の添字順、`domain/horse.py:124-127`）で決めます。
- オーナーは、いつでも明示的に脚質を設定するか、`None`（`auto`）に戻せます。スナップショットは、登録の締め切りの時点でコピーされます（`infra/db/race.py:215`）。

### 2.4 引退と差し押さえ
- **引退の価値**（`domain/horse.py:139-149`）：
  ```
  value = wins * 5000 + max(0, places - wins) * 2000 - max(0, races - places) * 2000
  retire_value = clamp(value, -20000, +60000)
  ```
  （`RETIRE_WIN=5000`、`RETIRE_PLACE=2000`、`RETIRE_LOSS=2000`、`RETIRE_MAX=60000`、`RETIRE_FEE_MAX=20000`）。
  - 価値がプラスならオーナーに払い出します（`income=value`）。マイナスならオーナーが費用を払います（手動の引退は `balance < -value` なら失敗します。32 戦での自動引退は、残高がマイナスになっても費用がかかります）。
  - 引退した馬は `owner_id = -2` になります。`entry` か `betting` のレースに登録されている間は、手動で引退できません（`infra/db/horse.py:125-131`）。
- **強制引退**：**`MAX_RACES = 32`** 戦を走ったあと、レースの精算で自動的に引退します（`infra/db/race.py:476-488`）。
- **資産の評価**（`infra/db/horse.py:58-60`）：`horse_worth = max(0, 30000 + retire_value(races, wins, places))`。
- **破産時の差し押さえ**（`infra/db/horse.py:186-202`）：`owner_id = -1, listed_at = now` にし、締め切り前の登録（`lane < 0`。出走料は返金しません）を削除し、抽選済みの `entry`／`betting` の登録を NPC に変え（`owner_id=0, horse_id=0`）、`count * 30000` の差し押さえの入金を返します。帝愛オークションで `max(1, round(30000 * teiai.auction_rate(listed_at, now)))` の価格で、カタギだけに売られます（`infra/db/horse.py:222-252`）。

---

## 3. スケジュールとレースの状態機械

### 3.1 スケジュール（`catalogs/horse.yaml:107-111`、`domain/horse.py:468-481`）
- ローカルのタイムゾーン（サーバーまたは Bot の `tz_hours`、既定は JST の UTC+9）：
  - **平日（月〜金）**：1 日 5 レース、**`09:00, 12:00, 15:00, 18:00, 21:00`**。
  - **週末（土・日）**：1 日 4 レース、**`09:00, 13:00, 17:00, 21:00`**。
  - **重賞（`🏆重賞`）**：ローカルの `start_at.hour == 21` のすべての `regular` レース（`MAJOR_HOUR = 21`、`domain/horse.py:63-66`）。
- `start_at` を基準にした流れ：
  - 出走受付の開始：`start_at - 120 min`（`ENTRY_OPEN_MIN = 120`）。
  - 出走受付の締め切りとオッズの公開：`start_at - 60 min`（`ENTRY_LEAD_MIN = 60`）。
  - 馬券の締め切り：`start_at - 120 sec`（`BET_LEAD_SEC = 120`）。
  - レースの実行と精算：`start_at`。
- **特別レース（`kind='special'`、管理者が作成）**（`infra/db/race.py:103-114`）：
  - `entry_close = now + entry_min * 60`
  - `bet_close = entry_close + bet_min * 60`
  - `start_at = bet_close + 120`（`BET_LEAD_SEC`）
- バックグラウンドのティックは **5 秒**ごとに動きます（`cogs/horse/cog.py:369`）。機能 `horse` が無効なら、新しい通常レースは作りませんが、すでに開いているレースは通常どおり終わります（`cogs/horse/cog.py:386-388`）。

### 3.2 状態機械
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

## 4. 出走登録、NPC の補充、コース、調子

### 4.1 出走登録のルール（`infra/db/race.py:134-192`）
- 出走料：**`ENTRY_FEE = 1,000`** ペリカ（`entry_close` の前に取り消せば、全額返金）。
- 制限：
  - 1 人につき 1 レース 1 頭（`race_one_horse_per_owner`）。
  - 登録できるのは最大 `FIELD_SIZE = 8` 頭（`race_field_full`）。
  - 同じレースに、同じ名前の馬は登録できません（`race_duplicate_name`）。
  - 馬は `races < 32` である必要があります（`horse_retired_by_age`）。
  - 通常レースは、すでに開いている `regular` レースに登録済みの馬を拒否します（`race_horse_busy`）。`special` のレースはこの確認を通りません（`infra/db/race.py:154-164`）。

### 4.2 登録の締め切りと NPC の生成（`infra/db/race.py:194-258`、`domain/horse.py:180-203,332-337`）
- 登録された各馬の、現在の能力、戦績 `(races, wins, places)`、`style` をコピーします。
- 残りの枠を `FIELD_SIZE = 8` まで NPC の馬（`horse_id=0, owner_id=0, style=None`）で埋めます：
  - **名前**：すでに使われた名前を除いた、30 の `NPC_NAMES` からシャッフルして選びます（足りない場合は `f"帝愛{len(rows)}号"`）。
  - **能力（`random_stats`）**：`raw = [rng.random() ** 3.0 + 0.08 for _ in 4]` を引き、`STAT_MIN=20` を超える分を `unit=5` 刻みで `STAT_TOTAL=200` に合わせてスケールし、合計がちょうど `200` になるよう `vals[0]` を調整します。すべての能力が `[20, 80]` に収まるまでやり直します。
  - **勝負服**：ここまででいちばん使われていない色から、ランダムに選びます。**毛色**：`COATS` から一様にランダムです。
  - **擬似的な NPC の戦績（`npc_record`）**：`races = rng.randint(0, 12)`、`wins = Binomial(races, 1/8)`、`places = wins + Binomial(races - wins, 2/7)`。
- 8 頭すべてを枠番 `1..8` にシャッフルします。
- **調子（`random_form`）**：`1 (◎)`、`0 (○)`、`-1 (△)` を、重み `[2, 5, 2]`（2/9、5/9、2/9）で選びます。
- **コース（`random_track`）**：
  - 距離：`[1000, 1200, 1600, 1800, 2000, 2400, 3000]` m から一様に選びます。
  - 馬場状態：`良`（60、ペナルティ 0.0）、`稍重`（25、ペナルティ 0.012）、`重`（11、ペナルティ 0.03）、`不良`（4、ペナルティ 0.05）から重み付きで選びます。

---

## 5. シミュレーションエンジン（`domain/horse.py:206-286`）

- 定数：`TICKS = 60`、`MAX_TICKS = 140`、`FATIGUE_MAX = 0.22`、`NOISE = 0.03`、`LUCK = 0.03`、`PACE_FACTOR = 0.05`。
- 各出走馬 `i` についての、レース前の抽選：
  - `luck[i] = rng.gauss(0, 0.03)`
  - `spurt[i] = max(0.0, (guts - 20) / 60 * 0.12 * rng.uniform(0.5, 1.5))`
  - `pace = count(style in ('nige', 'senko')) / n`、`pace_shift = (pace - 0.5) * 0.05`。
- ティックごとの倍率 `_mult(r, p, track, luck, spurt, style, pace_shift)`：
  1. スピード：`m = 1 + (speed - 50) / 50 * min(0.09, 0.042 * 1800 / distance)`
  2. 序盤の加速（パワー）：`m *= 1 + (power - 50) / 50 * 0.10 * max(0.0, 1 - p / 0.3)`
  3. スタミナと疲労：`reach = min(1.0, max(0.25, 0.8 * (stamina / 50) / (distance / 1800)))`。`p > reach` かつ `reach < 1.0` なら：
     - `fatigue = 0.22 * (p - reach) / (1 - reach)`
     - `m *= (1 - fatigue) * (1 + min(spurt, fatigue))`
  4. 脚質の曲線（`style_curve`）：
     - `p < 0.35`：`STYLE_EARLY[style] - (pace_shift if style in ('nige','senko') else 0)`
     - `p >= 0.70`：`STYLE_LATE[style] + (pace_shift if style in ('sashi','oikomi') else 0)`
     - `0.35 <= p < 0.70`：`STYLE_EARLY` と `STYLE_LATE` の線形補間（`t = (p - 0.35) / 0.35`。`pace_shift` なし）。
     - `m *= 1 + style_curve(...)`
  5. 馬場のペナルティ：`m *= 1 - GOING_PENALTY[going] * (1 - (power - 20) / 60)`
  6. 調子とレースの運：`m *= FORM_MULT[form] * (1 + luck)`（`◎: 1.015`、`○: 1.0`、`△: 0.985`）。
- ティック `t in 1..140` での進み：`step = _mult(...) * (1 + rng.gauss(0, 0.03)) / 60`、`new = pos[i] + max(0.0, step)`。
- `new >= 1.0` になったら、補間したゴールのタイムは `t - 1 + (1.0 - pos[i]) / max(1e-9, new - pos[i])` で、`pos[i] = 1.0` にします。全頭がゴールしたら、早めに止めます。
- ゴールしなかった馬のタイム：`140 + (1 - pos[i])`。同着の決め方：`(final_times[i], rng.random())`。

---

## 6. オッズ、賭け、配当

### 6.1 オッズの式（`domain/horse.py:326-465`）
- **戦績にもとづく勝率（`_win_weights`）**：
  - `ability_share[i] = sum_stats[i] / sum(sum_stats)`
  - `prior[i] = 0.3 * ability_share[i] + 0.7 * (1 / n)`（`ABILITY_PRIOR_WEIGHT = 0.3`）
  - `p = (wins + 4 * prior[i]) / (races + 4)`（`RECORD_PRIOR_RUNS = 4`）
  - `races == 0` なら：`p *= 0.75`（`FIRST_RUN_FACTOR = 0.75`）。
  - `raw[i] = p * FORM_ODDS[form]`（`◎: 1.15`、`○: 1.0`、`△: 0.85`）を、合計が 1 になるよう正規化します。
- **戦績にもとづく複勝率（`_place_probs`）**：同じ方法で、`flat = min(3, n) / n`、`prior = 0.3 * (share * min(3, n)) + 0.7 * flat` とし、合計が `min(3, n)` になるよう正規化し、`PLACE_CAP = 0.95` で頭打ちにします。
- **シミュレーションとの混合（`_blended_probs`）**：`estimate(runners, track, sims=600, seed=0)`（**シードは 0 で固定**）を走らせ、`0.7 * sim_prob + 0.3 * record_prob` で混ぜます（`ODDS_SIM_WEIGHT = 0.7`。複勝は `0.95` で頭打ち）。
- **オッズへの換算（`_odds`）**：`max(1.0, min(cap, floor((1 - takeout) / prob * 10) / 10))`。
  - 単式（`win`、`place`）：`TAKEOUT = 0.15`、`MAX_ODDS = 99.9`（期待 RTP は約 **85%**）。
  - 組み合わせ（`quinella`、`wide`、`exacta`、`trio`）：混合した `win_probs` からの Harville の式、`COMBO_TAKEOUT = 0.20`、`MAX_COMBO_ODDS = 100.0`（期待 RTP は約 **80%**）。
- **固定オッズ**：馬券を買った時点で確定します（`make_all_odds` は、登録の締め切りで 1 回だけ計算します）。

### 6.2 馬券の種類と上限（`catalogs/horse.yaml:91-93,113-128`、`infra/db/race.py:307-409`）
| 種類 | 日本語 | 選ぶ数 | キーの形式 | 的中の条件 | UI での複数選択 |
|---|---|---|---|---|---|
| `win` | `単勝` | 1 | `lane` | `lane == order[0]` | できる（それぞれに `stake`） |
| `place` | `複勝` | 1 | `lane` | `lane in order[:3]` | できる（それぞれに `stake`） |
| `quinella` | `馬連` | 2（順不同） | `"a-b"`（`a<b`） | `set(picks) == set(order[:2])` | できない |
| `wide` | `ワイド` | 2（順不同） | `"a-b"`（`a<b`） | `set(picks) <= set(order[:3])` | できない |
| `exacta` | `馬単` | 2（順番どおり） | `"a>b"` | `picks == order[:2]` | できない |
| `trio` | `三連複` | 3（順不同） | `"a-b-c"` | `set(picks) == set(order[:3])` | できない |

- 馬券 1 枚あたりの賭け金：**`100`〜`50,000`** ペリカ（`MIN_STAKE`、`MAX_STAKE`）。
- 1 レースで 1 人が賭けられる合計：**`150,000`** ペリカ（`MAX_RACE_STAKE`）。
- 的中したときの配当：**`int(stake * odds)`**（`domain/horse.py:464-465`）。
- 外れた賭け金のうち `int(total_lost * teiai.LOSS_SHARE)`（20%）は、帝愛銀行の収入になります（`infra/db/race.py:516-518`）。
- 統計の更新：賭けた時点で `total_wagered += stake`。精算のとき、馬券ごとに `games_played += 1`、`total_won += pay`、`biggest_win = max(biggest_win, pay - stake)`（`infra/db/race.py:352-355,509-513`）。

### 6.3 オーナーの賞金（`domain/horse.py:55-78`、`infra/db/race.py:423-475`）
- 基本の賞金表（1 着／2 着／3 着）：
  - 通常レース：**`[12,000, 5,000, 2,000]`**
  - 重賞（21:00 の通常レース）：**`[24,000, 10,000, 4,000]`**
- **インフレ防止の賞金プールの調整**：
  - `real_entries` ＝ そのレースにいるプレイヤーの馬の数、`placed_total` ＝ 1〜3 着に入ったプレイヤーの馬の、賞金表の賞金の合計とします。
  - 重賞だけ：`placed_total > real_entries * 1000` なら、帝愛銀行の現金が `topup = min(shortfall, int(bank_cash), 10000)` を補填します（`MAJOR_HOUSE_TOPUP = 10000`）。
  - `scale = min(1.0, (real_entries * 1000 + topup) / placed_total)`。
  - 3 着以内に入った各プレイヤーの馬は `prize = round(table[place-1] * scale)` を受け取り、さらに発掘品の `prize` バフ（竜の涙）で `round(prize * (1 + relic_buffs.get("prize", 0.0)))` に増え、そのあと `teiai.HORSE_PRIZE_SKIM_RATE`（`catalogs/teiai.yaml:4` では `0.0`）でピンハネされます。

---

## 7. アニメーションと実況（`cogs/horse/cog.py:34-124`）
- `TRACK_W = 22`、`STEP = 1.4s`、`GAP_ZOOM = 3.0`、`anim_frames(distance) = max(8, round(24 * distance / 1800))`、`laps = max(1, distance // 1000)`。
- `display_frames` は、勝者が `1.0` を越えたところで切り、先頭との差を `3.0` 倍に単調に拡大し、最後のフレームをゴールのタイム差で調整します。
- 季節スキン：`owner_id == 0` なら、`skins.house_horse_icon(now)`（たとえばクリスマス中の `🦌`）が `🐎` を置き換えます。

---

## 8. 日本語文言（原文のまま）

| キー ID | 日本語文言（原文） | 出典 |
|---|---|---|
| `horse.cmd.group_desc` | `🏇 競走馬を育てて走らせる・馬券を買う（毎日2回）` | `cogs/horse/cog.py:188` |
| `horse.cmd.stable_desc` | `自分の馬・ステータスの配分・出走の申し込み` | `cogs/horse/cog.py:217` |
| `horse.cmd.card_desc` | `いまのレースの出馬表・オッズ（馬券もここから）` | `cogs/horse/cog.py:226` |
| `horse.announce.entry_open` | `🏇 **競馬** の出走申し込みが始まりました！` | `cogs/horse/cog.py:288` |
| `horse.announce.odds_ready` | `🏇 **出馬表とオッズが出ました！** 馬券は、発走の2分前まで買えます。` | `cogs/horse/cog.py:322` |
| `horse.card.no_open_race` | `いま、開催中のレースはありません。次の発走は <t:{ts}:t>（<t:{ts}:R>）です。` | `cogs/horse/cog.py:235` |
| `horse.card.race_title` | `🏇 第{num}競走{tag}`（`tag`：`（臨時）` / `🏆重賞` / `""`） | `cogs/horse/cards.py:33-34` |
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
| `horse.ledger.retire` | `競馬:引退{金|費用}（{name}）` / `競馬:定年引退{金|費用}（{name}）` | `infra/db/horse.py:142`、`infra/db/race.py:484` |
