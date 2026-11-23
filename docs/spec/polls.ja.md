[English](polls.md) | **日本語**

# 投票仕様（`polls`）

> 担当：**B2-B** · 画面 ID：`poll` · 台帳の理由：`poll_rig`

## 1. 元ファイル

- `catalogs/economy.yaml`（L94–L101）：`poll` の定数
- 元の Python ボット（v1.0.0 より前の git 履歴を参照）。パスはそのフォルダからの相対パスです：
  - `domain/poll.py`（L1–L17）：定数と、`shown(real, adj)` の頭打ち
  - `infra/db/poll.py`（L1–L140）：`PollRepo` の作成、投票、票操作、期限切れの締め切り
  - `services/poll.py`（L1–L45）：`PollService` のファサード
  - `cogs/poll/cog.py`（L1–L177）：`/投票 作成`、永続のボタンのハンドラー、票操作の告知、1 分間隔の締め切りループ
  - `cogs/poll/views.py`（L1–L105）：`PollButton`、`RigModal`、`poll_embed`、`verdict`
  - `cogs/shared/messages/economy.py`（L78–L83）：失敗メッセージ

---

## 2. ルール、正確な数値、状態機械

### 2.1 作成と上限（`catalogs/economy.yaml:95-101`、`infra/db/poll.py:49-67`）
- サーバーのメンバーなら誰でも、`/投票 作成` で、はい／いいえの 2 択の投票を作れます。
- `title`：前後の空白を除いて `1`〜`200` 文字（`TITLE_MAX = 200`）。
- `duration`：`domain/duration.py` で解析します（`1 分`〜`43,200 分`（30 日）、既定は `1,440 分`（24 時間））。
- 作成者ごと、サーバーごとに、同時に開けられる投票は最大 **`MAX_OPEN_PER_USER = 5`** 件です。

### 2.2 投票（`infra/db/poll.py:80-91`）
- 1 つの投票につき、1 人 1 票です（`(poll_id, user_id)` への upsert。`closes` までは、賛成と反対を自由に切り替えられます）。
- `status != 'open'` または `now >= closes` なら拒否します。

### 2.3 有料の票操作（`poll_rig`、`infra/db/poll.py:93-121`）
- 投票が開いている間は、**作成者だけ**ができます。
- 費用：1 回につき **`RIG_COST = 500`** ペリカ（`bank_income_for(gid, 500, now)` で帝愛銀行の収入になり、台帳の理由は `"投票:票の書き換え"`）。
- 表示する目標の票数 `(yes, no)` は、それぞれ **`0`〜`1,000,000`** の整数である必要があります（`MAX_COUNT = 1_000_000`）。
- 現在の実際の票を基準にしたずれとして保存します：`adj_yes = yes - real_yes`、`adj_no = no - real_no`、`rigs += 1`。
- 表示する票数は、常に `shown(real, adj) = max(0, real + adj)`（`domain/poll.py:14-16`）です。そのため、あとから入る実際の票は、操作した合計に足され（投票先を変えたときは、0 まで引かれ）ます。
- 票操作は、変更前 → 変更後の合計とともに、チャンネルで**公開で告知**され、投票の埋め込みには `rigs` の回数が表示されます。

### 2.4 状態機械と締め切り
- バックグラウンドのティックは **1 分**ごとに動きます（`cogs/poll/cog.py:144`）。
- `open` ──（`now >= closes`）──► `closed`：元のメッセージを編集して（`view=None`）、判定つきの結果の埋め込みを投稿します：
  - `yes > no`：`✅ 賛成多数`
  - `no > yes`：`❌ 反対多数`
  - `yes == no`：`⚖️ 同数`

---

## 3. 日本語文言（原文のまま）

| キー ID | 日本語文言（原文） | 出典 |
|---|---|---|
| `poll.cmd.group_desc` | `🗳️ 誰でも作れる、賛成・反対の投票` | `cogs/poll/cog.py:53` |
| `poll.cmd.create_desc` | `賛成・反対の投票を作る（期限は自由。票はボタンで入れる）` | `cogs/poll/cog.py:55` |
| `poll.verdict.yes` | `✅ 賛成多数` | `cogs/poll/views.py:18` |
| `poll.verdict.no` | `❌ 反対多数` | `cogs/poll/views.py:20` |
| `poll.verdict.tie` | `⚖️ 同数` | `cogs/poll/views.py:21` |
| `poll.embed.footer` | `💰 作った人は {cost:,}ペリカ払うと、票数を好きな数に書き換えられます（全員に告知されます）` | `cogs/poll/views.py:43` |
| `poll.embed.rigs_warn` | `⚠️ この投票の票数は **{rigs}回** 書き換えられています` | `cogs/poll/views.py:37` |
| `poll.btn.yes` | `賛成`（`👍`） | `cogs/poll/views.py:52` |
| `poll.btn.no` | `反対`（`👎`） | `cogs/poll/views.py:53` |
| `poll.btn.rig` | `票をいじる（{cost:,}）`（`💰`） | `cogs/poll/views.py:54` |
| `poll.vote.ack` | `**{side}** に入れました。`（`賛成` / `反対`） | `cogs/poll/cog.py:109` |
| `poll.rig.modal_title` | `票数を書き換える` | `cogs/poll/views.py:87` |
| `poll.rig.announce_title` | `💰 投票の票数が書き換えられました` | `cogs/poll/cog.py:121` |
| `poll.rig.announce_body` | `{mention} が **{cost:,}ペリカ** 払って、投票 #{id}「{title}」の票数を書き換えました。\n👍 賛成 {old_yes:,} → **{yes:,}**　👎 反対 {old_no:,} → **{no:,}**` | `cogs/poll/cog.py:122-123` |
| `poll.result.title` | `🗳️ 投票 #{id} の結果` | `cogs/poll/cog.py:166` |
| `poll.result.rigs_note` | `⚠️ 票数は {rigs}回 書き換えられています` | `cogs/poll/cog.py:162` |
| `poll.err.bad_title` | `議題は 1〜{max}文字 で書いてください。` | `cogs/shared/messages/economy.py:78` |
| `poll.err.bad_duration` | `期限は 1分〜{days}日 で指定してください。` | `cogs/shared/messages/economy.py:79` |
| `poll.err.too_many` | `受付中の投票は、1人 {max}個 までです。締め切られてから作ってください。` | `cogs/shared/messages/economy.py:80` |
| `poll.err.closed` | `この投票はもう締め切られています。` | `cogs/shared/messages/economy.py:81` |
| `poll.err.not_creator` | `票数を書き換えられるのは、この投票を作った人だけです。` | `cogs/shared/messages/economy.py:82` |
| `poll.err.bad_count` | `票数は 0〜{max:,} で指定してください。` | `cogs/shared/messages/economy.py:83` |
| `poll.err.parse_count` | `票数は 0 以上の整数で書いてください。` | `cogs/poll/views.py:83` |
| `poll.ledger.rig` | `投票:票の書き換え` | `infra/db/poll.py:114` |
