# ── Stage 1: Build React ──────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy lockfile first for layer caching.
# package-lock.json is generated with npm 9 (ships with node:20) — do not
# regenerate it with a different Node version or the lockfile will go out of sync.
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps --silent

COPY public/ ./public/
COPY src/ ./src/

# Build metadata, read by About.js via process.env and shown in the About dialog.
#
# CRA inlines REACT_APP_* into the bundle at BUILD time — there is no runtime
# override, so these have to be build args here. Setting them in the compose
# `environment:` block would have no effect; changing the version means
# rebuilding the image.
#
# Declared after `npm ci` on purpose: BUILD_TIME changes on every invocation, so
# an ARG any earlier would bust the dependency-install layer each build.
ARG REACT_APP_VERSION=dev
ARG REACT_APP_COMMIT=unknown
ARG REACT_APP_BUILD_TIME=
ENV REACT_APP_VERSION=$REACT_APP_VERSION \
    REACT_APP_COMMIT=$REACT_APP_COMMIT \
    REACT_APP_BUILD_TIME=$REACT_APP_BUILD_TIME

RUN npm run build

# ── Stage 2: Serve with nginx ─────────────────────────────────────────────────
FROM nginx:1.27-alpine

RUN rm /etc/nginx/conf.d/default.conf
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/build /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
