# オーナー向けセットアップチェックリスト（macOS + Cloudflare Pages + Cloudflare Tunnel）

フロントエンドを Cloudflare Pages で配信し、Node 24 サーバーを自宅 Mac 上で起動して Cloudflare Tunnel 経由で公開するまでの手順です。上から順に実施してください。

## 1. Discord Developer Portal の設定

[Discord Developer Portal](https://discord.com/developers/applications) で対象アプリケーションを開きます。

1. **App ID と Public Key の確認**
   - **General Information** を開きます。
   - **Application ID** を控えます → `DISCORD_CLIENT_ID` に設定。
   - **Public Key**（64 文字の 16 進数）を控えます → `DISCORD_PUBLIC_KEY` に設定。
2. **Bot Token と OAuth2 Client Secret の取得**
   - **Bot** → **Token** を発行・コピー → `DISCORD_TOKEN` に設定（**機密情報**）。
   - **OAuth2** → **Client Secret** をコピー → `DISCORD_CLIENT_SECRET` に設定（**機密情報**）。
3. **OAuth2 Redirect のプレースホルダー登録**
   - **OAuth2 → Redirects** にプレースホルダーとして `https://127.0.0.1` を 1 件登録します（Discord の仕様上 1 件以上必要ですが、Activity の認証フローでは実際には使用されません）。
4. **URL Mappings の設定（Activities 有効化より先に実施）**
   - `/` マッピングを作成する前は Developer Portal で Activities を有効化できない（`Missing Requirement: [URL Mapping]` エラーになる）ため、先に **Activities → URL Mappings** を設定します。
   - ターゲット欄にはホスト名のみを入力し、`https://` や末尾のスラッシュは付けないでください。Activities の有効化に必須なのは `/` のみですが、`/api` と `/discord-cdn` もあわせて登録します（`/api` はトンネル起動後に更新できます）。

     | Prefix（プレフィックス） | Target（ターゲット） | 用途 |
     | --- | --- | --- |
     | `/` | `<pages-host>` | Cloudflare Pages のホスト名（例: `discord-casino-remaster.pages.dev`） |
     | `/api` | `<api-host>/api` | トンネルのホスト名 + `/api`（例: `<random>.trycloudflare.com/api` または `api.example.com/api`） |
     | `/discord-cdn` | `cdn.discordapp.com` | プレイヤーのアバター画像用（Activity から CDN へ直接はアクセスできません） |

   - Discord のプロキシはマッピング元のプレフィックスをターゲットに置換するため、サーバーが `/api` 配下で待ち受けるルートに合わせるには `/api` のターゲットを `<api-host>/api` に指定する必要があります。
5. **Activities の有効化と Entry Point コマンド**
   - **Activities → Settings** で **Enable Activities** を有効にします。
   - **Installation / App Commands** で Discord 管理の **Entry Point** コマンドが有効になっていることを確認します。

## 2. Mac 上に `.env` を作成する

リポジトリルートで `.env.example` を `.env` にコピーします。

```sh
cp .env.example .env
```

各項目に実際の値を入力します。**`.env` は絶対に git にコミットせず、機密値をチャット・Issue・ログ・スクリーンショットに貼り付けないでください。**

| 環境変数 | 機密? | 説明 |
| --- | --- | --- |
| `DISCORD_TOKEN` | **はい（機密）** | Developer Portal → Bot のトークン |
| `DISCORD_CLIENT_SECRET` | **はい（機密）** | Developer Portal → OAuth2 のシークレット |
| `SESSION_SECRET` | **はい（機密）** | ローカルで生成（`openssl rand -hex 32` など 32 文字以上） |
| `DISCORD_CLIENT_ID` | いいえ | General Information の Application ID |
| `DISCORD_PUBLIC_KEY` | いいえ | General Information の Public Key（Discord プロキシ署名検証に使用する公開鍵） |
| `ALLOWED_GUILD_IDS` | いいえ | 利用を許可する Discord サーバー ID（カンマ区切り） |
| `OWNER_IDS` | いいえ | オーナーの Discord ユーザー ID（カンマ区切り） |
| `TEST_GUILD_ID` | いいえ | テスト用 Discord サーバー ID |
| `REQUIRE_APPROVAL` | いいえ | `1` = 新規サーバーはオーナー承認待ち、`0` = 自動承認 |
| `UTC_OFFSET_HOURS` | いいえ | 日次リセットのタイムゾーン差（日本時間は `9`） |
| `PUBLIC_API_ORIGIN` | いいえ | `https://<api-host>`（末尾スラッシュなし）。独自ドメイン取得前にクイックトンネルを使う場合は `https://api.example.com` など有効な URL 形式で問題ありません（起動時バリデーションは行われますが現時点では未使用です） |
| `ANNOUNCE_CHANNEL_ID` | いいえ | デフォルトの通知先チャンネル ID |
| `NODE_ENV` | いいえ | 任意（既定 `production`）。Discord プロキシ / Cloudflare Tunnel 経由の本番運用時は `production`（Ed25519 署名検証を有効化）。プロキシなしのローカルブラウザ確認時のみ `development` |
| `HOST` | いいえ | 任意（既定 `127.0.0.1`）。待機アドレス。トンネルはローカル接続で `trustProxy` が有効なためループバック固定（`0.0.0.0` は `pi-sim` 等のコンテナ専用） |
| `PORT` | いいえ | 任意（既定 `3001`）。HTTP / Socket.io の待機ポート |
| `DATABASE_PATH` | いいえ | 任意（既定 `./data/casino.sqlite`、作業ディレクトリ基準）。新サーバーの SQLite ファイル（レガシーの `data/casino.db` はインポーター入力専用で直接指定しない） |
| `LOG_LEVEL` | いいえ | 任意（既定 `info`）。Pino ログレベル: `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace` \| `silent` |

## 3. `apps/web` 用 Cloudflare Pages プロジェクトの作成

Cloudflare Pages でこのリポジトリを連携し、以下を設定します（詳細は [DEPLOY_PAGES.md](DEPLOY_PAGES.md) を参照）。

- **Project name（プロジェクト名）:** `discord-casino-remaster`（推奨。プロジェクト名がそのまま `*.pages.dev` のホスト名、例: `discord-casino-remaster.pages.dev` になります）
- **Root directory（ルートディレクトリ）:** `/`（`@casino/shared` と `@casino/ui` を解決するためリポジトリルートを指定）
- **Build command（ビルドコマンド）:** `pnpm --filter @casino/web build`
- **Build output directory（出力ディレクトリ）:** `apps/web/dist`
- **環境変数:**
  - `NODE_VERSION` = `24`
  - `PNPM_VERSION` = `12.21.0`
  - `VITE_DISCORD_CLIENT_ID` = Application ID（`DISCORD_CLIENT_ID`、公開値、ビルド時に必須）
  - `VITE_API_HOST` = 任意。クイックトンネル使用中は**未設定**のままにしてください

初回デプロイ完了後、割り当てられた `*.pages.dev` のホスト名が Developer Portal の **URL Mappings**（`/`）の `<pages-host>` と一致していることを確認してください。

## 4. macOS への `cloudflared` 導入とトンネル起動

まず Homebrew で `cloudflared` をインストールします。

```sh
brew install cloudflared
```

独自ドメインの有無に応じて **方法 A（ドメイン未取得: クイックトンネル）** または **方法 B（独自ドメインあり: 名前付きトンネル）** を選びます。

### 方法 A: ドメイン未取得の場合 — クイックトンネル

1. ターミナル 1 でウォッチモードのサーバーを起動します（`tsup` で自動リビルドし、`--max-old-space-size=192` と `.env` 読み込み付きで `dist/main.js` を再起動します）:

   ```sh
   pnpm dev:server
   ```

2. ターミナル 2 でクイックトンネルを起動します（`pnpm dev:tunnel:quick` は `cloudflared tunnel --url http://localhost:3001` を実行します）:

   ```sh
   pnpm dev:tunnel:quick
   ```

   （直接実行する場合: `cloudflared tunnel --url http://localhost:3001`）

3. 表示された `*.trycloudflare.com` のホスト名（`https://` を除く）をコピーし、Developer Portal の `/api` マッピングに `<host>/api`（例: `example-words.trycloudflare.com/api`）として設定します。
4. `*.trycloudflare.com` のアドレスはトンネルを再起動するたびに変わるため、再起動のたびに `/api` の URL Mapping を更新してください。
5. `.env` の `PUBLIC_API_ORIGIN` は当面 `https://api.example.com` など任意の有効な URL のままで問題ありません（起動時バリデーションは行われますが現時点では未使用です）。

> **推奨:** 毎回 URL Mapping を更新せずに済む安定した URL を確保し、将来の Raspberry Pi 運用にも備えるため、あとから **Cloudflare Registrar** で独自ドメインを取得することをおすすめします。

### 方法 B: 独自ドメインがある場合 — 名前付きトンネル

1. Cloudflare にログインし、名前付きトンネルを作成します。

   ```sh
   cloudflared tunnel login
   cloudflared tunnel create discord-casino
   ```

   出力された `<TUNNEL_ID>` と認証情報ファイル `~/.cloudflared/<TUNNEL_ID>.json` を確認します。

2. API 用サブドメイン（`<api-host>`）をトンネルへ DNS ルーティングします。

   ```sh
   cloudflared tunnel route dns discord-casino api.example.com
   ```

3. テンプレートをリポジトリ外の `~/.cloudflared/config.yml` にコピーし、トンネル ID・認証情報パス・`<api-host>` を設定します。

   ```sh
   mkdir -p ~/.cloudflared
   cp ops/cloudflared/config.example.yml ~/.cloudflared/config.yml
   ```

   `service: http://localhost:3001`（またはサーバーの待機ポート）を設定します。**`ops/cloudflared/config.example.yml` 自体に実トンネル ID や実ドメインを書き換えてコミットしないでください。**

4. ターミナル 1 でサーバー（`pnpm dev:server`）を起動し、ターミナル 2 で名前付きトンネルを起動します（`dev:tunnel` は設定ファイルを使う名前付きトンネル専用です）:

   ```sh
   CLOUDFLARED_CONFIG=~/.cloudflared/config.yml pnpm dev:tunnel
   ```

## 5. 動作確認

1. **ローカルサーバーのヘルスチェック:**

   ```sh
   curl -i http://localhost:3001/api/health
   ```

   HTTP `200` の JSON 応答が返ることを確認します。

2. **トンネル経由の到達確認:**

   ```sh
   curl -i https://<api-host>/api/health
   ```

   `cloudflared` 経由で Mac 上のサーバーへ到達することを確認します（`production` モードでプロキシ署名検証が有効な場合、ヘルスチェック以外の `/api/*` へ直接アクセスすると Discord 署名ヘッダー不足で `401` が返ります）。

3. **Pages と Discord Activity の疎通確認:**
   - ブラウザで `https://<pages-host>` を開き、フロントエンドが読み込まれることを確認します。
   - `TEST_GUILD_ID` の Discord サーバーから Activity を起動し、Activity 内からの `/.proxy/api/health` へのリクエストが HTTP `200` を返し、認証および `/api` 通信が Mac 上のサーバーと疎通することを確認します。

Mac から Raspberry Pi へ移行する準備ができたら、[PI_SETUP.ja.md](PI_SETUP.ja.md) の手順でコード変更なしに移行できます。
