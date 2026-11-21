# Admin Tools Specification

Planned owner: `B2-B` | Feature toggle: none (owner-only DM commands + guild admin leaderboard + CLI)

## Source Files
- `docs/admin.md:1-57`
- `legacy/python/services/admin.py:1-33`
- `legacy/python/cogs/admin/cog.py:1-590`
- `legacy/python/cogs/admin/approval_ops.py:1-139`
- `legacy/python/cogs/admin/economy_ops.py:1-155`
- `legacy/python/cogs/admin/feature_ops.py:1-53`
- `legacy/python/cogs/admin/content_ops.py:1-298`
- `legacy/python/cogs/admin/embeds.py:1-193`
- `legacy/python/cogs/admin/views.py:1-236`
- `legacy/python/cogs/admin/purge.py:1-51`
- `legacy/python/cogs/admin/targets.py:1-133`
- `legacy/python/cogs/admin/texts.py:1-27`
- `legacy/python/manage.py:1-71`

## Rules & Exact Numbers

### Access Control & Context
- `/運営` slash command group is configured with `allowed_contexts=AppCommandContext(guild=False, dm_channel=True, private_channel=True)` — visible ONLY in DMs with the bot (`cogs/admin/cog.py:121-125`).
- Every subcommand checks `interaction.user.id in approval.owner_ids(config)` (`_owner_only`, `cogs/admin/cog.py:138-144`).
- Guild-level admin command (inside guilds): `/ペリカ ランキング掲示` requires Discord `manage_guild` OR `owner_ids` (`cogs/economy/cog.py:72-83,242-254`).
- Target parsing (`cogs/admin/targets.py:12-29`):
  - `valid_guild_id`: ASCII digits, `1 <= int < 2**63`.
  - `parse_user_id`: accepts raw digits, `<@123>`, or `<@!123>`, `1 <= uid < 2**63`.
  - `postable(channel, guild)`: requires `view_channel`, `send_messages`, `embed_links`.
  - Autocompletes return up to 25 choices (`guild_choices`, `channel_choices`, `user_choices` skipping bots).

### Complete `/運営` Command Matrix
| Command | Parameters & Bounds | Behaviour |
|---|---|---|
| `/運営 付与` | `サーバー`, `ユーザー`, `金額` (`1..10_000_000`), `理由` (opt) | Credits cash (no withholding), ledger reason `f"付与（管理）{reason}".strip()`. Refuses bots & non-members (`cogs/admin/economy_ops.py:17-32`). |
| `/運営 残高設定` | `サーバー`, `ユーザー`, `金額` (`-1_000_000_000..1_000_000_000`), `理由` (opt) | If `amount >= 0`, sets balance to `amount` (debt unchanged). If `amount < 0`, sets balance to `0` and overwrites `debt = -amount` (`infra/db/wallet.py:71-99`). Ledger reason `f"残高の設定（管理）{reason}".strip()`. |
| `/運営 イベント 開始` | `ゲーム` (`events.GAMES`), `時間` (`1..180`, def `30`), `上乗せ率` (`1..300`, def `50`), `サーバー` (opt=all allowed), `チャンネル` (opt) | Starts manual special event (replaces existing manual event; does not stack with random event, max boost applies; win bonus cap 10,000). Announces start/end (`cogs/admin/economy_ops.py:57-86`). |
| `/運営 イベント 終了` | `サーバー` (opt=all allowed) | Stops active manual event immediately (`cogs/admin/economy_ops.py:89-100`). |
| `/運営 還元率 設定` | `サーバー`, `ゲーム` (`*` or 5 casino games), `レベル` (`1..6`, `3` default) | Sets per-guild hidden RTP level (`1` かなり渋い .. `6` 大盤振る舞い, ~4pt/step). Replies with confirmation + full RTP table (`cogs/admin/economy_ops.py:103-117`). |
| `/運営 還元率 一覧` | `サーバー` (opt=all allowed, max 10 embeds) | Lists current RTP levels and approximate RTP (`cogs/admin/economy_ops.py:120-126`). |
| `/運営 機能 停止` / `再開` | `サーバー`, `機能` (`*` or 18 feature keys) | Disables/enables new starts for feature(s) per guild. Replies with status + full 18-feature table (`cogs/admin/feature_ops.py:21-43`). |
| `/運営 機能 一覧` | `サーバー` (opt=all allowed, max 10 embeds) | Displays active (`▶️ 稼働中`) / paused (`⏸️ 停止中`) per feature (`cogs/admin/feature_ops.py:46-52`). |
| `/運営 パチンコ統計` | `サーバー` (opt=all), `日数` (`1..365`, opt=all time) | Compares actual vs designed pachinko start rate, set hit rate, RTP, spin hit rate, omen breakdown (`なし`/`🔵 青`/`🔴 赤`/`🟡 金`), and tier breakdown (`なし`/`ノーマル`/`スーパー`/`プレミアム`). Rows with `< 100` (`SMALL_SAMPLE`) spins marked `（参考）` (`cogs/admin/embeds.py:48-91`). |
| `/運営 クリック履歴` | `サーバー`, `ユーザー`, `時間` (`1..336`, def `24`) | Displays hourly underground labor click stats (last 24 rows shown), flagging hours with `clicks >= MECH_MIN_CLICKS (100)` and `cv < MECH_CV_MAX (0.1)` with ` ⚠️`. Pure diagnostic view; does not impose manual bans (`cogs/admin/embeds.py:114-144`). |
| `/運営 競馬開催` | `サーバー`, `申し込み分` (`1..120`, def `5`), `発売分` (`1..120`, def `5`), `チャンネル` (opt) | Opens ad-hoc special horse race: entry (`entry_min`) → betting (`bet_min`) → start (`+2` min) (`cogs/admin/content_ops.py:29-53`). |
| `/運営 闘技場開催` | `サーバー`, `即決着` (bool, def `False`), `形式` (`duel`/`royale`, opt=both), `チャンネル` (opt) | Immediately creates/posts today's arena or advances current round (`cogs/admin/content_ops.py:56-80`). |
| `/運営 お知らせ` | `サーバー` (opt=all allowed), `画像` (opt, image/* ≤ 8MB), `見出し` (opt ≤ 200 chars, def `📢 お知らせ`), `チャンネル` (opt) | Opens `AnnounceModal` (`body` ≤ 2,000 chars) → shows preview + `AnnounceConfirm` (`timeout=300s`, `送信する`/`やめる`) → posts with `AllowedMentions.none()` (`cogs/admin/content_ops.py:83-111`, `views.py:48-104,149-177`). |
| `/運営 発言削除` | `サーバー`, `チャンネル` (required) | Requires bot `view_channel` + `read_message_history`. Shows `PurgeConfirm` (`timeout=300s`, `すべて消す`/`やめる`). Deletes bot's own messages 1-by-1; progress update every `25` (`PROGRESS_EVERY`); per-channel lock `cog.purging`; if interaction token expires (15m), DMs final report (`cogs/admin/purge.py:15-50`, `views.py:179-236`). |
| `/運営 抽選 開催` | `サーバー`, `掛金` (`>= 500`, opt=random 500..3000), `募集時間` (`1..1440`, def `60`), `チャンネル` (opt) | Starts raffle (`cogs/admin/content_ops.py:144-166`). |
| `/運営 抽選 再掲示` | `サーバー`, `チャンネル` (opt) | Reposts active raffle message (`cogs/admin/content_ops.py:169-185`). |
| `/運営 抽選 中止` | `サーバー` | Cancels active raffle & refunds all entrants (`cogs/admin/content_ops.py:188-199`). |
| `/運営 クイズ 追加` | `告知` (`1` def / `0`), `サーバー` (opt), `チャンネル` (opt) | Opens quiz creation modal (`cogs/admin/content_ops.py:202-218`). |
| `/運営 クイズ 一括追加` | `ファイル` (`.txt`/`.md`/`.text`/`text/*`, ≤ 200KB, UTF-8-SIG), `告知` (`0` def / `1`), `サーバー` (opt), `チャンネル` (opt) | Parses via `quizimport.parse_bulk`, rejects duplicate question texts atomically (up to 15 errors displayed), previews & confirms via `QuizBulkConfirm` (`timeout=300s`) (`cogs/admin/content_ops.py:221-280`, `views.py:106-147`). |
| `/運営 クイズ 一覧` | — | Lists registered quizzes (`cogs/admin/content_ops.py:283-287`). |
| `/運営 クイズ 削除` | `番号` (int) | Deletes quiz & answer history (`cogs/admin/content_ops.py:290-297`). |
| `/運営 サーバー一覧` | — | Shows approval mode ON/OFF, joined count, and lists `✅ 許可`, `⏳ 承認待ち`, `🚫 断った` (`cogs/admin/embeds.py:167-192`). |
| `/運営 サーバー許可` | `サーバーid` | Sets guild status `approved`; announces in guild if joined (`cogs/admin/approval_ops.py:89-108`). |
| `/運営 サーバー取消` | `サーバーid` | Refuses if in `allowed_guild_ids` config; else sets `denied` and calls `guild.leave()` (`cogs/admin/approval_ops.py:111-138`). |

### Persistent Guild Approval DM Buttons
- Dynamic item `guild-approve:(allow|deny):<guild_id>` (`ApprovalButton`, `cogs/admin/views.py:19-45`), survives bot restarts via `bot.add_dynamic_items(ApprovalButton)`.
- Triggered on `on_guild_join` (`reset_denied=True` so re-inviting a previously denied guild re-requests approval), `on_ready` (catches offline joins), and blocked command attempts if `now - notified_at > 3600s` (`RENOTIFY_AFTER`, `cogs/admin/cog.py:45`, `approval_ops.py:40-81`).

### CLI Tool (`legacy/python/manage.py`)
- `manage.py grant <guild_id> <user_id> <amount> [reason]`: validates `guild_id > 0`, `user_id > 0`, `1 <= amount <= 10_000_000`; credits with `f"付与（管理）{reason}".strip()`; exit `2` on invalid input or missing DB.
- `manage.py servers`: prints `guild_status` rows formatted as `{label:6s} {guild_id}  {name}`.

## Edge Cases
- Specifying `channel_id` without `guild_id` is rejected (`チャンネルを指定するときは、\`サーバー\` も指定してください。`, `cogs/admin/targets.py:88-89`).
- `docs/admin.md:41` states `/運営 クリック履歴` does not impose automatic limits ("何かを自動で制限はしません"), whereas `cogs/admin/embeds.py:129` and `domain/labor.py` DO automatically cap daily click earnings when `SUSPECT_HOURS` consecutive mechanical hours occur (see `docs/spec/labor.md`). Code is authoritative.
- `purge_own_messages` prevents concurrent purges on the same channel via `cog.purging: set[int]` (`cogs/admin/views.py:198-202`).

## User-Facing Japanese Strings (Verbatim)
| Key | Template / String | Source |
|---|---|---|
| `admin.group_name` | `運営` (`[管理者] Bot を使えるサーバーの管理。Bot とのDMで使えます`) | `cogs/admin/cog.py:122-123` |
| `admin.owner_only_err` | `権限がありません` / `このコマンドは Bot の持ち主だけが使えます。` | `cogs/admin/cog.py:141` |
| `admin.btn_owner_only` | `これは Bot の持ち主だけが操作できます。` | `cogs/admin/views.py:39` |
| `admin.approve_req_title` | `🆕 新しいサーバーに追加されました` | `cogs/admin/embeds.py:149` |
| `admin.approve_req_footer` | `許可するまで、このサーバーではコマンドが使えません` | `cogs/admin/embeds.py:153` |
| `admin.approve_btn_allow` | `許可する` | `cogs/admin/views.py:26` |
| `admin.approve_btn_deny` | `断って退出させる` | `cogs/admin/views.py:26` |
| `admin.approved_dm` | `許可しました` / `**{name}**（\`{gid}\`）で遊べるようになりました。` | `cogs/admin/cog.py:97` |
| `admin.denied_dm` | `断りました` / `**{name}**（\`{gid}\`）の利用を断りました。{left}` | `cogs/admin/cog.py:109` |
| `admin.approved_guild` | `遊べるようになりました` / `Bot の持ち主に承認されました。\`/help\` で遊び方、\`/ペリカ デイリー\` からどうぞ。` | `cogs/admin/embeds.py:162-163` |
| `admin.server_id_invalid` | `入力エラー` / `サーバーidは数字だけで入力してください。` | `cogs/admin/approval_ops.py:92,114` |
| `admin.revoke_preapproved` | `取り消せません` / `設定ファイル（allowed_guild_ids）で許可されているサーバーです。設定ファイルから外してください。` | `cogs/admin/approval_ops.py:121-122` |
| `admin.grant_ok` | `付与しました` / `{guild} の {mention}（{display_name}）に **{amount}** を付与しました（残高 {balance}）。` | `cogs/admin/economy_ops.py:27-28` |
| `admin.setbal_ok` | `残高を設定しました` / `{guild} の {mention}（{display_name}）の残高を **{before} → {after}** にしました（差額は台帳に残ります）。` | `cogs/admin/economy_ops.py:47-49` |
| `admin.rtp_levels` | `1: かなり渋い`, `2: 渋い`, `3: 標準`, `4: 甘い`, `5: かなり甘い`, `6: 大盤振る舞い` | `cogs/admin/texts.py:19-26` |
| `admin.rtp_changed` | `還元率のレベルを変えました` / `{guild}: {games} → レベル {level}（{level_name}）` | `cogs/admin/economy_ops.py:111-112` |
| `admin.rtp_footer` | `レベル1〜6。3が標準。1段階で還元率が約4ポイント動きます。勝ち分だけが増減します（ユーザーには見せません）` | `cogs/admin/embeds.py:109` |
| `admin.feature_on` | `▶️ 再開しました` / `{guild}: **{names}** を再開しました。` | `cogs/admin/feature_ops.py:32,39` |
| `admin.feature_off` | `⏸️ 止めました` / `{guild}: **{names}** を止めました。新しく始めることだけを止めます。止める前に始めたもの（賭け金を預かった大会・レース・建玉など）は、いつもどおり精算します。` | `cogs/admin/feature_ops.py:34-35,39` |
| `admin.feature_status` | `▶️ 稼働中` / `⏸️ 停止中` | `cogs/admin/feature_ops.py:17` |
| `admin.announce_default_title` | `📢 お知らせ` | `cogs/admin/texts.py:3` |
| `admin.announce_bad_image` | `画像を使えません` / `画像ファイル（8MBまで）を添付してください。` | `cogs/admin/content_ops.py:93` |
| `admin.announce_modal_title` | `お知らせの本文` (`本文（改行できます）`) | `cogs/admin/views.py:149-150` |
| `admin.announce_confirm` | `📢 送信前の確認` / `送り先（{n}サーバー）: {names}\n下がプレビューです。問題なければ「送信する」を押してください。` | `cogs/admin/views.py:171-172` |
| `admin.purge_no_perm` | `履歴を読めません` / `Bot は #{ch} の「メッセージ履歴を読む」権限がありません。招待URLの権限に足して（README を参照）、もう一度試してください。` | `cogs/admin/content_ops.py:126-127` |
| `admin.purge_confirm_title` | `🧹 発言の削除（確認）` | `cogs/admin/content_ops.py:138` |
| `admin.purge_running` | `実行中です` / `このチャンネルは、いま消している最中です。` | `cogs/admin/views.py:200` |
| `admin.purge_progress` | `🧹 消しています…` / `🧹 発言を消しました` / `消せた発言: **{deleted}件**（見た発言: {scanned}件）` | `cogs/admin/views.py:180-181` |
| `admin.quiz_bulk_bad_file` | `ファイルを使えません` / `テキストファイル（.txt、200KBまで）を添付してください。` | `cogs/admin/content_ops.py:240-241` |
| `admin.quiz_bulk_bad_encoding` | `文字コードを読めません` / `UTF-8 で保存したテキストファイルを添付してください。` | `cogs/admin/content_ops.py:251` |
| `admin.target_no_guild` | `サーバーが見つかりません` / `候補から選ぶか、Bot が参加しているサーバーのIDを入れてください。` | `cogs/admin/targets.py:73` |
| `admin.target_need_guild` | `チャンネルを使えません` / `チャンネルを指定するときは、\`サーバー\` も指定してください。` | `cogs/admin/targets.py:89,97` |
| `admin.target_no_member` | `そのサーバーにいません` / `\`{uid}\` は {guild} のメンバーではありません。` | `cogs/admin/targets.py:120` |
| `admin.target_bot` | `Bot には{verb}できません` | `cogs/admin/targets.py:130` |
