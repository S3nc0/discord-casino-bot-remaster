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
4. **Activities の有効化と Entry Point コマンド**
   - **Activities → Settings** で **Enable Activities** を有効にします。
   - **Installation / App Commands** で Discord 管理の **Entry Point** コマンドが有効になっていることを確認します。
5. **URL Mappings の設定**
   - **Activities → URL Mappings** に次の 3 つを設定します。
     - `/` → `PAGES_DOMAIN`（Cloudflare Pages のホスト名、例: `your-app.pages.dev`）
     - `/api` → `API_DOMAIN/api`（Cloudflare Tunnel のホスト名に `/api` を付けたもの、例: `api.example.com/api`）
     - `/discord-cdn` → `cdn.discordapp.com`（プレイヤーのアバター画像用。Activity から CDN へ直接はアクセスできません）
   - Discord のプロキシはマッピング元のプレフィックスをターゲットに置換するため、サーバーが `/api` 配下で待ち受けるルートに合わせるには `/api` のターゲットを `API_DOMAIN/api` に指定する必要があります。

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
| `PUBLIC_API_ORIGIN` | いいえ | `https://API_DOMAIN`（末尾スラッシュなし） |
| `ANNOUNCE_CHANNEL_ID` | いいえ | デフォルトの通知先チャンネル ID |
| `NODE_ENV` | いいえ | 任意（既定 `production`）。Discord プロキシ / Cloudflare Tunnel 経由の本番運用時は `production`（Ed25519 署名検証を有効化）。プロキシなしのローカルブラウザ確認時のみ `development` |
| `HOST` | いいえ | 任意（既定 `127.0.0.1`）。待機アドレス。トンネルはローカル接続で `trustProxy` が有効なためループバック固定（`0.0.0.0` は `pi-sim` 等のコンテナ専用） |
| `PORT` | いいえ | 任意（既定 `3001`）。HTTP / Socket.io の待機ポート |
| `DATABASE_PATH` | いいえ | 任意（既定 `./data/casino.sqlite`、作業ディレクトリ基準）。新サーバーの SQLite ファイル（レガシーの `data/casino.db` はインポーター入力専用で直接指定しない） |
| `LOG_LEVEL` | いいえ | 任意（既定 `info`）。Pino ログレベル: `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace` \| `silent` |

## 3. `apps/web` 用 Cloudflare Pages プロジェクトの作成

Cloudflare Pages でこのリポジトリを連携し、以下を設定します（詳細は [DEPLOY_PAGES.md](DEPLOY_PAGES.md) を参照）。

- **Root directory（ルートディレクトリ）:** `/`（`@casino/shared` と `@casino/ui` を解決するためリポジトリルートを指定）
- **Build command（ビルドコマンド）:** `pnpm --filter @casino/web build`
- **Build output directory（出力ディレクトリ）:** `apps/web/dist`
- **環境変数:** `NODE_VERSION` = `24`

初回デプロイ完了後、割り当てられた `*.pages.dev`（または独自ドメイン）が Developer Portal の `PAGES_DOMAIN` と一致していることを確認してください。

## 4. macOS への `cloudflared` 導入とトンネル作成

1. Homebrew で `cloudflared` をインストールします。

   ```sh
   brew install cloudflared
   ```

2. Cloudflare にログインし、トンネルを作成します。

   ```sh
   cloudflared tunnel login
   cloudflared tunnel create discord-casino
   ```

   出力された `<TUNNEL_ID>` と認証情報ファイル `~/.cloudflared/<TUNNEL_ID>.json` を確認します。

3. API 用サブドメイン（`API_DOMAIN`）をトンネルへ DNS ルーティングします。

   ```sh
   cloudflared tunnel route dns discord-casino api.example.com
   ```

4. テンプレートをリポジトリ外の `~/.cloudflared/config.yml` にコピーし、トンネル ID・認証情報パス・`API_DOMAIN` を設定します。

   ```sh
   mkdir -p ~/.cloudflared
   cp ops/cloudflared/config.example.yml ~/.cloudflared/config.yml
   ```

   `service: http://localhost:3001`（またはサーバーの待機ポート）を設定します。**`ops/cloudflared/config.example.yml` 自体に実トンネル ID や実ドメインを書き換えてコミットしないでください。**

5. 2 つのターミナルでサーバーとトンネルを起動します。

   - ターミナル 1 — ウォッチモードでサーバーを起動（`tsup` で自動リビルドし、`--max-old-space-size=192` と `.env` 読み込み付きで `dist/main.js` を再起動します）:

     ```sh
     pnpm dev:server
     ```

   - ターミナル 2 — Cloudflare Tunnel を起動（`CLOUDFLARED_CONFIG` で設定ファイルを指定。未指定時は `ops/cloudflared/config.example.yml` を参照）:

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
   curl -i https://API_DOMAIN/api/health
   ```

   `cloudflared` 経由で Mac 上のサーバーへ到達することを確認します（`production` モードでプロキシ署名検証が有効な場合、ヘルスチェック以外の `/api/*` へ直接アクセスすると Discord 署名ヘッダー不足で `401` が返ります）。

3. **Pages と Discord Activity の疎通確認:**
   - ブラウザで `https://PAGES_DOMAIN` を開き、フロントエンドが読み込まれることを確認します。
   - `TEST_GUILD_ID` の Discord サーバーから Activity を起動し、Activity 内からの `/.proxy/api/health` へのリクエストが HTTP `200` を返し、認証および `/api` 通信が Mac 上のサーバーと疎通することを確認します。

Mac から Raspberry Pi へ移行する準備ができたら、[PI_SETUP.ja.md](PI_SETUP.ja.md) の手順でコード変更なしに移行できます。
