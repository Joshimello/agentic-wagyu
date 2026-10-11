FROM docker.io/oven/bun:1.4.2
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/web/package.json ./apps/web/
RUN bun install --frozen-lockfile
RUN cd apps/web && bunx --bun playwright install --with-deps chromium
COPY apps/web ./apps/web
COPY evals ./evals
CMD ["bun", "run", "test:e2e"]
