[English](DB_SCHEMA.md) | **日本語**

# データベーススキーマ

SQLite のファイルは 1 つで、サーバーのプロセス 1 つが `better-sqlite3` で開きます。マイグレーションは `apps/server/src/db/migrations/` に番号付きの `.sql` ファイルとして置き、サーバーのバンドルに埋め込み、順番に、1 つずつトランザクションで適用します。マージ済みのマイグレーションは決して編集せず、新しいファイルを足してください。`0001_init.sql` に、下のコアテーブルがあります。機能ごとのテーブルは、担当者が後のマイグレーションで書きます（[予定のテーブル](#予定のテーブルwave-2) を参照）。

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

## 予定のテーブル（Wave 2）

担当者が、自分のマイグレーション（`0002_...` 以降）で、規約に沿って作ります。名前は出発点で、担当者が見直してかまいません。

**ペリカ、賭け金、ポジション、請求権を持つテーブルは、すべてサーバーごとです**（`guild_id` を持ち、プレイヤーの行は `guild_members` を参照します）。証券も同じです。保有、信用、オプション、債券はサーバーごとです。サーバーをまたいで共有するのは、元のボットと同じく、下の読み取り専用のフィードだけです。

| 分野 | サーバーごとのテーブル | 担当 |
| --- | --- | --- |
| 統計 | `player_stats` | B1（`GameSettled` の購読者） |
| カジノゲーム | `game_rounds`（進行中のラウンド、保留中の賭け金）、`jackpots`、`rtp_levels`、`pachinko_spins`、`pachinko_sets` | B2-A |
| デイリー、ミッション、ランキング | `daily_claims`、`missions`、`weekly_stats`、`weekly_champions`、`weekly_state`、`titles`、`nick_prefs` | B2-B |
| イベント | `event_state`、`manual_events` | B2-B |
| レース、闘技場 | `horses`（＋繁殖の列。[horse-breeding.ja.md](spec/horse-breeding.ja.md) §5）、`horse_breedings`（`horse_breeding_fee` の台帳の `ref_id`）、`horse_races`、`horse_entries`、`horse_bets`、`horse_odds`、`arena_tournaments`、`arena_fighters`、`arena_bets` | B2-B |
| 労働、クイズ、抽選会、投票 | `work_state`、`work_finds`、`work_click_hours`、`work_workers`、`quiz_answers`、`raffles`、`raffle_entries`、`polls`、`poll_votes` | B2-B |
| ショップとアイテム | `inventory`、`shop_stock`、`profiles`、`seized_items`、`teiai_market`、`teiai_market_days` | B2-B |
| プレイヤーマーケット | `marketplace_listings` | B3 |
| 証券 | `positions_spot`、`positions_short`、`positions_long`、`options`、`bonds`、`earnings_memos`、`earnings_shop` | B3 |
| 帝愛銀行 | `bank_accounts`（debt、bankrupt_at、blacklist_until）、`bank_reserve`、`house_account`、`bank_deposits`、`loans`、`cds` | B3 |
| 共済、会社 | `kyosai_units`、`kyosai_auctions`、`kyosai_offers`、`kyosai_motions`、`kyosai_votes`、`companies`、`company_stakes` | B3 |
| ボット | `bot_messages`、`guild_webhooks`（ペルソナ） | B4 |
| 取り込み | `legacy_ledger`（読み取り専用の旧履歴）、`legacy_import_runs` | B1 |

| 共有フィード（`guild_id` なし、お金なし） | 担当 |
| --- | --- |
| `market_prices`（`price_micros`）、`market_fair`、`market_events`、`earnings` | B3 |
| `quiz_questions` | B2-B |

## 旧テーブルの対応

元は Python ボットの `data/casino.db` です。取り込みスクリプト（`apps/server/scripts/import-legacy.ts`、B1）は、Python のボットを止めた状態で実行します。

| 旧テーブル | 新しいテーブル | メモ |
| --- | --- | --- |
| `users` | `guild_members`、台帳経由の `balances`、`player_stats`、`daily_claims`、`bank_accounts` | `balance` は `legacy_import` の台帳の行 1 つになります。`daily_streak`、`last_daily`、`last_slot` は `daily_claims` へ。`games_played`、`total_wagered`、`total_won`、`biggest_win` は `player_stats` へ。`debt`、`bankrupt_at`、`blacklist_until` は `bank_accounts` へ。 |
| `guild_users` | `guild_members` | `users` の行も作ります。 |
| `guild_status` | `guilds` | `status`、`name`、`decided_by`、`updated_at`、`notified_at`。 |
| `features_off` | `guild_features_off` | 1 対 1。 |
| `ledger` | `legacy_ledger` | 読み取り専用の履歴としてコピーします。`ledger` には再生しません。最初の `legacy_import` の行が、新しい連鎖の起点です。 |
| `escrow` | 台帳の `game_refund` | 終わっていないゲームの賭け金は、最初の行の直後に返金します。 |
| `play_state` | `player_stats` | 連勝、プレイ数、勝ち数、収支。 |
| `missions` | `missions` | 1 対 1。 |
| `weekly_stats`、`weekly_champions`、`weekly_state` | 同じ名前 | 1 対 1。 |
| `nick_prefs` | `nick_prefs` | 1 対 1。 |
| `profile` | `profiles`、`titles` | 称号、カード、スキン、デイリーのブースト、保険。 |
| `inventory`、`shop_stock` | 同じ名前 | 1 対 1。 |
| `jackpot` | `jackpots` | プールを引き継ぎます。 |
| `rtp_level` | `rtp_levels` | 1 対 1。 |
| `pachinko_spins`、`pachinko_sets` | 同じ名前 | 統計のみ。任意。 |
| `event_state`、`manual_event` | `event_state`、`manual_events` | 1 対 1。 |
| `horses`、`horse_races`、`horse_entries`、`horse_bets`、`horse_odds` | 同じ名前 | 未決着の賭けは、保留中の賭け金を保ちます。 |
| `arena_tournaments`、`arena_fighters`、`arena_bets` | 同じ名前 | NPC の賭け手は負のユーザー ID を使っていました。`NULL` のユーザーと NPC の列として保存します。 |
| `labor`、`labor_finds`、`labor_click_hours`、`labor_workers` | `work_state`、`work_finds`、`work_click_hours`、`work_workers` | 受け取っていない `pot` は、保留中のペリカです。 |
| `market_listings` | `marketplace_listings` | 最高入札額は保留中のペリカです。 |
| `seized_items`、`teiai_market`、`teiai_market_days` | 同じ名前 | `day`（REAL）は日付かミリ秒になります。 |
| `quiz_questions`、`quiz_answers` | 同じ名前 | 問題は全体で共有です。 |
| `raffle`、`raffle_entries` | `raffles`、`raffle_entries` | 開催中の抽選会の参加費は、保留中のペリカです。 |
| `polls`、`poll_votes` | 同じ名前 | 1 対 1。 |
| `market_prices`、`market_fair`、`market_events`、`earnings` | 同じ名前 | 共有フィード。価格と係数は固定小数点の整数にします。 |
| `earnings_memos`、`earnings_shop` | 同じ名前 | サーバーごと（ペリカで買うため）。 |
| `crypto`、`crypto_short`、`crypto_long` | `positions_spot`、`positions_short`、`positions_long` | サーバーごと。数量は `_milli`、価格は `_micros` に。信用は保留中のペリカです。 |
| `options`、`bonds`、`loans`、`cds` | 同じ名前 | サーバーごと。権利行使価格と現物価格は `_micros` に。`loans.rate_tenths`（1 日あたり 0.1 %）は `rate_bps`（×10）に。 |
| `teiai_bank`、`teiai_house`、`teiai_deposits` | `bank_reserve`、`house_account`、`bank_deposits` | サーバーごと。旧 `REAL` の現金、貸出額、サーモスタットの額は `INTEGER` のペリカになります（上の丸めのルールを使い、取り込みスクリプトが丸めの誤差の合計を報告します）。レートは bps に。 |
| `kyosai_units`、`kyosai_auctions`、`kyosai_offers`、`kyosai_motions`、`kyosai_votes` | 同じ名前 | `user_id = 0`（ハウスのユニット）は、`NULL` のユーザーとハウスのフラグになります。 |
| `companies`、`company_stakes` | 同じ名前 | 会社の資金は、プレイヤーの残高とは別です。 |
| `leaderboards`、`chart_posts`、`chart_boards` | `bot_messages` | メッセージへのポインターです。チャンネルがなくなっていれば捨てて問題ありません。 |

### 値の変換

- ID: 旧 `INTEGER` の ID は `safeIntegers(true)`（BigInt）で読み、10 進の文字列として書きます。JS の数値は決して経由しません。
- 時刻: 旧 `REAL` のエポック秒は `Math.round(ts * 1000)` のミリ秒になります。テキストの日付はテキストのままです。
- お金: 旧 `INTEGER` のペリカはそのままコピーします。旧 `REAL` のお金（銀行の内部の値）は、取り込み時に一度だけ丸めのルールで丸めます。プレイヤーの残高はもともと `INTEGER` なので、下のプレイヤーごとの証明は厳密に成り立ちます。
- レート、価格、数量: bps、マイクロペリカ、ミリ単位に変換します（`REAL` は残りません）。
- 旧データにマイナスの残高があれば、レポートを出して取り込みを止めます（上の決定を参照）。

### ペリカが動いていない証明

取り込みスクリプトは、サーバーごと、ユーザーごとに、項目（プレイヤーの残高、保留中の賭け金、保留中の入札額、受け取っていない労働の pot、預金、債券の元本、信用、抽選会の参加費）ごとの旧と新の合計を表示し、1 つでも差があれば 0 以外で終了します。プレイヤーごとに、新しい残高は `users.balance` に返金した `escrow` を足したものに等しく、それ以外の保留中の額は、そのまま新しいテーブルに引き継がれます。同じファイルでの 2 回目の実行は、何も起きないことが条件です（`legacy_import_runs`）。
