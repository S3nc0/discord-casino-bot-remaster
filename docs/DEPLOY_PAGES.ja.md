[English](DEPLOY_PAGES.md) | **日本語**

# `apps/web` を Cloudflare Pages にデプロイする

手順の全体（**Workers** ではなく **Pages** を選ぶための確認も含む）は、オーナー向けセットアップガイドを見てください。

- **English:** [Owner Setup Guide — Step 3: Cloudflare Pages](OWNER_SETUP.md#3-cloudflare-pages-host-the-web-app)
- **日本語:** [オーナー向けセットアップガイド — 手順 3：Cloudflare Pages](OWNER_SETUP.ja.md#3-cloudflare-pagesweb-アプリの公開)

## クイックリファレンス

| 設定 | 値 |
| --- | --- |
| **Framework preset** | `None` |
| **Build command** | `pnpm --filter @casino/web build` |
| **Build output directory** | `apps/web/dist` |
| **Root directory** | *（空のままにします。リポジトリのルートからビルドするので、ワークスペースのパッケージが解決されます）* |

### 環境変数（Production と Preview）

- `NODE_VERSION` = `24`
- `PNPM_VERSION` = `12.21.0`
- `VITE_DISCORD_CLIENT_ID` = `APP_ID`（公開してよい値です。Cloudflare Pages には秘密情報を絶対に入れないでください）
- `VITE_API_HOST` = 任意。クイックトンネルを使うときは設定しません

### ルーティングのメモ

- フォントとアセットはすべて `apps/web/dist` にバンドルします。Discord アクティビティの iframe の中では、マッピングされていない外部の URL はブロックされます。
- `/api` の通信は、Pages Functions や `_redirects` ではなく、Discord の **URL Mappings** でトンネル（`<tunnel-host>/api`）に回します。
