# Raspberry Pi セットアップ手順（`arm64` / Debian Bookworm）

`ops/pi/` を使用して、64-bit Raspberry Pi（`arm64` / `aarch64`、Debian Bookworm）へサーバーと `cloudflared` をコード変更なしでデプロイする手順です。

## 前提条件

- 64-bit OS が動作する Raspberry Pi（`uname -m` が `aarch64` または `arm64` を返すこと。例: Raspberry Pi OS Lite 64-bit / Debian 12 Bookworm）。
- `git` が利用可能で、`sudo` 権限があること。
- Cloudflare Tunnel の認証情報 JSON（Pi 上で作成するか、Mac 上の `~/.cloudflared/<TUNNEL_ID>.json` を安全にコピーしたもの）。

## 1. ワンコマンド・冪等インストーラ実行

リポジトリを取得し、root 権限で `ops/pi/install.sh` を実行します。

```sh
git clone <YOUR_REPO_URL> /tmp/discord-casino
sudo bash /tmp/discord-casino/ops/pi/install.sh
```

`ops/pi/install.sh` は再実行しても安全な冪等スクリプトで、以下を行います。

1. ホストアーキテクチャが `arm64` / `aarch64` であることを検証します。
2. `sqlite3`、`curl`、`gnupg`、`rsync`、`ca-certificates`、**Node.js 24**、**pnpm 12.21.0**、**`cloudflared`（arm64）** を未導入の場合のみインストールします。
3. 非 root システムユーザー `casino` と、`/opt/discord-casino`・`/opt/discord-casino/data`・`/var/backups/discord-casino` を作成します。
4. 既存の `.env`・`.env.*`・`data/` を保持したまま `/opt/discord-casino` へ同期し、`pnpm install --frozen-lockfile` と `@casino/server` のビルドを実行します。
5. systemd ユニットを配置し、`discord-casino-backup.timer` を有効化します。
   - `ops/pi/discord-casino.service`（`User=casino`、`MemoryMax=320M`、`Restart=on-failure`、`node --max-old-space-size=192`、`EnvironmentFile=/opt/discord-casino/.env`）
   - `ops/pi/cloudflared.service`（`User=casino`、`/etc/cloudflared/config.yml` を使用）
   - `ops/pi/discord-casino-backup.service` + `ops/pi/discord-casino-backup.timer`（毎晩 `sqlite3 .backup` でバックアップし 7 日ローテーション）

## 2. `.env` と `cloudflared` の設定

1. Pi 上で `/opt/discord-casino/.env` を作成します（コミット厳禁）。

   ```sh
   sudo cp /opt/discord-casino/.env.example /opt/discord-casino/.env
   sudo nano /opt/discord-casino/.env
   sudo chown casino:casino /opt/discord-casino/.env
   sudo chmod 600 /opt/discord-casino/.env
   ```

   Discord プロキシ署名検証を有効にするため、`NODE_ENV=production`（または未設定）にしてください。

2. `/etc/cloudflared/config.yml` とトンネル認証情報 JSON を配置します。

   ```sh
   sudo install -o root -g casino -m 0640 ~/.cloudflared/<TUNNEL_ID>.json /etc/cloudflared/<TUNNEL_ID>.json
   sudo nano /etc/cloudflared/config.yml
   ```

   `tunnel:`、`credentials-file: /etc/cloudflared/<TUNNEL_ID>.json`、`hostname: API_DOMAIN`（転送先 `http://localhost:3001`）を設定します。

## 3. Mac からのデータ移行（任意）

新サーバーが参照する本番データベースは `/opt/discord-casino/data/casino.sqlite`（`DATABASE_PATH`、既定値 `./data/casino.sqlite`）です。`data/casino.db` はレガシー Python Bot 用のインポート元ファイル（`apps/server/scripts/import-legacy.ts` の入力専用）であり、本番サーバーが直接開くことはありません。

Pi で起動する前に、**必ず Mac 側のサーバーを停止**してください（同一 Bot トークンでの二重起動や DB 同時書き込みを防ぐため）。Mac 上で `casino.sqlite` の安全な SQLite スナップショットを作成し、Pi へ転送します。

```sh
# Mac 側（サーバー停止後）:
sqlite3 data/casino.sqlite ".backup 'casino-migration.sqlite'"
scp casino-migration.sqlite <pi-user>@<pi-host>:/tmp/casino.sqlite

# Pi 側:
sudo install -o casino -g casino -m 0640 /tmp/casino.sqlite /opt/discord-casino/data/casino.sqlite
rm -f /tmp/casino.sqlite
```

（レガシー Python Bot の `data/casino.db` から移行する場合は、Python Bot を停止した状態で `apps/server/scripts/import-legacy.ts` を実行して `casino.sqlite` へ取り込んでください。）

## 4. サービスの起動と確認

```sh
sudo systemctl restart discord-casino.service cloudflared.service
sudo systemctl status discord-casino.service cloudflared.service
sudo journalctl -u discord-casino.service -n 50 --no-pager
```

夜間バックアップタイマーの確認と手動テスト実行:

```sh
sudo systemctl list-timers discord-casino-backup.timer
sudo systemctl start discord-casino-backup.service
ls -lh /var/backups/discord-casino/
```

## 5. バックアップからの復元

```sh
sudo systemctl stop discord-casino.service
sudo -u casino cp /var/backups/discord-casino/casino-YYYYMMDD-HHMMSS.sqlite /opt/discord-casino/data/casino.sqlite
sudo systemctl start discord-casino.service
```

## コンテナによる事前検証（`ops/pi-sim`）

実機デプロイ前に、`ops/pi-sim/Dockerfile` と `ops/pi-sim/compose.yaml` が `arm64` / Debian Bookworm / Node 24 / ビルド済み `better-sqlite3` バイナリ構成を `512m` メモリ・`2` CPU 制限下で検証します（CI の `ubuntu-24.04-arm` で自動実行されます）。
