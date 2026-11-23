[English](README.md) | **日本語**

# Pi 風コンテナ（`ops/pi-sim`）

実際に使う Raspberry Pi の実行環境を再現します。

- **アーキテクチャ:** `linux/arm64`
- **OS:** Debian Bookworm（`node:24-bookworm-slim`）
- **ランタイム:** Node 24（`--max-old-space-size=192`）、root ではない `node` ユーザー
- **ネイティブ依存:** `better-sqlite3` は、ビルド済みの `linux-arm64` バイナリを読み込みます。実行用のイメージにコンパイラ（`gcc`、`g++`、`make`、`python3`）はありません
- **リソース制限（`compose.yaml`）:** `mem_limit: 512m`、`cpus: 2`

## ビルドと実行（Docker のあるホストで）

1. リポジトリのルートに `.env` があることを確認します（`.env.example` をコピーして、本物の値を入れたもの）。
2. リポジトリのルートで、コンテナをビルドして起動します。

```sh
docker compose -f ops/pi-sim/compose.yaml up --build
```

コンテナの中で使うポート、バインドするアドレス、データベースのパスを上書きするには、次のようにします（`compose.yaml` が `HOST=0.0.0.0` を既定にしているのは、コンテナのポート転送のためだけです。ホストに直接入れる場合は `127.0.0.1` のままにします）。ホスト側のポートは `127.0.0.1` にだけバインドするので、外部のクライアントがトンネルを迂回して、`trustProxy` に対して `X-Forwarded-For` を偽装することはできません。

```sh
PORT=3001 HOST=0.0.0.0 DATABASE_PATH=/app/data/casino.sqlite docker compose -f ops/pi-sim/compose.yaml up --build
```

## CI での検証

手元に Docker がない場合（オーナーの Mac など）は、`.github/workflows/ci.yml` の `pi-sim` ジョブが、`ubuntu-24.04-arm` 上で `ops/pi-sim/Dockerfile` をネイティブにビルドします。実行用のイメージにコンパイラがないこと、`better-sqlite3` がビルド済みのものから読み込めることを確認し、HTTP サーバーがつながったあとは `GET /api/health` のスモークテストも行います。

## 性能テスト

`ops/pi-sim/perf.sh` は、このコンテナ（`512m`、2 CPU、スワップなし）を起動し、`apps/server/scripts/load.ts`（既定では 30 人の模擬プレイヤー、5 分間）で負荷をかけて、アイドル時の RSS、負荷時の RSS、ソケットの往復時間、コールドスタート、失敗の数を、目標と照らし合わせます。`ops/pi-sim/perf/probe.mjs` はサーバーに先読みさせ（`NODE_OPTIONS=--import`）、RSS、CPU、イベントループの遅延を 1 秒ごとに書き出します。CI では `perf (pi-sim arm64)` として実行します（`.github/workflows/perf.yml`）。結果は [docs/PI_SETUP.ja.md](../../docs/PI_SETUP.ja.md#パフォーマンス計測結果opspi-simperfsh) にあります。
