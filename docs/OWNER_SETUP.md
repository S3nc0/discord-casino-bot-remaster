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
4. **Enable Activities and Entry Point Command**
   - Go to **Activities → Settings** and toggle **Enable Activities** on.
   - Verify the Discord-managed **Entry Point** command (under **Installation / App Commands**) is enabled so users can launch the Activity from your server.
5. **Configure URL Mappings**
   - Go to **Activities → URL Mappings** and add these three mappings:
     - `/` → `PAGES_DOMAIN` (your Cloudflare Pages hostname, e.g. `your-app.pages.dev`)
     - `/api` → `API_DOMAIN/api` (your Cloudflare Tunnel hostname plus `/api`, e.g. `api.example.com/api`)
     - `/discord-cdn` → `cdn.discordapp.com` (player avatars; the Activity cannot load the CDN directly)
   - Discord's proxy replaces the mapped prefix with the target, so mapping `/api` to `API_DOMAIN/api` preserves the `/api` prefix that the server expects.

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
| `PUBLIC_API_ORIGIN` | No | `https://API_DOMAIN` (no trailing slash) |
| `ANNOUNCE_CHANNEL_ID` | No | Default Discord channel ID for announcements |
| `NODE_ENV` | No | Use `production` behind Discord proxy / Cloudflare Tunnel so Ed25519 signature verification is enforced; use `development` only for direct local browser testing without Discord proxy |
| `PORT` | No | Template placeholder (default `3001`) when supported by server config |
| `DATABASE_PATH` | No | Template placeholder (default `./data/casino.db`) when supported by server config |

## 3. Set Up Cloudflare Pages for `apps/web`

Create a Cloudflare Pages project connected to this repository with these settings (see [DEPLOY_PAGES.md](DEPLOY_PAGES.md) for details):

- **Root directory:** `/` (repository root, required so `@casino/shared` and `@casino/ui` workspace packages resolve)
- **Build command:** `pnpm --filter @casino/web build`
- **Build output directory:** `apps/web/dist`
- **Environment variable:** `NODE_VERSION` = `24`

After the first deploy succeeds, note the assigned `*.pages.dev` (or custom) domain and make sure it matches `PAGES_DOMAIN` in Developer Portal **URL Mappings**.

## 4. Install `cloudflared` on macOS and Create a Tunnel

1. Install `cloudflared` via Homebrew:

   ```sh
   brew install cloudflared
   ```

2. Authenticate with your Cloudflare account and create a named tunnel:

   ```sh
   cloudflared tunnel login
   cloudflared tunnel create discord-casino
   ```

   Note the generated `<TUNNEL_ID>` and credentials file `~/.cloudflared/<TUNNEL_ID>.json`.

3. Route your API subdomain (`API_DOMAIN`) to the tunnel:

   ```sh
   cloudflared tunnel route dns discord-casino api.example.com
   ```

4. Copy the template to `~/.cloudflared/config.yml` (outside the git repository) and fill in your tunnel ID, credentials file path, and `API_DOMAIN`:

   ```sh
   mkdir -p ~/.cloudflared
   cp ops/cloudflared/config.example.yml ~/.cloudflared/config.yml
   ```

   Keep `service: http://localhost:3001` (or match your configured server port). **Never edit `ops/cloudflared/config.example.yml` with real tunnel IDs or domains.**

5. Start the server and tunnel in two terminals:

   - Terminal 1 — server in watch mode (rebuilds with `tsup` and restarts `dist/main.js` with `--max-old-space-size=192`, loading `.env` if present):

     ```sh
     pnpm dev:server
     ```

   - Terminal 2 — Cloudflare Tunnel (uses `CLOUDFLARED_CONFIG` or defaults to `ops/cloudflared/config.example.yml`):

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
   curl -i https://API_DOMAIN/api/health
   ```

   Confirm traffic reaches your Mac through `cloudflared` (with proxy signature enforcement active in `production` mode, unauthenticated `/api/*` endpoints other than health will reject missing Discord proxy headers with `401`).

3. **Pages + Discord Activity check:**
   - Open `https://PAGES_DOMAIN` in a browser to verify the Cloudflare Pages bundle loads.
   - Launch the Activity inside your `TEST_GUILD_ID` server in Discord, confirm a request to `/.proxy/api/health` from inside the Activity returns `200`, and verify it authenticates and talks to your Mac via `/api`.

When you are ready to move from your Mac to a Raspberry Pi, follow [PI_SETUP.md](PI_SETUP.md) — no code changes are required.
