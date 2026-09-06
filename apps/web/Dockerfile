# Twin web image — builds the static Vite bundle, then serves it with
# nginx. VITE_API_URL is a BUILD-time value (Vite bakes it into the
# bundle at `vite build`, not read at container runtime), so it MUST
# be passed as a build arg pointing at the real, public API URL —
# there is no way to change it after the image is built.
#
# Build from the REPO ROOT:
#   docker build -f apps/web/Dockerfile \
#     --build-arg VITE_API_URL=https://api.your-domain.com \
#     -t twin-web .

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
COPY apps/api/package.json apps/api/package.json
RUN npm ci

FROM deps AS build
COPY packages/contracts packages/contracts
RUN npm run build --workspace packages/contracts
COPY apps/web apps/web
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build --workspace apps/web

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
