// Serve the React chat app from /app/.
//
// To rebuild: cd sdk && pnpm -r build, then go build.
// The chat-app/dist/ output is copied to internal/perplexity/chat_app_dist/
// at SDK build time (or by running `make chat-app`).
package perplexity

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed chat_app_dist
var chatAppDist embed.FS

// chatAppFS returns the embedded chat app as an http.FileSystem.
func chatAppFS() http.FileSystem {
	sub, err := fs.Sub(chatAppDist, "chat_app_dist")
	if err != nil {
		panic("chat_app_dist not embedded — run: cd sdk && pnpm -r build")
	}
	return http.FS(sub)
}

// handleApp serves the React-based chat app at /app/.
// Falls back to index.html for SPA routing.
func (h *Handler) handleApp(w http.ResponseWriter, r *http.Request) {
	fs := chatAppFS()
	path := strings.TrimPrefix(r.URL.Path, "/app")
	if path == "" || path == "/" {
		path = "/index.html"
	}
	f, err := fs.Open(path)
	if err != nil {
		// SPA fallback
		f, err = fs.Open("/index.html")
		if err != nil {
			http.Error(w, "app not built — run: cd sdk && pnpm -r build", http.StatusNotFound)
			return
		}
	}
	defer f.Close()
	stat, _ := f.Stat()
	if stat.IsDir() {
		f.Close()
		f, err = fs.Open("/index.html")
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer f.Close()
		stat, _ = f.Stat()
	}
	switch {
	case strings.HasSuffix(path, ".html"):
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
	case strings.HasSuffix(path, ".js"):
		w.Header().Set("Content-Type", "application/javascript")
	case strings.HasSuffix(path, ".css"):
		w.Header().Set("Content-Type", "text/css")
	case strings.HasSuffix(path, ".svg"):
		w.Header().Set("Content-Type", "image/svg+xml")
	case strings.HasSuffix(path, ".json"):
		w.Header().Set("Content-Type", "application/json")
	case strings.HasSuffix(path, ".png"):
		w.Header().Set("Content-Type", "image/png")
	}
	if !strings.HasSuffix(path, ".html") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}
	http.ServeContent(w, r, path, stat.ModTime(), f)
}
