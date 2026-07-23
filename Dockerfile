# Anvil Perplexity — production Dockerfile
# Build: docker build -t perplexity .

# ── Frontend build stage ────────────────────────────────────────
FROM node:22-alpine AS frontend
WORKDIR /sdk
RUN corepack enable && corepack prepare pnpm@9 --activate

# Copy workspace config + lockfile first (for caching)
COPY sdk/package.json sdk/pnpm-lock.yaml sdk/pnpm-workspace.yaml ./
COPY sdk/examples/chat-app/package.json ./examples/chat-app/
COPY sdk/packages/anvil-client/package.json ./packages/anvil-client/
COPY sdk/packages/anvil-react/package.json ./packages/anvil-react/
COPY sdk/packages/anvil-react-headless/package.json ./packages/anvil-react-headless/
RUN pnpm install --no-frozen-lockfile

# Now copy the full SDK source and build
COPY sdk/ ./
# chat-app package name is "chat-app"; Next output:'export' writes to out/
RUN pnpm --filter @anvil/client build && \
    pnpm --filter @anvil/react-headless build && \
    pnpm --filter @anvil/react build && \
    pnpm --filter chat-app build

# ── Go build stage ──────────────────────────────────────────────
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
# Copy Go sources. We use `COPY cmd/ ./cmd/` but precede it with a dummy
# RUN that touches a marker file. Railway's BuildKit is known to serve
# stale cache layers for `COPY cmd/ ./cmd/` after a successful build,
# leaving /src/cmd/ empty on subsequent deploys and breaking
# `go build ./cmd/perplexity-server`. The marker forces cache invalidation.
ARG RAILWAY_CACHE_BUST=2026-07-23-13-31
RUN echo "$RAILWAY_CACHE_BUST" > /tmp/cache_bust.txt
COPY cmd/ ./cmd/
# Post-COPY marker inside cmd/ — invalidates any cache layer that might
# have been keyed on the cmd/ directory's contents from a previous build.
RUN echo "/* cache-bust: $RAILWAY_CACHE_BUST */" >> ./cmd/.cache_bust.go
COPY internal/ ./internal/
# Copy frontend build output BEFORE go build so the embed picks it up.
# This must come AFTER COPY internal/ so it overwrites any stale chat_app_dist.
# NOTE: placing this here also busts the go build layer cache whenever
# the frontend output changes (different file hashes = different layer).
COPY --from=frontend /sdk/examples/chat-app/out /src/internal/perplexity/chat_app_dist
# Go's //go:embed directive ignores files/dirs starting with `_` or `.`.
# Next.js puts all static assets under _next/static/... — silently dropped
# by embed. Rename _next -> next so embed.FS picks everything up.
# The app_embed.go handler translates /app/_next/... <-> next/... for the
# browser and the embed.
RUN if [ -d /src/internal/perplexity/chat_app_dist/_next ]; then \
      mv /src/internal/perplexity/chat_app_dist/_next \
         /src/internal/perplexity/chat_app_dist/next; \
    fi
# Touch a file to bust Go's build cache when frontend changes
RUN find /src/internal/perplexity/chat_app_dist -name "*.css" -o -name "*.js" | sort | md5sum > /tmp/frontend.sum
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/perplexity ./cmd/perplexity-server

# ── Runtime stage ───────────────────────────────────────────────
FROM alpine:3.19
RUN apk add --no-cache ca-certificates tzdata wget
WORKDIR /app
COPY --from=build /out/perplexity /app/perplexity

ENV PORT=8081
EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -q -O - http://localhost:${PORT}/healthz > /dev/null || exit 1

RUN adduser -D -u 1000 anvil
USER anvil

ENTRYPOINT ["/app/perplexity"]
