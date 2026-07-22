// Serve the React chat app from /app/.
//
// To rebuild: cd sdk && pnpm -r build, then go build.
// The chat-app/dist/ output is copied to internal/perplexity/chat_app_dist/
// at SDK build time (or by running `make chat-app`).
//
// IMPORTANT: Go's `//go:embed` directive ignores files and directories
// whose names start with `_` or `.`. Next.js places all its static assets
// under `_next/static/...`, which would be silently dropped. To work
// around this, the build step renames `_next` to `next` when copying
// into chat_app_dist (see scripts/embed-chat-app.sh). At serve time we
// rewrite the URL: `/app/_next/...` → `next/...` for the embed, and
// rewrite the served HTML so its asset URLs still point at `/app/_next/...`
// for the browser.
package perplexity

import (
	"bytes"
	"embed"
	"io"
	"io/fs"
	"net/http"
	"strings"
	"time"
)

//go:embed static_preview.html
var staticPreview []byte

//go:embed chat_app_dist
var chatAppDist embed.FS

// chatAppFS returns the embedded chat app as an http.FileSystem.
// The embed root is `chat_app_dist/`; Next's static assets live under
// `next/` (we renamed from `_next` because embed ignores underscore dirs).
func chatAppFS() http.FileSystem {
	sub, err := fs.Sub(chatAppDist, "chat_app_dist")
	if err != nil {
		panic("chat_app_dist not embedded — run: cd sdk && pnpm -r build")
	}
	return http.FS(sub)
}

// urlToEmbedPath translates an HTTP request path inside /app/ to the
// embedded FS path. The embed uses `next/...` for Next's `_next/...`
// (rename workaround); everything else passes through unchanged.
func urlToEmbedPath(reqPath string) string {
	// strip /app prefix (Next.js assets are served from /app/_next/...)
	rel := strings.TrimPrefix(reqPath, "/app")
	if rel == "" || rel == "/" {
		return "index.html"
	}
	// /_next/... → next/...
	if strings.HasPrefix(rel, "/_next/") {
		return "next" + strings.TrimPrefix(rel, "/_next")
	}
	return strings.TrimPrefix(rel, "/")
}

// handleApp serves the React-based chat app at /app/.
// Falls back to index.html for SPA routing.
func (h *Handler) handleApp(w http.ResponseWriter, r *http.Request) {
	appFS := chatAppFS()
	embedPath := urlToEmbedPath(r.URL.Path)

	f, err := appFS.Open(embedPath)
	if err != nil {
		// SPA fallback for unknown client routes
		f, err = appFS.Open("index.html")
		if err != nil {
			http.Error(w, "app not built — run: cd sdk && pnpm -r build", http.StatusNotFound)
			return
		}
		embedPath = "index.html"
	}

	switch {
	case strings.HasSuffix(embedPath, ".html"):
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
	case strings.HasSuffix(embedPath, ".js"):
		w.Header().Set("Content-Type", "application/javascript")
	case strings.HasSuffix(embedPath, ".css"):
		w.Header().Set("Content-Type", "text/css")
	case strings.HasSuffix(embedPath, ".svg"):
		w.Header().Set("Content-Type", "image/svg+xml")
	case strings.HasSuffix(embedPath, ".json"):
		w.Header().Set("Content-Type", "application/json")
	case strings.HasSuffix(embedPath, ".png"):
		w.Header().Set("Content-Type", "image/png")
	}
	if !strings.HasSuffix(embedPath, ".html") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}

	// For index.html, rewrite asset paths so the browser requests them
	// at /app/_next/... (the URL Next generated) — the handler maps that
	// back to the embed path next/... at serve time.
	if embedPath == "index.html" {
		body, err := io.ReadAll(f)
		f.Close()
		if err != nil {
			http.Error(w, "read error", http.StatusInternalServerError)
			return
		}
		// Next outputs asset URLs as `/_next/...` and `/_not-found` etc.
		// Rewrite to `/app/_next/...` and `/app/_not-found` so they hit
		// this same handler (and the embed) instead of going to root.
		body = rewriteAssetPaths(body)
		http.ServeContent(w, r, embedPath, fsFileModTime(embedPath), bytes.NewReader(body))
		return
	}

	defer f.Close()
	stat, _ := f.Stat()
	http.ServeContent(w, r, embedPath, stat.ModTime(), f.(http.File))
}

// rewriteAssetPaths rewrites Next.js asset URLs in the served HTML to
// include the /app/ prefix so the browser requests resolve through this
// handler. Next writes relative paths like:
//   href="/_next/static/chunks/..."
//   src="/_next/static/chunks/..."
//   href="/_not-found"
// We rewrite them to:
//   href="/app/_next/static/chunks/..."
//   src="/app/_next/static/chunks/..."
//   href="/app/_not-found"
//
// IMPORTANT: the replacements must be ordered longest-first so that a
// /app/_next/ already-prefixed URL doesn't get double-prefixed (we only
// touch URLs that start with `/_next/` or `/_not-found` *without* an
// existing /app/ prefix).
func rewriteAssetPaths(body []byte) []byte {
	s := string(body)
	// Only rewrite absolute paths that don't already have /app/ prefix.
	// We do a single pass: scan for `="/_next/` or `="/_not-found` and
	// insert `app` after the leading `=`.
	replacements := []struct{ from, to string }{
		{`="/_next/`, `="/app/_next/`},
		{`="/_not-found`, `="/app/_not-found`},
	}
	for _, r := range replacements {
		s = strings.ReplaceAll(s, r.from, r.to)
	}
	// Safety: collapse any accidental `/app/app/` produced by double-rewrite.
	s = strings.ReplaceAll(s, `/app/app/`, `/app/`)
	return []byte(s)
}

// fsFileModTime returns a zero time; ServeContent will use it as-is.
// Kept as a helper so the signature stays tidy above.
func fsFileModTime(_ string) (t time.Time) { return time.Time{} }