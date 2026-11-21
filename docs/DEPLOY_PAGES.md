# Deploying `apps/web` to Cloudflare Pages

For the full step-by-step setup (including how to make sure you choose **Pages** instead of **Workers**), follow the owner setup guide:

- **English:** [Owner Setup Guide — Step 3: Cloudflare Pages](OWNER_SETUP.md#3-cloudflare-pages-host-the-web-app)
- **日本語:** [オーナー向けセットアップガイド](OWNER_SETUP.ja.md)（手順 3）

## Quick Reference

| Setting | Value |
| --- | --- |
| **Framework preset** | `None` |
| **Build command** | `pnpm --filter @casino/web build` |
| **Build output directory** | `apps/web/dist` |
| **Root directory** | *(leave empty — builds from the repository root so workspace packages resolve)* |

### Environment Variables (Production and Preview)

- `NODE_VERSION` = `24`
- `PNPM_VERSION` = `12.21.0`
- `VITE_DISCORD_CLIENT_ID` = `APP_ID` (public — never put secrets in Cloudflare Pages)
- `VITE_API_HOST` = optional; leave unset when using quick tunnels

### Routing Notes

- All fonts and assets are bundled into `apps/web/dist`; inside a Discord Activity iframe, unmapped third-party URLs are blocked.
- `/api` traffic is routed by Discord **URL Mappings** to your tunnel (`<tunnel-host>/api`), not by Pages Functions or `_redirects`.
