# syntax=docker/dockerfile:1
#
# API and worker image. Both services run from this same image with different
# commands — they share all their code, and building twice would only create an
# opportunity for the two to drift.
#
# Build context is the repository root, because npm workspaces need the root
# lockfile to install deterministically.

FROM node:22-alpine AS builder
WORKDIR /app

# Manifests first, so `npm ci` is cached and only re-runs when a dependency
# actually changes rather than on every source edit.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN npm ci

COPY packages/shared packages/shared
COPY apps/api apps/api

RUN npm run build --workspace @lds/shared \
 && npm run build --workspace @lds/api

# Drop dev dependencies from the tree that gets copied into the runtime stage.
RUN npm prune --omit=dev


FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Run unprivileged. The node image ships a `node` user for exactly this.
RUN chown -R node:node /app
USER node

COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=node:node /app/packages/shared/package.json ./packages/shared/
COPY --from=builder --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=node:node /app/apps/api/package.json ./apps/api/
# Migration SQL is committed and applied at deploy time, so it must ship.
COPY --from=builder --chown=node:node /app/apps/api/drizzle ./apps/api/drizzle

WORKDIR /app/apps/api

EXPOSE 4000

# Overridden by docker-compose for the worker service.
CMD ["node", "dist/server.js"]
