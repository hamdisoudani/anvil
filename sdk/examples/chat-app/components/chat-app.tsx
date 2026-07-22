"use client";

/**
 * ChatApp — Client boundary for the Anvil demo.
 *
 * Registers browser tools, wraps the provider, and renders AgentUI.
 * Kept as a Client Component because hooks + browser APIs require it.
 * The page shell above this is a Server Component.
 */
import { AnvilProvider, AgentUI } from "@anvil/react";
import { useFrontendTool } from "@anvil/react-headless";
import { useAgent } from "@anvil/react-headless";

function ChatSurface() {
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
    execute: ({ tz }) => {
      return tz
        ? new Date().toLocaleString("en-US", { timeZone: tz })
        : new Date().toLocaleString();
    },
  });

  useFrontendTool<{ url: string; newTab?: boolean }, string>({
    name: "open_url",
    description:
      "Open a URL in the browser. Use when the user asks to navigate, view, or open a link.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Full URL, e.g. https://example.com" },
        newTab: {
          type: "boolean",
          description: "Open in a new tab (default: false)",
        },
      },
      required: ["url"],
    },
    execute: ({ url, newTab = false }) => {
      if (newTab) window.open(url, "_blank", "noopener");
      else window.location.href = url;
      return `opened ${url}`;
    },
  });

  const agent = useAgent();
  return <AgentUI agent={agent} className="h-full" />;
}

export function ChatApp({ baseUrl }: { baseUrl: string }) {
  return (
    <AnvilProvider baseUrl={baseUrl}>
      <ChatSurface />
    </AnvilProvider>
  );
}
