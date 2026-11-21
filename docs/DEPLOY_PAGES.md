# Deploying `apps/web` to Cloudflare Pages

The Discord Activity front end (`apps/web`) is a static Vite + React bundle hosted on Cloudflare Pages and mapped to `/` in the Discord Developer Portal.

## Cloudflare Pages Build Settings

Configure the Pages project from the **repository root** (not `apps/web`), because `@casino/web` imports workspace packages (`@casino/shared` and `@casino/ui`):

| Setting | Value |
| --- | --- |
| **Project name** | `discord-casino-remaster` (recommended; becomes `discord-casino-remaster.pages.dev`) |
| **Framework preset** | `None` (or `Vite`) |
| **Root directory** | `/` |
| **Build command** | `pnpm --filter @casino/web build` |
| **Build output directory** | `apps/web/dist` |

### Environment Variables

Set under **Settings → Environment variables** (for both **Production** and **Preview**):

| Variable | Value | Purpose |
| --- | --- | --- |
| `NODE_VERSION` | `24` | Matches `.nvmrc` and root `package.json` `engines.node` |
| `PNPM_VERSION` | `12.21.0` | Matches root `package.json` `packageManager` |
| `VITE_DISCORD_CLIENT_ID` | Your Application ID | Public client ID (`DISCORD_CLIENT_ID`), required at build time |
| `VITE_API_HOST` | *(leave unset for quick tunnels)* | Optional; omit while using `*.trycloudflare.com` quick tunnels |

Cloudflare Pages reads `"packageManager": "pnpm@12.21.0"` from the root `package.json` and installs workspace dependencies from `pnpm-lock.yaml` before running the build command.

## Routing and Asset Notes

- `apps/web/vite.config.ts` sets `base: '/'` and outputs to `apps/web/dist`.
- All fonts and assets must be bundled into `apps/web/dist`; inside a Discord Activity iframe, external third-party URLs are blocked unless mapped in Developer Portal **URL Mappings**.
- API and WebSocket requests go to `/api` (which Discord maps to `<api-host>/api` on your Cloudflare Tunnel). Do not add Pages Functions or `_redirects` rules for `/api` unless intentionally fronting the tunnel.

## Verification

1. Trigger a deployment on Cloudflare Pages and confirm `pnpm --filter @casino/web build` exits `0`.
2. Open the deployed `https://<pages-host>` URL (for example `https://discord-casino-remaster.pages.dev`) in a browser and confirm static assets load with `200` status.
3. Verify the Developer Portal **URL Mappings** `/` entry points to `<pages-host>` (host only, no `https://` and no trailing slash).
