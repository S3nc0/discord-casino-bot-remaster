[English](lottery.md) | **日本語**

# 抽選会仕様（`lottery`）

> 担当：**B2-B** · 画面 ID：`lottery` · 台帳の理由：`lottery_ticket`、`lottery_payout`、`lottery_refund`

## 1. 元ファイル

- `catalogs/economy.yaml`（L54–L59）：`raffle` の定数
- 元の Python ボット（v1.0.0 より前の git 履歴を参照）。パスはそのフォルダからの相対パスです：
  - `infra/db/raffle.py`（L1–L109）：`RaffleRepo` の開催、参加、締め切り・抽選・返金
  - `services/raffle.py`（L1–L45）：`RaffleService` のファサード
  - `cogs/raffle/cog.py`（L1–L230）：`RaffleCog` の管理者による開催・再掲示・中止、永続の参加ハンドラー、20 秒間隔の締め切りループ
  - `cogs/raffle/embeds.py`（L1–L51）：募集、結果、中止の埋め込み
  - `cogs/raffle/views.py`（L1–L23）：永続の `JoinView`（`custom_id="raffle:join"`）
  - `cogs/shared/messages/games.py`（L84–L90）：失敗メッセージ

---

## 2. ルール、正確な数値、状態機械

### 2.1 仕組み（`catalogs/economy.yaml:54-59`、`infra/db/raffle.py:39-108`、`cogs/raffle/cog.py:34-38`）
- サーバーごとに、管理者が開催します（`/運営 抽選 …`）。1 サーバーで、開催中の抽選会は最大 **1** つです（`raffle_already_open`）。
- **参加費（`fee`）**：
  - 管理者 UI の最低額：`MIN_FEE = 500`（上限はなし。DB の下限は `fee >= 1`）。
  - 開催のとき省略すると：`[500, 3000]` の 100 ペリカ刻みのランダムな値になります（`RANDOM_FEE_RANGE = [500, 3000]`）。
- **期間（`minutes`）**：既定は `DEFAULT_MINUTES = 60`、最大は `MAX_MINUTES = 1440`（24 時間）。
- **ハウスの取り分はゼロ（RTP 100%）**：当選者は、手数料 **0%** で `fee * len(entries)` を総取りします。
- **参加**：
  - 1 回の抽選会につき、1 人 1 エントリー（`raffle_already_joined`）。
  - `now >= closes`（`raffle_closed`）、ユーザーが `debt > 0`（`debt_blocks`、動詞は `"参加できません"`）、または `balance < fee` のときは、参加できません。
  - 参加費はその場で引かれます（`抽選参加費`）。
- **抽選と返金**：
  - バックグラウンドのループが **20 秒**ごとに確認します（`cogs/raffle/cog.py:175`）。
  - `len(entries) >= 2` で中止されていなければ：一様な `rng.choice(entries)` で当選者を選び、`prize = fee * len(entries)` を支払います（`抽選当選`、`income = prize`）。
  - `len(entries) < 2`、または管理者が中止したときは：参加者全員に `fee` を全額返金します（`返金:抽選`、`income = 0`）。
- **対象外**：ミッション、連勝、週間ランキング、カジノのランダムイベントには数えません（`cogs/raffle/cog.py:6`）。

### 2.2 状態機械
```
[ open ] ──(now >= closes, entrants >= 2)──► [ done ] (1 winner paid fee * N)
   │     ──(now >= closes, entrants < 2)───► [ done ] (all refunded)
   └───────(admin cancel)──────────────────► [ cancelled ] (all refunded)
```

---

## 3. エッジケース

- 掲示し直すと、`message_id`（と `channel_id`）を更新し、古い投稿のボタンは自動的に無効になります（`raffle["message_id"] != interaction.message.id` なら `"募集は終わりました"` を返します）。
- 表示する参加者は最大 `SHOWN_ENTRANTS = 20` 人で、残りは `ほか{n}人` にまとめます。
- 募集のメッセージの投稿が Discord の HTTP エラーで失敗したときは、`host()` がすぐに DB のレコードを取り消します（`cogs/raffle/cog.py:94-96`）。

---

## 4. 日本語文言（原文のまま）

| キー ID | 日本語文言（原文） | 出典 |
|---|---|---|
| `raffle.embed.open_title` | `🎟️ 抽選 参加者募集中！` | `cogs/raffle/embeds.py:27` |
| `raffle.embed.closed_title` | `🎟️ 抽選（募集終了）` | `cogs/raffle/cog.py:212` |
| `raffle.embed.fee_line` | `参加費: **{fee}**（全員同じ額。押した時点で先に引かれます）` | `cogs/raffle/embeds.py:20` |
| `raffle.embed.prize_line` | `いまの賞金: **{prize}**（集めた参加費の全額。当選者は1人）` | `cogs/raffle/embeds.py:23` |
| `raffle.embed.refund_note` | `参加者が2人に満たないときは、全員に全額を返します。` | `cogs/raffle/embeds.py:25` |
| `raffle.btn.join` | `参加する`（`🎟️`） | `cogs/raffle/views.py:20` |
| `raffle.join.ok_title` | `参加しました` | `cogs/raffle/cog.py:168` |
| `raffle.join.ok_body` | `参加費 {fee} を預かりました。結果は締切にこのメッセージの下へ出ます。` | `cogs/raffle/cog.py:169` |
| `raffle.result.win_title` | `🎟️ 抽選 結果発表！` | `cogs/raffle/embeds.py:37` |
| `raffle.result.win_line` | `🎉 当選: <@{winner}>\n賞金: **{prize}**（参加 {n}人 × {fee}）` | `cogs/raffle/embeds.py:34-35` |
| `raffle.result.empty` | `参加者がいなかったので、抽選は行いませんでした。` | `cogs/raffle/embeds.py:39` |
| `raffle.result.too_few` | `参加者が{n}人だったので、抽選は行わず、全員に{fee}を返しました。` | `cogs/raffle/embeds.py:41` |
| `raffle.cancel.title` | `🎟️ 抽選 中止` | `cogs/raffle/embeds.py:47` |
| `raffle.cancel.body` | `抽選は中止されました。参加した{n}人に参加費を返しました。` | `cogs/raffle/embeds.py:48` |
| `raffle.err.min_fee` | `参加費は1ペリカ以上にしてください。` | `cogs/shared/messages/games.py:84` |
| `raffle.err.already_open` | `すでに募集中の抽選があります。` | `cogs/shared/messages/games.py:85` |
| `raffle.err.closed` | `募集は終わりました。` | `cogs/shared/messages/games.py:86` |
| `raffle.err.already_joined` | `すでに参加しています。` | `cogs/shared/messages/games.py:87` |
| `raffle.err.insufficient_balance` | `残高が足りません（参加費 {fee:,}ペリカ、いまの残高 {balance:,}ペリカ）。` | `cogs/shared/messages/games.py:89` |
| `raffle.ledger.join` | `抽選参加費` | `infra/db/raffle.py:83` |
| `raffle.ledger.refund` | `返金:抽選` | `infra/db/raffle.py:102` |
| `raffle.ledger.win` | `抽選当選` | `infra/db/raffle.py:107` |
