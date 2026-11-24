**English** | [日本語](polls.ja.md)

# Polls Specification (`polls`)

> Planned Owner: **B2-B** · Screen ID: `poll` · Ledger Reasons: `poll_rig`

## 1. Source Files

- `catalogs/economy.yaml` (L94–L101): `poll` constants
- The original Python bot (see git history before v1.0.0), paths relative to its folder:
  - `domain/poll.py` (L1–L17): constants and `shown(real, adj)` clamping
  - `infra/db/poll.py` (L1–L140): `PollRepo` create, vote, rig, close_due
  - `services/poll.py` (L1–L45): `PollService` facade
  - `cogs/poll/cog.py` (L1–L177): `/投票 作成`, persistent button handler, rig announcement, 1-minute closer loop
  - `cogs/poll/views.py` (L1–L105): `PollButton`, `RigModal`, `poll_embed`, `verdict`
  - `cogs/shared/messages/economy.py` (L78–L83): failure messages

---

## 2. Rules, Exact Numbers & State Machine

### 2.1 Creation & Limits (`catalogs/economy.yaml:95-101`, `infra/db/poll.py:49-67`)
- Any guild member can create a binary Yes/No poll via `/投票 作成`.
- `title`: trimmed, `1` – `200` chars (`TITLE_MAX = 200`).
- `duration`: parsed with `domain/duration.py` (`1 min` – `43,200 min` / 30 days; default `1,440 min` / 24h).
- Max concurrent open polls per creator per guild: **`MAX_OPEN_PER_USER = 5`**.

### 2.2 Voting (`infra/db/poll.py:80-91`)
- 1 vote per user per poll (upsert on `(poll_id, user_id)` — users may switch freely between Yes and No until `closes`).
- Rejected if `status != 'open'` or `now >= closes`.

### 2.3 Paid Vote Rigging (`poll_rig`, `infra/db/poll.py:93-121`)
- **Creator-only** while poll is open.
- Cost: **`RIG_COST = 500`** Pelica per rig (paid to Teiai Bank income via `bank_income_for(gid, 500, now)`, ledger reason `"投票:票の書き換え"`).
- Target displayed counts `(yes, no)` must each be integers in **`0` – `1,000,000`** (`MAX_COUNT = 1_000_000`).
- Stored as offsets relative to current real votes: `adj_yes = yes - real_yes`, `adj_no = no - real_no`, `rigs += 1`.
- Displayed count is always `shown(real, adj) = max(0, real + adj)` (`domain/poll.py:14-16`), so subsequent real votes add to (or if switched away, subtract down to 0 from) the rigged totals.
- Rigging is **publicly announced** in the channel with before → after totals, and the poll embed displays `rigs` count.

### 2.4 State Machine & Closing
- Background tick runs every **1 minute** (`cogs/poll/cog.py:144`).
- `open` ──(`now >= closes`)──► `closed`: edits original message (`view=None`) and posts result embed with verdict:
  - `yes > no`: `✅ 賛成多数`
  - `no > yes`: `❌ 反対多数`
  - `yes == no`: `⚖️ 同数`

### 2.5 Pinned Post (remaster, port of upstream 22a1f66)
- The public reply of `/poll create` is **pinned** in its channel right after it is posted, and **unpinned** once the poll is no longer `open` (closed by the minute tick). A poll created in the Activity has no chat post and is not pinned.
- Needs the **Pin Messages** permission in that channel. Without it, or when the channel's pin list is full or the message is gone, the poll works exactly the same, just unpinned: the failure is logged (at most one line per guild per 10 minutes) and never shown to players.
- Mechanism: the pinned message is recorded in `pinned_posts` (kind `poll`); the `notify:pin-sweep` job (every 30 s) unpins every recorded post whose poll is not `open` and deletes the row. A message that was already deleted is ignored silently. See [DB_SCHEMA.md](../DB_SCHEMA.md).

---

## 3. Verbatim Japanese Strings

| Key ID | Verbatim Japanese String | Source |
|---|---|---|
| `poll.cmd.group_desc` | `🗳️ 誰でも作れる、賛成・反対の投票` | `cogs/poll/cog.py:53` |
| `poll.cmd.create_desc` | `賛成・反対の投票を作る（期限は自由。票はボタンで入れる）` | `cogs/poll/cog.py:55` |
| `poll.verdict.yes` | `✅ 賛成多数` | `cogs/poll/views.py:18` |
| `poll.verdict.no` | `❌ 反対多数` | `cogs/poll/views.py:20` |
| `poll.verdict.tie` | `⚖️ 同数` | `cogs/poll/views.py:21` |
| `poll.embed.footer` | `💰 作った人は {cost:,}ペリカ払うと、票数を好きな数に書き換えられます（全員に告知されます）` | `cogs/poll/views.py:43` |
| `poll.embed.rigs_warn` | `⚠️ この投票の票数は **{rigs}回** 書き換えられています` | `cogs/poll/views.py:37` |
| `poll.btn.yes` | `賛成` (`👍`) | `cogs/poll/views.py:52` |
| `poll.btn.no` | `反対` (`👎`) | `cogs/poll/views.py:53` |
| `poll.btn.rig` | `票をいじる（{cost:,}）` (`💰`) | `cogs/poll/views.py:54` |
| `poll.vote.ack` | `**{side}** に入れました。` (`賛成` / `反対`) | `cogs/poll/cog.py:109` |
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
