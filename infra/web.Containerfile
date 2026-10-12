FROM docker.io/oven/bun:1.4.2 AS development
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/web/package.json ./apps/web/
RUN bun install --frozen-lockfile
COPY apps/web ./apps/web
COPY evals ./evals
ARG APP_ORIGIN=http://localhost:5173
RUN bun run --cwd apps/web build
CMD ["bun", "run", "--cwd", "apps/web", "dev"]

FROM docker.io/oven/bun:1.4.2 AS runtime-base
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/web/package.json ./apps/web/
RUN bun install --production --frozen-lockfile
COPY --from=development /app/apps/web/build ./apps/web/build
COPY apps/web/src/lib/server ./apps/web/src/lib/server
COPY apps/web/src/lib/speaker-names.ts ./apps/web/src/lib/speaker-names.ts
COPY apps/web/src/lib/source-organization.ts ./apps/web/src/lib/source-organization.ts
COPY apps/web/workers ./apps/web/workers
COPY apps/web/drizzle ./apps/web/drizzle
ENV NODE_ENV=production DATA_ROOT=/data HOST=0.0.0.0 PORT=5173 BODY_SIZE_LIMIT=536870912
CMD ["bun", "apps/web/build"]

FROM runtime-base AS tooling
COPY apps/web/tools ./apps/web/tools

FROM runtime-base AS runtime
