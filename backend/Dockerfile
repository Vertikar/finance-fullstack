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
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o finance-api .

# ── Stage 2: Run ──────────────────────────────────────────────────────────────
FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=builder /app/finance-api .

EXPOSE 8081
CMD ["./finance-api"]
