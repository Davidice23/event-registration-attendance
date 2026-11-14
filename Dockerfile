# Event Registration and Attendance — one image for the API and React SPA.
# Build from the repository root: docker build -t event-registration-attendance:local .

FROM node:24.14.0-bookworm-slim AS build
WORKDIR /app

# Prisma's schema/client generation detects the OpenSSL ABI during the build.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# Match the repository's pinned toolchain instead of relying on the npm bundled
# with the Node base image.
RUN npm install --global npm@11.9.0

# Install the npm workspaces from the root lockfile for reproducible builds.
COPY package.json package-lock.json ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json
RUN npm ci

COPY . .
RUN npm run build

# The same final image runs the web service and the one-shot Prisma migration
# / demo-seed commands. Keep the runtime base small and pin it to .nvmrc's Node.
FROM node:24.14.0-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    CLIENT_DIST_DIR=/app/client/dist \
    TZ=Asia/Bangkok

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

# Keep the locked npm workspace dependencies: Prisma CLI is needed by the
# separate migration job, and server/dist/seed.js is needed by the seed job.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/package-lock.json ./package-lock.json
COPY --from=build --chown=node:node /app/server/package.json ./server/package.json
COPY --from=build --chown=node:node /app/server/dist ./server/dist
COPY --from=build --chown=node:node /app/client/dist ./client/dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=node:node /app/server/docker-entrypoint.sh ./server/docker-entrypoint.sh

RUN chmod 755 ./server/docker-entrypoint.sh

USER node
EXPOSE 3001
ENTRYPOINT ["./server/docker-entrypoint.sh"]
CMD ["node", "server/dist/index.js"]
