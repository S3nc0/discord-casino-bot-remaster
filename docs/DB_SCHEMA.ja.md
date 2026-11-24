[English](DB_SCHEMA.md) | **日本語**

# データベーススキーマ

SQLite のファイルは 1 つで、サーバーのプロセス 1 つが `better-sqlite3` で開きます。マイグレーションは `apps/server/src/db/migrations/` に番号付きの `.sql` ファイルとして置き、サーバーのバンドルに埋め込み、順番に、1 つずつトランザクションで適用します。マージ済みのマイグレーションは決して編集せず、新しいファイルを足してください。`0001_init.sql` に、下のコアテーブルがあります。機能ごとのテーブルは、後のマイグレーションにあります（[機能ごとのテーブル](#機能ごとのテーブル) を参照）。

## 規約

| 項目 | ルール |
| --- | --- |
| Discord の ID | `TEXT` のスノーフレーク。JS の数値は 2^53 を超えると精度が落ちます。 |
| ペリカ | `INTEGER`。お金やレートを `REAL` の列に持つことは、どこでもありません。 |
| レート | `INTEGER` のベーシスポイント（`_bps`。1 bp = 0.01 %）。 |
| 価格と数量 | 固定小数点の `INTEGER`。価格はマイクロペリカ（`_micros`、×1,000,000）、数量はミリ単位（`_milli`、×1,000）。お金、レート、価格、数量に `REAL` は使いません。 |
| 丸め | 金額がペリカになる場所で、ルールは 1 つだけ。プレイヤーに払う額は切り捨て、プレイヤーに請求する額は切り上げます。台帳が見るのは整数だけです。 |
| 時刻 | `INTEGER` のエポックミリ秒、UTC。ゲームの日付はコードの中で `UTC_OFFSET_HOURS`（JST = 9）を使います。 |
| 真偽値 | `INTEGER` の 0/1 と `CHECK`。 |
| JSON | `TEXT` と `CHECK (json_valid(...))`。 |
| テーブル | `STRICT`。サーバーごとのテーブルは `guild_id` を持ち、プレイヤーが関わる場合は `guild_members` を参照します。 |
| 列挙値 | `TEXT`。値の一覧は `packages/shared`（`LedgerReason`、`ScreenId`、`NotificationKind` など）にあります。 |

## 接続の pragma

`applyPragmas`（`apps/server/src/db/pragmas.ts`）が、開くたびに設定します（接続ごとの設定なので、マイグレーションには入れません）。

| Pragma | 値 | 理由 |
| --- | --- | --- |
| `journal_mode` | `WAL` | 読み取りが書き込みを止めません。 |
| `synchronous` | `NORMAL` | WAL と組み合わせれば安全で、fsync が大きく減ります（Pi の SD カード向け）。 |
| `busy_timeout` | `5000` | バックアップや CLI がロックを持っているときに、失敗せず待ちます。 |
| `foreign_keys` | `ON` | SQLite は既定ではオフです。 |
| `recursive_triggers` | `ON` | `INSERT OR REPLACE` の暗黙の削除でも DELETE トリガーが動くようにします。台帳のトリガーは、これがなくても成り立ちます（両方の設定でテスト済み）。 |
| `temp_store` | `MEMORY` | 一時ファイルを作りません。 |
| `cache_size` | `-8000`（8 MB） | アイドル時の RSS 150 MB という目標に収まります。 |

お金が動く処理は、すべて 1 つの `db.transaction(...)` の中で実行します。プリペアドステートメントは一度だけ作って使い回します。毎晩のバックアップはオンラインバックアップ API（`sqlite3 .backup`）を使い、ファイルのコピーは決してしません。

## コアテーブル（0001_init）

| テーブル | キー | 役割 |
| --- | --- | --- |
| `users` | `user_id` | 全体で共通のアイデンティティのキャッシュ（ユーザー名、表示名、アバター）。 |
| `guilds` | `guild_id` | サーバーとその承認状態（`pending` / `approved` / `denied`。`REQUIRE_APPROVAL` 用）。 |
| `guild_config` | `guild_id` | サーバーごとの設定: 優先する `locale`、`announce_channel_id`（なければ `ANNOUNCE_CHANNEL_ID`）、お知らせのオンとオフ、大勝ちのしきい値、お知らせの頻度。 |
| `guild_announce_types` | `guild_id, event_type` | イベントの種類ごとのオンとオフ、チャンネルの上書き。 |
| `guild_features_off` | `guild_id, feature` | オーナーがオフにした機能。 |
| `guild_members` | `guild_id, user_id` | プレイヤーの、1 つのサーバーでのアカウント。経済はサーバーごとです。 |
| `ledger` | `id` | 追加のみのお金のログ: `delta`、`balance_after`、`reason`、任意の `ref_type` / `ref_id`、`idempotency_key`、`meta`。 |
| `balances` | `guild_id, user_id` | 現在の残高。台帳からトリガーが更新します。 |
| `idempotency_keys` | `guild_id, user_id, key` | キーごとの最初のレスポンス。繰り返されたときはこれを返します。`request_hash` で、同じキーを別の本文で使い回したことを検出します。 |
| `launch_intents` | `guild_id, user_id` | 認証のあとに開く画面。新しいものが古いものを置き換え、2 分で期限切れになり、使うと `consumed_at` が入ります。 |
| `user_settings` | `user_id` | 言語（`NULL` = 自動）、サウンド、音量、アニメーション（`system` / `full` / `reduced`）、テーマ、DM のダイジェスト。ユーザーごとの全体設定です。0004 で形が変わりました（下を参照）。 |
| `notification_prefs` | `user_id, kind` | `NotificationKind` ごとの、DM のオプトイン（既定はオフ）と受信箱（既定はオン）。システムの受信箱の種類（`SYSTEM_INBOX_KINDS`: `dm_disabled`）には行がありません。常に書き込まれ、DM は送りません。 |
| `notification_queue` | `id` | 送信待ちの DM。状態、試行回数、`next_attempt_at`、`dedupe_key` を持ちます。 |
| `inbox` | `id` | アクティビティ内の、ユーザーとサーバーごとの受信箱。`read_at` を持ちます。`kind` は `InboxKind`（`NOTIFICATION_KINDS` と `dm_disabled`）で、`payload` は `InboxPayload`（ドメインイベント、または `DmDisabledNotice`）の JSON です。 |

### 台帳の不変条件（トリガーで強制）

- `ledger` は `UPDATE` と `DELETE` を拒否します。明示した `id` がすでにある INSERT も拒否するので、`INSERT OR REPLACE` や upsert で履歴を上書きすることはできません。
- INSERT は `balance_after = 直前の残高（なければ 0）+ delta` を満たす必要があります。
- INSERT のたびに、新しい行から `balances` を upsert します。
- `balances` は、その口座の最新の台帳の行と食い違う INSERT（`INSERT OR REPLACE` も含む）、UPDATE、DELETE をすべて拒否します。そのため、直接書き込んでもお金は動かせません。
- `CHECK (balance_after >= 0)` と `CHECK (balance >= 0)`: 残高が 0 を下回ることはありません。

### 決定: 残高は決してマイナスにしない

元のボットは、負債をウォレットの外に置いています。`users.debt` は収入から差し引いて返す帝愛の負債で、プレイヤー間のローンは `loans` にあります。古いスキーマには、`balance` が 0 を下回る仕組みはありません。これを引き継ぎます。負債とローンはサーバーごとの別のテーブル（`bank_accounts`、`loans`）に持ち、通信のスキーマは負でない `Pelica` を使い、SQL でも強制します。利息や返済で残高が 0 を下回ることはありません。返済や差し引きは、現在の残高までしか引かず（`loan_repay`、`debt_withholding`）、残りは負債の行に残ります。取り込みスクリプトは、旧データにマイナスの残高があれば、取り込まずにエラーとして報告します。

そのため、口座ごとに `balances.balance = SUM(ledger.delta)` が常に成り立ちます。台帳に行を追加するコードは `EconomyService` だけで、トリガーが知らない業務ルール（上限、手数料、送金の制限）もここで確認します。トリガーのテストは `0001_init.test.ts` です。

### 0004 のあとの `user_settings`（B1）

`UserSettings`（`packages/shared/src/settings.ts`）はユーザーごとの全体設定なので、テーブルは `user_id` のキーを保ちます。SQLite は `CHECK` をその場で変更できないため、`0004_user_settings.sql` がテーブルを作り直します（`user_settings_new` を作り、コピーし、元を削除し、名前を変える。すべてマイグレーションのトランザクションの中で）。

| 列 | 0001 | 0004 のあと | 通信（`UserSettings`） |
| --- | --- | --- | --- |
| `user_id` | `TEXT` 主キー → `users` | 変更なし | （セッション） |
| `locale` | `'en'` / `'ja'`、`NULL` = 自動 | 変更なし | `language`: `NULL` ↔ `'auto'` |
| `sound` | 0/1、既定 1 | 変更なし | `sound.enabled` |
| `volume` | 0〜100、既定 70 | **削除** | — |
| `sfx_volume` | — | **追加**: `INTEGER NOT NULL DEFAULT 30 CHECK (sfx_volume BETWEEN 0 AND 100)`。`volume` からコピー | `sound.sfxVolume` |
| `music_volume` | — | **追加**: `INTEGER NOT NULL DEFAULT 30 CHECK (music_volume BETWEEN 0 AND 100)`。`volume` からコピー | `sound.musicVolume` |
| `motion` | `system` / `full` / `reduced`、既定 `system` | 変更なし | `motion` |
| `theme` | `system` / `light` / `dark`、既定 `system` | **変更**: `CHECK (theme IN ('discord', 'light', 'dark'))`、既定 `'discord'`。`'system'` の行は `'discord'` になる | `theme` |
| `dm_digest` | 0/1、既定 1 | 変更なし | （`UserSettings` にはない） |
| `updated_at` | ミリ秒 | 変更なし | — |

行のないユーザーには `DEFAULT_USER_SETTINGS` が適用されます。`PUT /api/settings` は行全体を upsert します。

### 0011 のあとの `arena_tournaments`

`0011_arena_runner_up.sql` は、`arena_tournaments` に NULL 可の列を 1 つ足します。

| 列 | 型 | 意味 |
| --- | --- | --- |
| `runner_up_id` | `INTEGER REFERENCES arena_fighters (id)` | 決勝の 2 位。同じトーナメントの闘士で、決勝の決着時に `champion_id` と一緒に入ります。トーナメントが開催中のときと、マイグレーションより前に終わったトーナメント（2 位は保存されていませんでした）では `NULL` です。 |

過去のデータは埋め直さず、お金の列も関係しません。[arena.ja.md](spec/arena.ja.md#45-準優勝リマスターでの追加マイグレーション-0011) の §4.5 を見てください。

## 機能ごとのテーブル

機能ごとに、上の規約に沿って、それぞれのマイグレーションでテーブルを足しました。

**ペリカ、賭け金、ポジション、請求権を持つテーブルは、すべてサーバーごとです**（`guild_id` を持ち、プレイヤーの行は `guild_members` を参照します）。証券も同じです。保有、信用、オプション、債券はサーバーごとです。サーバーをまたいで共有するのは、元のボットと同じく、下の読み取り専用のフィードだけです。

| マイグレーション | 分野 | サーバーごとのテーブル |
| --- | --- | --- |
| `0003_legacy_import` | 取り込み | `legacy_ledger`（読み取り専用の旧履歴）、`legacy_import_runs` |
| `0005_casino` | カジノゲーム | `game_rounds`（進行中のラウンド、保留中の賭け金）、`jackpots`、`rtp_levels`、`pachinko_sets`、`pachinko_spins` |
| `0006_notify_webhooks` | ボット | `guild_webhooks`（ペルソナ） |
| `0007_finance` | 帝愛銀行 | `bank_accounts`（debt、bankrupt_at、blacklist_until）、`bank_reserve`、`house_account`、`bank_deposits`、`loans`、`cds` |
| `0007_finance` | 共済、会社 | `kyosai_units`、`kyosai_auctions`、`kyosai_offers`、`kyosai_motions`、`kyosai_votes`、`companies`、`company_stakes` |
| `0007_finance` | 証券、プレイヤーマーケット | `positions_spot`、`positions_short`、`positions_long`、`options`、`bonds`、`earnings_memos`、`earnings_shop`、`marketplace_listings` |
| `0008_games_progression` | 統計、デイリー、ミッション、ランキング | `play_state`（連勝や遊んだ回数）、`daily_claims`、`missions`、`weekly_stats`、`weekly_champions`、`weekly_state` |
| `0008_games_progression` | ショップとアイテム | `inventory`、`profiles`、`shop_stock`、`seized_items`、`teiai_market`、`teiai_market_days` |
| `0008_games_progression` | レース、闘技場 | `horses`、`horse_races`、`horse_entries`、`horse_odds`、`horse_bets`、`arena_tournaments`、`arena_fighters`、`arena_bets` |
| `0008_games_progression` | 労働、クイズ、抽選会、投票 | `work_state`、`work_workers`、`work_finds`、`work_click_hours`、`quiz_answers`、`raffles`、`raffle_entries`、`polls`、`poll_votes` |
| `0009_horse_breeding` | 配合 | `horse_breedings`（`horse_breeding_fee` の台帳の `ref_id`）と、`horses` の親、世代、誕生、成熟、間隔の列（[horse-breeding.ja.md](spec/horse-breeding.ja.md) §5） |
| `0010_bot_tools` | 持ち主向けのツール | `leaderboards`（サーバーごとに固定表示するランキングのメッセージ）、`casino_events`（持ち主が手で始める特別イベント。サーバーごとに最大 1 つ） |
| `0011_arena_runner_up` | 闘技場 | `arena_tournaments.runner_up_id`（上を参照） |
| `0012_pinned_posts` | ボット | `pinned_posts`（下を参照） |
| `0013_stream` | 配信パネル | `streams`、`stream_rounds`、`stream_bets`、`stream_round_audit`（下を参照） |

`0012_pinned_posts.sql` は `pinned_posts` を作ります。ボットがチャットの投稿をピン留めした投票・共済の動議・抽選 1 件につき 1 行です。列は `kind`（`poll`、`motion`、`raffle`）、`ref_id`（`polls`・`kyosai_motions`・`raffles` の id。`kind` と合わせて主キー）、`guild_id`、`channel_id`、`message_id`、`pinned_at`、`tries`（想定外のエラーでピン留め解除に失敗した回数）です。外部キーはなく、元の行が消えていれば終了とみなします。`notify:pin-sweep` ジョブは、元が `open` でなくなった投稿のピン留めを外し、行を消します。ペリカは持たず、台帳の行もありません。インポーターは持ち込みません。[spec/polls.ja.md](spec/polls.ja.md) §2.5、[spec/kyosai.ja.md](spec/kyosai.ja.md) §6、[spec/lottery.ja.md](spec/lottery.ja.md) §2.3 を見てください。

`0013_stream.sql` は配信パネルのテーブルです（[spec/stream.ja.md](spec/stream.ja.md) §14）。4 つとも STRICT で、時刻はミリ秒、スノーフレークは TEXT です。

- `streams`：パネル 1 枚。`guild_id`、`streamer_id`（`guild_members` の行）、`title`（1〜100）、`url`（null か 300 文字まで）、チャットのパネルの `channel_id` と `message_id`（Activity だけで始めた配信は null）、`voice_channel_id`（配信者の Activity インスタンスのボイスチャンネル。Discord に確かめた値で、ボットが作ったチャンネルではありません。決定 D4）、`started_at`、`ends_at`（開始 + 24 時間）、`ended_at`、`tips` と `tip_count`（パネルの合計）、`status`（`live` か `ended`。`ended_at` は終わったときだけ入ります）。部分ユニークインデックス `streams_one_live`（`(guild_id, streamer_id) WHERE status = 'live'`）で、1 サーバーに配信者 1 人あたり配信中のパネルは 1 枚です。`streams_live_due` は自動終了ジョブ用です。
- `stream_rounds`：勝ち負けの勝負 1 回。`stream_id`、`guild_id`、`label`（0〜60。空なら、読む人の言語の既定の名前）、`status`（`open`、`locked`、`win`、`lose`、`void`）、`created_at`、`auto_lock_at`（開始 + 10 分）、`locked_at`、`settled_at`（決まったときだけ入ります）。部分ユニークインデックス `stream_rounds_one_active`（`stream_id WHERE status IN ('open', 'locked')`）で、決まっていない勝負は配信 1 つにつき 1 回です。片方にしか賭けがなかった勝負は、宣言した状態（`win` か `lose`）のまま全額返金になり、監査の行に `refunded` が残ります。
- `stream_bets`：勝負 1 回につき 1 人 1 行。主キーは `(round_id, user_id)`。`side`（`win` か `lose`）と `amount`（0 より大きい、合計の賭け金。2 回目の賭けは足されます）。お金は台帳にあります：`stream_bet` の行（`ref_type = 'stream_round'`、`ref_id` は勝負の番号）で預かり、同じ参照の `stream_payout` か `stream_refund` で返します。キーは各人の口座で `stream_round:{id}:payout|refund` なので、1 回の勝負で 1 人に払うのは多くて 1 回です。
- `stream_round_audit`：終わった勝負 1 回につき 1 行。精算か無効にしたのと同じトランザクションで書きます（決定 D3-2）。`round_id`（主キー）、`stream_id`、`guild_id`、`streamer_id`、`label`、`opened_at`、`locked_at`、`ended_at`、`outcome`（`win`、`lose`、`void`）、`cause`（`streamer`、`owner`、`stream_end`、`timeout`）、`actor_id`（タイマーのときは null）、`reason`（運営の理由、1〜200）、`bettors`、`win_total`、`lose_total`、`rake`（帝愛の控除と端数。返金なら 0）、`refunded`（0/1）、`top`（JSON。大きい順に最大 10 件の `{userId, amount}`。返金なら空）。運営だけが見るもので、データベースがあるかぎり残します。

スパチャには専用のテーブルがありません。`ref_type = 'stream'`、`ref_id` が配信の番号の `transfer_out`・`transfer_fee`・`transfer_in` の台帳の行です。メッセージは保存しません。インポーターはこれらのテーブルを持ち込みません（取り込みの時点で、元の Bot には配信パネルがありません）。

| 共有フィード（`guild_id` なし、お金なし） | マイグレーション |
| --- | --- |
| `market_prices`（`price_micros`）、`market_fair`、`market_events`、`earnings` | `0007_finance` |
| `quiz_questions`（公式のクイズは `guild_id` が `NULL`、サーバー独自の問題は値あり） | `0008_games_progression` |

## 旧テーブルの対応

元は、元の Bot の `data/casino.db` です。取り込みスクリプト（`apps/server/scripts/import-legacy.ts`。処理は `apps/server/src/db/legacy-import.ts`）は、元の Bot を止めた状態で実行します。`--apply` を付けないかぎり、試しに実行するだけです。

v1.0.0 の取り込みスクリプトが運ぶのは、お金のテーブルだけです：

| 旧テーブル | 新しいテーブル | メモ |
| --- | --- | --- |
| `users` | `users`、台帳の `legacy_import` | `balance` は、メンバーごとに `legacy_import` の台帳の行 1 つになります。 |
| `guild_users` | `guild_members` | `users` の行も作ります。 |
| `guild_status` | `guilds` | `status`、`name`、`decided_by`、`updated_at`、`notified_at`。 |
| `escrow` | 台帳の `game_refund` | 終わっていないゲームの賭け金は、最初の行の直後に返金します。 |
| `ledger` | `legacy_ledger` | 読み取り専用の履歴としてコピーします。`ledger` には再生しません。最初の `legacy_import` の行が、新しい連鎖の起点です。 |

ほかの旧テーブル（統計、連続日数、プロフィール、持ち物、馬、闘技場、労働、マーケット、金融、クイズ、投票、抽選、メッセージへのポインター）は取り込みません。これらの機能は、リマスターでは一から始まります。そこに保留中のペリカ（未決着の賭け、入札、労働の pot、預金、信用）があれば、取り込みの前に元の Bot で精算してください。

### 値の変換

- ID: 旧 `INTEGER` の ID は `safeIntegers(true)`（BigInt）で読み、10 進の文字列として書きます。JS の数値は決して経由しません。
- 時刻: 旧 `REAL` のエポック秒は `Math.round(ts * 1000)` のミリ秒になります。
- お金: 旧 `INTEGER` のペリカはそのままコピーします。
- 旧データにマイナスの残高があれば、レポートを出して取り込みを止めます。

### ペリカが動いていない証明

取り込みスクリプトは、サーバーごと、ユーザーごとに、期待する残高と取り込んだ残高を表示し、1 つでも差があれば 0 以外で終了します。プレイヤーごとに、新しい残高は `users.balance` に返金した `escrow` を足したものに等しくなります。同じファイルでの 2 回目の実行は何もしません（`legacy_import_runs` が元のファイルのダイジェストを持ちます）。
