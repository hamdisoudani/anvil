# Anvil SDK

The Anvil agent engine ships with a co-evolved TypeScript SDK. Same repo, same version, same release train.

## Architecture

```
anvil/                                 # the engine (Go) + SDK (TS) in one repo
├── internal/core/                     # Go engine
├── internal/server/                   # Go HTTP+SSE server
├── sdk/                               # TypeScript workspace
│   ├── packages/
│   │   ├── anvil-client/              # framework-agnostic SSE client
│   │   ├── anvil-react-headless/       # React hooks + provider
│   │   └── anvil-react/                # pre-built components
│   └── examples/
│       └── chat-app/                  # Vite + React demo
└── go.mod
```

## Three layers, pick what you need

| Layer | Package | Use it when |
|---|---|---|
| **Client** | `@anvil/client` | Vanilla JS, Vue, Svelte, Node, anything. No React. |
| **Headless** | `@anvil/react-headless` | React app with your own UI. Hooks + provider. |
| **Components** | `@anvil/react` | Want a chat UI out of the box. |

## Install

```bash
pnpm add @anvil/react          # React + pre-built UI
# or
pnpm add @anvil/react-headless # React, no UI
# or
pnpm add @anvil/client         # No React
```

## 30-second example

```tsx
import { AnvilProvider, AnvilChat, useFrontendTool } from "@anvil/react";

function App() {
  // Declare a tool the agent can call in the browser
  useFrontendTool({
    name: "get_current_time",
    description: "Returns the current time",
    inputSchema: { type: "object", properties: {} },
    execute: () => new Date().toLocaleString(),
  });

  return (
    <AnvilProvider baseUrl="http://localhost:8080">
      <AnvilChat placeholder="Ask anything…" />
    </AnvilProvider>
  );
}
```

That's it. You now have:
- Live streaming chat with the agent
- Tool calls rendered with collapsible input/result panels
- Auto-reconnect on disconnect (via `Last-Event-ID`)
- Sub-agent hierarchy (when the agent spawns sub-agents)
- Browser-side tools that the agent can call

## How it works

The engine emits events. The HTTP server turns them into SSE. The browser consumes them with `EventSource`. No library, no protocol polish — just standard web APIs.

```
Browser                              Go Engine
─────────                             ─────────
EventSource(/sessions/.../events)
   │
   ├─ session.start  ──────────▶  emit(Event{Type: "session.start"})
   ├─ think.chunk   ──────────▶  emit(Event{Type: "think.chunk"})
   ├─ tool.call     ──────────▶  emit(Event{Type: "tool.call"})
   │   │                              │
   │   ▼  (browser executes tool)     │
   │   │                              │
   │   fetch(POST /sessions/.../tool)──▶ deliverToolResult()
   │                                    │
   │   ◀─────────────── next event ───┘
   └─ ...
```

## Co-evolution guarantee

The SDK and the engine share the same `version`. The SDK's `anvilClient.subscribe()` is the only way to talk to the engine's `serveStream()`. If the engine adds a new event type, the SDK adds the corresponding `addEventListener`. If the SDK needs a new wire field, the engine exposes it. **Same PR, same release.**

## Why we ship this together

Every agent framework has the same problem: the engine is great but talking to it from a browser is hell. AG-UI, A2A, MCP — all "protocols" that are really just describing the same wire format with different names.

We skip that. The protocol is just SSE + JSON. The SDK is a thin React layer over it. Total surface area: ~500 lines of TypeScript, ~200 lines of CSS.

## What you can build with this

- **Chat UIs** (AnvilChat component)
- **Custom agent dashboards** (useSession + useEvents)
- **Mobile apps** (use the client directly, no React)
- **CLI tools** (use the client in Node)
- **Server-side orchestrators** (anvil spawning anvil spawning anvil)

## Development

```bash
cd sdk
pnpm install
pnpm build      # builds all packages
pnpm test       # runs all tests
pnpm dev        # starts the example app on :5173
```

The example app expects an Anvil server on `http://localhost:8080`. Start one with:

```bash
cd ..
go run ./cmd/anvil-server  # (coming soon — see v0.4 roadmap)
```
