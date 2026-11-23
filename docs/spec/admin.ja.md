[English](admin.md) | **日本語**

# 管理コマンド仕様

担当：`B2-B` | 機能トグル：なし（オーナー専用の DM コマンド + サーバー管理者向けのランキング掲示 + CLI）

## 元ファイル
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

## ルールと正確な数値

### アクセス制御とコンテキスト
- `/運営` スラッシュコマンドグループは `allowed_contexts=AppCommandContext(guild=False, dm_channel=True, private_channel=True)` で設定されています。Bot との DM でだけ表示されます（`cogs/admin/cog.py:121-125`）。
- すべてのサブコマンドが `interaction.user.id in approval.owner_ids(config)` を確認します（`_owner_only`、`cogs/admin/cog.py:138-144`）。
- サーバー内の管理コマンド：`/ペリカ ランキング掲示` は、Discord の `manage_guild` 権限か `owner_ids` のどちらかが必要です（`cogs/economy/cog.py:72-83,242-254`）。
- 対象の解釈（`cogs/admin/targets.py:12-29`）：
  - `valid_guild_id`：ASCII の数字で、`1 <= int < 2**63`。
  - `parse_user_id`：数字そのまま、`<@123>`、`<@!123>` を受け付けます。`1 <= uid < 2**63`。
  - `postable(channel, guild)`：`view_channel`、`send_messages`、`embed_links` が必要です。
  - オートコンプリートは最大 25 件を返します（`guild_choices`、`channel_choices`、`user_choices`。Bot は除外）。

### `/運営` コマンド一覧
| コマンド | パラメーターと範囲 | 挙動 |
|---|---|---|
| `/運営 付与` | `サーバー`、`ユーザー`、`金額`（`1..10_000_000`）、`理由`（任意） | 現金を付与します（天引きなし）。台帳の理由は `f"付与（管理）{reason}".strip()`。Bot とメンバーでない人は拒否します（`cogs/admin/economy_ops.py:17-32`）。 |
| `/運営 残高設定` | `サーバー`、`ユーザー`、`金額`（`-1_000_000_000..1_000_000_000`）、`理由`（任意） | `amount >= 0` なら残高を `amount` にします（債務はそのまま）。`amount < 0` なら残高を `0` にして `debt = -amount` で上書きします（`infra/db/wallet.py:71-99`）。台帳の理由は `f"残高の設定（管理）{reason}".strip()`。 |
| `/運営 イベント 開始` | `ゲーム`（`events.GAMES`）、`時間`（`1..180`、既定 `30`）、`上乗せ率`（`1..300`、既定 `50`）、`サーバー`（任意。全サーバー可）、`チャンネル`（任意） | 手動の特別イベントを始めます（既存の手動イベントは置き換え。ランダムイベントとは重ならず、大きいほうの上乗せ率が適用。勝ち分ボーナスの上限は 10,000）。開始と終了を告知します（`cogs/admin/economy_ops.py:57-86`）。 |
| `/運営 イベント 終了` | `サーバー`（任意。全サーバー可） | 稼働中の手動イベントをすぐに止めます（`cogs/admin/economy_ops.py:89-100`）。 |
| `/運営 還元率 設定` | `サーバー`、`ゲーム`（`*` または 5 つのカジノゲーム）、`レベル`（`1..6`、既定 `3`） | サーバーごとの隠し RTP レベルを設定します（`1` かなり渋い 〜 `6` 大盤振る舞い、1 段階で約 4 ポイント）。確認メッセージと RTP の全表を返信します（`cogs/admin/economy_ops.py:103-117`）。 |
| `/運営 還元率 一覧` | `サーバー`（任意。全サーバー可、埋め込みは最大 10 件） | 現在の RTP レベルとおよその RTP を一覧にします（`cogs/admin/economy_ops.py:120-126`）。 |
| `/運営 機能 停止` / `再開` | `サーバー`、`機能`（`*` または 18 個の機能キー） | サーバーごとに、機能の新規開始を止める／再開します。状態と 18 機能の全表を返信します（`cogs/admin/feature_ops.py:21-43`）。 |
| `/運営 機能 一覧` | `サーバー`（任意。全サーバー可、埋め込みは最大 10 件） | 機能ごとに稼働中（`▶️ 稼働中`）か停止中（`⏸️ 停止中`）かを表示します（`cogs/admin/feature_ops.py:46-52`）。 |
| `/運営 パチンコ統計` | `サーバー`（任意。全サーバー可）、`日数`（`1..365`、任意。省略で全期間） | パチンコの実際の始動率と設計値、セット当選率、RTP、スピン当選率、予兆の内訳（`なし`／`🔵 青`／`🔴 赤`／`🟡 金`）、ティアの内訳（`なし`／`ノーマル`／`スーパー`／`プレミアム`）を比べます。スピン数が `< 100`（`SMALL_SAMPLE`）の行には `（参考）` を付けます（`cogs/admin/embeds.py:48-91`）。 |
| `/運営 クリック履歴` | `サーバー`、`ユーザー`、`時間`（`1..336`、既定 `24`） | 地下労働のクリック数を 1 時間ごとに表示します（直近 24 行）。`clicks >= MECH_MIN_CLICKS (100)` かつ `cv < MECH_CV_MAX (0.1)` の時間には ` ⚠️` を付けます。確認用の表示だけで、手動で BAN することはありません（`cogs/admin/embeds.py:114-144`）。 |
| `/運営 競馬開催` | `サーバー`、`申し込み分`（`1..120`、既定 `5`）、`発売分`（`1..120`、既定 `5`）、`チャンネル`（任意） | 臨時の特別競馬を開きます。出走受付（`entry_min`）→ 発売（`bet_min`）→ 発走（`+2` 分後）（`cogs/admin/content_ops.py:29-53`）。 |
| `/運営 闘技場開催` | `サーバー`、`即決着`（bool、既定 `False`）、`形式`（`duel`／`royale`、任意。省略で両方）、`チャンネル`（任意） | 今日の闘技場をすぐに作って掲示するか、進行中のラウンドを進めます（`cogs/admin/content_ops.py:56-80`）。 |
| `/運営 お知らせ` | `サーバー`（任意。全サーバー可）、`画像`（任意。image/* で 8MB まで）、`見出し`（任意。200 文字まで、既定 `📢 お知らせ`）、`チャンネル`（任意） | `AnnounceModal`（`body` は 2,000 文字まで）を開き、プレビューと `AnnounceConfirm`（`timeout=300s`、`送信する`／`やめる`）を表示してから、`AllowedMentions.none()` で投稿します（`cogs/admin/content_ops.py:83-111`、`views.py:48-104,149-177`）。 |
| `/運営 発言削除` | `サーバー`、`チャンネル`（必須） | Bot に `view_channel` と `read_message_history` が必要です。`PurgeConfirm`（`timeout=300s`、`すべて消す`／`やめる`）を表示し、Bot 自身の発言を 1 件ずつ削除します。進捗は `25` 件ごと（`PROGRESS_EVERY`）に更新し、チャンネルごとに `cog.purging` でロックします。インタラクションのトークンが切れた場合（15 分）は、最終報告を DM で送ります（`cogs/admin/purge.py:15-50`、`views.py:179-236`）。 |
| `/運営 抽選 開催` | `サーバー`、`掛金`（`>= 500`、任意。省略で 500〜3000 のランダム）、`募集時間`（`1..1440`、既定 `60`）、`チャンネル`（任意） | 抽選会を始めます（`cogs/admin/content_ops.py:144-166`）。 |
| `/運営 抽選 再掲示` | `サーバー`、`チャンネル`（任意） | 開催中の抽選会のメッセージを掲示し直します（`cogs/admin/content_ops.py:169-185`）。 |
| `/運営 抽選 中止` | `サーバー` | 開催中の抽選会を中止し、参加者全員に返金します（`cogs/admin/content_ops.py:188-199`）。 |
| `/運営 クイズ 追加` | `告知`（既定 `1`／`0`）、`サーバー`（任意）、`チャンネル`（任意） | クイズ作成のモーダルを開きます（`cogs/admin/content_ops.py:202-218`）。 |
| `/運営 クイズ 一括追加` | `ファイル`（`.txt`／`.md`／`.text`／`text/*`、200KB まで、UTF-8-SIG）、`告知`（既定 `0`／`1`）、`サーバー`（任意）、`チャンネル`（任意） | `quizimport.parse_bulk` で解析し、問題文が重複していれば全体を受け付けません（エラーは最大 15 件まで表示）。`QuizBulkConfirm`（`timeout=300s`）でプレビューして確認します（`cogs/admin/content_ops.py:221-280`、`views.py:106-147`）。 |
| `/運営 クイズ 一覧` | — | 登録済みのクイズを一覧にします（`cogs/admin/content_ops.py:283-287`）。 |
| `/運営 クイズ 削除` | `番号`（整数） | クイズと回答履歴を削除します（`cogs/admin/content_ops.py:290-297`）。 |
| `/運営 サーバー一覧` | — | 承認モードの ON/OFF、参加数、`✅ 許可`／`⏳ 承認待ち`／`🚫 断った` の一覧を表示します（`cogs/admin/embeds.py:167-192`）。 |
| `/運営 サーバー許可` | `サーバーid` | サーバーの状態を `approved` にします。参加済みなら、そのサーバーに告知します（`cogs/admin/approval_ops.py:89-108`）。 |
| `/運営 サーバー取消` | `サーバーid` | 設定の `allowed_guild_ids` に入っていれば拒否します。そうでなければ `denied` にして `guild.leave()` を呼びます（`cogs/admin/approval_ops.py:111-138`）。 |

### サーバー承認 DM の永続ボタン
- 動的アイテム `guild-approve:(allow|deny):<guild_id>`（`ApprovalButton`、`cogs/admin/views.py:19-45`）。`bot.add_dynamic_items(ApprovalButton)` により Bot を再起動しても有効です。
- 次のときに通知します。`on_guild_join`（`reset_denied=True`。以前に断ったサーバーを招待し直すと、改めて承認を求めます）、`on_ready`（オフライン中の参加を拾う）、そしてブロックされたコマンドの実行時で `now - notified_at > 3600s` の場合（`RENOTIFY_AFTER`、`cogs/admin/cog.py:45`、`approval_ops.py:40-81`）。

### CLI ツール（`legacy/python/manage.py`）
- `manage.py grant <guild_id> <user_id> <amount> [reason]`：`guild_id > 0`、`user_id > 0`、`1 <= amount <= 10_000_000` を確認し、`f"付与（管理）{reason}".strip()` で付与します。入力が不正、または DB がなければ終了コード `2`。
- `manage.py servers`：`guild_status` の行を `{label:6s} {guild_id}  {name}` の形式で表示します。

## エッジケース
- `guild_id` なしで `channel_id` を指定すると拒否します（`チャンネルを指定するときは、\`サーバー\` も指定してください。`、`cogs/admin/targets.py:88-89`）。
- `docs/admin.md:41` は、`/運営 クリック履歴` は自動で何かを制限しない（「何かを自動で制限はしません」）としています。一方、`cogs/admin/embeds.py:129` と `domain/labor.py` は、機械的な時間が `SUSPECT_HOURS` 回連続すると、1 日のクリック収入に自動で上限をかけます（`docs/spec/labor.md` を参照）。正はコードです。
- `purge_own_messages` は、`cog.purging: set[int]` で同じチャンネルの削除を同時に走らせません（`cogs/admin/views.py:198-202`）。

## ユーザーに表示する日本語文言（原文のまま）
| キー | テンプレート／文字列 | 出典 |
|---|---|---|
| `admin.group_name` | `運営`（`[管理者] Bot を使えるサーバーの管理。Bot とのDMで使えます`） | `cogs/admin/cog.py:122-123` |
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
| `admin.rtp_levels` | `1: かなり渋い`、`2: 渋い`、`3: 標準`、`4: 甘い`、`5: かなり甘い`、`6: 大盤振る舞い` | `cogs/admin/texts.py:19-26` |
| `admin.rtp_changed` | `還元率のレベルを変えました` / `{guild}: {games} → レベル {level}（{level_name}）` | `cogs/admin/economy_ops.py:111-112` |
| `admin.rtp_footer` | `レベル1〜6。3が標準。1段階で還元率が約4ポイント動きます。勝ち分だけが増減します（ユーザーには見せません）` | `cogs/admin/embeds.py:109` |
| `admin.feature_on` | `▶️ 再開しました` / `{guild}: **{names}** を再開しました。` | `cogs/admin/feature_ops.py:32,39` |
| `admin.feature_off` | `⏸️ 止めました` / `{guild}: **{names}** を止めました。新しく始めることだけを止めます。止める前に始めたもの（賭け金を預かった大会・レース・建玉など）は、いつもどおり精算します。` | `cogs/admin/feature_ops.py:34-35,39` |
| `admin.feature_status` | `▶️ 稼働中` / `⏸️ 停止中` | `cogs/admin/feature_ops.py:17` |
| `admin.announce_default_title` | `📢 お知らせ` | `cogs/admin/texts.py:3` |
| `admin.announce_bad_image` | `画像を使えません` / `画像ファイル（8MBまで）を添付してください。` | `cogs/admin/content_ops.py:93` |
| `admin.announce_modal_title` | `お知らせの本文`（`本文（改行できます）`） | `cogs/admin/views.py:149-150` |
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
