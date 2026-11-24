[English](MAINTAINERS.md) | **日本語**

# メンテナー向けガイド

カジノを動かし続け、手を入れていく人のための手引きです。リポジトリの構成、各部分のつながり、起動・リリース・バックアップの方法、機能の足し方、困ったときの対処をまとめています。はじめてのセットアップは、画面を追って進められる別のガイド [オーナー向けセットアップガイド](docs/OWNER_SETUP.ja.md) を見てください。コードの作りを詳しく知りたいときは [docs/ARCHITECTURE.ja.md](docs/ARCHITECTURE.ja.md) です。

関連文書：[CONTRIBUTING.ja.md](CONTRIBUTING.ja.md)、[SECURITY.ja.md](SECURITY.ja.md)、[CHANGELOG.ja.md](CHANGELOG.ja.md)、[docs/STATUS.ja.md](docs/STATUS.ja.md)。

## 目次

- [管理している人](#管理している人)
- [リポジトリの案内](#リポジトリの案内)
- [各部分のつながり](#各部分のつながり)
- [ローカルですべて動かす](#ローカルですべて動かす)
- [環境変数](#環境変数)
- [リリースの手順](#リリースの手順)
- [マイグレーションとバックアップと復元](#マイグレーションとバックアップと復元)
- [旧データベースの取り込み](#旧データベースの取り込み)
- [新しいゲームを追加する](#新しいゲームを追加する)
- [翻訳キーを追加する](#翻訳キーを追加する)
- [お知らせや DM の種類を追加する](#お知らせや-dm-の種類を追加する)
- [デザイントークンを更新する](#デザイントークンを更新する)
- [ドット絵を作り直す](#ドット絵を作り直す)
- [サーバーを Raspberry Pi に移す](#サーバーを-raspberry-pi-に移す)
- [漏れた秘密情報を交換する](#漏れた秘密情報を交換する)
- [困ったときは](#困ったときは)
- [元のボットとクレジット](#元のボットとクレジット)

## 管理している人

このリポジトリと本番のボットは [S3nc0](https://github.com/S3nc0) が管理しています。趣味のプロジェクトなので、レビューや修正は時間のあるときに行い、サポートの約束はありません。ペリカはゲームの中だけのお金で、現実の価値はありません。

## リポジトリの案内

| パス | 中身 |
| --- | --- |
| `apps/server/` | サーバー本体（1 つのプロセス）。Fastify の HTTP API、Socket.io、Discord チャットボット、スケジューラー、SQLite。入口は `src/main.ts` です。 |
| `apps/server/src/` | `auth/` ログインとセッション、`db/` ストア・マイグレーション・インポーター、`economy/` 台帳の書き込み役、`finance/` 銀行・ローン・株・会社・市場、`games/` 各ゲーム、`http/` ルート、`socket/` Socket.io、`bot/` スラッシュコマンド、`notify/` お知らせ・DM・受信箱、`runtime/` 起動・ジョブ・制限。 |
| `apps/server/scripts/` | `import-legacy.ts`（旧データの取り込み）と `load.ts`（負荷テスト用）。 |
| `apps/web/` | Discord アクティビティ本体（React 19 + Vite）。`src/shell/` が外枠（ログイン、ソケット、ストア）、`src/screens/` が画面のグループごとのフォルダです。 |
| `packages/shared/` | サーバーと画面の両方が守る取り決め。ID、TypeBox スキーマ、ソケットとドメインのイベント、台帳の理由、環境変数の仕様、`i18n/` の英日テキスト。 |
| `packages/domain/` | ゲームのルールだけを書いた純粋な部分。入出力も時計も独自の乱数も持ちません。 |
| `packages/ui/` | Bitbloom。コンポーネント、デザイントークン、フォント、ドット絵のアイコンとスプライト、効果音とエフェクト。 |
| `catalogs/` | 調整できる数値（配当、価格、金利）の YAML。 |
| `design/` | Bitbloom のデザイントークンと、それを作るスクリプト。 |
| `tools/pixel-art/` | アイコン、スプライト、場面をすべて作るジェネレーター：`icons/`、`horse/`、`scenes/`、`casino/`、`social/`、`finance/`（[ドット絵を作り直す](#ドット絵を作り直す) を参照）。 |
| `tests/` | `e2e/`（複数クライアントのソケットテスト）、`invariants/`（台帳のプロパティテスト）、`fixtures/legacy/`（元のボットで記録した一致確認用のデータ）。ユニットテストはコードの隣にあります。 |
| `ops/` | `pi/` インストーラーと systemd ユニット、`cloudflared/` トンネルのひな形、`pi-sim/` arm64 コンテナと負荷テスト。 |
| `docs/` | オーナー向けガイド、`ARCHITECTURE.md`、`DB_SCHEMA.md`、`STATUS.md`、`spec/`（動作仕様）、`ui-cheatsheet.md`（どれも英日）、元のボットのゲームごとのメモ（日本語）。 |

元の Python ボットはツリーにはなく、v1.0.0 より前の git 履歴にあります（そこからファイルを読む方法は [docs/spec/INDEX.ja.md](docs/spec/INDEX.ja.md) を参照）。

ワークスペースのパッケージは TypeScript のソースのまま読み込まれます。型だけを消せる構文に限る（enum やパラメータプロパティは使わない）、相対インポートは `.ts` で終える、が決まりです。サーバーは `tsup` で `apps/server/dist/main.js` にまとめられます。

## 各部分のつながり

```text
Discord クライアント ──(アクティビティの iframe)──▶ Cloudflare Pages (apps/web)
      │                                                │  fetch /api、ソケット /api/socket.io
      │ スラッシュコマンド                                ▼
      ▼                                    Discord プロキシ (URL マッピング) ─▶ トンネル ─▶ サーバー :3001
 Discord ゲートウェイ ◀── discord.js ──────────────────────────────────────────────┘
                                   1 つの Node プロセス: HTTP + Socket.io + ボット + ジョブ
                                   1 つの SQLite ファイル (data/casino.sqlite)
```

- **アクティビティ**は Cloudflare Pages に置いた静的サイトです。Discord の中からは、Developer Portal でマッピングした URL にしか届きません。`/` は Pages、`/api` はトンネル経由でサーバー、`/discord-cdn` は Discord のアバター用 CDN につながります。
- **ログイン：** アクティビティが Discord からコードをもらい、`POST /api/token` に送ると、1 時間有効なセッショントークンが返ります。このトークンで HTTP ルートとソケットが使えます。サーバーは、サーバー（ギルド）・動作中のアクティビティ・ユーザーが正しいかを、Discord 本体に問い合わせて確かめます。
- **チャットボット**と**アクティビティ**は、同じプロセスの同じサービスにつながる 2 つの入口です。スラッシュコマンドもアクティビティのボタンも同じコードを呼ぶので、残高とルールはいつも一致します。
- **サービス**がペリカを動かすのは `EconomyService` を通したときだけで、ゲームの状態や重複防止の記録と一緒に、1 回の SQLite トランザクションで確定します。確定のあと、プロセス内のバスに**ドメインイベント**を流します。
- バスの**購読者**は、ソケットのルーム（アクティビティへのリアルタイム更新）、お知らせとウェブフックのペルソナ、DM キュー、受信箱、プレゼンス、統計・ミッション・ランキングです。
- **スケジューラー**が時間で動く処理（相場の更新、レース、デイリーのリセット、闘技場、宝くじ、ローン、後片付け）を動かします。

認証の手順や各層が守るルールまで含めた全体像は [docs/ARCHITECTURE.ja.md](docs/ARCHITECTURE.ja.md) にあります。

## ローカルですべて動かす

Node 24（`.nvmrc`）と pnpm 12.21.0（`package.json` の `packageManager`）が必要です。

```sh
pnpm i
cp .env.example .env        # 自分のマシンで本物の値を入れる
pnpm -r build
```

| やりたいこと | コマンド |
| --- | --- |
| 変更のたびに再ビルドするサーバー | `pnpm dev:server`（`.env` を読みます） |
| アクティビティの開発サーバー（ポート 5173、`/api` を `localhost:3001` へ中継） | `pnpm --filter @casino/web dev` |
| Discord なしでアクティビティを動かす（モック SDK とメモリ上の API） | `pnpm --filter @casino/web dev:mock`。URL に `?screen=blackjack` や `?locale=ja` を足せます |
| Discord からサーバーに届くようにするトンネル | `pnpm dev:tunnel`（名前付きトンネル）または `pnpm dev:tunnel:quick` |
| スラッシュコマンドの登録 | `pnpm commands:deploy:guild`（`TEST_GUILD_ID` のサーバーへ）、`pnpm commands:deploy:global`、先に中身を見るなら `pnpm commands:dry-run` |
| チャットボットなしでサーバーを動かす | `.env` に `BOT_DISABLED=1` |

push の前に、CI と同じチェックをすべて通します。

```sh
pnpm -r build && pnpm -r test && pnpm -r typecheck
pnpm lint && pnpm format:check && pnpm i18n:check
pnpm exec vitest run --config tests/vitest.config.ts tests/e2e
INVARIANT_RUNS=300 pnpm exec vitest run --config tests/vitest.config.ts tests/invariants
```

- 失敗したプロパティテストをやり直すときは `INVARIANT_SEED=<数字>` を付けます。
- 時間のかかるテストは、ふだんは飛ばします。リリースの前と、馬の配合に手を入れたときに走らせてください：`SLOW_TESTS=1 pnpm --filter @casino/server test`（今は配合の範囲をすべて調べる R-8）。
- ブラウザでの一連の確認（デスクトップと幅 390 px）には Chrome が必要です：`pnpm --filter @casino/web exec vitest run --config e2e/vitest.config.ts`。
- Pi の負荷テストには Docker が必要です：`ops/pi-sim/perf.sh --duration 60`（[docs/PI_SETUP.ja.md](docs/PI_SETUP.ja.md) を参照）。
- 1 つのトークンでボットを 2 つ同時に動かさないでください。古い Python ボットや別のマシンが動いていたら、先に止めます。

## 環境変数

ここには名前だけを書きます。本物の値はホスト上の `.env` にだけ置き、ほかの場所には書きません。コメント付きのひな形は `.env.example` です。サーバーは起動時に値を検査し、おかしいものがあればそのキーの名前を表示します。

| 変数 | 秘密？ | メモ |
| --- | --- | --- |
| `DISCORD_TOKEN` | **はい** | ボットトークン。 |
| `DISCORD_CLIENT_ID` | いいえ | アプリケーション ID。Cloudflare Pages の `VITE_DISCORD_CLIENT_ID` と同じ値にします。 |
| `DISCORD_CLIENT_SECRET` | **はい** | OAuth2 のクライアントシークレット（ボットトークンではありません）。 |
| `DISCORD_PUBLIC_KEY` | いいえ | 16 進の公開鍵。Discord のプロキシ署名の検証に使います。 |
| `ALLOWED_GUILD_IDS` | いいえ | アクティビティを使えるサーバー ID（カンマ区切り）。 |
| `OWNER_IDS` | いいえ | `/admin` を使えるユーザー ID（カンマ区切り）。 |
| `TEST_GUILD_ID` | いいえ | `commands:deploy:guild` で登録するサーバー。 |
| `REQUIRE_APPROVAL` | いいえ | `ALLOWED_GUILD_IDS` の外のサーバー用に予約中で、今は効果がありません。 |
| `UTC_OFFSET_HOURS` | いいえ | ゲーム内の 1 日の区切り（日本時間なら `9`）。ジョブの時刻もこれで読みます。 |
| `SESSION_SECRET` | **はい** | ランダムな 32 バイト以上。セッショントークンの署名に使います。 |
| `PUBLIC_API_ORIGIN` | いいえ | API の公開オリジン（末尾のスラッシュなし）。 |
| `ANNOUNCE_CHANNEL_ID` | いいえ | お知らせの既定チャンネル（サーバーごとの設定はデータベースに保存されます）。 |
| `REQUIRE_PROXY_SIGNATURE` | いいえ | `0` のまま。Discord はアクティビティの通信に署名ヘッダーを付けません。 |
| `HOST` | いいえ | `127.0.0.1` のまま。トンネルはローカルから接続します。 |
| `PORT` | いいえ | 既定は `3001`。 |
| `DATABASE_PATH` | いいえ | 既定は `./data/casino.sqlite`。旧 `casino.db` は絶対に指定しません。 |
| `LOG_LEVEL` | いいえ | `fatal`、`error`、`warn`、`info`、`debug`、`trace`、`silent` のどれか。 |
| `BOT_DISABLED` | いいえ | `0` でボットがログイン、`1` でオフライン。 |
| `NODE_ENV` | いいえ | 省略可、既定は `production`。`development` にするとプロキシ署名の検査が切れます。 |

ほかに出てくる名前：`VITE_DISCORD_CLIENT_ID` と `VITE_API_HOST`（Cloudflare Pages 用、公開される値）、`VITE_MOCK_DISCORD`（ローカルのモックモード）、`INVARIANT_RUNS`、`INVARIANT_SEED`、`SLOW_TESTS`（テスト用）、`CHROME_PATH` と `README_SHOTS`（スクリーンショットのスクリプト用）、`CLOUDFLARED_CONFIG`（`dev:tunnel` 用）、`ART_OUT`、`ART_REF`、`ART_THEME`（ドット絵ツール用）。`VITE_` で始まる変数に秘密を入れてはいけません。公開されるバンドルに入ってしまいます。

## リリースの手順

リリース用のパイプラインはありません。Pages は `main` から自動でビルドされ、サーバーは手で更新します。`vX.Y.Z` を出すときの手順です。

1. **`main` を確認する。** リリースするコミットで CI のジョブがすべて緑であること（check、invariants、e2e、pi-sim、サーバーを変えたなら Perf も）。時間のかかるテストも 1 回走らせます：`SLOW_TESTS=1 pnpm --filter @casino/server test`。
2. **変更履歴を書く。** `CHANGELOG.md` と `CHANGELOG.ja.md` の `Unreleased`（`未リリース`）を日付に変え、変わったことが両方の言語で分かりやすい言葉で並んでいるか確かめて、プルリクエストでマージします。
3. **タグを付ける。**

   ```sh
   git switch main && git pull
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```

   必要なら、タグから GitHub のリリースを作り、変更履歴の該当部分を本文にします。
4. **Pages のデプロイ。** `main` への push でビルドはすでに始まっています。Cloudflare の **Workers & Pages → プロジェクト → Deployments** で、リリースのコミットのデプロイが **Success** になっているか確認し、Pages の URL をブラウザで開きます。ビルドが失敗していたら、サーバーを再起動する前に直して push します。設定は [docs/DEPLOY_PAGES.ja.md](docs/DEPLOY_PAGES.ja.md) にあります。
5. **サーバーの再起動。** 起動時に新しいマイグレーションが走るので、先にバックアップを取ります（[下](#マイグレーションとバックアップと復元)）。
   - Pi の場合：インストールに使ったクローンを更新して、`sudo bash ops/pi/install.sh` をもう一度実行します。コードの同期、インストール、ビルド、サービスの再起動までやってくれます。`.env` と `data/` には触りません。
   - Mac の場合：サーバーを止めて、`git pull`、`pnpm i`、`pnpm dev:server`。
6. **コマンド。** スラッシュコマンドを追加・改名したなら、`pnpm commands:deploy:guild`（ほかのサーバーにも出すなら `pnpm commands:deploy:global`）を実行します。
7. **動作確認。** `curl https://<API のホスト>/api/health` が 200 を返し、ログに `casino server listening` が出ていることを見てから、[オーナー向け動作確認チェックリスト](docs/OWNER_TESTING.ja.md) を実施します。

API やソケットの取り決めを壊す変更は、画面とサーバーを同時に変える必要があります。できるだけ「足すだけ」の変更にして、古いタブを開いたままの人もリロードするまで動くようにしておきましょう。

## マイグレーションとバックアップと復元

**マイグレーション。** データベースの構造は `apps/server/src/db/migrations/` にある番号付きの SQL ファイルで、`index.ts` に並べ、サーバーの起動時に順番どおり 1 ファイルずつトランザクションで適用されます。適用済みファイルのチェックサムは `schema_migrations` に記録されます。

- マージ済みのマイグレーションは絶対に書き換えません。次の番号で新しく足します。適用済みのファイルが書き換わっていたり、このビルドが知らないマイグレーションがデータベースに入っていたり（新しいビルドが書いたもの）すると、サーバーは起動を拒否します。そのファイルで古いビルドを動かさないでください。
- 最新は `0012_pinned_posts` です（ボットがピン留めした投票・共済の動議・抽選の投稿を覚えておく `pinned_posts` テーブル。掃除のジョブがピン留めを外すために使います）。その前の `0011_arena_runner_up` は、`arena_tournaments.runner_up_id` という NULL 可能な列を足し、決勝の 2 位を保存します（それ以前に終わった大会では空です）。
- お金の列は整数、金利は bp（ベーシスポイント）、価格は固定小数点です。ルールとテーブルは [docs/DB_SCHEMA.ja.md](docs/DB_SCHEMA.ja.md) にあります。

**バックアップ。** Pi では systemd のタイマーが毎晩 3:30 ごろに `ops/pi/backup.sh` を実行し、`/var/backups/discord-casino/` に 7 日分を残します。SQLite のオンライン `.backup` を使うので、サーバーが動いていても安全です。今すぐ取るには：

```sh
sudo systemctl start discord-casino-backup.service
ls -lh /var/backups/discord-casino/
```

Mac では、サーバーが動いていても止まっていても：`sqlite3 data/casino.sqlite ".backup 'casino-backup.sqlite'"`。サーバーの動作中に `casino.sqlite` を `cp` でコピーしないでください。最新の状態の一部が隣の `-wal` ファイルにあるためです。ときどき、バックアップを別のディスクや別のパソコンにも写しておきましょう。

**復元。**

```sh
sudo systemctl stop discord-casino.service
sudo -u casino rm -f /opt/discord-casino/data/casino.sqlite-wal /opt/discord-casino/data/casino.sqlite-shm
sudo -u casino cp /var/backups/discord-casino/casino-YYYYMMDD-HHMMSS.sqlite /opt/discord-casino/data/casino.sqlite
sudo systemctl start discord-casino.service
sudo journalctl -u discord-casino.service -n 50 --no-pager
```

残っている `-wal` と `-shm` は置き換える前のファイルのものです。残したままだと、SQLite が復元したファイルにそれを適用しようとすることがあります。復元すると、バックアップより後の出来事はすべて消え、プレイヤーのペリカもその時点に戻ります。プレイヤーには知らせてください。必要になる前に、予備のコピーで一度復元を試しておきましょう。

## 旧データベースの取り込み

取り込みツールが引き継ぐのは、旧 Python ボットの**財布**です。各プレイヤーの残高（最初の台帳行 `legacy_import` 1 行）、途中のゲームに預けていた賭け金の返金、サーバーの承認状態とメンバー、旧台帳（読み取り専用の履歴）です。ほかのもの（馬、株、会社、アイテムなど）は新しく始まります。テーブルごとの対応と、ペリカが 1 枚も動かないことの証明は [docs/DB_SCHEMA.ja.md](docs/DB_SCHEMA.ja.md#旧テーブルの対応) にあります。

**v1.0.0 では、オーナーの判断で予行演習（dry run）を省きました。** そのため、テスト用のデータでは確かめてありますが、本物の `casino.db` ではまだ動かしていません。実行するときは次の手順で、必ず予行演習の出力を読んでから本番にします。

1. Python ボットと新しいサーバーを止めます。`casino.db` のコピーを作って、そのコピーを使います。たった 1 つの原本を直接指定してはいけません。
2. **予行演習**（何も書き込みません）。サーバーごと、プレイヤーごとに、残高、返金される賭け金、期待される合計と、警告・エラーが表示されます。

   ```sh
   node apps/server/scripts/import-legacy.ts --legacy data/casino.db
   ```

3. `error` と出たものは直します（たとえば旧データに負の残高があると取り込みは止まります）。合計を、旧ボットで見えていた数字と見比べます。
4. 新しいデータベースファイルへ**本番の取り込み**。すべてを 1 つのトランザクションで書き込み、プレイヤーごと・サーバーごとの合計を検証して、ペリカが 1 枚でも合わなければ何も書かずに 0 以外の終了コードで終わります。

   ```sh
   node apps/server/scripts/import-legacy.ts --legacy data/casino.db --target data/casino.sqlite --apply
   ```

5. もう一度同じコマンドを実行します。同じデータへの 2 回目の `--apply` は何もしません（元データのダイジェストが `legacy_import_runs` に記録されています）。そのあとでサーバーを起動します。

`casino.db` のコピーは、git の外の安全な場所に保管してください（`data/` は git の管理対象外です）。取り込みツールが読むのはこのファイルだけで、もうリポジトリにない元のボットのコードは要りません。

## 新しいゲームを追加する

次の順番で進めます。各ステップの隣にテストを置きます。進めながら、既存のゲーム（いちばん揃っているのはブラックジャック）を見本にしてください。

1. **取り決め**（`packages/shared`）：`src/ids.ts` の `GAME_IDS` に ID を足します（`SCREEN_IDS` は自動で追従します）。ライブ対戦ならインテントとテーブルの形を `src/intents.ts` と `src/socket.ts` に、新しい `ErrorCode` があればそれも、ゲームに必要な `LEDGER_REASONS` を `src/ledger.ts` に（フローの分類と符号つきで）足します。台帳の理由は追加するだけで、名前の変更や削除はしません。ミッションやお知らせに見せたいなら `GameSettled` のタグ名も足します。
2. **ルール**（`packages/domain/src/<game>/`）：状態、入力、`DomainContext`（`rng`、`clock`）を受け取って `Outcome` を返す純粋な関数。入出力、実時間、勝手な乱数は使えません（lint と `purity.test.ts` が検査します）。調整できる数値は `catalogs/` に置き、domain の定数に整数でそろえて写します。
3. **サービス**（`apps/server/src/games/<game>/`）：状態を読み、domain の関数を呼び、**1 つの** `store.transaction` の中で、`EconomyService` で残高を動かし（リクエストの idempotency キー付き）、ゲームの状態と idempotency の記録を保存します。イベントは `afterCommit` で流します。`games/index.ts`（カジノ系）か `games/progression/register.ts`（それ以外）に登録し、`runtime/server.ts` でつなぎます。
4. **ソケットイベントか HTTP ルート**：カジノ形式のラウンドは既存の `game:bet` / `game:action` インテントを使います（`games/casino/handlers.ts`）。それ以外の画面は `http/activity/` にルートのファイルを足し、`http/activity/index.ts` に登録します。ユーザー・サーバー・インスタンスをリクエスト本文から受け取ってはいけません。セッションのものを使います。ルートの名前は `packages/shared/src/activity/` に 1 か所だけ定義し（たとえば `FINANCE_ROUTES`）、書き込みにはすべて idempotency キーを付けます。`POST /api/finance/listings/create`（持っている取引可能なアイテムを預けて、プレイヤー市場の出品にするルート。`GET /api/finance/listings` が返す `sellable` の一覧がフォームの元になります）が、まねしやすい小さな例です。
5. **画面**（`apps/web/src/screens/<group>/`）：コンポーネント、API フック、`dev:mock` 用のモック、CSS、`screens/routes.tsx` への遅延読み込みの登録。部品は `@casino/ui` のコンポーネントとトークンだけを使います。ゲームアイコンは `tools/pixel-art/icons/` で描きます。画面に場面の絵があるなら、`tools/pixel-art/` のほかのものと並べてジェネレーターを置き、画面の隣に `*-art.ts` を書き出します（[下](#ドット絵を作り直す)）。
6. **スラッシュコマンド**（`apps/server/src/bot/`）：`commands.ts` の `COMMAND_SPECS` に、英語と日本語の名前・説明つきでコマンドを足し、対応するチャット用モジュールにハンドラーを書き、パスを `WIRED_COMMAND_PATHS` に加えて、`pnpm commands:deploy:guild` を実行します。
7. **i18n**：新しい文言は `en.ts` と `ja.ts` の両方に（画面名は `screen.<id>`、ボットの返信は `bot.*`、エラーは `error.<code>`）。`pnpm i18n:check` が通ること。
8. **テスト**：domain のユニットテスト、サービスのテスト（同じ idempotency キーの再送も）、ソケットまたはルートのテスト、お金が動くなら `tests/invariants/commands.ts` にコマンドを足してプロパティテストに遊ばせます。動作のメモを `docs/` に、1 行を `CHANGELOG.md` に足します。

## 翻訳キーを追加する

1. `packages/shared/i18n/en.ts` **と** `packages/shared/i18n/ja.ts` の両方にキーを足し、`{プレースホルダー}` を同じにします。キーは平らなドット区切りで、分野ごとに `bot.*`（チャットの返信）、`notify.*`（お知らせ、DM、受信箱のメモ）、`horse.*`、`finance.*`、`error.<code>`、`screen.<id>`、`inbox.kind.<kind>` です。
2. 使うときは、サーバーでは `t(locale, 'some.key', { name })`、アクティビティでは `useT()`。モジュールごとの辞書は持たず、文字列の直書きもしません。
3. `pnpm i18n:check` を実行します。キーの抜け、空の文、プレースホルダーの不一致があると失敗します。エラーコード、画面 ID、受信箱の種類にラベルがない場合は型チェックでも失敗します。
4. 日本語は、英語の逐語訳ではなく、日本語を話す人が自然に言う形で書きます。

## お知らせや DM の種類を追加する

お知らせ、トースト、DM、受信箱は、すべて**ドメインイベント**から始まります。

1. **イベント**（`packages/shared/src/events.ts`）：ユニオンと `DOMAIN_EVENT_TYPES` に種類を足します。どのイベントにも `guildId` と `at` を持たせます。サービスから、確定のあとに流します。
2. **誰がリアルタイムで見られるか**（`apps/server/src/socket/domain-audience.ts`）：イベントは、公開リスト `GUILD_PUBLIC` に足さない限り、名前の挙がったユーザーにしか届きません。サーバーの全員に見せてよいものだけを足します。
3. **お知らせ**（`apps/server/src/notify/messages.ts`）：`SUBSCRIBED_EVENT_TYPES` に種類を足し、`EVENT_META` に項目（タイトルと本文のキー、色の役割、ペルソナ、既定でお知らせするか、通知の種類、トーストの調子）を足します。`notify.event.<Type>.title` と `.body` を両言語で足し、文にフィールドが要るなら描画部分も書きます。
4. **オプトインの DM と受信箱の種類**（`packages/shared/src/notify.ts`）：`NOTIFICATION_KINDS` に種類を足し、`NOTIFICATION_SOURCE` で元のイベントに結びつけます。`inbox.kind.<kind>` を両言語で足します。イベントに結びつかないシステムからのお知らせは、代わりに `SYSTEM_INBOX_KINDS` に入れます（DM の設定はなく、DM も送られません）。
5. **テスト**：`notify/messages.test.ts`、お知らせと DM のテスト、届く相手が意図どおりかの確認。

## デザイントークンを更新する

色、余白、文字は Bitbloom のトークンから来ます。生成された CSS は手で直さないでください。

1. `design/bitbloom/build_tokens.py` でテーマを変え、`python3 design/bitbloom/build_tokens.py` を実行します。`design/bitbloom/proposal/archive/` の元のパレットから、`design/bitbloom/tokens.json` と `tokens.css` が作り直されます。
2. `python3 design/bitbloom/contrast_check.py` を実行します。すべての色の組み合わせが、両方のテーマで基準を満たす必要があります。
3. アプリに反映します。`packages/ui/src/styles/tokens.css` は、生成された CSS を Prettier にかけ、日本語フォントのフォールバックを残したものです。`tokens.json` と一致するかをテストが確かめ、`contrast.test.ts` がアプリの読み込む CSS でコントラストの規則を再確認します。
4. Discord の埋め込みの色は `apps/server/src/notify/theme.ts` でトークンに合わせてあり、ずれるとそのテストが失敗します。
5. `pnpm --filter @casino/ui test` と `pnpm --filter @casino/server test` を実行し、アクティビティをライトとダークの両方、スマホの幅で目で確かめます。

## ドット絵を作り直す

アイコン、スプライト、場面は、どれも手で直さず、ジェネレーターで作っています。コマンド、入力、プレビュー、出力は [tools/pixel-art/README.ja.md](tools/pixel-art/README.ja.md) にあります。`tools/pixel-art/` の構成：

| フォルダ | 描くもの | 書き出す先（とくに書いていなければ `apps/web/src/screens/`） |
| --- | --- | --- |
| `icons/` | ゲームアイコン 35 個 | `packages/ui/src/pixel/icon-art.ts` と `packages/ui/src/styles/bundle.css` のアイコンの色 |
| `horse/` | 8 コマの競走馬（参考資料が必要） | `horse/horse-art.ts` と `horse/horse.css` の毛色と勝負服の色 |
| `scenes/` | レース、厩舎、配合、闘技場（戦士 16 人）、鉱山（鉱夫、鉱石、発掘品）、ショップ、持ち物 | `horse/race-art.ts`、`stable-art.ts`、`arena-art.ts`、`life/mine-art.ts`、`shop-art.ts`、`inventory-art.ts` |
| `casino/` | スロット、チンチロ、ブラックジャック、ルーレット、パチンコ、チップ | `casino/art/*-art.ts` |
| `social/` | クイズ、抽選、投票、ミッション、ランキング、発掘品、送金、デイリー、履歴、プロフィール | `life/*-art.ts`、`casino/daily-art.ts`、`casino/history-art.ts`、`profile/profile-art.ts` |
| `finance/` | 銀行、融資、共済、株、暗号資産、会社、マーケット、コイン、バッジ、ハンマー | `finance/art/*.ts` |
| `lib/` | 共通の部品：パレットの段階の名前（`palette.js`）、8 倍で描く補助（`hi.js`）、出力先（`env.js`） | |
| `vendor/` | codixel の中核（`pixel.js`、MIT）。PNG、GIF、シートのプレビュー用 | |

作り直すときは、リポジトリのルートから実行します（どの `ship.js` も書き出したファイルを整形します。ジェネレーターを変えずに実行し直しても差分は出ません）。

```sh
node tools/pixel-art/icons/build.js
ART_OUT=/some/folder ART_REF=/some/folder/ref node tools/pixel-art/horse/ship.js
ART_REF=/some/folder/ref node tools/pixel-art/scenes/ship.js
node tools/pixel-art/casino/ship.js
node tools/pixel-art/social/ship.js
node tools/pixel-art/finance/ship.js
```

- **絵の出荷のしかた。** 絵は画像ではなくデータです。スプライトはそれぞれ行の文字列の並びと、各文字をパレットのトークンの組 `[ライト, ダーク]` に対応させる凡例でできています。`packages/ui/src/pixel/` の `PixelScene` と `useSceneFrame` / `useSceneOnce`（または画面ごとの `CasinoScene` / `FinanceScene`）が、各文字を今のテーマのトークンで、整数倍の大きさで塗ります。ライトは昼、ダークは夜です。動く部分は小さな重ね絵で出荷し、0 コマ目が、動きを減らす設定で見える止まった絵です。
- **画面ごとの遅延読み込み。** `*-art.ts` は使う画面の隣にあり、その画面からしか読み込みません。画面は `screens/routes.tsx` が遅延読み込みします。ホーム（`index` のチャンク）はどれも読み込まないので、場面を足しても最初の画面は遅くなりません。この形を守り、画面の絵を外枠や `@casino/ui` から読み込まないでください。
- 馬、厩舎の肖像、戦士、鉱夫は、**リポジトリに入れない**参考資料から作っています。必要なファイルの入手方法は README にあります。参考にする資料は、パブリックドメインか CC0 のものに限り、[CREDITS.md](CREDITS.md) と [CREDITS.ja.md](CREDITS.ja.md) に（題名、作者、ライセンス、出典、使い方）を載せます。
- 使う色は `design/bitbloom/tokens.css` のパレットの段階だけです（`tools/pixel-art/lib/palette.js` に名前があります）。
- 実行したあとは、`pnpm format`、`pnpm --filter @casino/ui test`、`pnpm --filter @casino/web test` を実行します。

## サーバーを Raspberry Pi に移す

[docs/PI_SETUP.ja.md](docs/PI_SETUP.ja.md)（[English](docs/PI_SETUP.md)）の手順に従います。要点は、**名前付き**トンネルでオーナーセットアップを終えておく、64 ビットの Pi で `ops/pi/install.sh` を実行する、`/opt/discord-casino/.env`（権限 600）を作る、トンネルの認証情報を `/etc/cloudflared/` に置く、Pi を起動する**前に**元のマシンのサーバーを止める（トークンごとにボットは 1 つ、データベースへの書き込み役も 1 つ）、きれいな `.backup` をとった `casino.sqlite` をコピーする、2 つのサービスを起動して `/api/health` を確かめる、です。コードの変更は要りません。メモリや CPU の実測値も、このガイドにあります。

## 漏れた秘密情報を交換する

チャット、スクリーンショット、イシュー、ログ、コミットに貼ってしまった秘密情報は、漏れたものとして扱います。後片付けより先に、まず交換してください。各秘密情報の役割は [SECURITY.ja.md](SECURITY.ja.md) にあります。

| 秘密情報 | 交換のしかた | そのあと起こること |
| --- | --- | --- |
| `DISCORD_TOKEN` | Developer Portal → **Bot** → **Reset Token**。新しい値を `.env` に入れて再起動。 | 古いトークンはすぐ使えなくなります。再起動するまでボットはオフラインです。 |
| `DISCORD_CLIENT_SECRET` | Developer Portal → **OAuth2** → **Reset Secret**。`.env` を更新して再起動。 | サーバーが新しい値を持つまで、ログインは `code_exchange_failed:401` で失敗します。 |
| `SESSION_SECRET` | `openssl rand -hex 32` で新しく作り、`.env` を更新して再起動。 | すべてのセッションが切れ、プレイヤーはアクティビティを開き直します。ほかに失うものはありません。 |
| トンネルの認証情報 | Cloudflare でトンネルを削除して作り直す（またはトークンを更新する）。`/etc/cloudflared/` と `config.yml` を更新し、`cloudflared` を再起動。 | 新しいトンネルが動くまで API に届きません。ホストが変わったら `/api` の URL マッピングも更新します。 |
| `DISCORD_PUBLIC_KEY`、`DISCORD_CLIENT_ID` | 公開してよい値で、秘密情報ではありません。 | 交換は不要です。 |

そのあとで、`git log` と `git grep` で古い値が残っていないか調べます。コミットしてしまった場合も、直すべきは値の交換です（履歴を書き換えても、漏れたこと自体は取り消せません）。身に覚えのない利用がないか、サーバーのログと Developer Portal を見て、起きたことを書き留めておきます。

## 困ったときは

まずサーバーのログを見ます（Pi では `journalctl -u discord-casino.service -f`、Mac では `pnpm dev:server` を動かしているターミナル）。認証の失敗は `auth rejected: <理由>` の 1 行で出ます。理由と直し方は [オーナー向けセットアップガイドの手順 10](docs/OWNER_SETUP.ja.md#10-トラブルシューティング) にあります。

**アクティビティが真っ白、固まる、「refused to connect」や CSP エラー。** Discord の中では、アクティビティは厳しいコンテンツセキュリティポリシーのもとにある iframe で動きます。URL マッピングで公開されたものしか読み込めないので、ほかのホストへのリクエストはすべてブロックされます。
- Discord デスクトップ版の開発者ツールを開き、コンソールを見ます。「Refused to connect to / load … Content Security Policy」のような行に、ブロックされたホストの名前が出ます。
- アプリが外部のホストを名指ししてはいけません。フォントも画像もバンドルに含めてあり、バンドルに許可されていないホストが出てくると `pnpm --filter @casino/web build` が（`scripts/check-bundle.js` で）失敗します。CSS に外部 URL を書くことも、テストで禁止されています。
- Developer Portal の 3 つのマッピング（`/` → Pages のホスト、`/api` → API のホスト、`/discord-cdn` → `cdn.discordapp.com`）を確認します。`https://` と末尾のスラッシュは付けず、**Save Changes** を押したかも確かめます。
- クイックトンネルは再起動のたびにホストが変わるので、`/api` のマッピングを更新します。
- 最新の Pages のデプロイが成功しているか、そこに `VITE_DISCORD_CLIENT_ID` が設定されているかも確かめます。
- `pnpm --filter @casino/web dev:mock` を動かすと、「アプリが壊れている」のか「Discord 側の設定が壊れている」のかを切り分けられます。

**ソケットがつながらない。** ソケットは `/api/socket.io` で、WebSocket のみです。トンネルが WebSocket を通すこと、`/api` のマッピングが `/api` の接頭辞を残していることが必要です。ハンドシェイクが拒否されると、詳細つきの `socket_auth_failed` がログに出ます。1 人のユーザーが同時に持てるソケットは 5 本までで（6 本目は `rate_limited` で拒否されます）、1 つのクライアントが再接続を繰り返す暴走をするとこの形になります。セッショントークンの 1 時間が過ぎると、クライアントが自動で新しいトークンをもらって再接続します。それが起きないときは `session_expired` を探します。

**レート制限。** `rate_limited` や HTTP 429 は、制限に当たったことを表します。HTTP は 1 アドレスあたり毎分 600 回、1 ユーザーあたり毎分 240 回、`POST /api/token` は 1 アドレスあたり毎分 30 回、ソケットのイベントは 1 ユーザーあたり 10 秒に 100 回（そのユーザーの全ソケットで共有）、ほかにゲームごとの賭けと操作の制限があります。クライアントのアドレスとして信じるのはプロキシ 1 段だけなので、もしトンネルの設定を誤って全員が同じアドレスから来たように見えると、全員で 1 つの枠を分け合うことになります。制限はメモリ上にあり、サーバーを再起動するとリセットされます。

**SQLite が busy / locked。** サーバーはファイルを 1 回だけ開き、busy のタイムアウトは 5 秒です。`SQLITE_BUSY` のほとんどは、別のプロセスが書き込みのためにそのファイルを開いている状態です。別のサーバー（たとえば Mac と Pi の両方）、トランザクションを開きっぱなしの `sqlite3` シェル、取り込みツールのようなスクリプトなどです。もう一方を止めてください。`.backup` のバックアップは安全です。サーバーの動作中にファイルを `cp` でコピーしないでください。

**スラッシュコマンドが出ない、ボットが 2 回答える。** 出ないとき：`pnpm commands:deploy:guild` をもう一度実行し、`TEST_GUILD_ID` を確かめます。2 回答えるとき：同じ `DISCORD_TOKEN` で別のプロセスがログインしています。それを止めます。

**サーバーが起動しない。** `invalid environment: <KEY> is invalid` はそのキーが不正です。`.env` を直します（引用符なし、行末のコメントなし）。`migration N … was edited` や `database has migration N, which this build does not know` は、コードとデータベースファイルの版が合っていないという意味です。どちらかを、対応する版に戻します。

## 元のボットとクレジット

このプロジェクトは [fatcorn753/discord-casino-bot](https://github.com/fatcorn753/discord-casino-bot)（元の Python ボットで、ゲームのルールの出どころ）のハードフォークです。両方の作者の名前は [LICENSE](LICENSE)（MIT）にあります。外部のコード、フォント、馬、厩舎の肖像、戦士、鉱夫の元になったパブリックドメインと CC0 の参考資料は、ライセンスとともに [CREDITS.ja.md](CREDITS.ja.md) に載せています。素材を足したら、そのつど [CREDITS.md](CREDITS.md) と一緒に更新してください。
