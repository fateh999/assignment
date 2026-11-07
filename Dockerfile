# Bun installs and runs scripts; Node runs Next (the SSRF connect-time guard relies on Node's net lookup hook).
FROM node:24-slim AS build
COPY --from=oven/bun:1.4.4 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000
# sharp/librsvg renders the overlay text; fontconfig maps Helvetica/Arial to Liberation Sans
RUN apt-get update && apt-get install -y --no-install-recommends fontconfig fonts-liberation && rm -rf /var/lib/apt/lists/*
COPY --from=build /app ./
# Run as non-root; /app/data holds SQLite + generated files (mount a volume here)
RUN mkdir -p data && chown -R node:node data .next
USER node
VOLUME ["/app/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# exec next directly (no package manager in between) so SIGTERM reaches node and in-flight requests can drain
CMD ["node_modules/.bin/next", "start"]
