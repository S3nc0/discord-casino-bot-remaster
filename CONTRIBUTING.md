**English** | [日本語](CONTRIBUTING.ja.md)

# Contributing

Thanks for helping. This is a hobby project with a small maintainer team, so a short, focused pull request is the easiest kind to review. Read the [Maintainer guide](MAINTAINERS.md) first for how the repository is laid out and how to run it, and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before you change anything in the server, the ledger or the contracts.

By contributing you agree that your work is released under the [MIT license](LICENSE). To report a security problem, do not open a pull request: follow [SECURITY.md](SECURITY.md).

## Branches

Work on a branch off `main`, named `<type>/<short-description>` in lowercase with hyphens:

```text
feat/horse-breeding-preview
fix/roulette-double-payout
docs/maintainers
chore/update-node-types
```

Use the same words as the commit types below. Do not push to `main` directly; open a pull request against it.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`, in the imperative, no full stop, about 72 characters.

| Type | For |
| --- | --- |
| `feat` | A new feature or screen |
| `fix` | A bug fix |
| `docs` | Documentation only |
| `test` | Tests only |
| `perf` | A speed or memory improvement |
| `refactor` | A change that keeps behaviour |
| `chore`, `ci`, `build` | Tooling, workflows, dependencies |

A scope is the area, for example `feat(ui): …`, `fix(auth): …`, `chore(ops): …`. A body that explains **why** is welcome. Keep one idea per commit.

**Commit messages, branch names and pull request text carry no attribution to tools or assistants: no tool or assistant names, no co-author trailers, no auto-added credit lines.** The author is the person who made the change.

## Before you open a pull request

Run everything CI runs. All of it must pass.

```sh
pnpm i
pnpm -r build
pnpm -r test
pnpm -r typecheck
pnpm lint
pnpm format:check          # pnpm format fixes it
pnpm i18n:check
pnpm exec vitest run --config tests/vitest.config.ts tests/e2e
pnpm exec vitest run --config tests/vitest.config.ts tests/invariants
```

Some slow tests are skipped by default (today the full horse breeding range sweep). Run them when you change horse breeding, and before a release: `SLOW_TESTS=1 pnpm --filter @casino/server test`.

The browser flow and the load test are described in the [Maintainer guide](MAINTAINERS.md#running-everything-locally); run them when you change the Activity shell or the server's hot paths. Add or update tests with your change: a bug fix comes with a test that fails without the fix.

Keep the pull request small, say what changed and why, and say how you checked it. Update [CHANGELOG.md](CHANGELOG.md) and [CHANGELOG.ja.md](CHANGELOG.ja.md) for anything a player or an owner would notice.

## Review checklist

A reviewer (and you, before asking) goes through this:

- **Money.** Balances change only through `EconomyService`, inside one transaction with the game state and the idempotency record. Amounts are integers, rates are basis points, prices are fixed point. No new ledger reason is renamed or removed; new ones have a flow class and a sign.
- **Server authority.** The client sends intents, never results. Randomness is on the server. No route or event takes a user, server or instance from the request; the session's are used.
- **Domain purity.** Rules in `packages/domain` do no I/O and read no clock or random source of their own.
- **Migrations.** A merged migration is never edited; a change is a new numbered file.
- **Contracts.** A change in `packages/shared` is small and additive, and both sides are updated.
- **Secrets.** Nothing secret in the code, tests, fixtures, logs, screenshots or the PR text. Test data uses obviously fake IDs. `.env` is never committed.
- **Text.** Every user-visible string goes through the dictionaries in both languages (see below). No external URLs in the Activity: fonts and images are bundled.
- **UI.** Built from `@casino/ui` and its tokens; readable text sizes, touch targets of at least 48 px, never colour alone, works in light and dark and on a phone width. See [docs/ui-cheatsheet.md](docs/ui-cheatsheet.md).
- **Tests and docs.** New behaviour is tested; docs and the changelog are updated.

## Translations

Every key exists in both languages. A new or changed string goes into `packages/shared/i18n/en.ts` **and** `packages/shared/i18n/ja.ts`, with the same `{placeholders}`, in the same pull request. Write the Japanese the way a Japanese speaker would say it, not word for word. `pnpm i18n:check` fails on a missing key, an empty text or mismatched placeholders, and CI runs it. Docs that have an English and a Japanese version (`NAME.md` and `NAME.ja.md`) are updated together too.

## Pixel art

Icons, sprites and scenes are generated, never hand-edited: change the generators in `tools/pixel-art/` and regenerate (see [tools/pixel-art/README.md](tools/pixel-art/README.md) and the [Maintainer guide](MAINTAINERS.md#regenerating-pixel-art)). Any reference material (a photograph, a sprite sheet, a font) must be **public domain or CC0**, and must be credited in [CREDITS.md](CREDITS.md) and [CREDITS.ja.md](CREDITS.ja.md) with title, author, licence, source and how it was used. Do not add copyrighted or unlicensed references, and do not commit the reference files themselves. Use only colours from the Bitbloom palette.

## Code style

TypeScript with strict settings, formatted by Prettier and checked by ESLint (`pnpm format`, `pnpm lint`). Workspace packages use erasable syntax only (no enums or parameter properties) and relative imports that end in `.ts`. Prefer small functions and plain data. A comment says why, not what.
