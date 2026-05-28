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
RUN npm run build

# ── Stage 2: Serve with nginx ─────────────────────────────────────────────────
FROM nginx:1.27-alpine

RUN rm /etc/nginx/conf.d/default.conf
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/build /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
