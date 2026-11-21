# Raspberry Pi Setup (`arm64` / Debian Bookworm)

This guide deploys the server and `cloudflared` onto a 64-bit Raspberry Pi (`arm64` / `aarch64`, Debian Bookworm) using `ops/pi/` without any code changes.

## Prerequisites

- Raspberry Pi running a 64-bit OS (`uname -m` must report `aarch64` or `arm64`, e.g. Raspberry Pi OS Lite 64-bit based on Debian 12 Bookworm).
- `git` installed so you can clone the repository, plus `sudo` access.
- Cloudflare Tunnel credentials JSON (either created on the Pi or copied securely from your Mac's `~/.cloudflared/<TUNNEL_ID>.json`).

## 1. One-Command Idempotent Install

Clone the repository and run `ops/pi/install.sh` as root:

```sh
git clone <YOUR_REPO_URL> /tmp/discord-casino
sudo bash /tmp/discord-casino/ops/pi/install.sh
```

What `ops/pi/install.sh` does (and safely re-runs when updating):

1. Verifies the host architecture is `arm64`/`aarch64`.
2. Installs `sqlite3`, `curl`, `gnupg`, `rsync`, `ca-certificates`, **Node.js 24**, **pnpm 12.21.0**, and **`cloudflared` (arm64)**.
3. Creates a non-root system user `casino` and directories `/opt/discord-casino`, `/opt/discord-casino/data`, and `/var/backups/discord-casino`.
4. Syncs the repository into `/opt/discord-casino` (preserving existing `.env`, `.env.*`, and `data/`), runs `pnpm install --frozen-lockfile`, and builds `@casino/server`.
5. Installs systemd units and enables `discord-casino-backup.timer`:
   - `ops/pi/discord-casino.service` (`User=casino`, `MemoryMax=320M`, `Restart=on-failure`, `node --max-old-space-size=192`, `EnvironmentFile=/opt/discord-casino/.env`)
   - `ops/pi/cloudflared.service` (`User=casino`, runs `/etc/cloudflared/config.yml`)
   - `ops/pi/discord-casino-backup.service` + `ops/pi/discord-casino-backup.timer` (nightly `sqlite3 .backup` with 7-day rotation)

## 2. Configure `.env` and `cloudflared`

1. Create `/opt/discord-casino/.env` locally on the Pi (never commit it):

   ```sh
   sudo cp /opt/discord-casino/.env.example /opt/discord-casino/.env
   sudo nano /opt/discord-casino/.env
   sudo chown casino:casino /opt/discord-casino/.env
   sudo chmod 600 /opt/discord-casino/.env
   ```

   Ensure `NODE_ENV=production` is set (or unset) so Discord proxy signature verification stays enforced.

2. Configure `/etc/cloudflared/config.yml` and place your tunnel credentials JSON under `/etc/cloudflared/`:

   ```sh
   sudo install -o root -g casino -m 0640 ~/.cloudflared/<TUNNEL_ID>.json /etc/cloudflared/<TUNNEL_ID>.json
   sudo nano /etc/cloudflared/config.yml
   ```

   Update `tunnel:`, `credentials-file: /etc/cloudflared/<TUNNEL_ID>.json`, and `hostname: API_DOMAIN` pointing to `http://localhost:3001`.

## 3. Migrate Data from Mac (Optional)

The live server opens `./data/casino.sqlite` (configured via `DATABASE_PATH`, default `./data/casino.sqlite` under `/opt/discord-casino`). `data/casino.db` is **only** the legacy Python bot file read by `apps/server/scripts/import-legacy.ts` — it is never opened by the live server.

Before starting the Pi service, stop the server on your Mac so no two instances share the same bot token or write to the database concurrently. Create a clean SQLite snapshot of your Mac's `casino.sqlite` and copy it to the Pi:

```sh
# On Mac (server stopped):
sqlite3 data/casino.sqlite ".backup 'casino-migration.sqlite'"
scp casino-migration.sqlite <pi-user>@<pi-host>:/tmp/casino.sqlite

# On Pi:
sudo install -o casino -g casino -m 0640 /tmp/casino.sqlite /opt/discord-casino/data/casino.sqlite
rm -f /tmp/casino.sqlite
```

(If you are migrating from the legacy Python bot's `data/casino.db`, run `apps/server/scripts/import-legacy.ts` with the Python bot stopped so it writes into `casino.sqlite`.)

## 4. Start and Verify Services

```sh
sudo systemctl restart discord-casino.service cloudflared.service
sudo systemctl status discord-casino.service cloudflared.service
sudo journalctl -u discord-casino.service -n 50 --no-pager
```

Verify the nightly backup timer is active and test a manual backup:

```sh
sudo systemctl list-timers discord-casino-backup.timer
sudo systemctl start discord-casino-backup.service
ls -lh /var/backups/discord-casino/
```

## 5. Restoring a Backup

```sh
sudo systemctl stop discord-casino.service
sudo -u casino cp /var/backups/discord-casino/casino-YYYYMMDD-HHMMSS.sqlite /opt/discord-casino/data/casino.sqlite
sudo systemctl start discord-casino.service
```

## Container Simulation (`ops/pi-sim`)

Before deploying to hardware, `ops/pi-sim/Dockerfile` and `ops/pi-sim/compose.yaml` validate the exact arm64 Debian Bookworm / Node 24 / prebuilt `better-sqlite3` runtime under `512m` RAM and `2` CPUs (run automatically in CI on `ubuntu-24.04-arm`).
