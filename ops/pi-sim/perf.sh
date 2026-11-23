#!/usr/bin/env bash
# Pi performance run: start the pi-sim container (arm64, 512 MB, 2 CPUs), drive it with the load
# script from the host over loopback and check the targets. Needs docker, node 24 and
# `pnpm install` (socket.io-client). Run on an arm64 host (CI: ubuntu-24.04-arm).
#
#   ops/pi-sim/perf.sh [--duration 300] [--players 30] [--idle 10] [--out DIR] [--label TEXT]
#                      [--rate-scale 1] [--image TAG] [--no-build] [--port 3001] [--no-gate]
#
# Results land in DIR (default perf-out): result.json, result.md, probe.jsonl, server.log.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
duration=300
players=30
idle=10
out="$root/perf-out"
label="Pi performance (pi-sim, arm64, 512 MB, 2 CPUs)"
image="discord-casino-pi-sim:perf"
build=1
port=3001
extra=()

while [ $# -gt 0 ]; do
  case "$1" in
    --duration) duration="$2"; shift 2 ;;
    --players) players="$2"; shift 2 ;;
    --idle) idle="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --label) label="$2"; shift 2 ;;
    --image) image="$2"; shift 2 ;;
    --port) port="$2"; shift 2 ;;
    --rate-scale) extra+=(--rate-scale "$2"); shift 2 ;;
    --no-build) build=0; shift ;;
    --no-gate) extra+=(--no-gate); shift ;;
    *) echo "unknown option: $1" >&2; exit 64 ;;
  esac
done

if [ "$build" = 1 ]; then
  docker build --platform linux/arm64 -f "$root/ops/pi-sim/Dockerfile" -t "$image" "$root"
fi

mkdir -p "$out"
rm -f "$out/probe.jsonl" "$out/server.log" "$out/result.json" "$out/result.md"
# The container runs as the unprivileged `node` user and appends the probe file here.
chmod 777 "$out"

# Races start at fixed local hours and take bets from 60 to 2 minutes before the start. Pick the
# UTC offset so that "now" is local 20:00, one hour before the 21:00 race (every day has one):
# the race card then has a race open for bets whatever time the run happens to start. The earlier
# races of the local day are run by the scheduler right away, so a race run is part of the load.
utc_hour="$(date -u +%H)"
offset=$(( (20 - 10#$utc_hour + 24) % 24 ))
if [ "$offset" -gt 12 ]; then offset=$(( offset - 24 )); fi
echo "UTC offset for the race card: $offset h"

secret="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
name="casino-perf-$$"
cleanup() {
  docker logs "$name" >"$out/server.log" 2>&1 || true
  docker rm -f "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Host networking keeps the socket path a true loopback; the cgroup limits still apply.
# `--memory-swap` equal to `--memory` forbids swap, which a 512 MB Pi without swap would not have.
started="$(date +%s%N)"
docker run -d --name "$name" --network host --memory=512m --memory-swap=512m --cpus=2 \
  -v "$root/ops/pi-sim/perf:/perf:ro" -v "$out:/perf-out" \
  -e NODE_OPTIONS=--import=/perf/probe.mjs \
  -e PERF_PROBE_FILE=/perf-out/probe.jsonl \
  -e NODE_ENV=production \
  -e HOST=127.0.0.1 \
  -e PORT="$port" \
  -e BOT_DISABLED=1 \
  -e DATABASE_PATH=/app/data/casino.sqlite \
  -e DISCORD_TOKEN=perf-placeholder-token \
  -e DISCORD_CLIENT_ID=100000000000000000 \
  -e DISCORD_CLIENT_SECRET=perf-placeholder-secret \
  -e DISCORD_PUBLIC_KEY=0000000000000000000000000000000000000000000000000000000000000000 \
  -e ALLOWED_GUILD_IDS=900000000000000001 \
  -e OWNER_IDS=100000000000000001 \
  -e TEST_GUILD_ID=900000000000000001 \
  -e REQUIRE_APPROVAL=0 \
  -e UTC_OFFSET_HOURS="$offset" \
  -e SESSION_SECRET="$secret" \
  -e PUBLIC_API_ORIGIN=https://api.example.com \
  -e ANNOUNCE_CHANNEL_ID=100000000000000002 \
  "$image" >/dev/null

# Cold start: from `docker run` until /api/health answers.
cold_ms=""
for _ in $(seq 1 600); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$port/api/health" 2>/dev/null; then
    cold_ms=$(( ($(date +%s%N) - started) / 1000000 ))
    break
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$name")" != "true" ]; then
    docker logs "$name" >&2 || true
    echo "server container exited before it listened" >&2
    exit 1
  fi
  sleep 0.05
done
if [ -z "$cold_ms" ]; then
  echo "server did not answer /api/health within 30 s" >&2
  exit 1
fi
echo "cold start (docker run to /api/health): ${cold_ms} ms"

status=0
node "$root/apps/server/scripts/load.ts" \
  --url "http://127.0.0.1:$port" \
  --secret "$secret" \
  --players "$players" \
  --duration "$duration" \
  --idle "$idle" \
  --probe "$out/probe.jsonl" \
  --cold-start-ms "$cold_ms" \
  --container "$name" \
  --label "$label" \
  --json "$out/result.json" \
  --markdown "$out/result.md" \
  ${extra[@]+"${extra[@]}"} || status=$?
exit "$status"
