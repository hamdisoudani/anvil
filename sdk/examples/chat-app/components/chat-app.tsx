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

  const agent = useAgent();
  return <ChatUI agent={agent} className="h-full" title="Anvil Chat" />;
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