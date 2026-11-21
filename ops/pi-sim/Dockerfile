# syntax=docker/dockerfile:1

FROM --platform=linux/arm64 node:24-bookworm-slim AS builder

ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"

RUN npm install -g pnpm@12.21.0

WORKDIR /src

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

COPY tsconfig.base.json ./
COPY apps/server ./apps/server
COPY apps/web/package.json ./apps/web/package.json
COPY packages/domain ./packages/domain
COPY packages/shared ./packages/shared
COPY packages/ui/package.json ./packages/ui/package.json

RUN rm -rf apps/*/node_modules packages/*/node_modules \
  && pnpm install --frozen-lockfile --offline \
  && pnpm --filter @casino/server build \
  && pnpm --filter @casino/server deploy --prod /srv/app \
  && rm -rf /srv/app/src /srv/app/tsconfig.json /srv/app/tsup.config.ts /srv/app/vitest.config.ts

FROM --platform=linux/arm64 node:24-bookworm-slim AS runtime

WORKDIR /app

RUN mkdir -p /app/data && chown -R node:node /app

COPY --from=builder --chown=node:node /srv/app /app

# Confirm better-sqlite3 loads from its prebuilt linux-arm64 binary with no compiler installed.
RUN node -e "import('better-sqlite3').then(({ default: Database }) => { const db = new Database(':memory:'); db.exec('SELECT 1'); db.close(); })"

USER node

ENV NODE_ENV=production

EXPOSE 3001

CMD ["node", "--max-old-space-size=192", "--enable-source-maps", "dist/main.js"]
