# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM golang:1.22-alpine AS builder

RUN apk add --no-cache git

WORKDIR /app

# go.mod uses `replace` directives for github.com mirrors of blocked packages.
# GONOSUMDB/GOPROXY can be overridden at build time for different environments.
ARG GONOSUMDB=*
ARG GOPROXY=direct
ENV GONOSUMDB=${GONOSUMDB}
ENV GOPROXY=${GOPROXY}

# Copy dependency manifests first — separate layer for cache efficiency.
# go.sum must be committed; run 'go mod tidy' locally if this step fails.
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# Build metadata, injected into the package-level vars in main.go and served by
# GET /api/version. Declared here, AFTER `go mod download`, on purpose:
# BUILD_TIME changes on every invocation, so an ARG any earlier would invalidate
# the dependency layer and force a full re-download each build.
ARG VERSION=dev
ARG COMMIT=unknown
ARG BUILD_TIME=

RUN CGO_ENABLED=0 GOOS=linux go build \
      -ldflags="-s -w -X main.version=${VERSION} -X main.commit=${COMMIT} -X main.buildTime=${BUILD_TIME}" \
      -o finance-api .

# ── Stage 2: Run ──────────────────────────────────────────────────────────────
FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=builder /app/finance-api .

EXPOSE 8081
CMD ["./finance-api"]
