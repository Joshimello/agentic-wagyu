FROM docker.io/oven/bun:1.4.2
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/web/package.json ./apps/web/
RUN bun install --frozen-lockfile
RUN cd apps/web && bunx --bun playwright install --with-deps chromium
CMD ["bun", "run", "--cwd", "apps/web", "test:browser"]
