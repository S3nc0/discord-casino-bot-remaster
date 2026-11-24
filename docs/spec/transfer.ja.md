[English](transfer.md) | **日本語**

# プレイヤー間の送金仕様

担当：`B2-B` | 画面 ID：`transfer`（`packages/shared/src/ids.ts`） | 機能トグル：なし

## 元ファイル
- `catalogs/economy.yaml:13-17`
- 元の Python ボット（v1.0.0 より前の git 履歴を参照）。パスはそのフォルダからの相対パスです：
  - `domain/types.py:84-90`
  - `infra/db/wallet.py:305-356`
  - `services/economy.py:132-148`
  - `cogs/economy/cog.py:35-40,256-317`
  - `cogs/shared/confirm.py:13-87`
  - `cogs/shared/messages/economy.py:20,84,88-97`

## ルールと正確な数値

### 定数（`catalogs/economy.yaml:13-17`）
- `TRANSFER_FEE_RATE = 0.10`（手数料 10%。送る側が**上乗せで**払い、受け取る側は、指定した `amount` をそのまま受け取ります）。
- `TRANSFER_DAILY_LIMIT = 20_000`（設定のタイムゾーン、既定は JST の `00:00` リセットでの、暦の 1 日あたりの、送った元本の合計。手数料は 1 日の上限に数えません）。
- `TRANSFER_CONFIRM_FROM = 5_000`（`>= 5,000` の金額には、30 秒でタイムアウトする、エフェメラルな確認ボタンが必要です）。
- `TRANSFER_MIN_GAMES = 3`（送る側は `users.games_played >= 3` である必要があります。複数アカウントでの稼ぎの対策です）。
- スラッシュコマンドの入力範囲：`1 <= amount <= 1_000_000`（`cogs/economy/cog.py:265`）。

### 手数料の式
- `fee = math.ceil(round(amount * fee_rate, 6)) if fee_rate else 0`（`infra/db/wallet.py:320-322`、`cogs/economy/cog.py:277`）。
- IEEE 754 の浮動小数点の誤差を避けるため、切り上げの前に小数 6 桁に丸めます（例：`amount = 10` → `round(1.0, 6)` → `fee = 1`、`amount = 1` → `fee = 1`。正の金額なら、最低 1 ペリカです）。
- 手数料は消滅します（帝愛のハウス口座には入金**されません**）。

### 検証の順番
1. **cog での事前確認**（`cogs/economy/cog.py:267-295`）：
   - `member.bot == True` を拒否します（`Bot には送金できません。`）。
   - ユーザーごとのセッションのロックを取ります（`user_session(sessions, interaction, "いまは送れません")`）。ゲームの最中に現金を抜いたり、確認の最中にゲームを始めたりできないようにするためです。
   - 確認の UI を出す前に、`balance_of(gid, uid) < amount + fee` を事前に確認します。
   - `amount >= 5_000` なら、エフェメラルな `ConfirmView`（`timeout = 30s`、本人だけ）を出します。
2. **DB のトランザクションの中での、リポジトリのアトミックな確認**（`infra/db/wallet.py:316-355`）：
   1. `sender == receiver` → `transfer_self`
   2. `amount <= 0` → `amount_must_be_positive`
   3. `sender` と `receiver` の両方のアカウントがあることを確かめます（`account.ensure`。注意：未登録のユーザーに送ると、その人のアカウントが初期残高 `3,000` で作られます）。
   4. `sender.games_played < min_games`（3）を確認します → `transfer_min_games`
   5. `ledger` のうち `reason LIKE '送金（送）%' AND ts >= day_start_ts`（設定のタイムゾーンでの `now.date()` の `00:00`）の行から、`sent_today = -COALESCE(SUM(delta), 0)` を計算します。
      `sent_today + amount > daily_limit`（20,000）なら → `transfer_daily_limit`。
   6. `sender_debt = account.debt(gid, sender)`（利息を加算）を確認します。`sender_debt > 0` なら → `debt_blocks`（`verb="送金はできません"`）。
   7. `raw_balance(gid, sender) < amount + fee` を確認します → `transfer_insufficient_balance`。

### 台帳への記録（`infra/db/wallet.py:349-355`）
1. `account.apply(gid, sender, -amount, f"送金（送）→{receiver}")`（`income` なし）
2. `fee > 0` なら：`account.apply(gid, sender, -fee, "送金手数料")`（`sent_today` が元本だけを合計できるよう、別の行にします。`domain/history.py:62-64` が、表示のためにこの行を送金の行に畳み込みます）
3. `account.apply(gid, receiver, amount, f"送金（受）←{sender}", income=amount)`。注意：`income=amount` なので、受け取る側に帝愛の債務があれば、受け取った額の 30%（`repay_rate = 0.30`）が、債務の返済に自動で天引きされます。

## 状態機械
- `IDLE` --（`/ペリカ 送金`）--> `LOCKED`（ユーザーのセッションを取得）
  - `amount >= 5,000` なら：`LOCKED` → `CONFIRMING`（30 秒のタイムアウト）→ `EXECUTING`（押したとき）または `CANCELLED`（キャンセル・タイムアウト）。
  - `amount < 5,000` なら：`LOCKED` → `EXECUTING`。
- `EXECUTING` --（アトミックな DB トランザクション）--> `DONE`（`receiver` だけにメンションする公開の成功の埋め込み、またはエフェメラルなエラーの埋め込み）→ セッションのロックを解放します。

## エッジケース
- 未登録のユーザーに送ると、`games_played`／`daily_limit`／`debt`／`balance` を確認する**前に** `account.ensure(gid, receiver)` が動きます（`infra/db/wallet.py:325-326`）。そのため、その後の検証で送金が失敗しても、受け取る側のアカウントが `3,000` で作られます（旧版の重要なクセです）。
- 債務のある受け取り側も、送金を受け取れます。`income=amount` なので、受け取った額に `withhold_income`（30% の債務の返済、`repay_rate = 0.30`）がかかります。
- 債務のある送る側は、送金できません（`debt_blocks`）。
- 送る側が、`grace_lock` による破産猶予で直接ブロックされることはありません。破産猶予に入っている人は `debt >= 15,000`（`grace_debt = 15,000`）`> 0` なので、すでに `debt_blocks` でブロックされています。
- cog の事前確認は `balance_of`（内部で `ensure` を呼ぶ）を呼ぶので、未登録の送る側は、`transfer()` が走る前に、3,000 のアカウントが作られます。

## ユーザーに表示する日本語文言（原文のまま）
| キー | テンプレート／文字列 | 出典 |
|---|---|---|
| `transfer.cmd_name` | `送金` | `cogs/economy/cog.py:260` |
| `transfer.cmd_desc` | `ほかの人にペリカを送る（手数料10%）` | `cogs/economy/cog.py:260` |
| `transfer.opt_member_name` | `相手`（`送る相手`） | `cogs/economy/cog.py:261-262` |
| `transfer.opt_amount_name` | `金額`（`送る金額`） | `cogs/economy/cog.py:261-262` |
| `transfer.err_bot_title` | `送れません` | `cogs/economy/cog.py:269` |
| `transfer.err_bot_body` | `Bot には送金できません。` | `cogs/economy/cog.py:269` |
| `transfer.busy_title` | `いまは送れません` | `cogs/economy/cog.py:272` |
| `transfer.err_title` | `送金できません` | `cogs/economy/cog.py:282,308` |
| `transfer.confirm_title` | `送金しますか？` | `cogs/economy/cog.py:289` |
| `transfer.confirm_body` | `{member_mention} に **{amount}** を送ります。\n手数料: {fee}（合計 {total} が引かれます）` | `cogs/economy/cog.py:290` |
| `transfer.confirm_btn` | `送金する` | `cogs/economy/cog.py:291` |
| `transfer.cancel_btn` | `キャンセル` | `cogs/shared/confirm.py:31` |
| `transfer.confirm_owner_only` | `この操作を実行できるのはコマンドを使った本人だけです。` | `cogs/shared/confirm.py:18` |
| `transfer.confirm_running` | `実行します` / `処理中です…` | `cogs/shared/confirm.py:44` |
| `transfer.confirm_cancelled` | `中止` / `キャンセルしました。` | `cogs/shared/confirm.py:45` |
| `transfer.confirm_timeout` | `中止` / `30秒以内に操作がなかったため、中止しました。` | `cogs/shared/confirm.py:46` |
| `transfer.ok_title` | `送金しました` | `cogs/economy/cog.py:311` |
| `transfer.ok_body` | `{member_mention} に **{received}** を送りました。\n手数料: {fee}　あなたの残高: **{sender_balance}**` | `cogs/economy/cog.py:312-313` |
| `transfer.fail_self` | `自分には送金できません。` | `cogs/shared/messages/economy.py:88` |
| `transfer.fail_positive` | `金額は1以上にしてください。` | `cogs/shared/messages/economy.py:20` |
| `transfer.fail_min_games` | `送金は、{min_games}回以上ゲームで遊んでからできます（複数アカウントでの稼ぎ対策です）。` | `cogs/shared/messages/economy.py:90` |
| `transfer.fail_daily_limit` | `1日の送金は合計 {daily_limit:,} ペリカまでです（今日は {sent_today:,} ペリカ送金済み）。` | `cogs/shared/messages/economy.py:93` |
| `transfer.fail_debt` | `借金が {debt:,}ペリカ 残っているので、送金はできません。` | `cogs/shared/messages/economy.py:84` / `infra/db/wallet.py:346` |
| `transfer.fail_balance` | `残高が足りません（送金額 {amount:,} + 手数料 {fee:,} が必要です）。` | `cogs/shared/messages/economy.py:96` |
| `transfer.ledger_out` | `送金（送）→{receiver_id}` | `infra/db/wallet.py:350` |
| `transfer.ledger_fee` | `送金手数料` | `infra/db/wallet.py:353` |
| `transfer.ledger_in` | `送金（受）←{sender_id}` | `infra/db/wallet.py:354` |

## Wave 5：スパチャは送金

配信パネルのスパチャ（[stream.ja.md](stream.ja.md) §3）は配信者への送金で、この仕様をそのまま使います。手数料（10%、切り上げ、上乗せ）、3 回以上プレイの条件、借金で断ること、5,000 からの確認、受け取る側の天引きは同じです。行には `ref_type = 'stream'`、`ref_id = 配信の id` が付きます。1 日の上限は `transfer_out` の行で数えるので、**スパチャと送金は 1 日 20,000 の上限を共有します**。配信が足すのは、1 回 100 以上、メッセージ 150 文字まで、自分の配信には送れない、という独自の制限だけです。
