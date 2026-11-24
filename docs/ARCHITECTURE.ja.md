[English](ARCHITECTURE.md) | **日本語**

# アーキテクチャ

メンテナー向けの案内（動かす、リリースする、機能を足す）は [MAINTAINERS.ja.md](../MAINTAINERS.ja.md) を見てください。

## プロセスとパッケージ

Node 24 のプロセスが 1 つだけ動きます。Fastify（HTTP API）、Socket.io（同じサーバー内）、discord.js（チャットボット。`Guilds` インテントのみ）、cron スケジューラーが、型付きのプロセス内 `EventEmitter` バス（`DomainEventMap`）でつながっています。Redis もブローカーも ORM もありません。tsup がサーバーを `dist/main.js` にまとめます（ワークスペースのコードは中に入れ、npm の依存は外に置きます）。実行時は `--max-old-space-size=192` を付けます。Web アプリは Vite + React のビルドで、Cloudflare Pages に置きます。

`packages/shared` には契約（TypeBox スキーマ、ソケットイベント、ルーム、ドメインイベント、台帳の理由、ID、環境変数の契約、プロキシ検証、RNG と時計のインターフェース、i18n）があります。`packages/domain` は純粋なルール、`packages/ui` は Bitbloom のコンポーネントです。ワークスペースのパッケージは TypeScript のソースのまま使います。使える構文は erasable なものだけで、相対 import は `.ts` を付けます。

## 起動の順番と停止

`apps/server/src/main.ts` が環境変数を検証します（`loadConfig` を `ServerEnv` に対して実行します。値が不正ならキーの名前だけを示すメッセージを出して停止し、値は出しません）。続けてデータフォルダを作り、`createServer` と `startRuntime` を呼びます。

- `createServer`（`runtime/server.ts`）は、1 つの `EventBus` の上にすべてのサービスを作ります。SQLite の `Store`（マイグレーションはここで実行）、`EconomyService`、設定、受信箱、セッション、起動インテント、トークンの流れ、金融、カジノゲーム、カジノ以外のゲーム、Fastify アプリ、Socket.io サーバー、ジョブの一覧を持つスケジューラーです。この時点ではまだ待ち受けません。
- `startRuntime`（`runtime/lifecycle.ts`）は次の順に起動します。チャットボット（`startBot`。`BOT_DISABLED=1` ならゲートウェイにログインしません）、通知ランタイム（どのジョブが発行するより前にバスを購読します）、HTTP とソケット（`listen`）、最後にスケジューラーです。
- `SIGINT` / `SIGTERM` では逆順に止めます。スケジューラー（実行中のジョブを待ちます）、通知、ボット、HTTP とソケット、データベースの順です。失敗したステップはログに残し、次のステップも続けて実行します。`installProcessGuards` は、処理されなかった rejection をログに残します。1 つの悪いハンドラーでプロセス全体が落ちることはありません。

## 永続化

SQLite のファイルは 1 つで、`better-sqlite3` の接続も 1 つです（`db/store.ts`）。`Store.transaction` は `BEGIN IMMEDIATE` で始めます（書き込みロックを先に取るので、読み取り側が途中で昇格してビジーエラーになることはありません）。入れ子はセーブポイントとして扱い、`afterCommit` コールバックは一番外側のコミットのあとにだけ実行します。ロールバックしたときは捨てます。「イベントはコミット後に発行する」という約束はこの仕組みで守られています。接続ごとの pragma（`db/pragmas.ts`）は、WAL、`synchronous = NORMAL`、`busy_timeout = 5000`、外部キー、再帰トリガーです。

マイグレーションは `db/migrations/` にある番号付きの `.sql` ファイルです（執筆時点で `0001_init` から `0014_color_roles` まで）。`db/migrations/index.ts` に並べ、バンドルの中に埋め込みます。`runMigrations` は新しいものを順番に、1 つずつトランザクションで適用し、SHA-256 のチェックサムを `schema_migrations` に記録します。適用済みのマイグレーションが書き換えられていた場合や、ファイルにこのビルドの知らないマイグレーションがある場合（新しいビルドが書いたもの）は、サーバーは起動を拒否します。マージ済みのマイグレーションは決して編集せず、新しいものを足してください。テーブルとルールは [DB_SCHEMA.ja.md](DB_SCHEMA.ja.md) にあります。

## スケジューラーとジョブ

`runtime/scheduler.ts` は `JobSpec`（`id`、cron、`run`）を `croner` で動かします。cron のフィールドはゲームのタイムゾーンで読みます（`UTC_OFFSET_HOURS`。JST なら 9）。`runtime/jobs.ts` が唯一の一覧です。金融のジョブ（市場、帝愛銀行、ローン、共済はそれぞれ毎分、会社は日次とメンテナンス、プレイヤーマーケットの精算）、ゲームのジョブ（レースは 1 日 4 回、デイリーのリセットとリマインダー、闘技場、週間ランキング、抽選会、投票、クイズ、ショップの市場、配信パネルの `stream:lock-due` と `stream:close-due` は毎分）は `denied` でないサーバーごとに 1 回ずつ実行します。ピン留めの掃除（30 秒ごと。[Notify](#notify) を参照）、名前の色のロールのスイープ `shop:color-role-sweep`（30 秒ごと。[名前の色のロール](#名前の色のロール) を参照）と、後片付けのジョブもあります（期限切れの冪等キーは 10 分ごと、期限切れの起動インテントは毎分）。ジョブが例外を投げてもログに残すだけでスケジューラーは止まりません。1 つのサーバーが例外を投げても、ほかのサーバーは止まりません。

## チャットボット

`apps/server/src/bot/` にあります。`commands.ts` の `COMMAND_SPECS` に、すべてのスラッシュコマンド、サブコマンド、オプションを、英語と日本語の名前と説明、オーナー専用かサーバー専用か、担当モジュールとともに持たせています。`buildSlashCommands` が、このスペックをローカライズ付きの Discord の JSON に変換します。`WIRED_COMMAND_PATHS` は、ハンドラーがあるコマンドの一覧です。`router.ts` はインタラクション（コマンド、オートコンプリート、ボタン、モーダル、セレクトメニュー）を受け取り、ユーザーのロケールを決め（`locale.ts`）、スペックに従ってオーナー専用とサーバー専用のルールを確認し、チャットモジュール（`casino-chat.ts`、`finance-chat.ts`、`progress-chat.ts`、`admin-tools.ts`、`wired-commands.ts`）に渡します。チャットモジュールは、アクティビティのルートと同じサービスを呼びます。コマンドの登録はサーバー起動とは別のスクリプトです。`pnpm commands:deploy:guild`（`TEST_GUILD_ID` に登録）、`pnpm commands:deploy:global`、送る内容を表示するだけの `pnpm commands:dry-run` があります。クライアントが求めるのは `Guilds` インテントだけで、キャッシュとスイーパーの設定（`BOT_CACHE_SETTINGS`、`BOT_SWEEPER_OPTIONS`）でメモリを小さく保っています。

## 名前の色のロール

`apps/server/src/games/shop/color-roles.ts`（`ColorRoleService`、`games.shop.colorRoles`）は、付けている名前の色を Discord のロールとしてメンバーに付けます（[spec/shop.ja.md](spec/shop.ja.md) §2.4）。正しいのはデータベースです。`profiles.color_role` が選んだ色、`color_roles` がボットの作ったロール（ほかのロールには触りません）、`color_role_holders` が各メンバーに付けたロールで、変更のたびに同じトランザクションで `color_role_sync` の行を書きます（最後の1つが持ち物からなくなるとき、つまり `Inventory.take` の差し押さえ・市場への出品・そのほかの取り上げも含みます）。Discord を呼ぶのはコミットの後だけで、ボットのクライアントの REST を使う `ColorRoleRest`（ロール一覧と Bot のメンバー、ロールの作成、色・位置の変更、メンバーへのロールの付け外し）を通します。ピン留めのポートと同じく、ログインの後に取り付けます。必要なインテントは `Guilds` だけで、メンバーはキャッシュしません。同期はサーバーごとのロックで1つずつ行うので、1色にロールが2つできることはありません。付けた操作はその行をすぐ反映します（チャットの返事と `POST /api/life/shop/color-role` は数秒まで待ち、Discord に断られたら `notice` を返します）。残りは `shop:color-role-sweep` ジョブ（30 秒ごと）が反映し、ロールの管理がない・ロールが低いときは 10 分ごとに1日（ログはサーバーごとに 10 分に1行）、想定外のエラーは3回までやり直します。コマンドやジョブを止めることはなく、`BOT_DISABLED=1` のときは行が待ちます。

## 通知

`apps/server/src/notify/` にあります。`attachNotify` は、毎分発行される `MarketTick` を除くすべてのドメインイベントを購読し（`SUBSCRIBED_EVENT_TYPES`）、それぞれを `EVENT_META` に従って振り分けます。`EVENT_META` には、タイトルと本文の i18n キー、埋め込みの色の役割、Webhook のペルソナ（任意）、既定でお知らせするかどうか、プレイヤーが選べる場合の `NotificationKind`、トーストのトーンが入っています。

- **アナウンサー**（`announcer.ts`）: イベントをまとめて埋め込みにし、サーバーのお知らせチャンネルに送ります（サーバーごとの設定を優先し、なければ `ANNOUNCE_CHANNEL_ID`）。サーバーごとに毎分の上限があり、Discord の retry-after も守ります。
- **ペルソナ**（`personas.ts`）: レースの実況、マーケットのニュースデスク、帝愛銀行として投稿する Webhook です。
- **DM キュー**（`dm-queue.ts`）: オプトインのダイレクトメッセージです。再試行とバックオフがあり、一度に多く届くときはダイジェストにまとめます。Discord のエラー 50007（DM が閉じている）が出ると、そのユーザーの DM はすべての種類がオフになり、受信箱に `dm_disabled` のお知らせを書きます。
- **受信箱**（`inbox-writer.ts`）と**トースト**: 同じイベントを受信箱に保存し、ユーザーのソケットルームにも送ります。
- **ピン留め**（`post-pins.ts`）: 新しい投票・共済の動議・抽選のチャット投稿をピン留めし（`PostPinService.pinPost`）、`pinned_posts` に記録します。`notify:pin-sweep` ジョブ（30 秒ごと）が、投票・動議・抽選が `open` でなくなったものを順にピン留め解除します。**メッセージをピン留め（Pin Messages）** 権限が必要で、失敗してもその前後のコマンドやジョブは止まりません。ピン留めが拒否されたときはログに残し（ギルドごとに 10 分に 1 行まで）、削除済みのメッセージは無視します。Discord 側は別の `PostPinPort` で、ボットのログイン後に取り付けます。
- **配信の投稿**（`stream-posts.ts`）: 配信パネルのチャット投稿（スパチャのカード、勝負の開始、自動締め切りのお知らせ、結果。[spec/stream.ja.md](spec/stream.ja.md) §13）は、パネルを投稿したチャンネルにだけ送り、お知らせチャンネルには送りません。お知らせと同じサーバーごとの枠（1 つの `GuildRateLimiter`）を使い、枠を使い切ったら、サーバーごとの小さなキューで待ちます。パネルのメッセージそのものは、チャット側が `StreamService.onChange` を見て編集します。

Discord へのやり取りはすべて `DiscordNotifyPort`（`ports.ts`）を通ります。`BOT_DISABLED=1` のときは何もしないポートを使うので、HTTP、ソケット、ジョブは動き続けます。

## アクティビティのフロントエンド

`apps/web` は Vite + React 19 のアプリで、状態管理は Zustand です。フォントもアセットもすべてバンドルに含めます（Discord の iframe がアクセスできるのは、マッピングされた URL だけだからです。`scripts/check-bundle.js` は、バンドルに未登録のホストが出てくるとビルドを失敗させ、CSS に外部 URL があるとテストが失敗します）。

- `shell/` はアプリの外枠です。`ShellRuntime`（`shell/runtime.ts`）が、`ActivitySdk`（Discord の中では本物の Embedded App SDK、`VITE_MOCK_DISCORD=1` なら `DiscordSDKMock`）、`AuthController`（上の認証の流れとサイレント更新）、HTTP の `Api`、`SocketController`（再接続とルーム）、プレゼンス、設定の同期をつなぎます。状態は `shell/stores/`（session、balance、inbox、nav、connection、settings、toasts）に置きます。`shell/config.ts` は URL からモードを決めます（`frame_id` と `instance_id` があれば Discord です）。
- `screens/routes.tsx` は、すべての `ScreenId` をコンポーネントに結びつけます。作り終えた画面は遅延読み込みし、対応するコンポーネントがない ID にはプレースホルダーを出します。画面は区分ごとにまとめています。`casino/`、`finance/`、`horse/`（レース、繁殖、闘技場）、`life/`（労働、クイズ、抽選会、投票、ショップ、ミッション、ランキング、送金、発掘品、持ち物）、`profile/`、`stream/`（配信パネル、スパチャ、勝敗の賭け）です。各区分は、自分の `api.ts` か `client.ts`、フック、`dev:mock` 用のモック、CSS を持ちます。
- 文字はすべて `useT()` と共有の辞書を通します。UI の部品はすべて `@casino/ui`（Bitbloom）から取ります。コンポーネント、トークン、自前で配信するフォント、ピクセルアイコンとスプライト（`pixel/`）、FX、ZzFX のオーディオマネージャーです。
- ドット絵の場面：どの画面も場面の絵から始まります。絵のデータは `tools/pixel-art/` が画面の隣の `*-art.ts`（`casino/art/`、`finance/art/`、`horse/`、`life/`、`profile/`、`stream/`）に書き出します。スプライトは行の文字列と、各文字をパレットのトークンの組 `[ライト, ダーク]` に対応させる凡例でできているので、ファイルに色の値はなく、両方のテーマが同じ行から描かれます。`PixelScene`、`useSceneFrame`、`useSceneOnce`（`@casino/ui`）と、`CasinoScene`、`FinanceScene` が整数倍の大きさで描き、0 コマ目が、動きを減らす設定で見せる止まった絵です。絵はその画面からしか読み込まないので、その画面の遅延読み込みのチャンクに入り、ホーム（`index`）は読み込みません。作り直し方は [MAINTAINERS.ja.md](../MAINTAINERS.ja.md#ドット絵を作り直す) にあります。
- 数字は `--font-numeric`（`.num` ユーティリティ）を使い、見出しの中では数字だけの書体 `Bitbloom Numerals` を使います。Pixelify Sans は 2 を 8 のように、5 を S のように描くためです。

## サーバーのルートとソケット

HTTP: `http/app.ts` が Fastify アプリを組み立てます。プロキシポリシーのフック、IP ごととユーザーごとのレート制限（`DEFAULT_RATE_LIMITS`: IP あたり毎分 600 リクエスト、`POST /api/token` は IP あたり毎分 30、ユーザーあたり毎分 240）、セッションの確認、そして [HTTP API](#http-api) のコアルートの順です。`http/activity/` は、アクティビティの区分ごとに認証つきのルートを足します（カジノ、競馬と闘技場、生活、金融、配信）。各区分は `ActivityDeps` の任意の項目を通して `http/activity/index.ts` に自分を登録します。ルートの名前は `packages/shared/src/activity/` に 1 か所だけ定義します（金融は `FINANCE_ROUTES`）。書き込みはすべて冪等キーを取ります。たとえばプレイヤーマーケットには、`GET /api/finance/listings`（出品中の一覧、手数料、フォームに必要な情報。`sellable` は呼び出し元が持つ取引可能アイテムの数量と参考価値、`maxActive`、`auctionHours`、`fixedDays`）と、`POST /api/finance/listings/create`、`…/buy`、`…/bid`、`…/cancel` があります。`create` は、取引可能なアイテム 1 種類の数量を、プレイヤーマーケットのサービスを通してエスクローします。価格の範囲と出品数の上限はそのサービスが守らせ、出品者は常にセッションのユーザー本人です。闘技場の画面は `ArenaTournament.runnerUpId` を返します（[spec/arena.ja.md](spec/arena.ja.md#45-準優勝リマスターでの追加マイグレーション-0011) を参照）。

ソケット: `socket/server.ts` が Socket.io を `/api/socket.io` に載せます（WebSocket のみ）。ハンドシェイクでセッショントークン、プロキシポリシー、ソケット数の上限を確認し、自動のルームに参加させ、イベントごとの期限チェックとレート制限を取り付けます。`socket/domain-audience.ts` は、ドメインイベントをどのルームに送るかを決めます。サーバーの全メンバーが見てよいイベントの種類は許可リストで管理し、リストにないものはイベントが名指しするユーザーにだけ届きます。新しいイベントの種類が、うっかり全体に公開されることはありません。ゲームのハンドラー（`games/casino/handlers.ts`）は、`game:bet` と `game:action` のインテントを、セッション本人のユーザー、サーバー、インスタンスでサービス呼び出しに変えます。その前にユーザーごとのリミッターがあります（`DEFAULT_LIMITS`: 10 秒あたり、ベット 12 回とその後のアクション 30 回）。

配信パネル: `apps/server/src/stream/service.ts`（`StreamService`）が、パネル、スパチャ、勝ち負けの勝負を受け持ちます（[spec/stream.ja.md](spec/stream.ja.md)）。お金のルールは `packages/domain/src/stream/` の純粋な関数です。アクティビティのルートは `http/activity/stream.ts`（`STREAM_ROUTES`）で、ユーザーごとに独自の上限があります（配信の書き込みは毎分 60 回、そのうちスパチャとベットは合わせて毎分 30 回）。配信のボイスチャンネルは、呼び出した人のアクティビティのインスタンス（`location.channel_id`。`auth/discord.ts` で Discord に確かめます）から読み、リクエストの中身は使いません。視聴者は `stream:join` でルーム `stream:{guild}:{id}` に入り（今の画面が返ります）、`stream:leave` で出ます。勝負とスパチャのイベントはそのルームにだけ届き、`StreamStarted` と `StreamEnded` は配信中の一覧のためにサーバーのルームにも届きます。運営の `/admin stream-void` も同じサービスを呼びます。

## カタログ

`catalogs/*.yaml` は、調整できる数値（配当、価格、レート、スケジュール）の、人が読める元データです。日本語のコメントは元の作者のものです。ドメインの定数はそれを整数で写しています（`packages/domain/src/**/constants.ts`）。数値を変えるときは両方を変え、ルールが動いたかどうかはドメインのテストで確かめます。

## 認証の流れ

1. アクティビティ: `discordSdk.ready()` のあと、`commands.authorize({ client_id, response_type: 'code', prompt: 'none', scope: AUTHORIZE_SCOPES })` を呼びます。スコープは `identify`、`guilds`（サーバーは `/users/@me` と `/users/@me/guilds` を読みます）、`rpc.activities.write`（リッチプレゼンス用の `commands.setActivity`）です。サーバーが付与に求めるのは `REQUIRED_SERVER_SCOPES`（`identify`、`guilds`）だけです。
2. `TokenRequest` で `POST /api/token` を呼びます。中身は何も、そのままでは信用しません。
3. サーバーはコードを交換し（`DISCORD_CLIENT_SECRET`）、`/users/@me` と `/users/@me/guilds` を読み、次の条件をすべて確かめます。`guildId` がユーザーのサーバー一覧に入っていて、**かつ** `ALLOWED_GUILD_IDS` にあること（リストにあるサーバーは承認済みとして扱います。`pending` の行はその場で `approved` にし、明示的な `denied` だけが `guild_not_allowed` として拒否します。`REQUIRE_APPROVAL` はこのルートには効果がなく、ボットが受け入れられるようになったときに、リスト外のサーバー用として取ってあります）。`instanceId` が `GET /applications/{app}/activity-instances/{instanceId}` で生きているインスタンスで、その場所のサーバーが `guildId` であり、ユーザーがその参加者に入っていること。そのあと `users` と `guild_members` を upsert し、ロケールを決め、このサーバーでのこのユーザーの起動インテントを消費し、`SessionClaims` に対する HS256 のセッショントークン（`SESSION_SECRET`、有効期間 1 時間）を入れた `TokenResponse` を返します。
4. アクティビティ: `commands.authenticate({ access_token })` を呼び、`auth: { token }` で Socket.io に接続します。HTTP は `Authorization: Bearer` を使います。期限が切れたら、同じ流れをサイレントにやり直します。

**ソケットのセッション。** `SocketData` は `expiresAt` と `jti` を持ちます。サーバーは受信するイベントのたびに `isSessionExpired` を確認し、`expiresAt` で接続を切ります。切る前に `session:error` `{ error: 'expired' }` を送ります。ルームへの参加は、自動の場合も `table:join` の場合も、すべて `canJoinRoom` を通ります。サーバーとユーザーのルームは、トークンのサーバーとユーザーにだけ、インスタンスとテーブルのルームは、トークンのインスタンス（上で、そのサーバーのものだと確認済み）にだけ入れます。

**ユーザーごとの上限。** 1 人のユーザーのすべてのソケットは、1 つのイベント予算を共有します（`eventsPer10s`、既定は 10 秒あたり 100 で、超えると `rate_limited`）。ソケットをいくつ開いても、予算は増えません。1 人のユーザーが同時に持てるソケットは最大 `maxSocketsPerUser`（既定 5）で、次のハンドシェイクは `rate_limited` で断ります。チェックをすり抜けて同時に通ったハンドシェイクは、接続した時点で切ります。アップグレードの試行も、クライアントアドレスごとに上限があります（`upgradesPerMinute`、既定 300）。

**サーバーの無効化。** `/admin server-revoke`（オーナー専用。`ALLOWED_GUILD_IDS` にあるサーバーには使えません）は、サーバーを `denied` にして、`onGuildRevoked` フックを呼びます。`startBot` はこのフックを `SessionService.revokeGuild` につなぐので、そのサーバーの生きているソケットはすべて一度に切れます。ほかに知らせる必要はありません。HTTP のルート、新しいトークンのリクエスト、新しいソケットのハンドシェイクは、`isGuildDenied` で `denied` の状態を読み、403 `guild_not_allowed` を返します。たまたま生き残ったソケットも、次のイベントで終わらせます。フックが失敗してもログに残すだけで、無効化は止まりません。

## URL マッピングとプロキシ署名

Developer Portal では、`/` を Pages のドメインに、`/api` を API のドメインに（`/api` は残したまま）割り当てます。こうするとルートが開発時と同じになります（Vite は `/api` を `localhost:3001` に中継します）。アバター用に `/discord-cdn` を `cdn.discordapp.com` に割り当てます（`DISCORD_CDN_PREFIX`、`DISCORD_URL_MAPPINGS`）。Discord の中では `avatarUrl(user, { base: '/.proxy/discord-cdn' })`、外では CDN のオリジンを使います。Socket.io のパスは `/api/socket.io` で、WebSocket のみです。URL を組み立てるライブラリは、`DISCORD_URL_MAPPINGS` で `patchUrlMappings` を使います。そのほかのアセットはすべてバンドルに含めます。

Discord のドキュメントでは、`X-Signature-Ed25519`、`X-Signature-Timestamp`、`X-Discord-Proxy-Payload`（`created_at` と `expires_at` を Unix 秒で持つ base64 の JSON）は任意とされています。**2026-11-21 に本物のアクティビティの通信で確かめたところ、3 つの署名ヘッダーはどれも、`sdk.authenticate` の前にも後にも届きませんでした（HTTP のルートでも、ソケットのアップグレードでも）。** ポリシーは**あれば検証する**のままにして、`REQUIRE_PROXY_SIGNATURE` は `false`（`0`）にしておきます。本当の認証の境界は、私たちが署名したセッショントークンです（加えて `POST /api/token` の Discord のコード交換と、生きているインスタンスの確認）。

共有の `ProxySignatureVerifier` は、次の順に拒否します。ヘッダーがない、ペイロードが `ProxyPayload` でない、`String(created_at) !== timestamp`、`created_at` が 60 秒より先の未来、`expires_at <= now`、デコードしたペイロードのバイト列に対する Ed25519 署名（16 進か base64）が `DISCORD_PUBLIC_KEY` で検証できない（`node:crypto`）の順です。ポリシー（`auth/proxy-policy.ts`）は、`/api/*` では Fastify の `onRequest` フックとして、アップグレードでは Socket.io の `allowRequest` で動きます。

- `GET /api/health` と `POST /api/token` は対象外です。`token` は自分の確認（クライアントシークレットを使った Discord のコード交換、`/users/@me`、`ALLOWED_GUILD_IDS` にあるサーバー、生きているインスタンス）とレート制限で成り立っています。
- それ以外はすべて**あれば検証する**です。3 つのヘッダーのどれか 1 つでもあれば、3 つともそろって有効でなければならず、そうでなければ 401 です。1 つもなければリクエストは通します。そのようなルートはどれも、私たちのセッショントークンが必要だからです（`me`、`settings`、`inbox`、`inbox/read`、`launch-intent/consume`、そしてソケットのハンドシェイク）。
- `REQUIRE_PROXY_SIGNATURE=1`（任意。既定は `0`）にすると、`health` と `token` を除くすべてのルートで、署名が 1 つもないときに 401 `proxy_signature_missing` も返します。
- `NODE_ENV=development` のときは、このチェックを完全にオフにします。

セッションごとに、最初の認証つきリクエストと最初のソケット接続で、情報ログを 1 行出します。`proxy signature: present=valid|absent`（フィールドは `transport`）で、ヘッダーの値は決して出しません。

認証の経路で 401/403 を返すときは、必ず警告ログを 1 行出します。`auth rejected: <reason>` で、`reason` は決まった文字列にし、秘密は含めません。`proxy_signature_missing:<absent headers>`、`proxy_signature_invalid`、`proxy_payload_invalid`、`timestamp_skew`、`proxy_expired`、`bearer_missing`、`session_invalid`、`session_revoked`、`session_expired`、`socket_auth_failed`（`detail` つき）、`scope_missing`、`user_not_in_guild`、`guild_not_allowed`、`guild_pending`、`instance_mismatch`、そして `code_exchange_failed:<status>` / `user_fetch_failed:<status>` / `guilds_fetch_failed:<status>` / `instance_fetch_failed:<status>`（Discord の HTTP ステータス、またはネットワークエラーなら `network`）です。レスポンスの本文に `reason` を入れるのは、`NODE_ENV` が `production` でないときだけです。

## サーバーの権威と冪等性

乱数はすべてサーバー側で作ります（`cryptoRng`、`crypto.randomInt`）。クライアントが送るのはインテント（`BetIntent`、`roundId` つきの `ActionIntent`）で、結果は決して送りません。受信するスキーマは、未知のプロパティを拒否します。各インテントの `idempotencyKey` は、最初のレスポンスとともに、お金の変更と同じトランザクションの中で `idempotency_keys` に保存し、繰り返されたときはそれを返します。同じキーで本文が違うと `conflict` になり、古い `roundId` も `conflict` です。レート制限はユーザーごととソケットごとにあります。チャットコマンドは、同じサービスをプロセス内で呼びます。

## ドメインの純粋さと経済

`packages/domain` の関数は、状態、入力、`DomainContext`（`rng`、`clock`）を受け取り、`Outcome<S>`（状態とイベント）を返します。I/O、実時間の時計、グローバルな乱数、パスの import はパッケージの外に出しません。ESLint が止め、`purity.test.ts` が単独で CI を失敗させます。

`EconomyService` は残高を書き込める唯一の場所です。変更ごとに `ledger` の行を 1 つ作り、トリガーが `balances` を同期させ、編集、置換、upsert は拒否します。残高が 0 を下回ることはありません（負債は別のテーブルで持ちます）。お金、レート、価格、数量はすべて整数です（ペリカ、bps、固定小数点）。変更、そのゲームの状態、冪等性の記録は一緒にコミットし、イベントはコミットのあとに発行します。[DB_SCHEMA.ja.md](DB_SCHEMA.ja.md) を見てください。

### 台帳の理由

`LEDGER_REASONS`（`packages/shared/src/ledger.ts`）は追加のみです。値は A1 タスクで足し、名前の変更も削除もしません。各理由には、`LEDGER_REASON_FLOW` で 1 つのフローの種類、`LEDGER_REASON_SIGN` で 1 つの方向を決めます。どちらかがない理由があるとテストが失敗します。種類は、プレイヤーの残高から見たものです。台帳の勘定になるのはプレイヤーの残高だけです。

- `faucet`（入金）: 同じトランザクションの中で、ペリカがほかのプレイヤーの残高から来ていないもの。システムの付与、帝愛銀行やハウス口座、会社の資金、エスクロー、ポジション、ポットです。
- `sink`（出金）: 同じトランザクションの中で、ペリカがほかのプレイヤーの残高に行かないもの。エスクローの保留とポジションも sink で、その解放や決済は faucet です。
- `transfer`（どちらの方向でも。理由ごとに固定）: プレイヤー間の移動の片側です。1 つのトランザクションの transfer の行は合計が 0 になります。上乗せの手数料は独立した sink の行にし、片側に混ぜて相殺することはしません。

呼び出し側のルール:

- すべての行で `isDeltaAllowed(reason, delta)` が成り立つ必要があります。昔の処理が 1 つの文字列で両方向を表していた場合は、理由を 2 つに分けています（`horse_retirement` / `horse_retirement_fee`、`quiz_author_reward` / `quiz_author_clawback`、`admin_grant` / `admin_revoke`）。
- あとから足したもの: `horse_breeding_fee`（sink。繁殖手数料の 15,000）、`quiz_author_pay`（sink。ユーザーの作者が正解の報酬を払う。正解者の `quiz_reward` は faucet です。不足分は作者の帝愛の負債になるので、行の合計が 0 になるとは限りません）、`game_insurance_refund`（faucet。下を参照）。
- 配信パネル（Wave 5）：`stream_bet`（sink。エスクローした賭け金）、`stream_payout` と `stream_refund`（faucet）。払い戻しは賭け金に負けた側の山の分け前を足したもの、返金は賭け金ちょうど（無効・片側だけの勝負・終了した配信）。控除 5% と端数は帝愛銀行に残ります。スパチャは `ref_type = 'stream'` の `transfer_out` / `transfer_in` / `transfer_fee` をそのまま使います。[spec/stream.ja.md](spec/stream.ja.md) を参照。
- **決定: 保険の返金は faucet の `game_insurance_refund` とする。** 同じトランザクションの中で払うプレイヤーはいない（アイテムの代金は `shop_buy` としてすでに出ている）ので、transfer ではありません。`game_refund` でもありません。それは中止したラウンドの賭け金を返すものです。履歴（`保険券で半額返金:{game}`）、統計、供給量のチェックでは、両者を区別する必要があります。
- 総額を入れてから控除する: 総額を入金し、そのあと差し引き分を独立した sink の行として出金します（デイリーと労働の収入には `teiai_skim`、利益の出た売却と信用取引の決済には `capital_gains_tax`、売却代金には `marketplace_fee` / `kyosai_fee`、収入には `debt_withholding`）。昔のシステムは skim を差分 0 の行として書いていましたが、台帳は差分 0 の行を拒否します。
- 株式市場と `cs` 暗号資産のティッカーは、1 つの現物の帳簿を共有します。どちらも `stock_buy`、`stock_sell`、`trade_fee` を使い、ティッカーは `ref_id` に入れます。帝愛の信託預金は `bank_deposit` / `bank_withdraw` / `bank_interest` です。同じお金の動きのチャット専用版と画面専用版は同じ理由を使い、`ref_type` / `ref_id` で区別します。
- 固定価格のマーケットでの売買は、1 つのトランザクションの中で `marketplace_buy` → `marketplace_sale` です。オークションの入札は `marketplace_hold` / `marketplace_release` で、落札されたオークションの出品者には `marketplace_auction_sale` が付きます。P2P ローンは `p2p_lend` → `p2p_borrow`、返済は `p2p_repay` か `p2p_garnishment` → `p2p_collect` です。破産の資金プールから支払いを受ける貸し手には `p2p_bankruptcy_payout` が付きます。
- 台帳の動きではないもの（理由はなく、それぞれ自分のテーブルに記録します）: 負債だけの変更（トイチの利息、海外逃亡の罰金、P2P の延滞ペナルティ、払えなかった不足分）、帝愛銀行、ハウス口座、会社の資金の中での移動（闘技場のプールへの補助、会社の維持費と出荷の skim、共済のオークションの収益）、信託のヘアカットです。このような処理がプレイヤーの現金を取るときは、対応する sink を使います（強制執行には `debt_seizure`、破産のプールに押さえた現金には `bankruptcy_writeoff`）。

供給量のチェック（`tests/invariants`。本物のサービスを通してランダムなコマンド列を実行します）: サーバーごとに、faucet の行の `SUM(delta)` と sink の行の `SUM(delta)` を足したものが、残高の合計の変化に等しく、transfer の行はトランザクションごとに合計が 0 になります。

## HTTP API

ルートは `API_ROUTES`（`packages/shared/src/api.ts`）です。リクエストとレスポンスの本文は、そこと `settings.ts` にある TypeBox のスキーマです。`health` と `token` 以外はすべてセッショントークンが必要で、トークンの本人のユーザーとサーバーにだけ作用します。ユーザー ID もサーバー ID も受け取るルートはありません。

| Route | Request → response |
| --- | --- |
| `GET /api/health` | → `{ status, db }`（署名チェックなし） |
| `POST /api/token` | `TokenRequest` → `TokenResponse` |
| `GET /api/me` | → `MeResponse`: ユーザー、サーバー、インスタンス、残高、決まったロケール、`localeHints`、有効期限 |
| `GET /api/settings` / `PUT /api/settings` | → `SettingsResponse` / `SettingsUpdateRequest`（ドキュメント全体）→ `SettingsResponse` |
| `GET /api/inbox` | `InboxQuery`（数字の文字列）→ `InboxPage`（新しい順、`unread`、`nextBefore`） |
| `POST /api/inbox/read` | `InboxReadRequest`（`{ ids }` か `{ all: true }`）→ `InboxReadResponse` |
| `POST /api/launch-intent/consume` | `LaunchIntentConsumeRequest`（`{}`）→ `LaunchIntentConsumeResponse` |

**決定: 残高の取得元は `/api/me`。** `/api/balance` はありません。シェルは、起動時と再接続のあとに、ユーザー、サーバー、残高、ロケールをまとめて必要とし、その後は `balance:update` が残高を新しく保ちます。呼び出しは 1 つ、スキーマも 1 つです。

**決定: 設定はユーザーごとの全体設定とする。** `UserSettings`（言語 `auto|en|ja`、テーマ `discord|light|dark`、サウンドのオンとオフ、効果音と音楽の音量 0〜100（既定 30）、アニメーション `system|full|reduced`。`system` は `prefers-reduced-motion` に従います）が表すのは、人とその端末であって、1 つのサーバーの経済の中のアカウントではありません。2 つのサーバーにいるプレイヤーは、同じアプリを期待します。サウンドがオンでも、最初のユーザー操作があるまで音は鳴らしません。変更したあと、クライアントは `localeHints` で `resolveLocale` をやり直し、トークンの `loc` は次のサイレント更新で追いつきます。

**受信箱。** ユーザーとサーバーごとです。`InboxItem.kind` は `InboxKind` で、オプトインの `NOTIFICATION_KINDS`（それぞれ 1 つのドメインイベントを元にします。`NOTIFICATION_SOURCE`。`horse_foaled` ← `HorseFoaled`）と `SYSTEM_INBOX_KINDS` を合わせたものです。**決定: DM が閉じているときのお知らせは `dm_disabled` という種類にする。** ユーザーに見えること（DM がオフになった）を名前にしたものです。`dm_closed` は、DM 送信の失敗理由（Discord の 50007）と、お知らせの `reason` フィールドにだけ残ります。受信箱専用で、DM の設定はなく、その `event` は `DmDisabledNotice` であってドメインイベントではありません。新しい項目は `user:{id}` に `inbox:new` として届き、続けて `inbox:unread`（`{ guildId, unread }`）が届きます。`inbox:unread` は、既読にしたあと（HTTP でも `inbox:read` ソケットイベントでも）にも送るので、開いているインスタンスはどれも同じ件数を表示します。

## イベント、ルーム、起動インテント

コミットのあと、サーバーごとの `DomainEvent` が購読者に渡ります。ソケットルーム（`domain:event`、`balance:update`、`table:state`）、チャットのアナウンサー（レート制限とまとめ送りあり）、Webhook のペルソナ、DM キュー（オプトイン、再試行、ダイジェスト）、受信箱、プレゼンス、統計とミッションとランキングです。ルームは、接続時に `guild:{id}`、`instance:{instanceId}`、`user:{id}`、`table:join` で `table:{instanceId}:{game}` です。`user:{id}` のペイロードには `guildId` が入っているので、2 つのサーバーにいるクライアントも選り分けられます。市場のティックは毎分で、レースはタイムラインで流します。

ユニオン（`DOMAIN_EVENT_TYPES`、`packages/shared/src/events.ts`）: `GameSettled`、`BigWin`、`Jackpot`、`RaceScheduled`、`RaceFinished`、`HorseRetired`、`MarketTick`、`MarketMove`、`LoanDue`、`BankruptcyGraceStarted`、`BankruptcyDeclared`、`MissionCompleted`、`TitleAwarded`、`OrderFilled`、`MarketplaceOutbid`、`DailyReady`、`CompanyBankrupt`、`LotteryDrawn`、`HorseFoaled`（繁殖で生まれた子馬。[horse-breeding.ja.md](spec/horse-breeding.ja.md) §5。お知らせするのは `statTotal >= FOAL_ANNOUNCE_MIN_TOTAL` = 205 のときだけ）。どのイベントも `guildId` と `at` を持ちます。`GameSettled.tags`（任意、snake_case、最大 16 個）には、そのラウンド特有のラベル（`natural`、`double_win`、`jackpot` など）が入ります。ミッションとアナウンサーが使うので、チャットのラウンドとアクティビティのラウンドが同じように数えられます。**決定: 破産は 2 つのイベントにする。** `BankruptcyGraceStarted` は 24 時間の猶予を始めるもので、破産にならずに終わることもあります（負債がしきい値より下まで返された場合）。`BankruptcyDeclared`（`cause` は `voluntary`、`forced`、`escape`）が破産そのもので、圧縮の前と後の負債を持ちます。1 つのイベントにフェーズのフィールドを持たせると、ほかのフィールドが任意になり、使う側が分岐することになります。

起動インテントは、プロセスの中でだけ作ります（`LaunchIntentService`）。作るための HTTP ルートはありません。ボットが `create({ userId, guildId, screen })` を呼び（2 分で期限切れ）、`LAUNCH_ACTIVITY` で応答します。`POST /api/token` は、セッションの本人のユーザーとサーバーについて `consume` を呼びます。すでに開いているアクティビティは、`POST /api/launch-intent/consume`（本文は空。ユーザーとサーバーはセッショントークンから取ります）で新しいインテントを消費するので、消費できるのは自分のものだけです。

`instance:participants`（`Participants`: サーバー、インスタンス、`PublicUser[]`）は、ユーザーがインスタンスに入るか出るたびに、完全な一覧として `instance:{instanceId}` に送られ、ソケットが参加した直後にもそのソケットに送られます。

## i18n、旧データの取り込み、秘密情報

辞書は `packages/shared/i18n/{en,ja}.ts` で、キーはフラットです。`ja` は `en` に対して型が付いています。すべての `ErrorCode` に `error.<code>`、すべての `InboxKind` に `inbox.kind.<kind>` があり、`pnpm i18n:check` がずれを CI で失敗させます。サーバー側の文言もここに置きます。`bot.*`（チャットの返信）、`notify.*`（お知らせ、ペルソナ、DM、受信箱のメモ）、`horse.*`（繁殖）、`finance.*`（トースト）です。モジュールが自前の辞書を持つことはありません。ロケールの優先順は、ユーザーの設定、クライアントのロケール、サーバーのロケール、`en` です。

`apps/server/scripts/import-legacy.ts` は、`data/casino.db`（Python のボットは停止した状態）を DB_SCHEMA.ja.md に沿って取り込み、ペリカに 1 つでも差があれば失敗します。1 つのトークンで 2 つのボットを同時に動かしてはいけません。

`.env` はオーナーのマシンにだけ置きます。`.env.example` にはプレースホルダーだけを入れ、`ServerEnv` を満たす必要があります（テスト済み）。サーバーは起動時に環境変数を検証します。任意のキーには `SERVER_ENV_DEFAULTS` があります。`PORT` は 3001、`HOST` は `127.0.0.1`、`DATABASE_PATH` は `./data/casino.sqlite`（旧 `data/casino.db` は決して使いません。読むのは取り込みスクリプトだけです）、`LOG_LEVEL` は `info`、`NODE_ENV` は `production`、`BOT_DISABLED` は `0`（`1` ならチャットボットのゲートウェイにログインせず、HTTP、Socket.io、ジョブは動き続けます）です。`HOST` はループバックのままにします。トンネルはローカルから接続し、`trustProxy` は 1 つの信頼できるホップに設定してあります（`true` ではなく `TRUSTED_PROXY_HOPS = 1`）。そのため、トンネルが `X-Forwarded-For` に付け足したアドレスだけを信じ、クライアントが書いた連鎖は無視します。直接アクセスできるサーバーでは、接続元を取り違えることになります（ほかのアドレスにバインドするのは、コンテナのときだけです）。Pino の `redact.paths` は、`req.headers.authorization`、`req.headers.cookie`、`req.headers["x-discord-proxy-payload"]`、`*.code`、`*.accessToken`、`*.access_token`、`*.sessionToken`、`*.token`、`*.secret` です。シリアライザーは、メッセージの中の `Bearer …`、JWS の形をした文字列、ボットトークンの形をした文字列も伏せます。

## どこを変えるか

| Path | 置いてあるもの |
| --- | --- |
| `packages/shared/` | 契約: ID、TypeBox スキーマ、ソケットイベントとドメインイベント、台帳の理由、環境変数の契約、プロキシ検証、RNG と時計のインターフェース、i18n の辞書。ここを変えると両側に影響するので、小さく、足すだけにします。 |
| `packages/domain/` | ゲームと金融のモジュールごとの純粋なルール。I/O はありません。 |
| `packages/ui/` | Bitbloom のコンポーネント、トークン、フォント、ピクセルアート、オーディオ、FX。 |
| `apps/server/src/{http,socket,db,auth,runtime}/` | 通信、永続化、認証、起動、ジョブ。 |
| `apps/server/src/{economy,finance,games}/` | サービス: 台帳の書き込み役、お金のモジュール、ゲーム。 |
| `apps/server/src/{bot,notify}/` | スラッシュコマンド、お知らせ、DM、受信箱。 |
| `apps/server/src/stream/`、`packages/domain/src/stream/` | 配信パネル。サービスとパリミュチュエルのルール。 |
| `apps/server/scripts/` | 旧データの取り込みスクリプトと負荷生成スクリプト。 |
| `apps/web/src/shell/`、`apps/web/src/screens/` | アクティビティの外枠と画面。 |
| `tests/e2e/`、`tests/invariants/` | 複数クライアントのソケットのテストと、経済のプロパティテスト。ユニットテストはコードの隣に置きます（`*.test.ts`）。 |
| `catalogs/`、`design/`、`tools/pixel-art/` | 調整できる数値、デザイントークン、ドット絵のジェネレーター。 |
| `ops/`、`.github/workflows/` | Raspberry Pi 用キット、トンネルのテンプレート、pi-sim コンテナ、CI。 |
| `docs/spec/` | 元のボットから書き起こした、動作の仕様。 |

## 既知の制限

- Discord はアクティビティの通信にプロキシ署名ヘッダーを付けません（2026-11-21 に確認）。そのため署名チェックは「あれば検証する」で、本当の境界はセッショントークンです。
- `ALLOWED_GUILD_IDS` の外のサーバーは、まだ受け入れられません。`REQUIRE_APPROVAL` は、ボットが受け入れられるようになる日のために取ってあります。
- プロセスは 1 つ、SQLite の接続も 1 つです。スケールアウトするには、別のストアと、バス用のブローカーが必要になります。
