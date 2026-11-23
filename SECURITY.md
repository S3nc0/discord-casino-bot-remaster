**English** | [日本語](SECURITY.ja.md)

# Security policy

Discord Casino Remaster is a play-money game. Pelica has no cash value and cannot be bought or cashed out, but the server still holds Discord credentials and players' accounts, so please report problems responsibly.

## Supported versions

Only the latest release and the current `main` branch get fixes.

## How to report a problem

**Do not open a public issue, pull request or Discord message with the details.**

1. Open the repository's **Security** tab and choose **Report a vulnerability** ([direct link](https://github.com/S3nc0/discord-casino-bot-remaster/security/advisories/new)). Private vulnerability reporting is on: the report is visible only to the maintainer and you, and the fix can be discussed there.
2. Only if that does not work for you: contact the maintainer, [S3nc0](https://github.com/S3nc0), privately through the contact options on their GitHub profile, and say only that you have a security report. Details follow once you have a private channel.

Please include what you found, where (file, route or command), the steps to reproduce it, what an attacker could do with it, and the version or commit. Do not include real tokens, secrets or other people's data; describe them instead.

This is a hobby project run by volunteers: there is no bounty and no guaranteed response time, but reports are read and taken seriously. Please give the maintainer time to fix the problem before you share it publicly, and you will be credited if you wish.

**In scope:** the server (HTTP, sockets, the chat bot), the Activity, the ledger and money rules, authentication and sessions, the install and backup scripts in `ops/`, and the build and CI configuration.

**Out of scope:** Discord, Cloudflare and other services themselves; denial of service by sheer traffic; social engineering; a problem that needs the owner's `.env` or machine to be compromised already; and play-money balance differences that cannot be turned into a way to bypass limits or damage other servers.

## Where secrets live

Secrets exist in exactly one place: the `.env` file on the machine that runs the server (on a Raspberry Pi, `/opt/discord-casino/.env`, owned by the service user with mode 600), plus the tunnel's credentials file under `/etc/cloudflared/`.

- `.env` is listed in `.gitignore` and must never be committed. `.env.example` holds placeholders only.
- The secrets are `DISCORD_TOKEN` (bot token), `DISCORD_CLIENT_SECRET`, `SESSION_SECRET` and the tunnel credentials. `DISCORD_CLIENT_ID` and `DISCORD_PUBLIC_KEY` are public.
- The Activity is a public website. It never contains a secret, and variables that start with `VITE_` are public by design. Do not put a secret in Cloudflare Pages.
- Tests, fixtures, docs and screenshots use fake IDs and placeholders. The server's logs redact tokens, codes, bearer strings and webhook URLs.
- Never paste a secret into chat, an issue, a pull request, a screenshot or a log you share.

## If a token leaks

Act first, investigate after.

1. **Bot token:** Discord Developer Portal → your application → **Bot** → **Reset Token**. Put the new token in `.env`.
2. **Client secret:** Developer Portal → **OAuth2** → **Reset Secret**. Put the new one in `.env`.
3. **Session secret:** make a new one with `openssl rand -hex 32` and put it in `.env`. All sessions end and players reopen the Activity.
4. **Tunnel credentials:** delete and recreate the tunnel (or rotate its token) in Cloudflare and update `/etc/cloudflared/`.
5. **Restart the server** (on the Pi, `sudo systemctl restart discord-casino.service cloudflared.service`). Nothing takes effect until it restarts.
6. Check the server log and the Developer Portal for use you did not make, and check that no secret is left in git history, issues or screenshots. A committed secret is still leaked after you delete it, so rotating is the fix.

The step-by-step version, with what each rotation breaks until the restart, is in the [Maintainer guide](MAINTAINERS.md#rotating-secrets-after-a-leak).

## What the server trusts

The short answer: **nothing the client says about money.**

- **Money is server-authoritative.** Clients send intents (a bet, an action), never results. All randomness runs on the server. Every Pelica change is one row in an append-only ledger written by one service in a database transaction; balances never go below zero and the database rejects edits to ledger rows.
- **Repeats are safe.** Every intent carries an idempotency key that is stored with its first answer, so a retry cannot pay twice; a stale round id is a conflict.
- **Identity comes from Discord, not the request.** Login exchanges a Discord OAuth2 code, then checks with Discord that the user is in the server, the server is in `ALLOWED_GUILD_IDS` and the Activity instance is live. After that only the signed, one-hour session token counts. No route takes a user or server id from the client, and sockets can join only their own server, user and Activity instance rooms.
- **Allow-list.** Only servers in `ALLOWED_GUILD_IDS` can use the Activity. `/admin` commands work only for the user IDs in `OWNER_IDS`. An owner can revoke a server at any time, which disconnects its open sessions at once.
- **Proxy signatures.** Discord's proxy signature headers are verified when present. Discord was observed not to send them on Activity traffic, so they are not the security boundary; the session token is.
- **Limits.** Rate limits per address and per user, a shared event budget and a socket cap per user, and one trusted proxy hop for client addresses.
- **Untrusted input.** Inbound schemas reject unknown properties; downloads made on an admin's behalf are limited to Discord's CDN with a timeout and a size cap; messages the bot sends do not ping anyone by accident.

If you find a way around any of this, that is exactly what to report.
