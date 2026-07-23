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
 *     <ChatSurface/>     — uses useAgent() + useFrontendTool()
 *       <ChatUI agent={agent} />   — generic chat renderer
 */
import { AnvilProvider, ChatUI } from "@anvil/react";
import { useAgent, useFrontendTool } from "@anvil/react-headless";

function ChatSurface() {
  // Register a browser-side tool the agent can call mid-conversation.
  useFrontendTool<{ tz?: string }, string>({
    name: "get_current_time",
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
    execute: ({ tz }) =>
      tz
        ? new Date().toLocaleString("en-US", { timeZone: tz })
        : new Date().toLocaleString(),
  });

  // Register the change_background_color tool. The server's
  // frontend tool definition matches this signature. When the
  // agent decides the user wants to restyle the UI, it calls
  // this tool with a CSS color; we apply it to <html> so the
  // entire chat surface flips. The handler returns the applied
  // color so the agent can confirm in its reply.
  useFrontendTool<{ color: string }, { applied: string; previous: string | null }>({
    name: "change_background_color",
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
    execute: ({ color }) => {
      if (typeof window === "undefined") {
        return { applied: color, previous: null };
      }
      const previous = document.documentElement.style.getPropertyValue(
        "--anvil-bg",
      );
      document.documentElement.style.setProperty("--anvil-bg", color);
      return { applied: color, previous: previous || null };
    },
  });

  const agent = useAgent();
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