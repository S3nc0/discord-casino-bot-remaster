# Owner Setup Checklist (macOS + Cloudflare Pages + Cloudflare Tunnel)

Follow these five steps in order to run the Discord Activity front end on Cloudflare Pages and the Node 24 server on your Mac behind a Cloudflare Tunnel.

## 1. Discord Developer Portal

Open your application in the [Discord Developer Portal](https://discord.com/developers/applications):

1. **Find App ID and Public Key**
   - Go to **General Information**.
   - Copy **Application ID** → use for `DISCORD_CLIENT_ID`.
   - Copy **Public Key** (64-character hex string) → use for `DISCORD_PUBLIC_KEY`.
2. **Bot Token and OAuth2 Client Secret**
   - Go to **Bot** → reset/copy **Token** → use for `DISCORD_TOKEN` (**secret**).
   - Go to **OAuth2** → copy **Client Secret** → use for `DISCORD_CLIENT_SECRET` (**secret**).
3. **OAuth2 Redirect Placeholder**
   - Go to **OAuth2 → Redirects** and add `https://127.0.0.1` as a placeholder (Discord requires at least one entry, though the Activity auth flow never uses it).
4. **Configure URL Mappings (Before Enabling Activities)**
   - Discord refuses to enable Activities (`Missing Requirement: [URL Mapping]`) until the `/` mapping exists, so configure **Activities → URL Mappings** first.
   - Each target is the host only — no `https://` and no trailing slash. Only `/` is required to enable Activities; add `/api` and `/discord-cdn` as well (you can update `/api` after starting your tunnel):

     | Prefix | Target | Purpose |
     | --- | --- | --- |
     | `/` | `<pages-host>` | Cloudflare Pages host (e.g. `discord-casino-remaster.pages.dev`) |
     | `/api` | `<api-host>/api` | Tunnel host + `/api` (e.g. `<random>.trycloudflare.com/api` or `api.example.com/api`) |
     | `/discord-cdn` | `cdn.discordapp.com` | Player avatars (the Activity cannot load the CDN directly) |

   - Discord's proxy replaces the mapped prefix with the target, so mapping `/api` to `<api-host>/api` preserves the `/api` prefix that the server expects.
5. **Enable Activities and Entry Point Command**
   - Go to **Activities → Settings** and toggle **Enable Activities** on.
   - Verify the Discord-managed **Entry Point** command (under **Installation / App Commands**) is enabled so users can launch the Activity from your server.

## 2. Create `.env` on Your Mac

Copy `.env.example` to `.env` at the repository root on your machine:

```sh
cp .env.example .env
```

Fill in the real values locally. **Never commit `.env`, and never paste secret values into chat, issues, screenshots, or logs.**

| Variable | Secret? | Notes |
| --- | --- | --- |
| `DISCORD_TOKEN` | **Yes (Secret)** | Bot token from Developer Portal → Bot |
| `DISCORD_CLIENT_SECRET` | **Yes (Secret)** | OAuth2 secret from Developer Portal → OAuth2 |
| `SESSION_SECRET` | **Yes (Secret)** | Generate locally (`openssl rand -hex 32`), at least 32 characters |
| `DISCORD_CLIENT_ID` | No | Application ID from General Information |
| `DISCORD_PUBLIC_KEY` | No | 64-char hex Public Key from General Information (verifies Discord proxy signatures) |
| `ALLOWED_GUILD_IDS` | No | Comma-separated Discord server IDs allowed to play |
| `OWNER_IDS` | No | Comma-separated owner Discord user IDs |
| `TEST_GUILD_ID` | No | Your staging/test Discord server ID |
| `REQUIRE_APPROVAL` | No | `1` = new guilds require owner approval; `0` = auto-approved |
| `UTC_OFFSET_HOURS` | No | Game day boundary offset (`9` for JST) |
| `PUBLIC_API_ORIGIN` | No | `https://<api-host>` (no trailing slash). If using a quick tunnel without a domain yet, any valid `https://...` URL (such as `https://api.example.com`) works for now — it is validated at startup but not used yet |
| `ANNOUNCE_CHANNEL_ID` | No | Default Discord channel ID for announcements |
| `NODE_ENV` | No | Optional (default `production`). Keep `production` behind Discord proxy / Cloudflare Tunnel so Ed25519 signature verification stays enforced; use `development` only for direct local browser testing without Discord proxy |
| `HOST` | No | Optional (default `127.0.0.1`). Bind address — keep loopback because `cloudflared` connects locally and `trustProxy` is enabled (only a container such as `pi-sim` binds `0.0.0.0`) |
| `PORT` | No | Optional (default `3001`). HTTP and Socket.io listen port |
| `DATABASE_PATH` | No | Optional (default `./data/casino.sqlite`, relative to working directory). SQLite file of the new server — never the legacy `data/casino.db` (importer input only) |
| `LOG_LEVEL` | No | Optional (default `info`). Pino log level: `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace` \| `silent` |

## 3. Set Up Cloudflare Pages for `apps/web`

Create a Cloudflare Pages project connected to this repository (see [DEPLOY_PAGES.md](DEPLOY_PAGES.md) for details):

- **Project name:** `discord-casino-remaster` (recommended — the project name becomes your `*.pages.dev` host, e.g. `discord-casino-remaster.pages.dev`)
- **Root directory:** `/` (repository root, required so `@casino/shared` and `@casino/ui` workspace packages resolve)
- **Build command:** `pnpm --filter @casino/web build`
- **Build output directory:** `apps/web/dist`
- **Environment variables:**
  - `NODE_VERSION` = `24`
  - `PNPM_VERSION` = `12.21.0`
  - `VITE_DISCORD_CLIENT_ID` = your Application ID (`DISCORD_CLIENT_ID`, public, required at build time)
  - `VITE_API_HOST` = optional; leave **unset** while using quick tunnels

After the first deploy succeeds, note the assigned `*.pages.dev` host and make sure it matches `<pages-host>` in Developer Portal **URL Mappings** (`/`).

## 4. Install `cloudflared` on macOS and Start a Tunnel

First, install `cloudflared` via Homebrew:

```sh
brew install cloudflared
```

Choose either **Option A (Quick Tunnel — no domain required)** or **Option B (Named Tunnel — custom domain)**.

### Option A: No domain yet — quick tunnel

1. Start the server in Terminal 1 (watch mode; rebuilds with `tsup` and restarts `dist/main.js` with `--max-old-space-size=192`, loading `.env` if present):

   ```sh
   pnpm dev:server
   ```

2. Start a quick tunnel in Terminal 2 (`pnpm dev:tunnel:quick` runs `cloudflared tunnel --url http://localhost:3001`):

   ```sh
   pnpm dev:tunnel:quick
   ```

   (Equivalent direct command: `cloudflared tunnel --url http://localhost:3001`.)

3. Copy the printed `*.trycloudflare.com` hostname (without `https://`) and paste it into the Developer Portal `/api` mapping as `<host>/api` (for example `example-words.trycloudflare.com/api`).
4. The `*.trycloudflare.com` address changes on every restart, so update the `/api` URL Mapping each time you restart the quick tunnel.
5. In `.env`, `PUBLIC_API_ORIGIN` can remain any valid URL (such as `https://api.example.com`) for now — it is validated at startup but not used yet.

> **Tip:** Later, buying a domain through **Cloudflare Registrar** is recommended so you get a stable URL without updating URL Mappings on every restart, and for running unattended on a Raspberry Pi.

### Option B: Custom domain — named tunnel

1. Authenticate with your Cloudflare account and create a named tunnel:

   ```sh
   cloudflared tunnel login
   cloudflared tunnel create discord-casino
   ```

   Note the generated `<TUNNEL_ID>` and credentials file `~/.cloudflared/<TUNNEL_ID>.json`.

2. Route your API subdomain (`<api-host>`) to the tunnel:

   ```sh
   cloudflared tunnel route dns discord-casino api.example.com
   ```

3. Copy the template to `~/.cloudflared/config.yml` (outside the git repository) and fill in your tunnel ID, credentials file path, and `<api-host>`:

   ```sh
   mkdir -p ~/.cloudflared
   cp ops/cloudflared/config.example.yml ~/.cloudflared/config.yml
   ```

   Keep `service: http://localhost:3001` (or match your configured server port). **Never edit `ops/cloudflared/config.example.yml` with real tunnel IDs or domains.**

4. Start the server (`pnpm dev:server`) in Terminal 1, and start the named tunnel in Terminal 2 (`dev:tunnel` is only for named tunnels with a config file):

   ```sh
   CLOUDFLARED_CONFIG=~/.cloudflared/config.yml pnpm dev:tunnel
   ```

## 5. Check That It Works

1. **Local server health check:**

   ```sh
   curl -i http://localhost:3001/api/health
   ```

   Expect an HTTP `200` JSON response from the running server.

2. **Public tunnel reachability:**

   ```sh
   curl -i https://<api-host>/api/health
   ```

   Confirm traffic reaches your Mac through `cloudflared` (with proxy signature enforcement active in `production` mode, unauthenticated `/api/*` endpoints other than health will reject missing Discord proxy headers with `401`).

3. **Pages + Discord Activity check:**
   - Open `https://<pages-host>` in a browser to verify the Cloudflare Pages bundle loads.
   - Launch the Activity inside your `TEST_GUILD_ID` server in Discord, confirm a request to `/.proxy/api/health` from inside the Activity returns `200`, and verify it authenticates and talks to your Mac via `/api`.

When you are ready to move from your Mac to a Raspberry Pi, follow [PI_SETUP.md](PI_SETUP.md) — no code changes are required.
