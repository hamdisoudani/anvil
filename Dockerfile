# Anvil Perplexity — production Dockerfile (Railway/Fly/Render compatible)
#
# Multi-stage: builds the React frontend, then the Go binary embedding it.
#
# Build:    docker build -t perplexity .
# Run:      docker run -p 8081:8081 -e GROQ_API_KEY=*** perplexity

# ── Frontend build stage ────────────────────────────────────────
FROM node:20-alpine AS frontend
WORKDIR /sdk
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY sdk/package.json sdk/pnpm-lock.yaml* ./
COPY sdk/examples/chat-app/package.json ./examples/chat-app/
COPY sdk/packages/anvil-client/package.json ./packages/anvil-client/
COPY sdk/packages/anvil-react/package.json ./packages/anvil-react/
COPY sdk/packages/anvil-react-headless/package.json ./packages/anvil-react-headless/
RUN pnpm install --no-frozen-lockfile
COPY sdk/ ./
RUN pnpm --filter @anvil/client build && \
    pnpm --filter @anvil/react-headless build && \
    pnpm --filter @anvil/react build && \
    pnpm --filter anvil-chat-app build

# ── Go build stage ──────────────────────────────────────────────
FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# Overlay the freshly built chat-app dist into the Go embed location
COPY --from=frontend /sdk/examples/chat-app/dist /src/internal/perplexity/chat_app_dist
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
