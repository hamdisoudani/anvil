"use client";

/**
 * ChatApp — Client boundary for the Anvil Perplexity demo.
 *
 * Wraps the rich AnvilPerplexity UI (focus modes, thread history,
 * sources, reasoning, related questions, follow-ups) in the client
 * boundary. The page shell above this is a Server Component.
 *
 * AnvilPerplexity owns its own hooks (useSession, useChat,
 * useAgentState, useFrontendTool) — so we don't need to wire anything
 * here except the boundary and the base URL.
 */
import { AnvilProvider, AnvilPerplexity } from "@anvil/react";

export function ChatApp({ baseUrl }: { baseUrl: string }) {
  return (
    <AnvilProvider baseUrl={baseUrl}>
      <div className="h-full">
        <AnvilPerplexity className="h-full" />
      </div>
    </AnvilProvider>
  );
}