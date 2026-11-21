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

To override the port or database path used inside the container:

```sh
PORT=3001 DATABASE_PATH=/app/data/casino.db docker compose -f ops/pi-sim/compose.yaml up --build
```

## CI Validation

If Docker is not installed locally (such as on the owner's Mac), the `pi-sim` job in `.github/workflows/ci.yml` builds `ops/pi-sim/Dockerfile` natively on `ubuntu-24.04-arm`, verifies no compiler exists in the runtime image, verifies `better-sqlite3` loads from prebuilt, and smoke-tests `GET /api/health` once the HTTP server is wired.
