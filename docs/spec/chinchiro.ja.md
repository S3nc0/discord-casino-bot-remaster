[English](chinchiro.md) | **日本語**

# チンチロ（`chinchiro`）

サイコロの手を比べるゲームです。ひとり用は親と勝負します（`/カジノ チンチロ`）。複数人の卓では参加者どうしで振り合い、いちばん強い役の人が総取りします（`/カジノ チンチロ卓`）。
共通契約との整合：`GameId = 'chinchiro'`、`ScreenId = 'chinchiro'`、`LEDGER_REASONS`（`game_stake`、`game_payout`、`game_refund`、`jackpot_payout`、`debt_withholding`）。エスクロー、RTP、イベント、保険、スキン、ジャックポットは [casino-common.ja.md](./casino-common.ja.md) を参照してください。

## 元ファイル

- `catalogs/games.yaml:74-96,151-157`
- `catalogs/skins.yaml:8-53,81-96`
- `docs/casino.md:5-22,138-144`
- 元の Python ボット（v1.0.0 より前の git 履歴を参照）。パスはそのフォルダからの相対パスです：
  - `domain/games/chinchiro.py:1-139`
  - `domain/games/rtplevel.py:27,86`
  - `cogs/casino/cog.py:51-63`
  - `cogs/casino/chinchiro.py:1-229`
  - `cogs/casino/chinchiro_table.py:1-209`
  - `cogs/casino/texts.py:42-76`

## ルールと正確な数値

### サイコロと役の判定（`classify`）
標準の 6 面サイコロを 3 つ振り（`randint(1, 6)` × 3）、`(a, b, c)` の順に並べ替えます。

| 役の ID | 日本語名 | 条件 | `strength` | 基本 `mult` |
|---|---|---|---|---|
| `pinzoro` | `ピンゾロ` | `a == b == c == 1` | `100` | `5` |
| `arashi` | `嵐（{v}のゾロ目）` | `a == b == c`、`v ∈ {2..6}` | `40 + v` | `3` |
| `shigoro` | `シゴロ` | `(4, 5, 6)` | `30` | `2` |
| `me` | `{v}の目` | `a == b`（`v = c`）または `b == c`（`v = a`） | `10 + v` | `1` |
| `menashi` | `目なし` | 上のどれにも当たらない | `1` | `1` |
| `hifumi` | `ヒフミ` | `(1, 2, 3)` | `0` | `1` |

- `MAX_ROLLS = 3`：1 人につき最大 3 回まで振ります。`hand.kind != "menashi"` の目が出たらすぐに止まります。
- `HIFUMI_FACTOR = 2`：負けたほうが `hifumi` だと、勝ったほうの倍率が 2 倍になります。
- `MAX_MULT = 5 * 2 = 10`（`pinzoro` 対 `hifumi`）。

### 比較と配当（`compare`、`payout`）
- `player.strength == dealer.strength` のとき：
  - `player.kind == "menashi"` なら、**ハウスに有利なルール**で `Outcome("lose", 1)`（目なし同士は親の勝ち）。
  - それ以外は `Outcome("draw", 0)`（引き分け。賭け金は返金）。
- `player.strength > dealer.strength` のとき：
  - `mult = ROLE_MULT[player.kind] * (2 if dealer.kind == "hifumi" else 1)`
  - `Outcome("win", mult)` → `(payout = bet + bet * mult, penalty = 0)`。
- `player.strength < dealer.strength` のとき：
  - `mult = ROLE_MULT[dealer.kind] * (2 if player.kind == "hifumi" else 1)`
  - `Outcome("lose", mult)` → `(payout = 0, penalty = bet * (mult - 1))`。

### オッズと RTP
- 基本の RTP プロファイル（`rtplevel.py:27`）：`CHINCHIRO_RTP = 0.985`、`CHINCHIRO_W = 0.653`。
- レベル 1〜6 のおよその RTP：`90.5%` / `94.5%` / `98.5%` / `102.5%` / `106.5%` / `110.5%`。
- `chinchiro.py:129-138` の `expected_value()` は、1 ペリカを賭けたときの純期待値を求めます（わずかにマイナスで約 `-0.015`。これは `menashi` 同士が親の勝ちになることだけが理由です）。

### 倍払いでの負けと、強制的な差し押さえ
- `penalty = bet * (mult - 1) > 0` のとき：
  - 精算と同じトランザクションで、プレイヤーの現金から引きます。
  - 不足分は `debt.owe_for(gid, user_id, penalty - taken, "チンチロの倍払い")` を呼び、帝愛の債務を作る前に資産を差し押さえます（信用取引 → 株 → 通常の債券の順）。
  - 保険券の消耗品（`保険券`）は、基本の `bet` に対してだけ `min(bet // 2, 1000)` を返します。`penalty` には効きません。

### 上限とタイマー
- `MIN_BET = 10`、上限なし（`balance_factor = 1`。先に `10` 倍の残高が必要なわけでは**ありません**）。
- ひとり用のチンチロ：
  - アニメーションのステップの間隔：`CHINCHIRO_STEP_SECONDS = 0.9s`。
  - プレイヤーが振るビューのタイムアウト：`60s`（`ChinchiroView`、`chinchiro.py:121`）。タイムアウトすると、まだ振っていなければ `menashi`、振っていれば最後の目で精算します。
  - リプレイのビューのタイムアウト：`90s`。
- 複数人の卓（`/カジノ チンチロ卓`。upstream cc6dc77 から総取り式。remaster は `packages/domain/src/casino/chinchiro/table.ts`）：
  - 席：`TABLE_MIN_SEATS = 2` から `TABLE_MAX_SEATS = 6`。卓を立てた人が最初に座ります。全員が同じ `bet` を賭けます（席ごとに別のラウンドで預かり、その人のカジノセッションをロックします）。
  - 座る時間：`TABLE_JOIN_MS = 60 000`（60 秒で自動的に始まります。立てた人は `▶️ 始める` で早めに始められます）。始まる前に立つ（`🚪 立つ`）と、`bet` の全額が返ります。
  - 始まるときに 2 人未満なら、卓をたたんで賭け金を全額返します。
  - 振る：座った人がそれぞれ `🎲 振る` を 1 回押します。1 回押すと手が最後まで決まります（役が出るまで最大 3 回。ひとり用と同じ `play_hand`）。`TABLE_ROLL_MS = 45 000`：時間が来たら、まだ振っていない人は自動で振ります。最後の人が振ったら、その場で精算します。
  - 精算は `potPayouts(hands, bet)`（upstream の `pot_payouts`）：
    - `best = max(strength)`、`winners = strength == best の席`、`losers = 席数 - winners`。
    - `share = floor(floor(bet × losers × 9 / 10) / winners)`（`TABLE_RAKE_BPS = 1000`、負けた人の賭け金の 10 %）。勝った人は `bet + share`、負けた人は 0。全員が同じ強さなら、全員に `bet` を返します。
    - 卓は `rake = bet × 席数 − 払い戻しの合計` を取ります（場代と割り算の端数）。これはシンクです（負けた人の `game_stake` が戻らないだけ）。
    - 卓では倍払いはありません。`hifumi` はいちばん弱い役として扱い、`penalty` も取りません。還元率の補正もしません（`rtpDone: true`）。
    - 計算例：bet 1000・3 人・勝ち 1 人 → 2800 / 0 / 0、場代 200。bet 1000・4 人・2 人が並ぶ → 1900 ずつ、場代 200。bet 333・3 人・2 人が並ぶ → `floor(299.7) // 2 = 149`、482 ずつ、場代 35。bet 500・3 人・全員同じ → 500 ずつ、場代 0。
    - イベントのボーナス、保険、ジャックポットは、精算のときに席ごとに今まで通りかかります（共通の精算処理）。ボーナスのイベント中は、卓でもペリカが増えることがあります。
  - 卓の精算は 1 つのトランザクションで行います（全員に払うか、誰にも払わないか）。どこかの席で失敗したら何も払わず、代わりに全員の賭け金を返します（これも 1 つのトランザクション）。upstream は勝った人から順に精算し、失敗したら残りを返金していたので、あとで返金される賭け金から勝った人に払ってしまうことがありました。
  - 結果は `CHINCHIRO_TABLE_RESULT_MS = 10 000` のあいだ表示し、そのあと次の卓を立てられます。
  - チャット：座る時間のメッセージには `🪑 座る` / `🚪 立つ` / `▶️ 始める`、振る時間には `🎲 振る`（custom id は `b:cht:roll:<tableRound>`）。Activity：卓のラウンドに `game:action` の `table_roll` を送ります。

## 状態機械

### ひとり用のチンチロ
```text
INIT -> [start_game: lock + escrow] -> DEALER_ROLLING (0.9s steps)
DEALER_ROLLING -> [dealer completes 1..3 rolls] -> PLAYER_TURN (60s timeout)
DEALER_ROLLING -> [message deleted (NotFound)] -> SETTLED (player treated as menashi)
PLAYER_TURN -> [click 🎲 サイコロを振る] -> PLAYER_ROLLING (0.9s)
PLAYER_ROLLING -> [menashi and rolls < 3] -> PLAYER_TURN
PLAYER_ROLLING -> [non-menashi or rolls == 3] -> SETTLED
PLAYER_TURN -> [timeout 60s or NotFound] -> SETTLED (player = last roll or menashi)
```

### 複数人の卓
```text
IDLE -> [sit: open lobby, host seated, lock + escrow] -> LOBBY (60s countdown)
LOBBY -> [sit: <=6 seats, same bet, lock + escrow] -> LOBBY
LOBBY -> [stand: refund + unlock] -> LOBBY
LOBBY -> [host clicks begin OR 60s elapsed, seats < 2] -> IDLE (folded, every stake refunded)
LOBBY -> [host clicks begin OR 60s elapsed, seats >= 2] -> ROLLING (45s countdown)
ROLLING -> [seat clicks roll: whole hand, once per seat] -> ROLLING
ROLLING -> [last seat rolls OR 45s elapsed: the rest auto-roll] -> RESULT (one transaction)
RESULT -> [10s] -> IDLE
```

## エッジケース

- **削除によるキャンセルの防止**：親の目が表示されたあとにメッセージを削除すると（`discord.NotFound`）、返金ではなく、プレイヤーを `menashi` として即座に精算します。親の `pinzoro` や `arashi` を避ける抜け道をふさぐためです（`chinchiro.py:110-113,198-201`）。
- **ボタンの連打による競合**：`_busy` フラグが、同時に来た振るクリックを拒否します。タイムアウトと振る処理が重なっても、`ctx.done` が二重精算を防ぎます。
- **親の `hifumi` で勝ったときの文言**：スキンを装備していても、通常の勝ち文言を `親がヒフミ…！ 倍もらう…！` で上書きします（`chinchiro.py:167-168`）。
- **卓の精算の失敗**：精算は 1 つのトランザクションです。どこかで失敗したら巻き戻し、もう 1 つのトランザクションで全員に返金します（`卓の精算に失敗しました` / `精算前の賭け金は、全額返しました。`）。プロセスが落ちたときはラウンドが開いたまま残り、起動時の復旧で返金します。
- **振るときの断り**（この順に判定）：座っていない → `この卓に座っていません。`、決着済み → `もう決着しています。`、まだ座る時間 → `まだ始まっていません。`、振った → `もう振りました。`。同じ冪等キーで送り直すと、最初の結果を返すだけで二度は振りません。
- **結果の並び**：強い順、同じ強さは座った順。勝った人に 👑、ほかの人は全角スペース。最後の埋め込みは金色です。

## ユーザーに表示する日本語文言

| キー | 原文 | 出典 |
|---|---|---|
| `chinchiro.cmd.desc` | `🎲 チンチロ。親と勝負、目が出なければ3回まで振れる` | `cogs/casino/cog.py:51` |
| `chinchiro.table.cmd.desc` | `🎲 チンチロの卓を立てる。みんなで振って、いちばん強い役が総取り（60秒で締切）` | upstream cc6dc77 `cogs/casino/cog.py` |
| `chinchiro.table.bet.desc` | `1人あたりの賭け金（座る人は全員この額）` | `cogs/casino/cog.py:60` |
| `chinchiro.title` | `🎲 地下チンチロ` | `cogs/casino/texts.py:42` |
| `chinchiro.table.title` | `🎲 地下チンチロの卓` | `cogs/casino/chinchiro_table.py:25` |
| `chinchiro.role.pinzoro` | `ピンゾロ` | `catalogs/games.yaml:78` |
| `chinchiro.role.arashi` | `嵐（{v}のゾロ目）` / カタログでは `嵐（アラシ）` | `domain/games/chinchiro.py:55`、`catalogs/games.yaml:81` |
| `chinchiro.role.shigoro` | `シゴロ` | `catalogs/games.yaml:84` |
| `chinchiro.role.me` | `{v}の目` | `domain/games/chinchiro.py:53` |
| `chinchiro.role.menashi` | `目なし` | `catalogs/games.yaml:90` |
| `chinchiro.role.hifumi` | `ヒフミ` | `catalogs/games.yaml:93` |
| `chinchiro.start` | `賭け金: **{bet:,}ペリカ**\n\nざわ… ざわ…\n親（ディーラー）が丼にサイコロを放る…` | `cogs/casino/chinchiro.py:83` |
| `chinchiro.rolling` | `{dice}　カラカラカラ…` | `cogs/casino/chinchiro.py:65` |
| `chinchiro.reroll` | `　→ 振り直し` | `cogs/casino/chinchiro.py:58` |
| `chinchiro.prompt.first` | `あなたの番。ボタンで振る（目が出なければ振り直せる）` | `cogs/casino/chinchiro.py:139` |
| `chinchiro.prompt.reroll` | `目なし…！ あと **{left}回** 振れる` | `cogs/casino/chinchiro.py:141` |
| `chinchiro.btn.roll` | `🎲 サイコロを振る` | `cogs/casino/chinchiro.py:191` |
| `chinchiro.busy` | `処理中です。少し待ってください。` | `cogs/casino/chinchiro.py:194` |
| `chinchiro.timeout_player` | `**あなた**\n時間切れ…（目なし扱い）` | `cogs/casino/chinchiro.py:182` |
| `chinchiro.win.pinzoro` | `ピンゾロ…ッ！ 5倍…！ 場の空気が凍りつく…` | `cogs/casino/texts.py:61` |
| `chinchiro.win.arashi` | `嵐…ッ！ 3倍…！ ざわ…ざわ…` | `cogs/casino/texts.py:62` |
| `chinchiro.win.shigoro` | `シゴロ…！ 2倍…。流れが来ている…` | `cogs/casino/texts.py:63` |
| `chinchiro.win.me` | `目で押し切った…！ 静かな勝利…` | `cogs/casino/texts.py:64` |
| `chinchiro.win.menashi` | `相手のヒフミに救われた…！` | `cogs/casino/texts.py:65` |
| `chinchiro.win.dealer_hifumi` | `親がヒフミ…！ 倍もらう…！` | `cogs/casino/chinchiro.py:168` |
| `chinchiro.lose.pinzoro` | `親のピンゾロ…！ 5倍払い…。血の気が引いていく…` | `cogs/casino/texts.py:69` |
| `chinchiro.lose.arashi` | `親の嵐…！ 3倍払い…。地下に悲鳴が響く…` | `cogs/casino/texts.py:70` |
| `chinchiro.lose.shigoro` | `親のシゴロ…2倍払い…。` | `cogs/casino/texts.py:71` |
| `chinchiro.lose.me` | `親の目が上だった…。` | `cogs/casino/texts.py:72` |
| `chinchiro.lose.menashi` | `目なし同士は親の勝ち…。それが地下のルール…` | `cogs/casino/texts.py:73` |
| `chinchiro.lose.hifumi` | `ヒフミ…ッ！ 倍払い…！ 地獄だ…` | `cogs/casino/texts.py:74` |
| `chinchiro.lose.debt` | `払い切れない…！ 残りは借金になった…` | `cogs/casino/chinchiro.py:173` |
| `chinchiro.draw` | `引き分け…。ざわ……何も動かない…` | `cogs/casino/chinchiro.py:175` |
| `chinchiro.table.btn.sit` | `🪑 座る` | `cogs/casino/chinchiro_table.py:163` |
| `chinchiro.table.btn.leave` | `🚪 立つ` | `cogs/casino/chinchiro_table.py:171` |
| `chinchiro.table.btn.begin` | `▶️ 始める` | `cogs/casino/chinchiro_table.py:177` |
| `chinchiro.table.err.started` | `もう始まっています。` | `cogs/casino/chinchiro_table.py:66` |
| `chinchiro.table.err.already_sat` | `もう座っています。` | `cogs/casino/chinchiro_table.py:68` |
| `chinchiro.table.err.full` | `満席です（6人）。` | `cogs/casino/chinchiro_table.py:70` |
| `chinchiro.table.err.not_seated` | `座っていないか、もう始まっています。` | `cogs/casino/chinchiro_table.py:174` |
| `chinchiro.table.err.host_only` | `始められるのは、卓を立てた人だけです。` | `cogs/casino/chinchiro_table.py:180` |
| `chinchiro.table.pot` | `賭け金: **{bet}**（全員同じ）　場代: 負けた分の10%` | upstream cc6dc77 `chinchiro_table.py` |
| `chinchiro.table.lobby_rule` | `全員が振って、**いちばん強い役の人が総取り**します（並んだら山分け）。2人から遊べます。` | upstream cc6dc77 |
| `chinchiro.table.btn.roll` | `🎲 振る` | upstream cc6dc77 |
| `chinchiro.table.not_rolled` | `…まだ振っていません` | upstream cc6dc77 |
| `chinchiro.table.roll_prompt` | `座っている人は「🎲 振る」を押してください（45秒で、まだの人は自動で振ります）。` | upstream cc6dc77 |
| `chinchiro.table.err.not_at_table` | `この卓に座っていません。` | upstream cc6dc77 |
| `chinchiro.table.err.finished` | `もう決着しています。` | upstream cc6dc77 |
| `chinchiro.table.err.not_started` | `まだ始まっていません。` | upstream cc6dc77 |
| `chinchiro.table.err.already_rolled` | `もう振りました。` | upstream cc6dc77 |
| `chinchiro.table.folded` | `2人そろわなかったので、卓をたたみました（賭け金は全額返しました）。` | upstream cc6dc77 |
| `chinchiro.table.head.draw` | `全員が同じ強さで、引き分け。賭け金は全額戻りました。` | upstream cc6dc77 |
| `chinchiro.table.head.single` | `👑 **{name}** の総取り！` | upstream cc6dc77 |
| `chinchiro.table.head.split` | `👑 {name1}・{name2} の山分け！` | upstream cc6dc77 |
| `chinchiro.table.result_title` | `🎲 地下チンチロの卓 — 決着` | upstream cc6dc77 |
| `chinchiro.table.rake` | `場代: **{rake}**` | remaster で追加 |
| `chinchiro.table.failed_title` | `卓の精算に失敗しました` | upstream cc6dc77 |
| `chinchiro.table.failed_body` | `精算前の賭け金は、全額返しました。` | upstream cc6dc77 |

総取りの卓（upstream cc6dc77）で消えた文言：判定の `🟢 勝ち` / `🔴 負け` / `⚪ 引き分け`、`ざわ…ざわ…　子が振る…`、`誰も座らなかったので、卓をたたみました。`、「同じ親と勝負」の文言。
