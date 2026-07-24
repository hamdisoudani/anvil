"use client";

/**
 * ChatApp — Client boundary for the Anvil demo.
 *
 * Wired to ChatUI (the generic, brand-neutral full chat surface
 * exported from @anvil/react). The Perplexity-flavored alternative is
 * AnvilPerplexity — swap the JSX below to compare both.
 *
 * Architecture:
 *   <AnvilProvider>      — configures the client + tool registry
 *     <ChatSurface/>     — uses useAgent({ tools }) to register frontend
 *                          tools AND transmit their specs to the server
 *                          with each POST /tasks
 *       <ChatUI agent={agent} />   — generic chat renderer
 */
import { AnvilProvider, ChatUI } from "@anvil/react";
import { useAgent } from "@anvil/react-headless";

function ChatSurface() {
  // Register frontend tools with useAgent({ tools }).
  // The specs (name, description, inputSchema) are transmitted to the
  // server with each POST /tasks request so the LLM knows what's
  // available. The execute() functions stay in the browser and are
  // called when the server emits a tool.call event.
  //
  // renderTool provides strongly-typed custom UI for each tool. The
  // renderer receives `{input, result, error, stage, outcome, isFrontend}`
  // so it can branch on lifecycle to show pending spinners, success
  // cards, or error UI. Works for BOTH frontend tools (browser-side)
  // AND server tools (the agent called them).
  const agent = useAgent({
    tools: {
      get_current_time: {
        description:
          "Returns the current time. Use whenever the user asks about the time, date, or when something happened.",
        inputSchema: {
          type: "object",
          properties: {
            tz: {
              type: "string",
              description:
                "Timezone, e.g. 'UTC', 'America/New_York'. Omit for local time.",
            },
          },
        },
        execute: async ({ tz }: { tz?: string }) =>
          tz
            ? new Date().toLocaleString("en-US", { timeZone: tz })
            : new Date().toLocaleString(),
      },
      change_background_color: {
        description:
          "Change the chat UI's background color. Use whenever the user asks to recolor, theme, or restyle the chat interface.",
        inputSchema: {
          type: "object",
          properties: {
            color: {
              type: "string",
              description:
                "CSS color value (hex, rgb(), hsl(), or named color). Examples: '#0b1220', 'darkblue', 'rgb(11,18,32)'.",
            },
          },
          required: ["color"],
        },
        execute: async ({ color }: { color: string }) => {
          if (typeof window === "undefined") {
            return { applied: color, previous: null };
          }
          const previous = document.documentElement.style.getPropertyValue(
            "--anvil-bg",
          );
          document.documentElement.style.setProperty("--anvil-bg", color);
          // Inject/replace a global rule that overrides the chat
          // surface's Tailwind `bg-background`. ChatUI's <main> paints
          // its own dark color over our wrapper, so we need a
          // high-specificity rule that wins.
          let style = document.getElementById(
            "anvil-bg-override",
          ) as HTMLStyleElement | null;
          if (!style) {
            style = document.createElement("style");
            style.id = "anvil-bg-override";
            document.head.appendChild(style);
          }
          style.textContent =
            `main.bg-background, .bg-background { background-color: ${color} !important; }`;
          return { applied: color, previous: previous || null };
        },
      },
    },
    /**
     * Custom UI for tool calls. The renderer fires at EVERY lifecycle
     * stage (pending → executing → completed-success/error) so you can
     * build rich, animated tool cards.
     *
     * NOTE: This also works for server-side tools (e.g. a `web_search`
     * tool that the agent runs on the backend) — the same renderer API
     * applies to both, since useChat auto-populates stage/outcome for
     * ANY tool.call / tool.result event.
     */
    renderTool: {
      change_background_color: ({ input, result, error, stage, outcome }) => {
        if (stage === "pending") {
          return (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 px-3 py-2 text-xs">
              <div className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
              <span className="font-medium">Preparing background change…</span>
              <code className="ml-auto font-mono text-[10px] text-muted-foreground">
                {String(input?.color ?? "")}
              </code>
            </div>
          );
        }
        if (outcome && !outcome.success) {
          return (
            <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30 px-3 py-2 text-xs text-red-700 dark:text-red-300">
              <div className="font-medium">Failed to change background</div>
              <div className="opacity-80 mt-0.5 font-mono">{error}</div>
            </div>
          );
        }
        const applied = (result as any)?.applied ?? input?.color;
        return (
          <div
            className="flex items-center gap-3 rounded-lg border px-3 py-2 text-xs"
            style={{
              borderColor: applied,
              background: `color-mix(in srgb, ${applied} 12%, transparent)`,
            }}
          >
            <div
              className="h-6 w-6 rounded border"
              style={{ background: applied }}
            />
            <div>
              <div className="font-medium">Background changed</div>
              <div className="opacity-70 font-mono text-[10px]">
                {applied}
              </div>
            </div>
          </div>
        );
      },
      get_current_time: ({ result, stage, outcome }) => {
        if (stage === "pending") {
          return (
            <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30 px-3 py-2 text-xs">
              <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
              <span>Fetching time…</span>
            </div>
          );
        }
        if (outcome?.success) {
          return (
            <div className="rounded-lg border bg-card px-3 py-2 text-xs">
              <div className="text-muted-foreground">Current time</div>
              <div className="font-mono mt-0.5">{String(result)}</div>
            </div>
          );
        }
        return null;
      },
    },
  });

  return (
    <div
      className="h-full"
      style={{ background: "var(--anvil-bg, transparent)" }}
    >
      <ChatUI agent={agent} className="h-full" title="Anvil Chat" />
    </div>
  );
}

export function ChatApp({ baseUrl }: { baseUrl: string }) {
  return (
    <AnvilProvider baseUrl={baseUrl}>
      <div className="h-full">
        <ChatSurface />
      </div>
    </AnvilProvider>
  );
}