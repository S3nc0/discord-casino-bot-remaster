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

1. サーバーを止め、古い `casino.sqlite-wal` と `casino.sqlite-shm` を削除し、バックアップファイルを `casino.sqlite` へ上書きコピーしてから起動し直します。

   ```sh
   sudo systemctl stop discord-casino.service
   sudo -u casino rm -f /opt/discord-casino/data/casino.sqlite-wal /opt/discord-casino/data/casino.sqlite-shm
   sudo -u casino cp /var/backups/discord-casino/casino-YYYYMMDD-HHMMSS.sqlite /opt/discord-casino/data/casino.sqlite
   sudo systemctl start discord-casino.service
   ```

   `-wal` と `-shm` は、置き換える前のデータベースのファイルです。残っていると、SQLite が復元したファイルにそれを適用しようとすることがあります。復元すると、バックアップより後の変更はすべて消えるので、プレイヤーに知らせてください。

✅ **確認:** `sudo systemctl status discord-casino.service` が `active (running)` になり、`journalctl` にデータベースエラーが出ていません。

---

## コンテナによる事前検証（`ops/pi-sim`）

実機へ入れる前に、`ops/pi-sim/Dockerfile` と `ops/pi-sim/compose.yaml` が `arm64` / Debian Bookworm / Node 24 / ビルド済み `better-sqlite3` の環境を `512m` メモリ・`2` CPU 制限下で検証します（CI の `ubuntu-24.04-arm` で自動実行されます）。

---

## パフォーマンス計測結果（`ops/pi-sim/perf.sh`）

サーバーを GitHub の `ubuntu-24.04-arm` ランナー上の `pi-sim` コンテナ（`arm64`、メモリ 512 MB、CPU 2、スワップなし、`node --max-old-space-size=192`、`NODE_ENV=production`）で動かします。`apps/server/scripts/load.ts` が自分で署名したセッショントークンで 30 人の疑似プレイヤーをループバック経由でログインさせ（`BOT_DISABLED=1`、使い捨ての `SESSION_SECRET`、コンテナ内のファイル DB）、ルーレット・スロット・ブラックジャックの席（1 人 1 ラウンドずつ）、競馬の賭け、デイリー受け取り、送金、マーケット注文、閲覧系の画面という現実的な操作を再現します。往復時間は各プレイヤーが毎秒送る `time:ping` で測ります。サーバーに先読みさせるプローブ（`ops/pi-sim/perf/probe.mjs`）が RSS・CPU・イベントループ遅延を毎秒記録します。

| 指標（30 人・5 分） | 目標 | 調整前 | 調整後 | リリース前の確認（v1.0.0） |
| --- | --- | --- | --- | --- |
| 起動直後のアイドル RSS | ≤ 150 MB | 137.4 MB | 137.4 MB（変更なし） | 137.2 MB |
| 負荷時の RSS（ピーク） | ≤ 250 MB | 157.8 MB | 157.8 MB（変更なし） | 159.3 MB |
| 負荷時の RSS（定常） | – | 156.2 MB | 156.2 MB（変更なし） | 157.7 MB |
| コンテナのメモリピーク（cgroup） | – | 117 MB | 117 MB（変更なし） | 117.4 MB |
| ソケット往復 p95（ループバック） | < 50 ms | 0.73 ms | 0.73 ms（変更なし） | 0.72 ms |
| コールドスタート（`docker run` から `/api/health` まで） | < 5 秒 | 1.16 秒 | 1.16 秒（変更なし） | 1.12 秒 |
| CPU 平均 / p95（2 コアのうち 1 コア換算 %） | – | 4.0 / 5.7 | 4.0 / 5.7（変更なし） | 3.6 / 5.3 |
| イベントループ遅延 アイドル p50 / p95 / p99 | – | 0.1 / 0.3 / 1.1 ms | 変更なし | 0.1 / 0.2 / 1.1 ms |
| イベントループ遅延 負荷時 p50 / p95 / p99 | – | 0.1 / 1.1 / 1.6 ms | 変更なし | 0.1 / 1.1 / 1.4 ms |

**最初の計測で全目標を満たしたため、サーバーのコードは変更していません**（「調整後」は「調整前」と同じです。目標値も引き上げていません）。5 分間で `5xx`、`internal` エラー、想定外の切断はありませんでした。`game_busy`、`insufficient_funds`、`transfer_min_games`、受け取り済みのデイリーなどの拒否は通常のプレイとして扱い、レポートでは別に数えます。

**リリース前の確認（2026-11-24、v1.0.0 の前）：** ウェーブ 4 の変更をすべてマージしたリリース用のブランチで、同じ 5 分間の計測をしました（[実行 45211982992](https://github.com/S3nc0/discord-casino-bot-remaster/actions/runs/45211982992)）。今回もすべての目標を満たし、失敗も想定外の切断もありませんでした。数値の違いは実行ごとの揺れの範囲です（アイドル RSS 137.2 MB、ピーク 159.3 MB、往復 p95 0.72 ms、コールドスタート 1.12 秒）。

余裕の確認（同じコンテナ）: 60 人・5 倍の操作頻度・2 分間で、RSS ピーク 184.5 MB、CPU 平均 23.8 % / p95 34.2 %（1 コア換算）、ソケット往復 p95 2.5 ms、イベントループ遅延 p99 2.2 ms、失敗なしでした。

数値の読み方:

- アイドル RSS は余裕が最も小さい項目です（150 MB に対して 137 MB）。この計測ではチャットボットを止めている（`BOT_DISABLED=1`）ため、実際のログイン時の Discord ゲートウェイのキャッシュは**含まれていません**。実機で最初の 1 日が過ぎたら `systemctl status discord-casino.service` で RSS を確認してください。
- ランナーの CPU は Raspberry Pi より速いため、CPU と往復時間は下限の目安です（メモリとコードの動きは同じです）。往復時間はループバックで、トンネルは含みません。
- 競馬は、現地時間が 20:00（21:00 のレースの 1 時間前）になるように `UTC_OFFSET_HOURS` を選んで、賭けを受け付けるレースを用意します。その日の先のレースはスケジューラーがすぐ実行するため、レースの実行も負荷に含まれます。賭けは 21:00 のレースに入り、そのレース自体はテスト終了後に走ります。

実行方法:

- **CI:** ジョブ `perf (pi-sim arm64)`（`.github/workflows/perf.yml`）は、`apps/server`、`packages/shared`、`packages/domain`、`ops/pi-sim` に触れるプルリクエストごとに 60 秒実行し、目標を外すと失敗します。5 分の完全版は **Actions → Perf → Run workflow**（入力: `duration`、`players`、`rate_scale`）から実行します。結果の表はジョブサマリーと `perf-results` アーティファクトにあります。
- **Docker と Node 24 のある arm64 マシン:** `pnpm install` のあと `ops/pi-sim/perf.sh --duration 300`。結果は `perf-out/`（`result.md`、`result.json`、`probe.jsonl`、`server.log`）に出ます。
