**English** | [日本語](economy-core.ja.md)

# Economy Core, Per-Guild Isolation, 3,000 Start, Net Worth, History & Ranking Specification

Planned owner: `B2-B` | Screen IDs: `home`, `ranking`, `history`, `inbox`, `profile` (`packages/shared/src/ids.ts`)

Covers: **per-guild economy**, **3,000 initial balance**, `AccountCore` ledger & debt withholding, balance card (`/ペリカ 残高`), history summarization (`/ペリカ 履歴`), balance-sheet net worth: net assets, current assets, total assets (`/ペリカ ランキング`), auto-updating leaderboard (`/ペリカ ランキング掲示`), temporary notice queue, guild approval gate, and per-guild feature toggles.

## Source Files
- `catalogs/economy.yaml:2-18`
- The original Python bot (see git history before v1.0.0), paths relative to its folder:
  - `domain/types.py:8-37`
  - `domain/history.py:1-98`
  - `domain/approval.py:1-36`
  - `domain/features.py:1-85`
  - `infra/db/base.py:22-108`
  - `infra/db/account.py:1-68`
  - `infra/db/wallet.py:52-109,204-301`
  - `infra/db/assets.py:1-218`
  - `infra/db/guild.py:1-194`
  - `infra/db/notices.py:1-30`
  - `infra/db/repositories.py:278-296`
  - `services/economy.py:22-112`
  - `services/ranking.py:1-46`
  - `cogs/economy/cog.py:72-123,201-255,318-325`
  - `cogs/economy/embeds.py:15-79,170-173`
  - `cogs/economy/boards.py:1-188`
  - `cogs/shared/ranking.py:1-110`
  - `cogs/shared/approval_guard.py:1-112`
  - `cogs/shared/announce.py:1-21`
  - `cogs/shared/texts.py:1-20`
  - `cogs/shared/messages/base.py:88-100`
  - `main.py:56-104`

## Rules & Exact Numbers

### 1. Per-Guild Economy & 3,000 Initial Balance
- Every economic table is strictly partitioned by `guild_id` (`infra/db/base.py:65-108`). `ScopedRepo._g()` raises `RuntimeError` if `strict=True` and `guild_id == 0`; `validate_guild_id` requires `guild_id > 0`.
- Currency unit: **Pelica** (`ペリカ`), integer-only (`cogs/shared/ui.py:18,59-61`).
- Initial balance (`catalogs/economy.yaml:3`, `domain/types.py:9`): `INITIAL_BALANCE = 3_000`.
- Lazy account creation (`infra/db/account.py:19-28`):
  - `AccountCore.ensure(guild_id, user_id)` runs `INSERT OR IGNORE INTO users (guild_id, user_id, balance, created_at) VALUES (?, ?, 3000, now_ts)`.
  - Only when a row is newly inserted (`cur.rowcount == 1`), logs a ledger entry `(+3000, 3000, "初期支給")`.
  - Kyosai units are NOT granted on account creation (fixed supply).
  - Read-only queries (`peek_stats`, `peek_balance`, viewing another member's `/ペリカ 残高`, `/ペリカ ミッション`) do NOT create an account (`services/economy.py:80-97`). Viewing your own `/ペリカ 残高` DOES create your account.

### 2. Account Primitive (`AccountCore.apply`)
- `apply(guild_id, user_id, delta, reason, income=0)` (`infra/db/account.py:58-67`):
  - Floor clamp: `after = max(0, before + delta)` (cash balance never goes negative).
  - Writes a ledger row ONLY if `after != before`, recording `actual_delta = after - before`.
  - If `delta > 0 and income > 0`: calls `debt_hook.withhold_income(guild_id, user_id, min(income, delta))` (automatically withholds 30% (`repay_rate = 0.30`) toward Teiai debt if in debt; see `docs/spec/teiai.md`).
  - Returns final net balance change `raw_balance - before` (i.e. after withholding).
- Admin `set_balance(user_id, amount, reason)` (`infra/db/wallet.py:71-99`):
  - `amount >= 0`: sets cash balance to `amount` (`income=0`, no withholding, debt untouched).
  - `amount < 0`: sets cash balance to `0` and overwrites `users.debt = -amount` (logs 0-delta ledger row `"{reason}（借金を {-amount:,}ペリカ に設定）"`, triggers `after_debt_change`).

### 3. Balance sheet: net assets (純資産), current assets (流動資産), total assets (総資産)
Upstream c099a04 and ce6f500 count wealth as a balance sheet everywhere: `/ペリカ ランキング`, the
balance card, the auto-updating board and the breakdown. Remaster: `NetWorthService`
(`apps/server/src/finance/net-worth-service.ts`), groups and sort in
`packages/domain/src/progression/economy-core.ts`. Terms: [glossary](glossary.md#assets-balance-sheet).

- **Debt interest first.** Before anything is valued, Toichi interest is accrued for every debtor of
  the guild in one transaction (`TeiaiService.accrueGuildDebtInterest`), so the ranking shows the
  debt as it stands now. This is a write (debt only, no ledger row).
- 15 lines in 3 groups (`LIQUID_KEYS`, `FIXED_KEYS`, `LIABILITY_KEYS`, `PART_KEYS`):
  - **Current assets (流動資産)**:
    - `cash`: wallet balance
    - `deposit`: Teiai trust deposit
    - `crypto`: spot holdings at the sell quote (`spotSellQuote(...).proceeds`, fee taken off) +
      every margin position at `max(0, margin + P&L)` at the latest price
    - `bonds`: principal of active bonds
    - `options`: open options (`StocksService.optionValuesByUser`): a bought option at its resale
      value (its payout once past expiry); a written one at posted margin − buy-back cost (− what it
      owes once past expiry), which can be negative
    - `pot`: unclaimed labor wages (`work_state.pot`)
    - `escrow`: bids held in escrow: the top bid of an active player-market auction and of an open
      kyosai auction (remaster addition: the remaster holds kyosai bids with `kyosai_bid_hold`, so
      leaving them out would make a bid lower net assets)
    - `loans_lent`: what is left to repay on `active` / `overdue` P2P loans, for the lender
  - **Fixed assets (固定資産)**:
    - `items`: inventory and active player-market item listings at shop price (0 for priceless
      limited items)
    - `relics`: relics in the inventory, waiting in the mine (`work_state.relics`) and listed, at
      `RELIC_VALUE × MERGE_COUNT^star`
    - `horses`: owned (not retired) and listed horses at `max(0, 30,000 + retireValue(races, wins, places))`
    - `company`: `funds + companyInvested(level)` (office build cost), split with outside investors
      by `computeStakeValues` (owner gets what exceeds the stakes, investors at most their stake)
    - `tools`: `upgradeSpent(pick) + upgradeSpent(glove) + dormSpent(dorm)`
  - **Liabilities (負債, stored negative in `parts`)**:
    - `debt`: Teiai debt, after the accrual above
    - `loans_owed`: what is left to repay on `active` / `overdue` P2P loans, for the borrower
- Subtotals (`assetGroups`): `liquid`, `fixed`, `gross = liquid + fixed`,
  `liabilities = −Σ LIABILITY_KEYS`, `net = gross − liabilities`. **`liquid + fixed − liabilities =
  net = Σ parts` always holds** (property tests in `balance-sheet.test.ts` and
  `net-worth-service.test.ts`).
- Views and sort (`rankBalanceSheets`): `net` (純資産, the default), `liquid` (流動資産; ce6f500
  replaced the short-lived `💎 総資産` button, which ranked like 純資産 whenever nobody had debt),
  `gross` (server only). Order `(-value, user_id)`, user ids compared as numbers. Every member with
  an account is ranked; top N = 10. A caller ranked below 10 gets `…` and their own line.
- Each ranking row shows the subtotals `（流動 12,345・固定 6,789・負債 1,000）`; zero groups are
  left out.
- **Financial net worth (金融純資産)**: the old ranking key, `cash − debt + valuations`
  (`netWorth`), survives only for the 🟡 wealthy badge (`WEALTHY_ASSETS = 1,000,000`). The made-up
  term "ファイナル総資産" (final total assets) is gone: it is now **net assets**.
- **Cost.** One aggregate query per source, about 15 statements per guild whatever its size. Measured
  on 1,000 seeded players: median 5.7 ms on a dev machine (`net-worth-service.test.ts`), so no cache.

**Where it shows (remaster, decision D2).** `/pelica ranking` keeps the weekly game ranking as its
default and gains `view: weekly | net | liquid`. With `net` or `liquid` it shows the balance-sheet
ranking with three buttons, `🏆 純資産`, `💧 流動資産` and `🧾 自分の内訳`; only the person who ran the
command may press them (others get `core.rank_owner_only`, privately). `member` with `net` or
`liquid` opens that member's breakdown, visible only to the caller. The balance card adds the rank by
net assets and the field `🧾 資産（貸借対照表）`. The Activity Ranking screen has three tabs, weekly
(default), net assets and current assets, under the same podium art, with a "My breakdown" sheet
(`GET /api/life/net-worth`, query `view=net|liquid`).

### 4. Auto-Updating Leaderboard (`/ペリカ ランキング掲示`)
- Permissions: guild `Manage Guild` permission OR bot owner (`owner_ids`) (`cogs/economy/cog.py:72-83`).
- 1 board per guild (`leaderboards(guild_id, channel_id, message_id)`).
- Refresh interval: `BOARD_INTERVAL_MINUTES = 1` minute (`catalogs/economy.yaml:18`, `cogs/economy/cog.py:226-233`).
- Ranks by balance-sheet net assets (§3, debt interest accrued first), top 10, each row with its subtotals; the post has no buttons. Remaster: `boardStandings` / `boardEmbed` in `apps/server/src/bot/boards.ts`, which used to rank by `cash − debt + deposit + spot cost basis + bonds + company funds`.
- Recovery behavior (`cogs/economy/boards.py:85-106`):
  - If the message was deleted (`discord.NotFound`), reposts and updates `message_id`.
  - If the channel was deleted (`channel is None`), deletes the `leaderboards` DB row.
  - On `on_guild_remove`, deletes the `leaderboards` row (`cogs/economy/cog.py:238-240`).
- Also serves as the primary `announce_channel` for guild-wide announcements (falling back to `guild.system_channel` if no leaderboard is set or unpostable) (`cogs/shared/announce.py:10-20`).

### 5. History Summarization (`/ペリカ 履歴`)
- Fetches the latest `60` ledger rows (`cogs/economy/cog.py:321`) and summarizes into up to `12` entries (`domain/history.py:27-93`):
  - **Game grouping**: Starting at a row whose `reason` begins with `"賭け:"` (`game = reason.split(":", 1)[1]`), consumes consecutive following rows whose `reason` ends with `":" + game` AND starts with one of `("追加の賭け:", "払い戻し:", "保険券で半額返金:", "追加の支払い:", "返金:")`. Accumulates `bet` (`-delta` on initial + `"追加の賭け:"`) and `net` (sum of all deltas), using the last row's `ts` and `balance_after`.
  - **Transfer grouping**: Matches `^送金（(送|受)）[→←](\d+)$`. If `"送"` and the immediately following row has `reason == "送金手数料"`, merges the fee into `delta` and takes its `balance_after`.
  - **Other**: Emitted verbatim as `kind="other"`.

### 6. Temporary Notice Queue (`NoticeRepo`)
- Stored in memory per `(guild_id, user_id)` on `EcoDb.notices` (`infra/db/notices.py:19-30`, `infra/db/base.py:39`).
- Bounded to the newest `MAX_NOTICES = 5` items (`catalogs/economy.yaml:8`); older unread notices are dropped.
- `take_notices(user_id)` pops and clears the queue. (Lost on bot restart in legacy.)
- 23 notice codes formatted in `cogs/shared/messages/notices.py:9-75`.

### 7. Guild Approval Gate & Feature Toggles
- **Global Command Tree Check** (`main.py:59-76`):
  1. Slow-interaction warning log if `(utcnow - created_at) > 1.5s`.
  2. Allows DM `/運営` commands strictly for `owner_ids` (`approval_guard.is_owner_dm_command`).
  3. Rejects all other DM commands (`このコマンドはサーバー内でのみ使えます。`).
  4. Runs `approval_guard.guard`:
     - Always allowed if `user_id in owner_ids` or `guild_id in allowed_guild_ids`.
     - If `require_approval` is `true`: allowed iff `guild_status.status == "approved"`. Otherwise triggers DM approval request to `owner_ids` (renotified at most once per `RENOTIFY_AFTER = 3600s`).
     - If `require_approval` is `false`: allowed iff `allowed_guild_ids` is empty.
  5. Runs `approval_guard.command_feature_guard`: checks if the command maps to a disabled feature in `features_off(guild_id)`.
- **18 Legacy Per-Guild Feature Toggle Keys** (`domain/features.py:10-29`):
  `chinchiro`, `pachinko`, `slot`, `blackjack`, `roulette`, `arena`, `horse`, `market`, `bonds`, `kyosai`, `loan`, `company`, `labor`, `quiz`, `raffle`, `poll`, `p2p`, `shop` (remaster Wave 5 adds a 19th key, `stream`; see [admin.md](admin.md#wave-5-additions) and [stream.md](stream.md#4-feature-toggle)).
- Longest-prefix command mapping (`domain/features.py:41-80`): e.g. `"証券 注文 債券"` maps to `"bonds"`, whereas `"証券 注文 ..."` maps to `"market"`.
- **Always Allowed even when feature is OFF** (`domain/features.py:58-68`):
  `"共済 状況"`, `"共済 取消"`, `"貸付 返済"`, `"貸付 一覧"`, `"会社 状況"`, `"会社 持分"`, `"クイズ 取り下げ"`.
- Pausing a feature only blocks starting new activities; in-flight escrows, races, tournaments, and open positions continue to settle normally.

## User-Facing Japanese Strings (Verbatim)
| Key | Template / String | Source |
|---|---|---|
| `core.group_name` | `ペリカ` (`💴 残高・デイリー・ランキング・送金`) | `cogs/economy/cog.py:110` |
| `core.ledger_init` | `初期支給` | `infra/db/account.py:26` |
| `core.ledger_set_debt` | `{reason}（借金を {debt:,}ペリカ に設定）` | `infra/db/wallet.py:91` |
| `core.bal_no_account_title` | `💴 {name} の残高` | `cogs/economy/embeds.py:16` |
| `core.bal_no_account_body` | `まだ遊んでいません（口座がありません）。` | `cogs/economy/embeds.py:16` |
| `core.bal_title` | `{icon} {name} の残高` | `cogs/economy/embeds.py:26` |
| `core.bal_field_status` | `身分` | `cogs/economy/embeds.py:31` |
| `core.bal_field_debt` | `帝愛への借金` / `{debt}（収入の{rate}%が天引きで返済されます。\`/ペリカ 返済\` で自分から返せます）\n⏳ 帝愛の利息（トイチ）: 1日ごとに借金の{daily_rate:.0%}が加わります（{ceiling:,}ペリカまで）` | `cogs/economy/embeds.py:34-36` |
| `core.bal_field_rank` | `このサーバーでの順位（純資産）` / `{rank}位 / {total}人` | `cogs/economy/embeds.py:40` |
| `core.bal_field_collection` | `🏆 コレクション（資産価値 {total}）` | `cogs/economy/embeds.py:44,50` |
| `core.bal_frozen_collection` | `🔒 帝愛により差し押さえ中（借金を完済して、カタギに戻ると返されます）` | `cogs/economy/embeds.py:45` |
| `core.bal_frozen_equip` | `🔒 称号・カード・演出` / `差し押さえ中です（借金を完済して、カタギに戻ると使えます）` | `cogs/economy/embeds.py:56-57` |
| `core.bal_field_crypto` | `証券（現物）の評価額` | `cogs/economy/embeds.py:61` |
| `core.bal_field_bonds` | `債券（預けている元本）` | `cogs/economy/embeds.py:63` |
| `core.bal_field_games` | `遊んだ回数` / `{n:,}回` | `cogs/economy/embeds.py:64` |
| `core.bal_field_bigwin` | `最大の勝ち` | `cogs/economy/embeds.py:65` |
| `core.bal_field_streak` | `連続ログイン` / `{n}日` or `まだ受け取っていません` | `cogs/economy/embeds.py:67-68` |
| `core.bal_field_winrate` | `勝率` / `{pct}%（{plays:,}戦）` | `cogs/economy/embeds.py:73` |
| `core.bal_field_net` | `ゲームの損益` / `{net:+,}ペリカ` | `cogs/economy/embeds.py:74` |
| `core.bal_field_best_streak` | `最大連勝` / `{n}連勝` | `cogs/economy/embeds.py:76` |
| `core.bal_footer` | `勝率・損益は、集計を始めてからのゲームの分です` | `cogs/economy/embeds.py:77` |
| `core.rank_title_net` | `🏆 このサーバーのランキング（純資産）` | `cogs/economy/boards.py:38` |
| `core.rank_footer_net` | `純資産 = 総資産 − 負債（帝愛への借金・個人からの借入） ｜ ペリカはサーバーごとに別々です` | `cogs/economy/boards.py:40` (c099a04) |
| `core.rank_title_liquid` | `🏆 このサーバーのランキング（流動資産）` | `cogs/economy/boards.py` (ce6f500) |
| `core.rank_footer_liquid` | `流動資産 = 現金・預金・株式・債券など、すぐペリカにできる資産（馬・持ち物などの固定資産は含まない） ｜ 内訳は「自分の内訳」で` | `cogs/economy/boards.py` (ce6f500) |
| `core.rank_empty` | `まだ誰も遊んでいません。\`/ペリカ デイリー\` から始めましょう。` | `cogs/shared/ranking.py:30,66` |
| `core.rank_owner_only` | `これは他の人のランキングです。\`/ペリカ ランキング\` で自分を開けます。` | `cogs/economy/boards.py:21` |
| `core.rank_btn_net` | `🏆 純資産` | `cogs/economy/boards.py:53` |
| `core.rank_btn_liquid` | `💧 流動資産` | `cogs/economy/boards.py` (ce6f500) |
| `core.rank_btn_mine` | `🧾 自分の内訳` | `cogs/economy/boards.py:61` |
| `core.breakdown_title` | `🧾 {name} の資産の内訳` | `cogs/shared/ranking.py:90,105` |
| `core.breakdown_no_account` | `まだ口座がありません。` | `cogs/shared/ranking.py:90` |
| `core.breakdown_sections` | `**💧 流動資産**`, `**🏛️ 固定資産**`, `**総資産（流動＋固定）: {gross}**`, `**📉 負債**`, `**負債合計: {liab}**`, `**🧾 純資産（総資産 − 負債）: {net}**`, `（なし）` | `cogs/shared/ranking.py:97-104` |
| `core.breakdown_footer` | `着せ替え・コレクションは買値、馬は購入価格＋引退金の見込み、発掘品は目安の価値、地下作業の工具・寮はこれまでの強化費用で数えます` (remaster: `持ち物は買値、…`) | `cogs/shared/ranking.py:107` |
| `core.rank_subtotals` | `（流動 {liquid}・固定 {fixed}・負債 {liab}）` (zero groups left out) | `cogs/shared/ranking.py` (c099a04) |
| `core.part_labels` | `💴 現金` `🏦 預金（帝愛信託）` `📈 株式（現物の時価＋信用取引の評価額）` `📜 債券（元本）` `🎯 オプション（評価額）` `⛏ 未収金（受け取る前の地下作業の稼ぎ）` `🔒 預け金（競りへの入札）` `🤝 貸付金（個人への貸付）` `🎁 持ち物（買値）` `🏺 発掘品（目安の価値）` `🐎 競走馬（購入価格＋引退金の見込み）` `🏢 会社（会社資金＋事業所の建設費）` `🧰 地下作業の工具・寮（これまでの強化費用）` `💳 借入金（帝愛への借金）` `📉 借入金（個人からの借入）` | `cogs/shared/texts.py` (c099a04) |
| `core.bal_field_bs` | `🧾 資産（貸借対照表）` / `流動資産 {liquid}　固定資産 {fixed}\n総資産 {gross} − 負債 {liab} ＝ **純資産 {net}**` | `cogs/economy/embeds.py` (c099a04) |
| `core.board_title` | `🏆 ペリカランキング（純資産）` | `cogs/economy/boards.py:72` |
| `core.board_header` | `最終更新: <t:{ts}:R>\n\n` | `cogs/economy/boards.py:73` |
| `core.board_footer` | `{interval}分ごとに自動で更新されます` | `cogs/economy/boards.py:74` |
| `core.board_need_channel` | `チャンネルを指定してください` / `掲示するチャンネルを指定します。止めるときは「止める」を True にしてください。` | `cogs/economy/boards.py:134-135` |
| `core.board_no_perm` | `掲示できません` / `Bot が {channel_mention} に埋め込みを投稿できません。チャンネルの権限を確認してください。` | `cogs/economy/boards.py:147-148` |
| `core.board_set_ok` | `ランキングを掲示しました` / `{jump_url}\n{interval}分ごとに、この投稿を自動で書き換えます。止めるときは \`/ペリカ ランキング掲示\` の「止める」を True にしてください。` | `cogs/economy/boards.py:163-164` |
| `core.board_not_set` | `掲示していません` / `このサーバーには、ランキングの掲示がありません。` | `cogs/economy/boards.py:177` |
| `core.board_unset_ok` | `掲示を止めました` / `自動の更新をやめて、ランキングの投稿を削除しました。` | `cogs/economy/boards.py:185` |
| `core.history_title` | `🧾 最近の増減` | `cogs/economy/embeds.py:172` |
| `core.history_empty` | `まだ記録がありません。` | `cogs/economy/embeds.py:172` |
| `core.history_line` | `<t:{ts}:t> {text}　**{delta:+,}**　→ {balance_after:,}ペリカ` | `cogs/shared/messages/base.py:99` |
| `core.guard_guild_only` | `利用できません` / `このコマンドはサーバー内でのみ使えます。` | `main.py:71` |
| `core.guard_not_allowed` | `このサーバーでは使えません` / `この Bot は、許可されたサーバーだけで遊べます。` | `cogs/shared/approval_guard.py:40` |
| `core.guard_pending` | `承認待ちです` / `このサーバーは、まだ Bot の持ち主に承認されていません。承認を依頼しました。承認されるまで、少しお待ちください。` | `cogs/shared/approval_guard.py:51-52` |
| `core.guard_denied` | `承認待ちです` / `このサーバーでの利用は、Bot の持ち主に許可されていません。` | `cogs/shared/approval_guard.py:49,52` |
| `core.guard_feature_off` | `⏸️ 停止中` / `**{label}** は、いま管理者が止めています。再開まで、お待ちください。\n（止める前に始めたものは、いつもどおり精算されます）` | `cogs/shared/approval_guard.py:88-90` |
| `core.err_missing_perms` | `このコマンドを使うには、サーバーの「サーバー管理」権限が必要です。` | `main.py:81` |
| `core.err_check_failure` | `このコマンドは、いまは使えません。` | `main.py:83` |
| `core.err_forbidden` | `Bot の権限が足りないため実行できませんでした。チャンネルの権限を確認してください。` | `main.py:85` |
| `core.err_http` | `Discord 側のエラーで失敗しました。時間をおいてもう一度お試しください。` | `main.py:87` |
| `core.err_unexpected` | `予期しないエラーが発生しました。[精算の前なら賭けたペリカは返しています（\`/ペリカ 履歴\` で確認できます）。]` | `main.py:92-94` |
