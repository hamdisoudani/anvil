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
          console.log("[ANVIL-DEBUG] change_background_color execute called with", color);
          const previous = document.documentElement.style.getPropertyValue(
            "--anvil-bg",
          );
          document.documentElement.style.setProperty("--anvil-bg", color);
          console.log("[ANVIL-DEBUG] bg applied", color);
          return { applied: color, previous: previous || null };
        },
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