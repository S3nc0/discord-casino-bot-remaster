# Raspberry Pi Setup Guide (`arm64` / Debian Bookworm)

**English** | [日本語](PI_SETUP.ja.md)

This guide moves the server and `cloudflared` tunnel onto a 64-bit Raspberry Pi (`arm64` / `aarch64`, Debian Bookworm) using `ops/pi/`. No code changes are required.

Complete the [Owner Setup Guide](OWNER_SETUP.md) first (including a named tunnel in Step 6, Path B).

> [!CAUTION]
> **Keep secrets private.** Never paste your **Bot Token** (`DISCORD_TOKEN`), **OAuth2 Client Secret** (`DISCORD_CLIENT_SECRET`), **`SESSION_SECRET`**, or tunnel credentials JSON into chat, screenshots, GitHub issues, Cloudflare, or GitHub.

---

## Prerequisites

- A Raspberry Pi running a 64-bit OS (`uname -m` must print `aarch64` or `arm64`, such as Raspberry Pi OS Lite 64-bit based on Debian 12 Bookworm).
- `git` installed on the Pi, plus `sudo` access.
- Your Cloudflare named tunnel credentials file (either created on the Pi or copied securely from your Mac's `~/.cloudflared/<tunnel-id>.json`).

✅ **Check:** Running `uname -m` on the Pi prints `aarch64` or `arm64`, and `git --version` prints a version number.

---

## 1. Run the One-Command Installer

1. On the Pi, clone the repository and run `ops/pi/install.sh` as root (replace `<your-repo-url>` with your GitHub repository URL):

   ```sh
   git clone <your-repo-url> /tmp/discord-casino
   sudo bash /tmp/discord-casino/ops/pi/install.sh
   ```

2. `ops/pi/install.sh` is safe to run again whenever you update the code. It performs these steps automatically:
   1. Checks that the Pi is 64-bit (`arm64` / `aarch64`).
   2. Installs `sqlite3`, `curl`, `gnupg`, `rsync`, `ca-certificates`, **Node.js 24**, **pnpm 12.21.0**, and **`cloudflared` (`arm64`)** if missing.
   3. Creates a non-root system user named `casino` and the folders `/opt/discord-casino`, `/opt/discord-casino/data`, and `/var/backups/discord-casino`.
   4. Syncs the code into `/opt/discord-casino` (keeping your existing `.env`, `.env.*`, and `data/`), runs `pnpm install --frozen-lockfile`, and builds `@casino/server`.
   5. Installs **systemd** units (Linux's background service manager) and enables the nightly backup timer:
      - `ops/pi/discord-casino.service` (`User=casino`, `MemoryMax=320M`, `Restart=on-failure`, `node --max-old-space-size=192`, `EnvironmentFile=/opt/discord-casino/.env`)
      - `ops/pi/cloudflared.service` (`User=casino`, uses `/etc/cloudflared/config.yml`)
      - `ops/pi/discord-casino-backup.service` + `ops/pi/discord-casino-backup.timer` (nightly `sqlite3 .backup` with 7-day rotation)

✅ **Check:** `ops/pi/install.sh` finishes with no errors and `/opt/discord-casino` exists.

---

## 2. Configure `.env` and `cloudflared`

1. Create `/opt/discord-casino/.env` on the Pi (never commit it) and lock down its file permissions:

   ```sh
   sudo cp /opt/discord-casino/.env.example /opt/discord-casino/.env
   sudo nano /opt/discord-casino/.env
   sudo chown casino:casino /opt/discord-casino/.env
   sudo chmod 600 /opt/discord-casino/.env
   ```

   Keep `NODE_ENV=production` (or leave `NODE_ENV` unset) so Discord proxy signature checks stay enforced.

2. Place your tunnel credentials file under `/etc/cloudflared/` and edit `/etc/cloudflared/config.yml`:

   ```sh
   sudo install -o root -g casino -m 0640 ~/.cloudflared/<tunnel-id>.json /etc/cloudflared/<tunnel-id>.json
   sudo nano /etc/cloudflared/config.yml
   ```

   Set `tunnel:`, `credentials-file: /etc/cloudflared/<tunnel-id>.json`, and `hostname: api.example.com` (your real API domain) pointing to `http://localhost:3001`.

✅ **Check:** `/opt/discord-casino/.env` has real values with `600` permissions owned by `casino`, and `/etc/cloudflared/config.yml` points at your `<tunnel-id>.json` and `http://localhost:3001`.

---

## 3. Migrate Data from Your Mac (Optional)

The live server uses `/opt/discord-casino/data/casino.sqlite` (`DATABASE_PATH`, default `./data/casino.sqlite`). The legacy Python bot file `data/casino.db` is **only** an input for `apps/server/scripts/import-legacy.ts` — the live server never opens it.

1. **Stop the server on your Mac first** so two servers never use the same Bot Token or write to the database at the same time.
2. On your Mac, take a clean SQLite backup and copy it to the Pi:

   ```sh
   # On Mac (server stopped):
   sqlite3 data/casino.sqlite ".backup 'casino-migration.sqlite'"
   scp casino-migration.sqlite <pi-user>@<pi-host>:/tmp/casino.sqlite
   ```

3. On the Pi, move the file into place with the right ownership and remove the temporary copy:

   ```sh
   # On Pi:
   sudo install -o casino -g casino -m 0640 /tmp/casino.sqlite /opt/discord-casino/data/casino.sqlite
   rm -f /tmp/casino.sqlite
   ```

*(If you are migrating from the legacy Python bot's `data/casino.db`, stop the Python bot and run `apps/server/scripts/import-legacy.ts` so it writes into `casino.sqlite`.)*

✅ **Check:** `/opt/discord-casino/data/casino.sqlite` exists, is owned by `casino:casino`, and your Mac server is stopped.

---

## 4. Start and Verify Services

1. Start (or restart) the server and tunnel services and check their status and logs:

   ```sh
   sudo systemctl restart discord-casino.service cloudflared.service
   sudo systemctl status discord-casino.service cloudflared.service
   sudo journalctl -u discord-casino.service -n 50 --no-pager
   ```

2. Check that the nightly backup timer is active and run one manual backup to test it:

   ```sh
   sudo systemctl list-timers discord-casino-backup.timer
   sudo systemctl start discord-casino-backup.service
   ls -lh /var/backups/discord-casino/
   ```

✅ **Check:** Both `discord-casino.service` and `cloudflared.service` show `active (running)`, `curl -i https://api.example.com/api/health` returns HTTP `200`, and a backup file appears in `/var/backups/discord-casino/`.

---

## 5. Restoring a Backup

1. Stop the server, copy the backup snapshot over `casino.sqlite`, and start the server again:

   ```sh
   sudo systemctl stop discord-casino.service
   sudo -u casino cp /var/backups/discord-casino/casino-YYYYMMDD-HHMMSS.sqlite /opt/discord-casino/data/casino.sqlite
   sudo systemctl start discord-casino.service
   ```

✅ **Check:** `sudo systemctl status discord-casino.service` shows `active (running)` with no database errors in `journalctl`.

---

## Container Simulation (`ops/pi-sim`)

Before deploying to real hardware, `ops/pi-sim/Dockerfile` and `ops/pi-sim/compose.yaml` test the exact `arm64` / Debian Bookworm / Node 24 / prebuilt `better-sqlite3` runtime under `512m` RAM and `2` CPUs (this runs automatically in CI on `ubuntu-24.04-arm`).

---

## Performance results (`ops/pi-sim/perf.sh`)

The server runs in the `pi-sim` container (`arm64`, 512 MB, 2 CPUs, no swap, `node --max-old-space-size=192`, `NODE_ENV=production`) on a GitHub `ubuntu-24.04-arm` runner. `apps/server/scripts/load.ts` logs in 30 simulated players over loopback with session tokens it signs itself (`BOT_DISABLED=1`, a throw-away `SESSION_SECRET`, a file database inside the container) and plays a realistic mix: roulette, slots and blackjack seats (one round per player at a time), race bets, daily claims, transfers, market orders and the read-only screens, plus a `time:ping` per player per second for the round trip. A probe preloaded into the server (`ops/pi-sim/perf/probe.mjs`) reports RSS, CPU and event-loop lag once a second.

| Metric (30 players, 5 minutes) | Target | Before tuning | After tuning |
| --- | --- | --- | --- |
| Idle RSS after boot | ≤ 150 MB | 137.4 MB | 137.4 MB (unchanged) |
| RSS under load, peak | ≤ 250 MB | 157.8 MB | 157.8 MB (unchanged) |
| RSS under load, steady | – | 156.2 MB | 156.2 MB (unchanged) |
| Container memory peak (cgroup) | – | 117 MB | 117 MB (unchanged) |
| Socket round trip p95, loopback | < 50 ms | 0.73 ms | 0.73 ms (unchanged) |
| Cold start (`docker run` to `/api/health`) | < 5 s | 1.16 s | 1.16 s (unchanged) |
| CPU, mean / p95 (% of one of 2 cores) | – | 4.0 / 5.7 | 4.0 / 5.7 (unchanged) |
| Event-loop lag idle, p50 / p95 / p99 | – | 0.1 / 0.3 / 1.1 ms | unchanged |
| Event-loop lag under load, p50 / p95 / p99 | – | 0.1 / 1.1 / 1.6 ms | unchanged |

**Every target was met on the first measurement, so no server code was changed** ("after" equals "before"; the targets were not raised). Over the 5 minutes there were no `5xx`, no `internal` errors and no unexpected disconnects. Refusals such as `game_busy`, `insufficient_funds`, `transfer_min_games` and an already claimed daily bonus are normal play and are counted separately in the report.

Headroom check, same container: 60 players at five times the action rate for 2 minutes gave RSS peak 184.5 MB, CPU 23.8 % mean / 34.2 % p95 of one core, socket round trip p95 2.5 ms and event-loop lag p99 2.2 ms, again with no failures.

How to read these numbers:

- Idle RSS has the least room (137 of 150 MB). The run has the chat bot off (`BOT_DISABLED=1`), so the Discord gateway cache of a real login is **not** in these figures; check `RSS` with `systemctl status discord-casino.service` after the first real day.
- The runner's CPU is faster than a Raspberry Pi, so CPU and round-trip figures are a lower bound; memory and the code paths are the same. The round trip is a loopback one and does not include the tunnel.
- The race card opens a race for bets by choosing `UTC_OFFSET_HOURS` so that it is 20:00 local, one hour before the 21:00 race. The scheduler runs the earlier races of that local day at once, so a race run is part of the load. Only the bets are on the 21:00 race; the race itself runs after the test.

Running it:

- **CI:** the job `perf (pi-sim arm64)` (`.github/workflows/perf.yml`) runs 60 s on every pull request that touches `apps/server`, `packages/shared`, `packages/domain` or `ops/pi-sim`, and fails when a target is missed. Start the full 5-minute run from **Actions → Perf → Run workflow** (inputs: `duration`, `players`, `rate_scale`). The result table is in the job summary and `perf-results` artifact.
- **On a machine with Docker and Node 24 (arm64):** `pnpm install` then `ops/pi-sim/perf.sh --duration 300`. Results land in `perf-out/` (`result.md`, `result.json`, `probe.jsonl`, `server.log`).
