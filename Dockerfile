# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates wget \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm prisma generate && pnpm next build

# Image d'exécution commune : build complet + node_modules. La sortie « standalone »
# de Next.js a été écartée : son traçage omet des fichiers chargés dynamiquement
# par certaines dépendances (liens pnpm), ce qui provoquait des erreurs 500.
FROM base AS runtime
ENV NODE_ENV=production
RUN useradd --system --uid 1001 app
COPY --from=build --chown=app /app ./
USER app

# ── Application web ──
FROM runtime AS web
ENV PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]

# ── Worker (jobs BullMQ) et migrations ──
FROM runtime AS worker
CMD ["node_modules/.bin/tsx", "src/worker/index.ts"]
