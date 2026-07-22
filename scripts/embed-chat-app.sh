#!/usr/bin/env bash
# Refresh internal/perplexity/chat_app_dist from sdk/examples/chat-app/out.
#
# Why this exists:
# Go's `//go:embed` directive ignores files and directories whose names
# start with `_` or `.`. Next.js puts all its static assets under
# `_next/static/...`, which would be silently dropped from the embedded
# binary. This script copies the build output and renames `_next` to
# `next` so embed.FS picks everything up.
#
# Usage:  ./scripts/embed-chat-app.sh
# (Run from repo root or anywhere — paths are absolute.)
set -euo pipefail

REPO_ROOT="/home/dinzab/anvil"
SRC="${REPO_ROOT}/sdk/examples/chat-app/out"
DST="${REPO_ROOT}/internal/perplexity/chat_app_dist"

if [[ ! -d "${SRC}" ]]; then
  echo "build output missing: ${SRC}" >&2
  echo "run: cd ${REPO_ROOT}/sdk/examples/chat-app && pnpm build" >&2
  exit 1
fi

echo "==> Refreshing ${DST}"
rm -rf "${DST}"
mkdir -p "${DST}"
cp -r "${SRC}/." "${DST}/"

if [[ -d "${DST}/_next" ]]; then
  echo "==> Renaming _next -> next (embed.FS workaround)"
  mv "${DST}/_next" "${DST}/next"
fi

echo "==> Done. Embed will contain:"
find "${DST}" -type f | sort | head -20
echo "  (${DST}: $(find "${DST}" -type f | wc -l) files total)"