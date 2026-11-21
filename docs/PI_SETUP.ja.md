# Raspberry Pi セットアップガイド（`arm64` / Debian Bookworm）

[English](PI_SETUP.md) | **日本語**

`ops/pi/` を使って、64-bit Raspberry Pi（`arm64` / `aarch64`、Debian Bookworm）へサーバーと `cloudflared` トンネルを移す手順です。コードの変更は不要です。

先に [オーナー向けセットアップガイド](OWNER_SETUP.ja.md)（手順 6 の方法 B: 名前付きトンネルを含む）を完了しておいてください。

> [!CAUTION]
> **機密情報は絶対に公開しないでください。** **Bot Token**（`DISCORD_TOKEN`）、**OAuth2 Client Secret**（`DISCORD_CLIENT_SECRET`）、**`SESSION_SECRET`**、およびトンネル認証情報 JSON は、チャット・スクリーンショット・GitHub の Issue・Cloudflare・GitHub のどこにも貼り付けないでください。

---

## 前提条件

- 64-bit OS が動く Raspberry Pi（`uname -m` が `aarch64` または `arm64` を返すこと。例: Debian 12 Bookworm ベースの Raspberry Pi OS Lite 64-bit）。
- Pi 上で `git` が使えて、`sudo` 権限があること。
- Cloudflare 名前付きトンネルの認証情報ファイル（Pi 上で作成するか、Mac の `~/.cloudflared/<tunnel-id>.json` を安全にコピーしたもの）。

✅ **確認:** Pi 上で `uname -m` が `aarch64` または `arm64` を返し、`git --version` でバージョン番号が表示されます。

---

## 1. ワンコマンドインストーラを実行する

1. Pi 上でリポジトリを取得し、root 権限で `ops/pi/install.sh` を実行します（`<your-repo-url>` は自分の GitHub リポジトリ URL に置き換えてください）。

   ```sh
   git clone <your-repo-url> /tmp/discord-casino
   sudo bash /tmp/discord-casino/ops/pi/install.sh
   ```

2. `ops/pi/install.sh` は更新時に何度やり直しても安全です。次の処理を自動で行います。
   1. Pi が 64-bit（`arm64` / `aarch64`）であることを確認します。
   2. `sqlite3`、`curl`、`gnupg`、`rsync`、`ca-certificates`、**Node.js 24**、**pnpm 12.21.0**、**`cloudflared`（`arm64`）** を未導入の場合のみインストールします。
   3. 非 root のシステムユーザー `casino` と、`/opt/discord-casino`・`/opt/discord-casino/data`・`/var/backups/discord-casino` を作成します。
   4. 既存の `.env`・`.env.*`・`data/` を残したまま `/opt/discord-casino` へ同期し、`pnpm install --frozen-lockfile` と `@casino/server` のビルドを実行します。
   5. **systemd** ユニット（Linux の常駐サービス管理）を配置し、夜間バックアップタイマーを有効にします。
      - `ops/pi/discord-casino.service`（`User=casino`、`MemoryMax=320M`、`Restart=on-failure`、`node --max-old-space-size=192`、`EnvironmentFile=/opt/discord-casino/.env`）
      - `ops/pi/cloudflared.service`（`User=casino`、`/etc/cloudflared/config.yml` を使用）
      - `ops/pi/discord-casino-backup.service` + `ops/pi/discord-casino-backup.timer`（毎晩 `sqlite3 .backup` でバックアップし 7 日分を保持）

✅ **確認:** `ops/pi/install.sh` がエラーなしで終わり、`/opt/discord-casino` が作成されています。

---

## 2. `.env` と `cloudflared` を設定する

1. Pi 上で `/opt/discord-casino/.env` を作成し（コミット厳禁）、権限を絞ります。

   ```sh
   sudo cp /opt/discord-casino/.env.example /opt/discord-casino/.env
   sudo nano /opt/discord-casino/.env
   sudo chown casino:casino /opt/discord-casino/.env
   sudo chmod 600 /opt/discord-casino/.env
   ```

   Discord プロキシの署名検証を有効に保つため、`NODE_ENV=production`（または未設定）にしてください。

2. トンネル認証情報ファイルを `/etc/cloudflared/` へ配置し、`/etc/cloudflared/config.yml` を編集します。

   ```sh
   sudo install -o root -g casino -m 0640 ~/.cloudflared/<tunnel-id>.json /etc/cloudflared/<tunnel-id>.json
   sudo nano /etc/cloudflared/config.yml
   ```

   `tunnel:`、`credentials-file: /etc/cloudflared/<tunnel-id>.json`、`hostname: api.example.com`（実際の API ドメイン、転送先 `http://localhost:3001`）を設定します。

✅ **確認:** `/opt/discord-casino/.env` に実際の値が入って権限 `600`・所有者 `casino` になっており、`/etc/cloudflared/config.yml` が `<tunnel-id>.json` と `http://localhost:3001` を指しています。

---

## 3. Mac からデータを移行する（任意）

本番サーバーが使うデータベースは `/opt/discord-casino/data/casino.sqlite`（`DATABASE_PATH`、既定 `./data/casino.sqlite`）です。旧 Python Bot の `data/casino.db` は `apps/server/scripts/import-legacy.ts` の入力専用であり、本番サーバーが直接開くことはありません。

1. 同じ Bot Token での二重起動や DB 同時書き込みを防ぐため、**先に Mac 側のサーバーを停止** します。
2. Mac 上で安全な SQLite バックアップを作り、Pi へ転送します。

   ```sh
   # Mac 側（サーバー停止後）:
   sqlite3 data/casino.sqlite ".backup 'casino-migration.sqlite'"
   scp casino-migration.sqlite <pi-user>@<pi-host>:/tmp/casino.sqlite
   ```

3. Pi 側で正しい所有者に設定して配置し、一時ファイルを消します。

   ```sh
   # Pi 側:
   sudo install -o casino -g casino -m 0640 /tmp/casino.sqlite /opt/discord-casino/data/casino.sqlite
   rm -f /tmp/casino.sqlite
   ```

*（旧 Python Bot の `data/casino.db` から移行する場合は、Python Bot を止めた状態で `apps/server/scripts/import-legacy.ts` を実行し、`casino.sqlite` へ取り込んでください。）*

✅ **確認:** `/opt/discord-casino/data/casino.sqlite` が `casino:casino` 所有で配置され、Mac 側のサーバーが停止しています。

---

## 4. サービスを起動して確認する

1. サーバーとトンネルを起動（または再起動）し、状態とログを確認します。

   ```sh
   sudo systemctl restart discord-casino.service cloudflared.service
   sudo systemctl status discord-casino.service cloudflared.service
   sudo journalctl -u discord-casino.service -n 50 --no-pager
   ```

2. 夜間バックアップタイマーが有効か確認し、手動で 1 回バックアップを試します。

   ```sh
   sudo systemctl list-timers discord-casino-backup.timer
   sudo systemctl start discord-casino-backup.service
   ls -lh /var/backups/discord-casino/
   ```

✅ **確認:** `discord-casino.service` と `cloudflared.service` の両方が `active (running)` になり、`curl -i https://api.example.com/api/health` が HTTP `200` を返し、`/var/backups/discord-casino/` にバックアップファイルが作成されます。

---

## 5. バックアップから復元する

1. サーバーを止め、バックアップファイルを `casino.sqlite` へ上書きコピーしてから起動し直します。

   ```sh
   sudo systemctl stop discord-casino.service
   sudo -u casino cp /var/backups/discord-casino/casino-YYYYMMDD-HHMMSS.sqlite /opt/discord-casino/data/casino.sqlite
   sudo systemctl start discord-casino.service
   ```

✅ **確認:** `sudo systemctl status discord-casino.service` が `active (running)` になり、`journalctl` にデータベースエラーが出ていません。

---

## コンテナによる事前検証（`ops/pi-sim`）

実機へ入れる前に、`ops/pi-sim/Dockerfile` と `ops/pi-sim/compose.yaml` が `arm64` / Debian Bookworm / Node 24 / ビルド済み `better-sqlite3` の環境を `512m` メモリ・`2` CPU 制限下で検証します（CI の `ubuntu-24.04-arm` で自動実行されます）。
