[English](arena.md) | **日本語**

# 地下闘技場仕様（`arena`）

> 担当：**B2-B** · ゲーム ID：`arena` · 画面 ID：`arena` · 台帳の理由：`arena_bet`、`arena_payout`

## 1. 元ファイル

- `catalogs/arena.yaml`（L1–L36）：スケジュール、戦士プール、基礎パワー、武器の係数、オッズ、上限、観客の賭け、補填
- 元の Python ボット（v1.0.0 より前の git 履歴を参照）。パスはそのフォルダからの相対パスです：
  - `domain/arena.py`（L1–L158）：戦士の生成、武器ボーナス、オッズ、試合のシミュレーション、HP バトルのフレーム、インフレ防止の配当精算を行う純粋なロジック
  - `infra/db/arena.py`（L1–L275）：毎日のトーナメントの流れ、観客の初期ベット、賭け、準決勝と決勝の精算
  - `services/arena.py`（L1–L64）：`ArenaService` のファサード
  - `cogs/arena/cog.py`（L1–L248）：`/闘技場 大会`、30 秒間隔のスケジューラーループ、バトルのアニメーション、管理者用の `host_now`
  - `cogs/arena/embeds.py`（L1–L117）：トーナメント表、HP バー、準決勝・決勝の結果の埋め込み
  - `cogs/arena/views.py`（L1–L108）：`BetPanel`、`FighterSelect`、`StakeModal`
  - `cogs/shared/messages/games.py`（L91–L95）：失敗メッセージ
- `docs/arena.md`（L1–L70）：元の設計ドキュメント

---

## 2. 形式と毎日のスケジュール

各サーバーは、**毎日 2 つの形式を同時に**自動で開催します（トーナメントの行は `(guild_id, day, format)` ごとに別で、`day` はローカル日付の ISO 形式 `YYYY-MM-DD`。`infra/db/arena.py:34-48`）。

| 形式キー | 表示名 | 戦士 | 準決勝 | 決勝 |
|---|---|---|---|---|
| `duel` | `🥊 1on1` | 4 | 2 組 × 2 人 | 1 試合（勝ち上がり 2 人） |
| `royale` | `⚔️ バトルロイヤル` | 16 | 4 組 × 4 人 | 1 試合（勝ち上がり 4 人） |

- **スケジュール**（`catalogs/arena.yaml:1-2`、`cogs/arena/cog.py:83,219-223`）：
  - バックグラウンドのループが **30 秒**ごとに確認します。
  - ローカル日付が変わって最初のティックで（機能 `arena` が有効なら）、両方のトーナメントを `semi_betting` で作って告知します。
  - **`SEMI_HOUR = 9`**（ローカル 09:00）：`tz_hour >= 9` かつ `status == 'semi_betting'` のとき、準決勝の全組を同時に決着させ、状態を `final_betting` にします。
  - **`FINAL_HOUR = 13`**（ローカル 13:00）：`tz_hour >= 13` かつ `status == 'final_betting'` のとき、決勝を決着させ、状態を `done` にします。
- 機能トグル：`arena` が OFF なら新しいトーナメントは作りませんが、作成済みのトーナメントは引き続き進行して精算されます（`cogs/arena/cog.py:200-204`）。

### 状態機械
```
[ semi_betting ] ──(tz_hour >= 9)──► [ final_betting ] ──(tz_hour >= 13)──► [ done ]
  (all fighters stage='semi')         (winners stage='final',                (champion result='won',
                                       losers stage='out', result='lost')     final losers stage='out', result='lost')
```

---

## 3. 戦士、武器、観客の初期ベット

### 3.1 戦士の生成（`domain/arena.py:78-84`、`catalogs/arena.yaml:3-4,19-35`）
- 人数：`group_size(fmt) * semi_groups(fmt)`（`duel` は `4`、`royale` は `16`）。
- 名前は 16 名のカタログ `FIGHTER_NAMES` から重複なしで抽選します：
  `鉄拳のゴウ`、`灼熱のレイジ`、`黒影のクロウ`、`修羅のバキ`、`氷牙のユキ`、`雷鳴のライ`、`鬼哭のオニマル`、`疾風のハヤテ`、`剛腕のゴリウス`、`影狼のシノビ`、`爆砕のデストロ`、`不死身のゾンバ`、`蛇瞳のメデューサ`、`怒髪のバーサーカー`、`無敵のタイタン`、`影帝のシャドウキング`（足りない場合は `f"無名の戦士{n}"`）。
- `base_power = rng.randint(20, 80)`（`BASE_POWER_MIN=20`、`BASE_POWER_MAX=80`）。
- 順番にグループへ割り当てます（`group_no = i // group_size + 1`）。

### 3.2 武器ボーナス（`domain/arena.py:92-101`）
- トーナメント全体で積み上がった賭け金（`bet_total`。観客の賭けと、準決勝・決勝の賭けを両方含む）に応じて、戦士がより強い武器を装備します：
  ```
  weapon_bonus(bet_total) = min(1.0, max(0.0, bet_total) / 50000)   # WEAPON_CAP=1.0, WEAPON_SCALE=50000
  effective_power = base_power * (1 + weapon_bonus(bet_total))
  ```
- 賭け金の合計が 50,000 ペリカ以上になると、最大の `+100%`（`base_power` の `2.0` 倍）に達します。

### 3.3 NPC 観客の初期ベット（`infra/db/arena.py:96-114`、`catalogs/arena.yaml:13-17`）
- トーナメントの作成時に、NPC の観客（`user_id = -5`、`NPC_SPECTATOR`）が、帝愛銀行の現金を元手に準決勝の初期ベットを入れます：
  - トーナメントごとの予算：`topup_left = min(5000, int(bank_cash))`（`HOUSE_TOPUP_MAX = 5000`）。
  - 戦士 1 人あたり：`rng.randint(3, 8)` 回（`SPECTATOR_COUNT = (3, 8)`）、1 回ごとに `rng.randint(100, 3000)`（`SPECTATOR_BET = (100, 3000)`）。
  - `topup_left` を超える抽選結果はスキップします（`continue`）。
  - 使った合計 `spent` は、最後に 1 回だけ `bank.cash` から引きます。
  - 観客の賭けは、当たっても配当されません（精算では `user_id <= 0` を除外）。ただし外れた観客の賭けは `losers_pool` に入り、プレイヤーの利益の原資になります。

---

## 4. オッズ、賭け、シミュレーション

### 4.1 賭けの上限（`catalogs/arena.yaml:11-12`、`infra/db/arena.py:116-146`）
- 1 回の賭け金：**`100`〜`20,000`** ペリカ（`MIN_STAKE`、`MAX_STAKE`）。残高以外に試合ごとの上限はなく、何回でも、複数の戦士にも賭けられます。
- 戦士は、いま受付中の段と合っている必要があります（`semi_betting` 中は `stage == 'semi'`、`final_betting` 中は `stage == 'final'`。`stage == 'out'` は拒否）。
- 競馬と違い、オッズは賭けた時点では**確定しません**。配当には、試合の精算時に計算したオッズ（決着までに積み上がったすべての賭けと武器ボーナスを含む）を使います。

### 4.2 オッズの計算（`domain/arena.py:58-75`）
- `win_weights`：その試合の戦士のあいだで `effective_power(base_power, bet_total)` に比例します（合計 `1.0`）。
- 戦士ごとの基本オッズ：`max(1.0, min(20.0, floor((1 - 0.15) / p * 10) / 10))`（`TAKEOUT = 0.15`、`MAX_ODDS = 20.0`）。
- **決勝ブースト**：決勝の試合では基本オッズに `FINAL_ODDS_BOOST = 1.3` をかけ、`MAX_ODDS = 20.0` で頭打ちにします：
  `min(20.0, _odds(p, 0.15, 20.0) * 1.3)`。
  - 補足：準決勝の期待 RTP は 85% 以下です。決勝ではブーストしたオッズで期待利益の目標が `min(20.0, base * 1.3)` まで上がりますが、下のインフレ防止のプラン上限がかかります。

### 4.3 試合のシミュレーション（`domain/arena.py:104-113`）
- 戦士ごとの重み：`max(0.01, effective_power(base_power, bet_total) * rng.gauss(1.0, 0.25))`（`LUCK = 0.25`）。
- 勝者は `rng.choices(range(len(fighters)), weights=weights, k=1)[0]` で選びます。

### 4.4 インフレ防止の精算（`domain/arena.py:137-157`、`infra/db/arena.py:148-201`）
- `losers_pool` ＝ その試合（`tournament_id, stage`）で負けた戦士に入った `arena_bets.amount` の合計（プレイヤーと NPC 観客の賭けを両方含む）。
- 勝った戦士に賭けた**プレイヤー**（`user_id > 0`）の賭け金 `a` ごとに：
  - 元本 `a` は**必ず返します**。
  - 目標の利益：`profit = max(0, round(a * rate) - a)`。
  - `due = sum(profits)`。
  - `due > losers_pool` なら、帝愛銀行が `subsidy = min(due - losers_pool, min(5000, max(0, int(bank_cash))))` を補填します（`MATCH_SUBSIDY_MAX = 5000`。`bank.cash` から引きます）。
  - `scale = min(1.0, (losers_pool + subsidy) / due)`（`due <= 0` なら `1.0`）。
  - 賭けごとに支払う利益：`round(profit * scale)`。支払総額：`a + paid_profit`。
  - 台帳の記録：`闘技場:勝利の配当`、`income = max(0, pay - a)`。
  - 余り `leftover = max(0, losers_pool + subsidy - sum(paid))` のうち、`int(leftover * teiai.LOSS_SHARE)`（20%）を帝愛銀行の収入にします（`infra/db/arena.py:191-194`）。
  - **注**：闘技場の賭けは、カジノゲームや競馬の賭けと違い、`infra/db/arena.py` では `users.games_played` / `total_wagered` を増やしません。

---

### 4.5 準優勝（リマスターでの追加、マイグレーション 0011）

旧版の結果テキストには決勝の他の戦士を出す枠（`arena.result.final_body`）がありましたが、保存されていたのは優勝者だけでした。リマスターでは、本当の 2 位を保存します。

- 決勝を精算するとき、優勝者に負けた戦士のあいだで同じ重み付きの試合（4.3）を行って 2 位を決め、`champion_id` と一緒に `arena_tournaments.runner_up_id`（そのトーナメントの `arena_fighters.id`）に保存します。
- トーナメントの開催中は `NULL` です。マイグレーション 0011 より前に終わったトーナメントも `NULL` のままです（2 位は保存されていませんでした）。それらは優勝者だけを表示します。
- 賭け、オッズ、配当は一切変わりません。賭けは 4.4 のとおり、各試合の勝者に対して精算されます。見た目と履歴のためのものです。
- Activity API では `ArenaTournament.runnerUpId` として渡され、闘技場画面の結果行と、チャットのトーナメント埋め込み（`bot.arena.runnerUp`）に、英語と日本語で表示されます。

---

## 5. アニメーション（`domain/arena.py:116-134`、`cogs/arena/cog.py:33-34,105-119`）
- 見た目だけです（勝者はすでに決着済み）：`ANIM_FRAMES = 6`（HP 100 から始めて全 `7` フレーム）、`ANIM_STEP = 1.2s`。
- 1 ステップごとに、勝者は `uniform(0, 10)` ずつ減ります（`>= 20.0` を下限に固定）。敗者は `uniform(12, 25)` ずつ減ります（`>= 0.0` を下限に固定）。最後のフレームで敗者は強制的に `0` にします。
- HP バーは 10 ブロックで描きます（`🟥` / `⬛`）。

---

## 6. 日本語文言（原文のまま）

| キー ID | 日本語文言（原文） | 出典 |
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
