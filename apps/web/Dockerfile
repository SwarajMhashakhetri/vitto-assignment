# syntax=docker/dockerfile:1
#
# Web client. Vite emits static assets, so the runtime stage is just nginx —
# there is no Node process in production.

FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

# See apps/api/Dockerfile — Vite and TypeScript are devDependencies, which npm
# omits under NODE_ENV=production.
RUN npm ci --include=dev

COPY packages/shared packages/shared
COPY apps/web apps/web

# The API base URL is baked in at build time, because Vite inlines env vars
# into the bundle. Changing it means rebuilding the image.
ARG VITE_API_URL=http://localhost:4000
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build --workspace @lds/web


FROM nginx:1.27-alpine AS runtime

COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
