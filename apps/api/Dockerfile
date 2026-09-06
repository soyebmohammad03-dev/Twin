# Twin API/worker image — one image, two roles. The API server
# (src/server.ts) and the background worker (src/worker.ts) share this
# exact build; which one runs is decided by the container's command,
# not by building two separate images. See README.md's "Production
# deployment" section for exactly how each is started and how many
# instances of each should run.
#
# Build from the REPO ROOT (npm workspaces need the root lockfile and
# the sibling packages/contracts + packages/db sources):
#   docker build -f apps/api/Dockerfile -t twin-api .

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
# apps/web is a workspace member too — npm needs its manifest present
# to resolve the workspace tree, even though this image never builds it.
COPY apps/web/package.json apps/web/package.json
RUN npm ci

FROM deps AS build
COPY packages/contracts packages/contracts
COPY packages/db packages/db
COPY apps/api apps/api
RUN npm run build --workspace packages/contracts \
 && npm run build --workspace packages/db \
 && npm run build --workspace apps/api

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/contracts ./packages/contracts
COPY --from=build /app/packages/db ./packages/db
COPY --from=build /app/apps/api ./apps/api
WORKDIR /app/apps/api

# Runs as a real non-root user — the node:20-alpine base image already
# ships one, no extra setup needed.
USER node

EXPOSE 4000

# Default role: the API server. Override for the worker:
#   docker run <image> node dist/worker.js
CMD ["node", "dist/server.js"]
