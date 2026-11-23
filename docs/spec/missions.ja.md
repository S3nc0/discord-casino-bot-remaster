[English](missions.md) | **日本語**

# ミッションと連勝仕様

担当：`B2-B` | 画面 ID：`missions`（`packages/shared/src/ids.ts`） | 機能トグル：なし（カジノゲームと一緒に常に有効）

## 元ファイル
- `catalogs/missions.yaml:1-97`
- `legacy/python/domain/missions.py:1-97`
- `legacy/python/infra/db/records.py:27-116,220-236`
- `legacy/python/services/economy.py:38-45,113-122`
- `legacy/python/cogs/economy/cog.py:43-50,194-200`
- `legacy/python/cogs/economy/embeds.py:154-168`

## ルールと正確な数値

### 毎日のミッションの選び方
- リセットの周期：設定のタイムゾーン（既定は JST、`UTC+9`）の `00:00`。ISO 日付 `YYYY-MM-DD` をキーにします（`domain/missions.py:67`、`services/economy.py:118-121`）。
- 1 日 `PER_DAY = 3` 件のミッションで、すべてのサーバーの全プレイヤーで同じです（`catalogs/missions.yaml:12`、`domain/missions.py:61-70`）。
- 決定論的な RNG のシード：`random.Random(f"mission:{day.isoformat()}")`（`domain/missions.py:67`）。
- 選ぶ枠（`domain/missions.py:68-70`）：
  1. `first`：`rng.choice(UNIVERSAL)`（共通のミッション 8 件）
  2. `second`：`rng.choice(BLACKJACK_MISSIONS)`（ブラックジャックのミッション 4 件。ブラックジャックしか遊ばない人も、1 日に最低 2 件は達成できるようにするため）
  3. `third`：`rng.choice([m for m in POOL if m.id not in (first.id, second.id)])`（残りのプール 21 − 2 = 19 件から 1 件）
- プールの作り方の順番（`domain/missions.py:32-57`。旧版との一致のために重要）：
  `POOL = UNIVERSAL + OTHER_GAMES + BLACKJACK_MISSIONS + [BIG_WIN]`（合計 21 件のミッション）。
  - `GAMES` の順番（`catalogs/missions.yaml:3-8`）：`["スロット", "ルーレット", "チンチロ", "ブラックジャック", "パチンコ"]`。
  - `OTHER_GAMES` は、`play_game` のミッション 4 件（`GAMES` から `"ブラックジャック"` を除いて順番どおり）と、続けて `game_win` のミッション 4 件（同じ順番）を作ります。

### ミッションのプール全体（21 件）
| グループ | ID | 名前（JA） | 種類 | 目標 | 報酬 | ゲーム／タグ |
|---|---|---|---|---:|---:|---|
| `UNIVERSAL` | `play5` | ゲームを5回遊ぶ | `play` | 5 | 300 | — |
| `UNIVERSAL` | `play10` | ゲームを10回遊ぶ | `play` | 10 | 500 | — |
| `UNIVERSAL` | `win3` | 3回勝つ | `win` | 3 | 400 | — |
| `UNIVERSAL` | `win5` | 5回勝つ | `win` | 5 | 600 | — |
| `UNIVERSAL` | `wager5k` | 合計5,000ペリカ賭ける | `wager` | 5,000 | 400 | — |
| `UNIVERSAL` | `wager20k` | 合計20,000ペリカ賭ける | `wager` | 20,000 | 700 | — |
| `UNIVERSAL` | `streak2` | 2連勝する | `streak` | 2 | 400 | — |
| `UNIVERSAL` | `streak3` | 3連勝する | `streak` | 3 | 700 | — |
| `OTHER_GAMES` | `game_スロット` | スロットを3回遊ぶ | `play_game` | 3 | 400 | `スロット` |
| `OTHER_GAMES` | `game_ルーレット` | ルーレットを3回遊ぶ | `play_game` | 3 | 400 | `ルーレット` |
| `OTHER_GAMES` | `game_チンチロ` | チンチロを3回遊ぶ | `play_game` | 3 | 400 | `チンチロ` |
| `OTHER_GAMES` | `game_パチンコ` | パチンコを3回遊ぶ | `play_game` | 3 | 400 | `パチンコ` |
| `OTHER_GAMES` | `gwin_スロット` | スロットで2回勝つ | `game_win` | 2 | 600 | `スロット` |
| `OTHER_GAMES` | `gwin_ルーレット` | ルーレットで2回勝つ | `game_win` | 2 | 600 | `ルーレット` |
| `OTHER_GAMES` | `gwin_チンチロ` | チンチロで2回勝つ | `game_win` | 2 | 600 | `チンチロ` |
| `OTHER_GAMES` | `gwin_パチンコ` | パチンコで2回勝つ | `game_win` | 2 | 600 | `パチンコ` |
| `BLACKJACK_MISSIONS` | `game_ブラックジャック` | ブラックジャックを3回遊ぶ | `play_game` | 3 | 300 | `ブラックジャック` |
| `BLACKJACK_MISSIONS` | `gwin_ブラックジャック` | ブラックジャックで2回勝つ | `game_win` | 2 | 400 | `ブラックジャック` |
| `BLACKJACK_MISSIONS` | `bj_double` | ブラックジャックでダブルダウンに成功する | `tag` | 1 | 600 | `ブラックジャック` / `double_win` |
| `BLACKJACK_MISSIONS` | `bj_natural` | ナチュラルブラックジャックを出す | `tag` | 1 | 700 | `ブラックジャック` / `natural` |
| `BIG_WIN` | `big3x` | 賭け金の3倍以上の利益を1回で出す | `big_win` | 3 | 600 | — |

### 対象の条件、進捗、支払い、上限
- 最低賭け金のゲート：`MIN_BET = 100`（`catalogs/missions.yaml:10`、`infra/db/records.py:46`）。`bet < 100` のプレイでも、全体の `win_streak`、`best_streak`、`plays`、`wins`、`net_total`、`weekly_stats` は更新されますが、`day_streak` と、毎日のミッションは進みません（`infra/db/records.py:42-74`）。
- `progress_after(m, current, game, bet, net, streak, tags)`（`domain/missions.py:73-91`）：
  - `play`：`current + 1`
  - `win`：`current + (1 if net > 0 else 0)`
  - `wager`：`current + bet`
  - `streak`：`max(current, day_streak)`。`day_streak` は日付が変わるとリセットされ（`streak_day != day.isoformat()`）、`net > 0` で増え、`net < 0` で `0` に戻り、`net == 0`（引き分け）ではそのままです（`infra/db/records.py:39-48`）。
  - `big_win`：`max(current, net // bet if net > 0 and bet > 0 else 0)`（純利益を賭け金で割った整数の切り捨て）。
  - `play_game`：`current + (1 if game == m.game else 0)`
  - `game_win`：`current + (1 if game == m.game and net > 0 else 0)`
  - `tag`：`current + (1 if m.tag in tags else 0)`
- 保存する進捗は `min(progress, m.target)` で頭打ちです（`infra/db/records.py:90`）。
- 達成したときの自動の支払い（`infra/db/records.py:92-101`）：
  - 個々のミッションの達成では、`income=m.reward` で `m.reward` を入金します（帝愛の債務の天引きの対象。デイリーのピンハネはなし）。台帳の理由は `f"ミッション報酬:{m.name}"`。
  - `(guild_id, user_id, day)` の `PER_DAY = 3` 件がすべて `done = 1` になったら、`income=500` で `COMPLETE_BONUS = 500` を入金します。台帳の理由は `"ミッション全達成ボーナス"`。
- 達成済み（`done == 1`）のミッションは飛ばすので、報酬と全達成のボーナスは、1 日に最大 1 回しか支払われません（`infra/db/records.py:81-82,95-101`）。

### 連勝とジャックポットの判定
- `play_state` は `(guild_id, user_id)` ごとに、`win_streak`、`best_streak`、`day_streak`、`streak_day`、`plays`、`wins`、`net_total` を持ちます（`infra/db/records.py:51-67`）。
  - `net > 0`：`win_streak += 1`、`net < 0`：`win_streak = 0`、`net == 0`：そのまま。
  - `new_best = streak > best`、`best = max(best, streak)`。
- ジャックポットの補助関数：`is_jackpot(bet, net)` は `bet > 0 and net >= bet * 50` を返します（`jackpot_multiplier: 50`、`catalogs/missions.yaml:96`、`domain/missions.py:94-96`）。カジノの UI で、特別な演出に使います。

## 状態機械と流れ
1. プレイヤーがカジノゲームを終える → `RecordRepo.record_play(user_id, game, bet, net, day, tags)` が、DB のトランザクションで動きます。
2. 無条件で `play_state` と `weekly_stats` を更新します。
3. `bet >= 100` なら、まだ `done` でない `today_missions(day)` を 1 件ずつ評価します：
   - `progress_after(...)` を計算し、`missions(guild_id, user_id, day, mission_id, progress, done)` に upsert します。
   - `done: 0 -> 1` に変わったとき、`m.reward`（`income=m.reward`）を入金します。
4. このプレイで少なくとも 1 件のミッションを達成し、`COUNT(done=1) >= 3` なら、`COMPLETE_BONUS`（`500`、`income=500`）を入金します。
5. `/ペリカ ミッション` は、アカウントを作らずに `mission_status(user_id, today)` を読み（`infra/db/records.py:104-115`）、10 ブロックの進捗バー（`🟩` / `⬜`）つきのエフェメラルな埋め込みを表示します。

## エッジケース
- 1 度も遊ぶ前に `/ペリカ ミッション` を見ても、`users` の行は作られません（`infra/db/records.py:105`）。
- 引き分け（`net == 0`）は、`play`、`play_game`、`wager` には数えられますが、`win`／`game_win` には数えられず、`win_streak` と `day_streak` は両方とも保たれます。
- `win_streak` は日をまたいで続いても、`day_streak` は 0 時を越えると引き継がれません（`infra/db/records.py:39-41`）。
- `bet < 100` のプレイでは、`streak_day` は上書きされません（`d if counts else (row["streak_day"] if row else None)`、`infra/db/records.py:63`）。
- 進捗バーは、整数の切り捨て `10 * min(progress, m.target) // m.target` を使います（`cogs/economy/embeds.py:157`）。

## ユーザーに表示する日本語文言（原文のまま）
| キー | テンプレート／文字列 | 出典 |
|---|---|---|
| `missions.cmd_name` | `ミッション` | `cogs/economy/cog.py:194` |
| `missions.cmd_desc` | `今日のミッションと進み具合を見る` | `cogs/economy/cog.py:194` |
| `missions.embed_title` | `📜 今日のミッション` | `cogs/economy/embeds.py:167` |
| `missions.row` | `{mark} **{name}**　報酬 {reward}\n{bar} {shown:,} / {target:,}`（`mark` ＝ `✅` / `🔸`、`bar` ＝ `🟩`/`⬜` を 10 個） | `cogs/economy/embeds.py:157-160` |
| `missions.min_bet_note` | `※ 賭け金 {min_bet} 以上のゲームだけが数えられます。連勝はその日の分だけです。` | `cogs/economy/embeds.py:162` |
| `missions.complete_bonus_line` | `🎁 3つ全部で、さらに **+{bonus}**` | `cogs/economy/embeds.py:164` |
| `missions.streak_line` | `🔥 いまの連勝: **{win_streak}** ／ 自己ベスト: **{best_streak}**` | `cogs/economy/embeds.py:165` |
| `missions.reset_line` | `🕛 次の更新: **{reset_text}**（<t:{ts}:R>）` | `cogs/economy/embeds.py:166` |
| `missions.ledger_reward` | `ミッション報酬:{name}` | `infra/db/records.py:93` |
| `missions.ledger_bonus` | `ミッション全達成ボーナス` | `infra/db/records.py:101` |
| `missions.tz_jst` | `日本時間` | `cogs/economy/cog.py:44` |
| `missions.reset_label_jst` | `日本時間 0:00` | `cogs/economy/cog.py:49` |
| `missions.reset_label_other` | `{tz_label} の 0:00` | `cogs/economy/cog.py:49` |
