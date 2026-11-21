# オーナー向けセットアップガイド（macOS + Cloudflare Pages + トンネル）

[English](OWNER_SETUP.md) | **日本語**

ゼロから Mac 上で Discord Activity が動くまでを、上から順番に進めるためのガイドです。インフラやサーバー構築の経験がなくても進められるようにまとめています。

> [!CAUTION]
> **機密情報は絶対に公開しないでください。** **Bot Token**（`DISCORD_TOKEN`）、**OAuth2 Client Secret**（`DISCORD_CLIENT_SECRET`）、**`SESSION_SECRET`** は、チャット・スクリーンショット・GitHub の Issue・Cloudflare・GitHub のどこにも貼り付けないでください。

---

## 0. 全体像

このアプリは 3 つのパーツが連携して動きます。

1. **Cloudflare Pages** — **Web アプリ**（Discord 内に表示されるカジノ画面）を配信します。
2. **あなたの Mac** — **サーバー**（ログイン処理・ゲームルール・残高データの保存）を動かします。
3. **トンネル**（`cloudflared`）— ルーターやファイアウォールの設定を変えずに、Discord から自宅 Mac のサーバーへ安全につなぐ橋渡しです。

```text
Discord Activity（デスクトップ / モバイル）
  ├── /     ──▶ Cloudflare Pages（Web アプリ: your-host.pages.dev）
  └── /api  ──▶ Cloudflare トンネル ──▶ あなたの Mac（localhost:3001 + SQLite DB）
```

**所要時間:** 初回は 20〜30 分ほどです。

### 始める前に用意するもの

- **Discord** アカウント
- あなたが管理者権限を持つ **テスト用 Discord サーバー**（Discord の設定画面ではサーバーのことを **guild（ギルド）** と呼びます）
- このリポジトリにアクセスできる **GitHub** アカウント
- 無料の **Cloudflare** アカウント
- **Homebrew** が入った **Mac（macOS）**
- Mac にインストールされた **Node.js 24** と **pnpm 12.21.0**

### 手順の中で集める値の一覧

手順 2〜6 で次の値を集めます。パスワードマネージャーなど、自分だけが見られるメモを開きながら進めてください。

| 項目 | 取得場所 | 機密? | 使う場所 |
| --- | --- | --- | --- |
| Application ID（`APP_ID`） | Discord Developer Portal → General Information | いいえ | `.env`（`DISCORD_CLIENT_ID`）、Cloudflare Pages（`VITE_DISCORD_CLIENT_ID`） |
| Public Key | Discord Developer Portal → General Information | いいえ | `.env`（`DISCORD_PUBLIC_KEY`） |
| OAuth2 Client Secret | Discord Developer Portal → OAuth2 | **はい** | `.env`（`DISCORD_CLIENT_SECRET`） |
| Bot Token | Discord Developer Portal → Bot | **はい** | `.env`（`DISCORD_TOKEN`） |
| Pages ホスト名（`your-host.pages.dev`） | Cloudflare Pages のプロジェクト画面 | いいえ | Discord の URL Mappings（`/`） |
| テストサーバー ID | Discord → サーバーアイコンを右クリック | いいえ | `.env`（`ALLOWED_GUILD_IDS`、`TEST_GUILD_ID`） |
| 自分のユーザー ID | Discord → 自分のアイコンを右クリック | いいえ | `.env`（`OWNER_IDS`） |
| 通知用チャンネル ID | Discord → テキストチャンネルを右クリック | いいえ | `.env`（`ANNOUNCE_CHANNEL_ID`） |
| Session Secret | Mac で生成（`openssl rand -hex 32`） | **はい** | `.env`（`SESSION_SECRET`） |
| トンネルのホスト名（`xxxx.trycloudflare.com` または `api.example.com`） | ターミナル出力（クイックトンネル）または独自ドメイン | いいえ | Discord の URL Mappings（`/api`） |

✅ **確認:** ターミナルで `node -v`、`pnpm -v`、`brew -v` を実行し、Node が `v24.x.x`、`pnpm` と `brew` もバージョン番号を表示することを確認します。

---

## 1. ローカルでコードを動かす準備

1. Mac で **ターミナル** を開きます。
2. リポジトリをダウンロードしてフォルダへ移動します（`<your-repo-url>` は自分の GitHub リポジトリ URL に置き換えてください）。

   ```sh
   git clone <your-repo-url> discord-casino
   cd discord-casino
   ```

3. 依存パッケージをインストールします。

   ```sh
   pnpm i
   ```

4. 全パッケージをビルドして、問題なく通ることを確認します。

   ```sh
   pnpm -r build
   ```

✅ **確認:** `pnpm -r build` がエラーなしで完了します。

---

## 2. Discord Developer Portal（前半: キー取得と Redirect 設定）

1. [Discord Developer Portal](https://discord.com/developers/applications) を開き、対象アプリをクリックします（まだなければ **New Application**（新規作成）から作成します）。
2. **Application ID** と **Public Key** を控えます。
   - 左メニューの **General Information**（一般情報）を開きます。
   - **Application ID** をコピーします（このガイドでは `APP_ID` と表記します）。
   - **Public Key**（64 文字の 16 進数）をコピーします。
3. **OAuth2 Client Secret** を取得します。
   - 左メニューの **OAuth2** を開きます。
   - **Client information**（クライアント情報）の **Client Secret** をコピーします。
   - 隠れていたり確信が持てない場合は **Reset Secret**（シークレットをリセット）を押して新しい値をコピーしてください。
   - **注意:** **Client Secret** は **Bot Token ではありません**。別の画面にある別の機密キーです。
4. ダミーの **OAuth2 Redirect** を 1 件登録します。
   - そのまま **OAuth2** 画面の **Redirects**（リダイレクト）へスクロールします。
   - **Add Redirect**（リダイレクトを追加）を押し、`https://127.0.0.1` を入力して **Save Changes**（変更を保存）を押します。
   - Activity では実際には使われませんが、Discord の仕様上 1 件以上の登録が必要です。
5. **Bot Token** を取得します。
   - 左メニューの **Bot** を開きます。
   - **Token** の **Reset Token**（トークンをリセット）または **Copy**（コピー）を押し、自分だけのメモに保存します。

✅ **確認:** 4 つの値（Application ID・Public Key・OAuth2 Client Secret・Bot Token）を安全に保存し、**OAuth2 → Redirects** に `https://127.0.0.1` が登録されています。

---

## 3. Cloudflare Pages（Web アプリの公開）

1. [dash.cloudflare.com](https://dash.cloudflare.com) にサインアップまたはログインします。
2. 左メニューから **Workers & Pages** → **Create**（作成）をクリックします。
3. Workers ではなく **Pages** を選びます。
   - 画面下部の **「Looking to deploy Pages? Get started」**（または **Pages** タブ）を開きます。
   - **Import an existing Git repository**（既存の Git リポジトリをインポート）をクリックします。

> [!WARNING]
> **Workers ではなく、必ず Pages になっているか確認してください。**
> 設定画面に **「Deploy command」** や **`wrangler`** が表示される場合、あるいはビルドで `"application detection logic has been run in the root of a workspace"` とエラーになる場合は、誤って **Workers** の作成画面に入っています。
> **Workers & Pages** へ戻り、作成された Worker を開いて **Settings → Delete**（設定 → 削除）で削除してください（残しておくと GitHub のすべての PR に失敗チェックが付いてしまいます）。その後、もう一度 **Workers & Pages → Create** から **Pages** を選び直します。

4. GitHub アカウントを連携し、このリポジトリを選んで **Begin setup**（セットアップを開始）をクリックします。
5. ビルド設定を次の通りに入力します。

   | 設定項目 | 入力する値 |
   | --- | --- |
   | **Project name**（プロジェクト名） | 例: `discord-casino`（`*.pages.dev` のホスト名になります） |
   | **Production branch**（本番ブランチ） | `main` |
   | **Framework preset**（フレームワークプリセット） | `None` |
   | **Build command**（ビルドコマンド） | `pnpm --filter @casino/web build` |
   | **Build output directory**（ビルド出力ディレクトリ） | `apps/web/dist` |
   | **Root directory**（ルートディレクトリ、表示される場合） | *（空欄のまま）* |

   Root directory を空欄のままにするとリポジトリ直下でビルドされ、ワークスペース内の共通パッケージを正しく読み込めます。

6. **Environment variables (advanced)**（環境変数）を開いて、次を追加します。

   | 変数名 | 値 | 説明 |
   | --- | --- | --- |
   | `NODE_VERSION` | `24` | プロジェクトの Node バージョンに合わせます |
   | `PNPM_VERSION` | `12.21.0` | プロジェクトの pnpm バージョンに合わせます |
   | `VITE_DISCORD_CLIENT_ID` | `APP_ID` | 手順 2 の Application ID（公開値） |
   | `VITE_API_HOST` | *（未設定のまま）* | 任意。クイックトンネルを使う間は設定しないでください |

   Bot Token・Client Secret・`SESSION_SECRET` などの機密値は Cloudflare Pages には絶対に入れないでください。

7. **Save and Deploy**（保存してデプロイ）を押し、ビルド完了まで 1〜3 分待ちます。
8. プロジェクト画面に表示された公開 URL（例: `https://your-host.pages.dev`）を確認します。
   - `https://` を除いた **実際に表示されているホスト名そのまま**（例: `your-host.pages.dev`）をコピーします。
   - 入力したプロジェクト名や GitHub リポジトリ名とは少し違うホスト名が割り当てられることがあるため、必ず画面に出ている文字列をコピーしてください。

✅ **確認:** デプロイが **Success**（成功）になり、ブラウザで `https://your-host.pages.dev` を開くと 404 やビルドエラーではなく Web アプリが読み込まれます。

---

## 4. Discord Developer Portal（後半: インストール・URL Mappings・Activities 有効化）

### 4.1 テストサーバーへアプリを追加する

1. **Developer Portal → 対象アプリ → Installation**（インストール）を開きます。
2. **Installation Contexts**（インストールコンテキスト）で **Guild Install**（サーバーへのインストール）にチェックを入れ、**Save Changes**（変更を保存）を押します。
3. **Default Install Settings**（既定のインストール設定）→ **Guild Install** で以下を設定します。
   - **Scopes**（スコープ）: `applications.commands` と `bot` を追加します。
   - **Permissions**（権限）: **Send Messages**（メッセージを送信）、**Embed Links**（埋め込みリンク）、**Use Slash Commands**（アプリコマンドを使う）にチェックを入れます（将来 Webhook ペルソナを使う場合は **Manage Webhooks**（ウェブフックの管理）にもチェック）。
   - **Save Changes**（変更を保存）を押します。
4. **Install Link**（インストールリンク）が **Discord Provided Link** になっていることを確認し、リンクを **Copy**（コピー）してブラウザで開きます。
5. **テスト用サーバー** を選んで **Authorize**（認証）を押します。

### 4.2 URL Mappings を設定する（Activities 有効化より先に実施）

**URL mapping（URL マッピング）** は、Activity の中から出た Web や API への通信をどこへ転送するかを Discord に伝える設定です。`/` のマッピングを先に作らないと、Activities を有効にしようとしたときに `Missing Requirement: [URL Mapping]` エラーが出ます。

1. **Developer Portal → 対象アプリ → Activities → URL Mappings** を開きます。
2. 次の 3 行を追加して **Save Changes**（変更を保存）を押します。

   | PREFIX（プレフィックス） | TARGET（ターゲット） | 転送先 |
   | --- | --- | --- |
   | `/` | `your-host.pages.dev` | 手順 3 でコピーした Cloudflare Pages のホスト名 |
   | `/api` | `xxxx.trycloudflare.com/api` | トンネルのホスト名 + `/api`（手順 6 で実際の値に更新します） |
   | `/discord-cdn` | `cdn.discordapp.com` | Discord のアバター画像 |

3. **TARGET** 列のルールを必ず守ってください。
   - **ホスト名のみ** を書きます。**`https://` も末尾の `/` も付けません。**
   - `/api` 行の末尾には **必ず `/api` を残します**（`<tunnel-host>/api`）。Discord がプレフィックスをターゲット文字列で置き換える仕組みだからです。
   - いま Activities を有効化するために必須なのは `/` だけです。`/api` は仮の値で保存しておき、手順 6 で更新して構いません。

### 4.3 Activities を有効化する

1. **Developer Portal → 対象アプリ → Activities → Settings**（設定）を開きます。
2. **Enable Activities**（アクティビティを有効化）をオンにし、**Save Changes**（変更を保存）を押します。
   - これを有効にすると、Discord 管理の **Entry Point**（起動用コマンド）が自動で追加されます。

✅ **確認:** テストサーバーにアプリが追加されており、**Activities → URL Mappings** に `/` と `/discord-cdn` が保存され、**Enable Activities** がオンになっています。

---

## 5. Mac 上に `.env` を作成する

**`.env` ファイル** は、Mac 上のサーバーが読み込む設定や機密キーを書いておくローカル専用のテキストファイルです。Git の管理対象外なので GitHub にアップロードされることはありません。

1. ターミナル（`discord-casino` フォルダ内）でサンプルファイルをコピーします。

   ```sh
   cp .env.example .env
   ```

2. Discord で **開発者モード（Developer Mode）** をオンにして、各種 ID をコピーできるようにします。
   - Discord の **User Settings**（ユーザー設定・歯車アイコン）→ **Advanced**（詳細設定）→ **Developer Mode**（開発者モード）をオンにします。
   - **テストサーバー ID:** 左端のサーバーアイコンを右クリック → **Copy Server ID**（サーバー ID をコピー）。
   - **自分のユーザー ID:** 自分の名前やアイコンを右クリック → **Copy User ID**（ユーザー ID をコピー）。
   - **通知用チャンネル ID:** テストサーバー内のテキストチャンネルを右クリック → **Copy Channel ID**（チャンネル ID をコピー）。

3. ターミナルでランダムな `SESSION_SECRET` を生成し、出力された文字列をコピーします。

   ```sh
   openssl rand -hex 32
   ```

4. `.env` をテキストエディタ（例: `open -e .env` や `nano .env`）で開き、次の表に沿って値を入力します。

   | 環境変数 | 必須? | 機密? | 取得元・入力例 |
   | --- | --- | --- | --- |
   | `DISCORD_TOKEN` | 必須 | **はい** | Developer Portal → Bot → Token |
   | `DISCORD_CLIENT_ID` | 必須 | いいえ | Developer Portal → General Information → Application ID（`APP_ID`） |
   | `DISCORD_CLIENT_SECRET` | 必須 | **はい** | Developer Portal → OAuth2 → Client Secret（Bot Token ではない） |
   | `DISCORD_PUBLIC_KEY` | 必須 | いいえ | Developer Portal → General Information → Public Key（64 文字の 16 進数） |
   | `ALLOWED_GUILD_IDS` | 必須 | いいえ | テストサーバー ID（複数ある場合はカンマ区切り） |
   | `OWNER_IDS` | 必須 | いいえ | 自分の Discord ユーザー ID（複数ある場合はカンマ区切り） |
   | `TEST_GUILD_ID` | 必須 | いいえ | テストサーバー ID |
   | `REQUIRE_APPROVAL` | 必須 | いいえ | `1` / `0`。`ALLOWED_GUILD_IDS` に載せたサーバーは常に承認済みで、この設定では変わりません |
   | `UTC_OFFSET_HOURS` | 必須 | いいえ | 日次リセットの時差（日本時間は `9`） |
   | `SESSION_SECRET` | 必須 | **はい** | `openssl rand -hex 32` の出力（32 文字以上） |
   | `PUBLIC_API_ORIGIN` | 必須 | いいえ | 当面は `https://localhost` で構いません（起動時に形式チェックされますが現在は未使用。独自ドメイン取得後は `https://api.example.com`） |
   | `ANNOUNCE_CHANNEL_ID` | 必須 | いいえ | テストサーバー内の通知用テキストチャンネル ID |
   | `NODE_ENV` | 任意 | いいえ | 既定 `production`。Discord / トンネル経由で動かすときは未設定または `production` のままにします |
   | `REQUIRE_PROXY_SIGNATURE` | 任意 | いいえ | 既定 `0`。いまは `0` のままにします（ログイン後の通信に Discord の署名が付くことを確認できたら有効にする予定です） |
   | `HOST` | 任意 | いいえ | 既定 `127.0.0.1`。トンネルがローカル接続するため既定のままにします |
   | `PORT` | 任意 | いいえ | 既定 `3001`。サーバーの待機ポート |
   | `DATABASE_PATH` | 任意 | いいえ | 既定 `./data/casino.sqlite`。新しいデータベースファイルです（旧版の `data/casino.db` はインポーターの入力専用） |
   | `LOG_LEVEL` | 任意 | いいえ | 既定 `info`（`fatal` / `error` / `warn` / `info` / `debug` / `trace` / `silent`） |

5. ファイルを保存します。
   - **重要:** `.env` を編集したあとは、毎回 **サーバーを再起動**（ターミナル 1 で `Ctrl+C` → もう一度 `pnpm dev:server`）しないと反映されません。

✅ **確認:** `.env` に `replace-with-...` や `000000000000000000` のような仮の値が残っておらず、`git status` を実行しても `.env` が表示されません。

---

## 6. トンネルを用意する

**トンネル**（`cloudflared`）を使うと、Discord から Mac 上のサーバー（`localhost:3001`）へ安全に通信が届くようになります。

まず Homebrew で `cloudflared` をインストールします。

```sh
brew install cloudflared
```

次に、独自ドメインの有無に合わせて **方法 A** または **方法 B** を選びます。

### 方法 A: まだドメインがない場合 — クイックトンネル（最短）

1. ターミナル（`discord-casino` フォルダ内）でクイックトンネルを起動します。

   ```sh
   pnpm dev:tunnel:quick
   ```

2. ターミナルの枠内に `https://xxxx.trycloudflare.com` のような一時 URL が表示されます。
3. `https://` を除いたホスト名だけ（`xxxx.trycloudflare.com`）をコピーします。
4. **Developer Portal → 対象アプリ → Activities → URL Mappings** を開き、`/api` のターゲットを `xxxx.trycloudflare.com/api` に書き換えて **Save Changes**（変更を保存）を押します。
5. **このターミナルウィンドウは開いたままにしてください。**
6. **注意:** クイックトンネルは **再起動するたびに `xxxx.trycloudflare.com` のホスト名が変わります**。再起動したら毎回 `/api` のマッピングを更新し、Discord を再読み込み（`Cmd+R` / `Ctrl+R`）してください。

### 方法 B: Cloudflare 上に独自ドメインがある場合 — 名前付きトンネル（あとから推奨）

あとから **Cloudflare Registrar** で独自ドメインを購入すると（年額 10 ドル前後）、`api.example.com` のような固定アドレスが使えます。再起動のたびに URL Mappings を書き換える手間がなくなり、将来 Raspberry Pi で常時稼働させるときにも必要になります。

1. Cloudflare にログインして名前付きトンネルを作成します。

   ```sh
   cloudflared tunnel login
   cloudflared tunnel create discord-casino
   ```

   表示された `<tunnel-id>` と、`~/.cloudflared/<tunnel-id>.json` が作成されたことを確認します。

2. API 用サブドメイン（例: `api.example.com`）をトンネルへ紐付けます。

   ```sh
   cloudflared tunnel route dns discord-casino api.example.com
   ```

3. 設定テンプレートをリポジトリ外へコピーし、`<tunnel-id>`・認証ファイルパス・`api.example.com` を入力します。

   ```sh
   mkdir -p ~/.cloudflared
   cp ops/cloudflared/config.example.yml ~/.cloudflared/config.yml
   open -e ~/.cloudflared/config.yml
   ```

   `service: http://localhost:3001` はそのままにしてください。`ops/cloudflared/config.example.yml` 自体には実トンネル ID や実ドメインを書かないでください。

4. **Developer Portal → 対象アプリ → Activities → URL Mappings** で `/api` を `api.example.com/api` に設定し、**Save Changes**（変更を保存）を押します。
5. 必要であれば `.env` の `PUBLIC_API_ORIGIN` も `https://api.example.com` に更新します。

✅ **確認:** `cloudflared --version` でバージョンが表示され、**Activities → URL Mappings** の `/api` が `<tunnel-host>/api`（`https://` なし・末尾スラッシュなし）になっています。

---

## 7. すべて起動して疎通を確認する

`discord-casino` フォルダを開いた **2 つのターミナルウィンドウ** を使います。

1. **ターミナル 1 — サーバーを起動する:**

   ```sh
   pnpm dev:server
   ```

   そのまま開いておきます。うまく動かないときのエラーログはここに表示されます。

2. **ターミナル 2 — トンネルを起動する:**
   - **方法 A（クイックトンネル）** — 手順 6 から起動したままでなければ実行します。

     ```sh
     pnpm dev:tunnel:quick
     ```

     *（再起動した場合は、新しく出た `xxxx.trycloudflare.com/api` で Developer Portal の `/api` を更新してください。）*

   - **方法 B（名前付きトンネル）:**

     ```sh
     CLOUDFLARED_CONFIG=~/.cloudflared/config.yml pnpm dev:tunnel
     ```

3. **ターミナル 3（新しいタブ）— 3 つのヘルスチェックを実行する:**
   1. Mac 上のサーバー単体の確認:

      ```sh
      curl -i http://localhost:3001/api/health
      ```

   2. トンネル経由の確認（`<tunnel-host>` は `xxxx.trycloudflare.com` または `api.example.com` に置き換え）:

      ```sh
      curl -i https://<tunnel-host>/api/health
      ```

   3. Discord の URL Mapping 経由の確認（`APP_ID` は自分の Application ID に置き換え）:

      ```sh
      curl -i https://APP_ID.discordsays.com/.proxy/api/health
      ```

      3 つ目が成功すると、Discord 側の `/api` マッピングが自宅 Mac まで正しく届いていることが確認できます。

✅ **確認:** 3 つすべての `curl` コマンドで HTTP `200` と `{"status":"ok","db":"ok",...}` が返ってきます。

---

## 8. Discord で Activity を開く

URL Mappings を直前に変更した場合は、**先に Discord を再読み込み** してください（macOS は `Cmd+R`、Windows/Linux は `Ctrl+R`）。

### デスクトップ版

- **ボイスチャンネル:** テストサーバーのボイスチャンネルに参加 → **Activities**（ロケットアイコン）をクリック → 対象アプリを選択。
- **テキストチャンネル:** メッセージ入力欄の横にある **Apps**（アプリ）ボタンをクリック → 対象アプリを選択 → **Launch**（起動）（または `/launch` と入力してアプリの Entry Point コマンドを実行）。

### モバイル版

- **ボイスチャンネル:** ボイスチャンネルに参加 → ボイス操作パネルを開く → **Activities**（ロケットアイコン）をタップ → 対象アプリを選択。
- **テキストチャンネル:** メッセージ入力欄横の **`+`** / **Apps** ボタンをタップ → 対象アプリを選択 → **Launch**（起動）。

### 初回起動

1. **Authorize**（認証）画面が出るので、**Authorize** をクリックします。
2. **Home**（ホーム）画面が開き、自分のアカウント名と初期残高（新規アカウントは **3,000 Pelica**）が表示されます。

✅ **確認:** Discord 内でカジノのホーム画面が開き、残高 **3,000 Pelica** が表示されます。

---

## 9. トラブルシューティング

| 症状 | よくある原因 | 解決方法 |
| --- | --- | --- |
| Activities を有効にしようとすると `Missing Requirement: [URL Mapping]` が出る | `/` の URL Mapping をまだ保存していない | **Activities → URL Mappings** で `/` → `your-host.pages.dev` を保存してから **Enable Activities** をオンにする |
| Cloudflare のビルドで `"application detection logic has been run in the root of a workspace"` と出る（または **Deploy command** / `wrangler` が表示される） | **Pages** ではなく **Worker** を作ってしまった | その Worker の **Settings → Delete** で削除し、手順 3 の通り **Pages** プロジェクトを作り直す |
| `<APP_ID>.discordsays.com refused to connect` と表示される | `/` のターゲット指定ミス（ホスト名の打ち間違い、`https://` や末尾 `/` の混入） | Cloudflare Pages の正確な `*.pages.dev` ホスト名をコピーして `/` を修正・保存し、Discord を再読み込み（`Cmd+R` / `Ctrl+R`） |
| 読み込み画面のまま止まる | サーバーまたはトンネルが止まっている、あるいはクイックトンネル再起動後に `/api` を更新していない | ターミナル 1 と 2 が動いているか確認し、クイックトンネル再起動時は `/api` を更新、手順 7 の `curl` 3 つを確認して Discord を再読み込み（`Cmd+R` / `Ctrl+R`） |
| Activities 一覧にアプリが出てこない | Activities が有効になっていない、テストサーバーに未インストール、または Discord の表示が古い | **Activities → Settings → Enable Activities** がオンか、手順 4 でサーバーにインストール済みかを確認し、Discord を再起動または再読み込み（`Cmd+R` / `Ctrl+R`） |
| `"Your session ended. Please open the app again."` と表示される | サーバー側で認証が拒否された | **ターミナル 1** のログから `auth rejected: <reason>` の行を探し、下の表で原因を確認する |

### ターミナル 1 の `auth rejected: <reason>` 一覧

| ターミナル 1 に出た理由 | 原因 | 解決方法 |
| --- | --- | --- |
| `code_exchange_failed:401` | `DISCORD_CLIENT_SECRET` が間違っている（**Bot Token** を誤って貼っていることが多い） | **Developer Portal → OAuth2 → Client Secret** をコピーまたはリセットして `.env` を更新し、サーバーを再起動 |
| `code_exchange_failed:400` | `.env` の `DISCORD_CLIENT_ID` と Cloudflare Pages の `VITE_DISCORD_CLIENT_ID` が一致していない、または認証コードの期限切れ | 両方が同じ `APP_ID` か確認し（Pages 変更時は再デプロイ、`.env` 変更時はサーバー再起動）、Activity を開き直す |
| `guild_not_allowed`（または `guild_denied`） | そのサーバーの ID が `ALLOWED_GUILD_IDS` に入っていない | サーバー ID をコピーして `.env` の `ALLOWED_GUILD_IDS` に追加し、サーバーを再起動 |
| `guild_pending` | `ALLOWED_GUILD_IDS` に無いサーバーのみ（先に `guild_not_allowed` で拒否されます）。ここに載せたサーバーは自動承認されます | サーバー ID を `ALLOWED_GUILD_IDS` に追加 → サーバーを再起動 |
| `proxy_signature_invalid` | `.env` の `DISCORD_PUBLIC_KEY` が間違っている | **Developer Portal → General Information** から 64 文字の **Public Key** をコピーして `.env` を更新し、サーバーを再起動 |
| `proxy_signature_missing` *（続けて不足ヘッダー名が表示）* | Discord のプロキシ署名ヘッダーが付いていない（`/api/token` では発生しません。ほかのルートでも `REQUIRE_PROXY_SIGNATURE=1` のときだけ出ます） | `.env` で `REQUIRE_PROXY_SIGNATURE=0` に戻してサーバーを再起動し、報告してください |
| `timestamp_skew` / `proxy_expired` | Mac の時計がずれている、または通信の期限が切れた | macOS の **システム設定 → 一般 → 日付と時刻** で自動設定をオンにし、Activity を開き直す |
| `session_expired` / `session_invalid` / `session_revoked` / `socket_auth_failed` | セッション切れ、またはリアルタイム通信の認証失敗 | Activity を閉じて開き直す。すぐ再発する場合は報告してください |
| `user_not_in_guild` / `instance_mismatch` / `scope_missing` | Discord 側でユーザー・サーバー・権限の一致を確認できなかった | Activity を閉じ、Discord を再読み込み（`Cmd+R` / `Ctrl+R`）してから起動し直す |
| `*_failed:network` または `user_fetch_failed:<status>` / `guilds_fetch_failed:<status>` / `instance_fetch_failed:<status>` | Mac から Discord へ接続できない、または Discord API に拒否された | インターネット接続を確認して再試行。`instance_fetch_failed:401` / `403` の場合は `.env` の `DISCORD_TOKEN` を確認してサーバーを再起動 |

✅ **確認:** 原因を直したら（`.env` を変えた場合はターミナル 1 を再起動）、Discord を再読み込み（`Cmd+R` / `Ctrl+R`）し、ターミナル 1 に新しい `auth rejected:` が出ないことを確認します。

---

## 10. あとから Raspberry Pi へ移行する

Mac を起動したままにせず 24 時間動かしたくなったら、[Raspberry Pi セットアップガイド](PI_SETUP.ja.md) に進んでください。コードの変更は不要で、名前付きトンネル（手順 6 の方法 B）を用意したうえで `.env` とトンネル認証情報を Pi へ移すだけで移行できます。

✅ **確認:** Pi への移行を始める前に、Mac 上で名前付きトンネル（手順 6 の方法 B）が動いている状態にしておきます。
