# Pi-Like Container (`ops/pi-sim`)

Simulates the target Raspberry Pi runtime environment:

- **Architecture:** `linux/arm64`
- **OS:** Debian Bookworm (`node:24-bookworm-slim`)
- **Runtime:** Node 24 with `--max-old-space-size=192`, non-root `node` user
- **Native dependency:** `better-sqlite3` loaded from its prebuilt `linux-arm64` binary with no compiler (`gcc`, `g++`, `make`, `python3`) in the runtime image
- **Resource limits (`compose.yaml`):** `mem_limit: 512m`, `cpus: 2`

## Build and Run (on a host with Docker)

1. Ensure `.env` exists at the repository root (copied from `.env.example` with real values).
2. From the repository root, build and start the container:

```sh
docker compose -f ops/pi-sim/compose.yaml up --build
```

To override the port, bind address, or database path used inside the container (`compose.yaml` defaults `HOST=0.0.0.0` only for container port forwarding; host installs keep `127.0.0.1`). The host port mapping binds to `127.0.0.1` only so external clients cannot bypass the tunnel and forge `X-Forwarded-For` against `trustProxy`.

```sh
PORT=3001 HOST=0.0.0.0 DATABASE_PATH=/app/data/casino.sqlite docker compose -f ops/pi-sim/compose.yaml up --build
```

## CI Validation

If Docker is not installed locally (such as on the owner's Mac), the `pi-sim` job in `.github/workflows/ci.yml` builds `ops/pi-sim/Dockerfile` natively on `ubuntu-24.04-arm`, verifies no compiler exists in the runtime image, verifies `better-sqlite3` loads from prebuilt, and smoke-tests `GET /api/health` once the HTTP server is wired.

## Performance Run

`ops/pi-sim/perf.sh` starts this container (`512m`, 2 CPUs, no swap), drives it with `apps/server/scripts/load.ts` (30 simulated players, 5 minutes by default) and checks idle RSS, RSS under load, socket round trip, cold start and failures against the targets. `ops/pi-sim/perf/probe.mjs` is preloaded into the server (`NODE_OPTIONS=--import`) and writes RSS, CPU and event-loop lag once a second. CI runs it as `perf (pi-sim arm64)` (`.github/workflows/perf.yml`). Results are in [docs/PI_SETUP.md](../../docs/PI_SETUP.md#performance-results-opspi-simperfsh).
