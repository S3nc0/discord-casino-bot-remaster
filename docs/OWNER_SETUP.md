# Owner Setup Guide (macOS + Cloudflare Pages + Tunnel)

**English** | [日本語](OWNER_SETUP.ja.md)

This guide walks you from zero to a working Discord Activity on your Mac, step by step. You do not need DevOps experience.

> [!CAUTION]
> **Keep secrets private.** Never paste your **Bot Token** (`DISCORD_TOKEN`), **OAuth2 Client Secret** (`DISCORD_CLIENT_SECRET`), or **`SESSION_SECRET`** into chat, screenshots, GitHub issues, Cloudflare, or GitHub.

---

## 0. Overview

The app has three pieces that work together:

1. **Cloudflare Pages** — hosts the **web app** (the casino screen players see inside Discord).
2. **Your Mac** — runs the **server** (handles login, game rules, and saves balances).
3. **A tunnel** (`cloudflared`) — a secure bridge that connects Discord to the server on your Mac, without changing your router or firewall.

```text
Discord Activity (desktop or mobile)
  ├── /     ──▶ Cloudflare Pages (web app: your-host.pages.dev)
  └── /api  ──▶ Cloudflare Tunnel ──▶ Your Mac (localhost:3001 + SQLite DB)
```

**Time needed:** About 20–30 minutes the first time.

### What you need before you start

- A **Discord** account.
- A **test Discord server** where you are an admin (Discord's settings call a server a **guild**).
- A **GitHub** account with access to this repository.
- A free **Cloudflare** account.
- A **Mac (macOS)** with **Homebrew** installed.
- **Node.js 24** and **pnpm 12.21.0** installed on your Mac.

### Values you will collect along the way

You will gather these values during Steps 2–6. Keep a private note (such as a password manager) open while you follow this guide.

| Value | Where to find it | Secret? | Where it goes |
| --- | --- | --- | --- |
| Application ID (`APP_ID`) | Discord Developer Portal → General Information | No | `.env` (`DISCORD_CLIENT_ID`), Cloudflare Pages (`VITE_DISCORD_CLIENT_ID`) |
| Public Key | Discord Developer Portal → General Information | No | `.env` (`DISCORD_PUBLIC_KEY`) |
| OAuth2 Client Secret | Discord Developer Portal → OAuth2 | **Yes** | `.env` (`DISCORD_CLIENT_SECRET`) |
| Bot Token | Discord Developer Portal → Bot | **Yes** | `.env` (`DISCORD_TOKEN`) |
| Pages host (`your-host.pages.dev`) | Cloudflare Pages project page | No | Discord URL Mappings (`/`) |
| Test Server ID | Discord → right-click server icon | No | `.env` (`ALLOWED_GUILD_IDS`, `TEST_GUILD_ID`) |
| Your User ID | Discord → right-click your profile | No | `.env` (`OWNER_IDS`) |
| Announce Channel ID | Discord → right-click a text channel | No | `.env` (`ANNOUNCE_CHANNEL_ID`) |
| Session Secret | Generated on your Mac (`openssl rand -hex 32`) | **Yes** | `.env` (`SESSION_SECRET`) |
| Tunnel host (`xxxx.trycloudflare.com` or `api.example.com`) | Terminal output (quick tunnel) or your domain | No | Discord URL Mappings (`/api`) |

✅ **Check:** Run `node -v`, `pnpm -v`, and `brew -v` in Terminal. Node prints `v24.x.x`, and both `pnpm` and `brew` print version numbers.

---

## 1. Get the Code Running Locally

1. Open **Terminal** on your Mac.
2. Download the repository and enter the folder (replace `<your-repo-url>` with your GitHub repository URL):

   ```sh
   git clone <your-repo-url> discord-casino
   cd discord-casino
   ```

3. Install the project dependencies:

   ```sh
   pnpm i
   ```

4. Build all packages to make sure everything compiles cleanly:

   ```sh
   pnpm -r build
   ```

✅ **Check:** `pnpm -r build` finishes with no errors.

---

## 2. Discord Developer Portal (Part 1: Keys and Redirect)

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and click your application (or click **New Application** to create one).
2. Get your **Application ID** and **Public Key**:
   - In the left menu, click **General Information**.
   - Copy **Application ID** (this guide calls it `APP_ID`).
   - Copy **Public Key** (a 64-character hex string).
3. Get your **OAuth2 Client Secret**:
   - In the left menu, click **OAuth2**.
   - Under **Client information**, copy **Client Secret**.
   - If it is hidden or you are not sure you have the right one, click **Reset Secret** and copy the new value.
   - **Important:** The **Client Secret** is **not** the Bot Token. They are two different secrets on two different pages.
4. Add a placeholder **OAuth2 Redirect**:
   - Still on **OAuth2**, scroll to **Redirects**.
   - Click **Add Redirect**, type `https://127.0.0.1`, and click **Save Changes**.
   - Discord requires at least one redirect entry, even though the Activity never actually uses it.
5. Get your **Bot Token**:
   - In the left menu, click **Bot**.
   - Under **Token**, click **Reset Token** (or **Copy** if shown) and save it in your private note.

✅ **Check:** You have four values saved safely (Application ID, Public Key, OAuth2 Client Secret, Bot Token), and `https://127.0.0.1` is listed under **OAuth2 → Redirects**.

---

## 3. Cloudflare Pages (Host the Web App)

1. Sign up or log in at [dash.cloudflare.com](https://dash.cloudflare.com).
2. In the left menu, click **Workers & Pages**, then click **Create**.
3. Choose **Pages**, not Workers:
   - Look for **"Looking to deploy Pages? Get started"** (or click the **Pages** tab).
   - Click **Import an existing Git repository**.

> [!WARNING]
> **Make sure you are in Pages, not Workers.**
> If the setup screen asks for a **"Deploy command"** or mentions **`wrangler`**, or if a build fails with `"application detection logic has been run in the root of a workspace"`, you are in the **Workers** flow.
> Go back to **Workers & Pages**, open that Worker, click **Settings → Delete**, and delete it — otherwise it also adds a failing check to every pull request on GitHub. Then return to **Workers & Pages → Create** and pick **Pages**.

4. Connect your GitHub account, select this repository, and click **Begin setup**.
5. Fill in the build settings:

   | Setting | Value |
   | --- | --- |
   | **Project name** | e.g. `discord-casino` (this becomes your `*.pages.dev` host) |
   | **Production branch** | `main` |
   | **Framework preset** | `None` |
   | **Build command** | `pnpm --filter @casino/web build` |
   | **Build output directory** | `apps/web/dist` |
   | **Root directory** (if shown) | *(leave empty)* |

   Leaving the root directory empty lets Cloudflare build from the repository root so it can find the shared workspace packages.

6. Open **Environment variables (advanced)** and add these variables:

   | Variable | Value | Notes |
   | --- | --- | --- |
   | `NODE_VERSION` | `24` | Matches the project Node version |
   | `PNPM_VERSION` | `12.21.0` | Matches the project pnpm version |
   | `VITE_DISCORD_CLIENT_ID` | `APP_ID` | Your Application ID from Step 2 (public) |
   | `VITE_API_HOST` | *(leave unset)* | Optional — leave blank when using quick tunnels |

   Never put secret values (Bot Token, Client Secret, `SESSION_SECRET`) in Cloudflare Pages.

7. Click **Save and Deploy** and wait 1–3 minutes for the build to finish.
8. On the project page, look at the deployed address (for example `https://your-host.pages.dev`).
   - Copy the **exact host shown**, without `https://` (for example `your-host.pages.dev`).
   - Cloudflare can assign a host that differs from the project name you typed or from the repository name, so always copy the exact host shown on screen.

✅ **Check:** The deployment says **Success**, and opening `https://your-host.pages.dev` in your browser loads the web app (not a Cloudflare 404 or build error).

---

## 4. Discord Developer Portal (Part 2: Install, URL Mappings, Enable Activities)

### 4.1 Install the app in your test server

1. Go to **Developer Portal → your app → Installation**.
2. Under **Installation Contexts**, tick **Guild Install** (guild = Discord server) and click **Save Changes**.
3. Under **Default Install Settings → Guild Install**:
   - **Scopes:** add `applications.commands` and `bot`.
   - **Permissions:** tick **Send Messages**, **Embed Links**, and **Use Slash Commands** (also tick **Manage Webhooks** if you want webhook personas later).
   - Click **Save Changes**.
4. Under **Install Link**, keep **Discord Provided Link**, click **Copy**, and open the link in your browser.
5. Choose your **test server** and click **Authorize**.

### 4.2 Add URL Mappings (before enabling Activities)

A **URL mapping** tells Discord's built-in proxy where to send web and API requests from inside your Activity. You must add the `/` mapping **before** turning on Activities, or Discord will show `Missing Requirement: [URL Mapping]`.

1. Go to **Developer Portal → your app → Activities → URL Mappings**.
2. Add these three rows and click **Save Changes**:

   | PREFIX | TARGET | Purpose |
   | --- | --- | --- |
   | `/` | `your-host.pages.dev` | Your exact Cloudflare Pages host from Step 3 |
   | `/api` | `xxxx.trycloudflare.com/api` | Your tunnel host + `/api` (you will update this in Step 6) |
   | `/discord-cdn` | `cdn.discordapp.com` | Discord avatar images |

3. Check these three rules carefully:
   - Enter the **host only** — **no `https://`** and **no trailing `/`**.
   - The `/api` row **must keep `/api` on the end** (`<tunnel-host>/api`), because Discord replaces the prefix with the target.
   - Only `/` is required right now to enable Activities; you can enter a placeholder for `/api` and update it in Step 6.

### 4.3 Enable Activities

1. Go to **Developer Portal → your app → Activities → Settings**.
2. Turn on **Enable Activities** and click **Save Changes**.
   - The Discord-managed **Entry Point** launch command is created automatically when you enable Activities.
3. Still on **Activities → Settings**, scroll to **Supported Platforms**:
   - Tick **iOS** and **Android** (otherwise phones say the Activity is not available on this OS).
   - Leave orientation unlocked.
   - Click **Save Changes**, then **fully restart Discord** on your phone.

✅ **Check:** Your app is installed in your test server, `/` and `/discord-cdn` are saved under **Activities → URL Mappings**, **Enable Activities** is **On**, and **iOS** and **Android** are ticked under **Supported Platforms**.

---

## 5. Create `.env` on Your Mac

A **`.env` file** is a local text file in your project folder that stores settings and secret keys for your Mac server. Git ignores it so it is never uploaded to GitHub.

1. In Terminal (inside the `discord-casino` folder), copy the example file:

   ```sh
   cp .env.example .env
   ```

2. Turn on **Discord Developer Mode** so you can copy Discord IDs:
   - In Discord, click **User Settings** (gear icon) → **Advanced** → turn on **Developer Mode**.
   - **Test Server ID:** Right-click your test server's icon in the left bar → **Copy Server ID**.
   - **Your User ID:** Right-click your own name or avatar → **Copy User ID**.
   - **Announce Channel ID:** Right-click a text channel in your test server → **Copy Channel ID**.

3. Generate a random `SESSION_SECRET` in Terminal and copy the output:

   ```sh
   openssl rand -hex 32
   ```

4. Open `.env` in a text editor (for example `open -e .env` or `nano .env`) and fill in your values:

   | Variable | Required? | Secret? | Where it comes from / Example |
   | --- | --- | --- | --- |
   | `DISCORD_TOKEN` | Yes | **Yes** | Developer Portal → Bot → Token (`replace-with-bot-token`) |
   | `DISCORD_CLIENT_ID` | Yes | No | Developer Portal → General Information → Application ID (`APP_ID`) |
   | `DISCORD_CLIENT_SECRET` | Yes | **Yes** | Developer Portal → OAuth2 → Client Secret (NOT the Bot Token) |
   | `DISCORD_PUBLIC_KEY` | Yes | No | Developer Portal → General Information → Public Key (64 hex chars) |
   | `ALLOWED_GUILD_IDS` | Yes | No | Your test server ID (comma-separated if more than one) |
   | `OWNER_IDS` | Yes | No | Your Discord User ID (comma-separated if more than one) |
   | `TEST_GUILD_ID` | Yes | No | Your test server ID |
   | `REQUIRE_APPROVAL` | Yes | No | Keep `0` for now. Servers listed in `ALLOWED_GUILD_IDS` always count as approved, so this setting is unused until the bot can admit other servers |
   | `UTC_OFFSET_HOURS` | Yes | No | Daily reset timezone offset (`9` for JST) |
   | `SESSION_SECRET` | Yes | **Yes** | Output of `openssl rand -hex 32` (at least 32 characters) |
   | `PUBLIC_API_ORIGIN` | Yes | No | Use `https://localhost` for now (checked at startup, not yet used; with a custom domain later, use `https://api.example.com`) |
   | `ANNOUNCE_CHANNEL_ID` | Yes | No | A text channel ID in your test server |
   | `NODE_ENV` | Optional | No | Default `production`. Leave unset or `production` behind Discord and the tunnel |
   | `REQUIRE_PROXY_SIGNATURE` | Optional | No | Default `0`. Keep `0` for now — it will be turned on once we confirm Discord signs traffic after login |
   | `HOST` | Optional | No | Default `127.0.0.1`. Keep default; the tunnel connects locally |
   | `PORT` | Optional | No | Default `3001`. Port the server listens on |
   | `DATABASE_PATH` | Optional | No | Default `./data/casino.sqlite`. This is the new database (the legacy `data/casino.db` is only an importer input) |
   | `LOG_LEVEL` | Optional | No | Default `info` (`fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`) |

5. Save the file.
   - **Remember:** Whenever you edit `.env`, you must **restart the server** (press `Ctrl+C` in Terminal 1 and run `pnpm dev:server` again) for changes to take effect.

✅ **Check:** No `replace-with-...` or `000000000000000000` placeholders remain in `.env`, and `git status` does not show `.env`.

---

## 6. Set Up the Tunnel

A **tunnel** (`cloudflared`) lets Discord safely reach the server on your Mac (`localhost:3001`).

First, install `cloudflared` with Homebrew:

```sh
brew install cloudflared
```

Now pick **Path A** (no domain yet) or **Path B** (you own a domain on Cloudflare).

### Path A: No domain yet — quick tunnel (fastest start)

1. In Terminal (inside `discord-casino`), start a quick tunnel:

   ```sh
   pnpm dev:tunnel:quick
   ```

2. Look for the box in the output that prints a temporary address like `https://xxxx.trycloudflare.com`.
3. Copy the host only (`xxxx.trycloudflare.com`, without `https://`).
4. Go to **Developer Portal → your app → Activities → URL Mappings**, set the `/api` target to `xxxx.trycloudflare.com/api`, and click **Save Changes**.
5. **Keep this Terminal window open.**
6. **Important:** The `xxxx.trycloudflare.com` host changes **every time** you restart the quick tunnel. After every restart, update `/api` in Developer Portal and reload Discord (`Cmd+R` / `Ctrl+R`).

### Path B: Own domain on Cloudflare — named tunnel (recommended later)

Buying a domain through **Cloudflare Registrar** (~$10/yr) gives you a permanent address (like `api.example.com`). You will not need to update URL Mappings on restarts, and you will need this later if you move to a Raspberry Pi.

1. Log in to Cloudflare and create a named tunnel:

   ```sh
   cloudflared tunnel login
   cloudflared tunnel create discord-casino
   ```

   Write down the printed `<tunnel-id>` and confirm `~/.cloudflared/<tunnel-id>.json` was created.

2. Point your API subdomain (for example `api.example.com`) to the tunnel:

   ```sh
   cloudflared tunnel route dns discord-casino api.example.com
   ```

3. Copy the config template outside the repository and edit it with your `<tunnel-id>`, credentials path, and `api.example.com`:

   ```sh
   mkdir -p ~/.cloudflared
   cp ops/cloudflared/config.example.yml ~/.cloudflared/config.yml
   open -e ~/.cloudflared/config.yml
   ```

   Keep `service: http://localhost:3001`. Never put real tunnel IDs or domains into `ops/cloudflared/config.example.yml`.

4. Go to **Developer Portal → your app → Activities → URL Mappings**, set `/api` to `api.example.com/api`, and click **Save Changes**.
5. Optionally update `PUBLIC_API_ORIGIN=https://api.example.com` in `.env`.

✅ **Check:** `cloudflared --version` prints a version number, and `/api` in **Activities → URL Mappings** is set to `<tunnel-host>/api` (no `https://`, no trailing slash).

---

## 7. Start Everything and Check It Works

Keep **two Terminal windows** open inside your `discord-casino` folder:

1. **Terminal 1 — Start the server:**

   ```sh
   pnpm dev:server
   ```

   Keep this window open. It prints server logs you will need if anything fails.

2. **Terminal 2 — Start the tunnel:**
   - **Path A (quick tunnel)** — if not already running from Step 6:

     ```sh
     pnpm dev:tunnel:quick
     ```

     *(If you restarted it, update `/api` in Developer Portal with the new `xxxx.trycloudflare.com/api` host.)*

   - **Path B (named tunnel):**

     ```sh
     CLOUDFLARED_CONFIG=~/.cloudflared/config.yml pnpm dev:tunnel
     ```

3. **Terminal 3 (a new tab) — Run all three health checks:**
   1. Check the server on your Mac:

      ```sh
      curl -i http://localhost:3001/api/health
      ```

   2. Check the tunnel (replace `<tunnel-host>` with your `xxxx.trycloudflare.com` or `api.example.com`):

      ```sh
      curl -i https://<tunnel-host>/api/health
      ```

   3. Check Discord's URL mapping (replace `APP_ID` with your Application ID):

      ```sh
      curl -i https://APP_ID.discordsays.com/.proxy/api/health
      ```

      This third check proves Discord's `/api` mapping reaches your Mac.

✅ **Check:** All three `curl` commands return HTTP `200` and JSON starting with `{"status":"ok","db":"ok",...}`.

---

## 8. Open the Activity in Discord

If you just changed any URL Mappings, **reload Discord first** (`Cmd+R` on macOS, `Ctrl+R` on Windows/Linux).

### On desktop

- **Voice channel:** Join a voice channel in your test server → click the **Activities** (rocket) icon → pick your app.
- **Text channel:** Click the **Apps** button next to the message box → pick your app → click **Launch** (or type `/launch` and use the app's Entry Point command).

### On mobile

- **Voice channel:** Join a voice channel → open the voice panel → tap the **Activities** (rocket) icon → pick your app.
- **Text channel:** Tap the **`+`** / **Apps** button next to the message box → pick your app → tap **Launch**.

### First launch

1. Discord shows an **Authorize** screen. Click **Authorize**.
2. The Activity loads the **Home** screen with your account and a starting balance of **3,000 Pelica** (for a new account).

✅ **Check:** The Activity opens on the **Home** screen inside Discord and displays **3,000 Pelica**.

---

## 9. Troubleshooting

| What you see | Likely cause | How to fix |
| --- | --- | --- |
| `Missing Requirement: [URL Mapping]` when enabling Activities | The `/` URL Mapping was not saved yet | Go to **Activities → URL Mappings**, add `/` → `your-host.pages.dev`, click **Save Changes**, then enable Activities |
| Cloudflare build error `"application detection logic has been run in the root of a workspace"` (or screen shows **Deploy command** / `wrangler`) | You created a **Worker** instead of **Pages** | Open that Worker → **Settings → Delete**, then create a **Pages** project (Step 3) |
| `<APP_ID>.discordsays.com refused to connect` | Wrong `/` mapping target (typo in the host, extra `https://`, or trailing `/`) | Copy the exact `*.pages.dev` host from Cloudflare Pages, update `/` in **URL Mappings**, click **Save Changes**, and reload Discord (`Cmd+R` / `Ctrl+R`) |
| Stuck on loading | Server or tunnel is not running, or `/api` still points to an old quick tunnel host | Make sure Terminal 1 and Terminal 2 are running, update `/api` if the quick tunnel restarted, re-run the three `curl` checks in Step 7, and reload Discord (`Cmd+R` / `Ctrl+R`) |
| App is not in the Activities list | Activities not enabled, app not installed in this server, or Discord needs a refresh | Check **Activities → Settings → Enable Activities** is On, confirm the app is installed in your test server (Step 4), and restart/reload Discord (`Cmd+R` / `Ctrl+R`) |
| Phone says the Activity is not available on this OS | **iOS** / **Android** is not enabled under **Supported Platforms** | Go to **Activities → Settings → Supported Platforms**, tick **iOS** and **Android** (leave orientation unlocked), click **Save Changes**, and fully restart Discord on your phone |
| `"Your session ended. Please open the app again."` | The server rejected login | Look at **Terminal 1** for a line saying `auth rejected: <reason>` and check the table below |

### `auth rejected: <reason>` codes (Terminal 1)

| Reason in Terminal 1 | Cause | How to fix |
| --- | --- | --- |
| `code_exchange_failed:401` | Wrong `DISCORD_CLIENT_SECRET` (often the **Bot Token** was pasted by mistake) | Go to **Developer Portal → OAuth2 → Client Secret**, copy or reset it, update `.env`, and restart the server |
| `code_exchange_failed:400` | `DISCORD_CLIENT_ID` mismatch between `.env` and Cloudflare Pages (`VITE_DISCORD_CLIENT_ID`), or an expired auth code | Verify both match `APP_ID` (redeploy Pages if edited), restart the server if `.env` changed, and reopen the Activity |
| `guild_not_allowed` (or `guild_denied`) | This server ID is not in `ALLOWED_GUILD_IDS` | Copy the server ID, add it to `ALLOWED_GUILD_IDS` in `.env`, and restart the server |
| `guild_pending` | The server is not approved (servers in `ALLOWED_GUILD_IDS` are approved automatically) | Add the server ID to `ALLOWED_GUILD_IDS` in `.env`, then restart the server |
| `proxy_signature_invalid` | Wrong `DISCORD_PUBLIC_KEY` in `.env` | Copy the 64-character **Public Key** from **Developer Portal → General Information**, update `.env`, and restart the server |
| `proxy_signature_missing` *(followed by missing header names)* | Request arrived without Discord's proxy headers (cannot happen on `/api/token`; on other routes it only appears when `REQUIRE_PROXY_SIGNATURE=1`) | Set `REQUIRE_PROXY_SIGNATURE=0` in `.env`, restart the server, and report it |
| `timestamp_skew` / `proxy_expired` | Your Mac's clock is off or the request expired | Turn on automatic date and time in macOS **System Settings → General → Date & Time**, then reopen the Activity |
| `session_expired` / `session_invalid` / `session_revoked` / `socket_auth_failed` | The session expired or the live connection could not authenticate | Close and reopen the Activity; if it repeats right away, report it |
| `user_not_in_guild` / `instance_mismatch` / `scope_missing` | Discord could not match your user, server, or permission grant to the live Activity | Close the Activity, reload Discord (`Cmd+R` / `Ctrl+R`), and open it again |
| `*_failed:network` or `user_fetch_failed:<status>` / `guilds_fetch_failed:<status>` / `instance_fetch_failed:<status>` | Your Mac could not reach Discord, or Discord rejected an API call | Check your internet connection and retry; for `instance_fetch_failed:401` or `403`, check `DISCORD_TOKEN` in `.env` and restart the server |

✅ **Check:** After fixing the issue, restart Terminal 1 (if you edited `.env`), reload Discord (`Cmd+R` / `Ctrl+R`), and confirm Terminal 1 prints no new `auth rejected:` lines.

---

## 10. Moving to a Raspberry Pi Later

When you are ready to run the server 24/7 without keeping your Mac awake, follow the [Raspberry Pi Setup Guide](PI_SETUP.md). No code changes are required — once you have a named tunnel (Step 6, Path B), you only copy your `.env` and tunnel credentials to the Pi.

✅ **Check:** Your Mac setup works with a named tunnel (Step 6, Path B) before you start the Pi move.
