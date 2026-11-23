[English](p2p-loans.md) | **日本語**

# 個人間融資（`/貸付`）仕様

担当：`B3` | 画面 ID：`loans`（`packages/shared/src/ids.ts`） | 機能トグル：`loan`（OFF でも常に使えるのは `貸付 返済`、`貸付 一覧`、既存のオファーの辞退と取り下げ）

## 元ファイル
- `catalogs/economy.yaml:20-30`
- `docs/teiai.md:111-124`
- 元の Python ボット（v1.0.0 より前の git 履歴を参照）。パスはそのフォルダからの相対パスです：
  - `domain/loans.py:1-67`
  - `infra/db/loans.py:1-432`
  - `services/loan.py:1-94`
  - `cogs/loan/cog.py:1-331`
  - `cogs/loan/embeds.py:1-70`
  - `cogs/loan/views.py:1-149`
  - `cogs/shared/messages/economy.py:144-167,200-202`

## ルールと正確な数値

### 1. パラメーターと上限（`catalogs/economy.yaml:20-30`、`domain/loans.py:15-26`）
- `USER_MIN_PRINCIPAL = 100` ペリカ（元本の上限はなし）。
- 金利（`rate_tenths`）：1 日あたり 1% の 10 分の 1 を単位とした整数で保存します（`1` ＝ `0.1%/日`、`0` ＝ `0%/日`。上限なし）。スラッシュコマンドは `>= 0.0` の float を受け付け、`round(rate * 10)` で変換します。
- 期間：`MIN_TERM_DAYS = 1`、`MAX_TERM_DAYS = 30` 日。
- `OFFER_HOURS = 24`（保留中の貸し手のオファーと、借り手の募集の有効期限）。
- 同時に持てる数の上限：
  - `MAX_BORROWER_OPEN = 1`（ユーザーごとの、借り手の `request` の掲載）。
  - `MAX_LENDER_OPEN = 5`（ユーザーごとの、保留中の貸し手の `offer` の掲載）。
  - `MAX_LENDER_ACTIVE = 10`（貸し手ごとの、進行中と延滞中の貸付の合計）。
  - 借り手が同時に借りられる進行中の貸付の数に、上限はありません。
- `REMIND_HOURS = 24`（`due - now <= 24h` になったとき、チャンネルに 1 回だけリマインドを投稿）。
- 延滞ペナルティのパラメーター：
  - `LATE_MIN_RATE_TENTHS = 20`（ペナルティ金利の最低 `2.0%/日`）。
  - `LATE_CAP = 2`（累積の延滞ペナルティの上限 ＝ 元本の `2` 倍）。

### 2. 利息と延滞ペナルティの式（`domain/loans.py:33-66`）
- 日割りの単利で、経過日数は切り上げです：
  - `elapsed_days(accepted_at, now, term_days) = min(term_days, max(1, math.ceil((now - accepted_at) / 86400)))`（すぐに返済しても、最低 1 日分です）。
  - `interest(principal, rate_tenths, days) = principal * rate_tenths * days // 1000`（整数の切り捨て除算）。
- 延滞ペナルティ（`now > due` のとき。`due = accepted_at + term_days * 86400.0`）：
  - `late_rate_tenths(r) = max(r * 3 // 2, 20)`（`max(契約金利の 1.5 倍, 2.0%/日)`）。
  - `overdue_days = math.ceil((now - due) / 86400)`。
  - `late_interest = min(principal * 2, principal * late_rate_tenths * overdue_days // 1000)`。
- `total_owed = principal + interest(elapsed_days) + late_interest`。
- `remaining = max(0, total_owed - paid)`。
- `elapsed_days` は返済時刻 `now` で評価するので、早めに返すと通常の利息が減ります。

### 3. 2 つの作成の流れ
1. **貸し手のオファー（`/貸付 提案`）**：
   - 貸し手が `member`（Bot でなく、自分以外）、`principal`、`rate`、`days` を指定します。
   - 貸し手の現金 `>= principal`、`opened < 5`、`active < 10` を検証します。オファーの時点では、貸し手の現金を**ロックしません**。
   - 借り手にメンションする公開のオファーの埋め込みを、永続の `LoanButton`（`承諾`、`辞退`、`取り下げ`）つきで投稿します。
   - 借り手が `承諾` を押すと（`loan_accept`）：期限切れでないこと、借り手がブラックリストに入っておらず延滞中の貸付がないことを確認し（帝愛の債務があるのは構いません。借り換えのため）、貸し手の残高 `>= principal` を再確認します。`principal` を貸し手から借り手に直接移し（`income=0` なので、借りた元本は帝愛の 30% の天引きの対象に**なりません**）、`status='active'`、`accepted_at = now`、`due = now + term_days * 86400` にします。
2. **借り手の募集（`/貸付 募集`）**：
   - 借り手が `principal`、`rate`、`days` を指定します。借り手がブラックリストに入っておらず、延滞中の貸付がなく、開いている募集が `< 1` であることを検証します。
   - 借り手の信用の報告（`borrower_note`：状態、帝愛の債務、猶予、返済済み／延滞／免除の件数、進行中の件数と元本の残り、最後の破産の日付。現金、株、預金は隠します）を示す公開の募集の埋め込みを、`貸す` と `取り下げ` のボタンつきで投稿します。
   - 借り手以外で最初に `貸す` を押した人に、30 秒の確認のモーダル（`handle_lend`）が出ます。そのあと `loan_lend` が、借り手の資格、貸し手の残高、`active < 10` をアトミックに再確認し、現金を移し、`active` にします。

### 4. 返済、満期の自動回収、延滞の差し押さえ
- **手動の返済（`/貸付 返済`）**：借り手が `amount`（省略すると `min(remaining, balance)`）を払います。借り手から引き、貸し手に入金します（`income=0`。貸付の回収には、帝愛の天引きがかかりません）。`remaining <= 0` になったら `status='repaid'` にします。
- **満期の自動回収（`loan_collect_due`）**：1 分ごとに動きます。`now >= due` のとき、ちょうど `loan["due"]` の時点の `remaining` を評価し（満期のぴったりの回収では、延滞ペナルティはゼロ）、`min(borrower_balance, remaining)` を差し押さえて貸し手に移します。`left <= 0` なら `repaid`、そうでなければ `overdue` になります（借り手の状態は `🟤 地下労働者` に変わります）。
- **延滞中の収入の差し押さえ（`collect_overdue_for`）**：P2P の貸付は、帝愛の債務の**後順位**の債務です。借り手が `income` を得るたびに、`AccountCore` が `30%` を天引きします。まず帝愛の債務に払い、その 30% の枠で余った分は、延滞中の P2P の貸付に、`id` の昇順（古い順）で回します。
- **破産との関係**：`bankrupt_for` の間、帝愛の債務を全額払ったあと、清算のプールに残りがあれば、進行中と延滞中の P2P の貸付に古い順に払います（`貸付の配当（借り手の自己破産）`）。払えなかった残高は `discharged`（貸し手の損失）になります。借り手は、帝愛の債務が `0` になってから `7` 日間、借り入れのブラックリストに入ります。

## タイマーとスケジュール
- **1 分のティック（`LoanCog.tick`）**：オファーと募集の期限切れ（`offer_expires <= now`）、期限の 24 時間前のリマインドの投稿（`reminded = 0`）、`loan_collect_due` の実行と、元のチャンネル（なければ `announce_channel`）への結果の投稿を行います。

## 状態機械
- オファーの経路：`offer` → `active`（`accept`）| `declined`（`decline`）| `cancelled`（`cancel`）| `expired`（24 時間のタイムアウト）。
- 募集の経路：`request` → `active`（`lend`）| `cancelled`（`cancel`）| `expired`（24 時間のタイムアウト）。
- 進行中の経路：`active` → `repaid`（手動の返済、または満期の自動回収）| `overdue`（満期での不足）| `discharged`（借り手の破産）。
- 延滞の経路：`overdue` → `repaid`（手動の返済、または差し押さえ）| `discharged`（借り手の破産）。

## エッジケース
- `/貸付 提案` を投稿するとき、貸し手の現金はエスクローされません。借り手が `承諾` を押す前に、貸し手が使ってしまうと、承諾は `loan_lender_insufficient_balance` で失敗します。
- `loan_collect_due` は、`now` ではなく `loan["due"]` の時点で支払額を評価するので、Bot が止まっていても、貸付が `overdue` に変わる前に延滞ペナルティが増えることはありません。
- 貸し手への返済の入金は `income=0` で渡すので、帝愛の債務を抱えた貸し手も、元本と利息の 100% を、30% の天引きなしで受け取れます。
- 延滞中の P2P の貸付は、借り手を `underground` の状態にしますが、破産猶予は発動しません（`grace_debt` は帝愛の債務だけを数えます）。

## ユーザーに表示する日本語文言（原文のまま）
| キー | テンプレート／文字列 | 出典 |
|---|---|---|
| `loan.group_name` | `貸付`（`🤝 ペリカの貸し借り（日割りの単利つき）`） | `cogs/loan/cog.py:75` |
| `loan.offer_title` | `🤝 貸付の提案 #{id}` | `cogs/loan/embeds.py:65` |
| `loan.request_title` | `🙋 貸付の募集 #{id}` | `cogs/loan/embeds.py:53` |
| `loan.state_title` | `🤝 貸付 #{id} {title}`（`成立` / `辞退されました` / `取り下げられました` / `承諾の期限が切れました` / `募集の期限が切れました`） | `cogs/loan/embeds.py:69`、`views.py:64,147`、`cog.py:265` |
| `loan.btn_labels` | `承諾`、`辞退`、`取り下げ`、`貸す` | `cogs/loan/views.py:26-29` |
| `loan.confirm_lend` | `この募集に貸しますか？` | `cogs/loan/views.py:87` |
| `loan.remind_msg` | `⏰ 貸付 #{id} の返済の期限は <t:{due}:R> です。<@{borrower}> さん、\`/貸付 返済\` で返せます（期限には、残高から自動で回収します）。` | `cogs/loan/cog.py:274` |
| `loan.due_repaid` | `✅ 貸付 #{id} の期限が来て、{collected}を回収し、返済が終わりました。` | `cogs/loan/cog.py:281` |
| `loan.due_overdue` | `⚠️ 貸付 #{id} は延滞です。{collected}を回収しましたが、残り {left} があります。<@{borrower}> さんに入るお金から、自動で回収していきます。` | `cogs/loan/cog.py:287` |
| `loan.err_blacklisted` | `破産のブラックリストの間は、貸付を借りられません（完済して7日たつと解除されます）。` | `cogs/shared/messages/economy.py:144` |
| `loan.err_overdue` | `延滞中の貸付があるので、借りられません。先に返してください。` | `cogs/shared/messages/economy.py:145` |
| `loan.ledger_lend` | `貸付→{borrower_id}（#{id}）` / `借入←{lender_id}（#{id}）` | `infra/db/loans.py:213-214,307-308` |
| `loan.ledger_repay` | `貸付の返済→{lender_id}（#{id}）` / `貸付の回収←{borrower_id}（#{id}）` | `infra/db/loans.py:76,78` |
