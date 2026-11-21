# Deploying `apps/web` to Cloudflare Pages

The Discord Activity front end (`apps/web`) is a static Vite + React bundle hosted on Cloudflare Pages and mapped to `/` in the Discord Developer Portal.

## Cloudflare Pages Build Settings

Configure the Pages project from the **repository root** (not `apps/web`), because `@casino/web` imports workspace packages (`@casino/shared` and `@casino/ui`):

| Setting | Value |
| --- | --- |
| **Framework preset** | `None` (or `Vite`) |
| **Root directory** | `/` |
| **Build command** | `pnpm --filter @casino/web build` |
| **Build output directory** | `apps/web/dist` |

### Environment Variables

Set under **Settings → Environment variables** (for both **Production** and **Preview**):

| Variable | Value | Purpose |
| --- | --- | --- |
| `NODE_VERSION` | `24` | Matches `.nvmrc` and root `package.json` `engines.node` |

Cloudflare Pages reads `"packageManager": "pnpm@12.21.0"` from the root `package.json` and installs workspace dependencies from `pnpm-lock.yaml` before running the build command.

## Routing and Asset Notes

- `apps/web/vite.config.ts` sets `base: '/'` and outputs to `apps/web/dist`.
- All fonts and assets must be bundled into `apps/web/dist`; inside a Discord Activity iframe, external third-party URLs are blocked unless mapped in Developer Portal **URL Mappings**.
- API and WebSocket requests go to `/api` (which Discord maps to your `API_DOMAIN` Cloudflare Tunnel). Do not add Pages Functions or `_redirects` rules for `/api` unless intentionally fronting the tunnel.

## Verification

1. Trigger a deployment on Cloudflare Pages and confirm `pnpm --filter @casino/web build` exits `0`.
2. Open the deployed `https://<project>.pages.dev` URL (or custom domain) in a browser and confirm static assets load with `200` status.
3. Verify the Developer Portal **URL Mappings** `/` entry points to this exact hostname (`PAGES_DOMAIN`).
