"use client";

/**
 * <AgentProvider> + `useAgentContext()` — share an agent across components.
 *
 * The `useAgent` hook returns a rich object (messages, state, send,
 * cancel, pendingInterrupt, etc). Without a context, every component
 * that wants to read it has to either:
 *   - call `useAgent()` independently (wasteful — N subscriptions)
 *   - receive the agent as a prop (prop drilling)
 *
 * `AgentProvider` solves both: call `useAgent()` once at the top,
 * pass it to `<AgentProvider agent={agent}>`, and any descendant
 * can call `useAgentContext()` to read the same object.
 *
 * ```tsx
 * function App() {
 *   const agent = useAgent({ url: "/api" });
 *   return (
 *     <AgentProvider agent={agent}>
 *       <ChatUI />           // reads from context
 *       <ThreadList />       // reads from context
 *       <TokenCounter />     // reads from context, custom
 *     </AgentProvider>
 *   );
 * }
 * ```
 *
 * Two read modes:
 *   - `useAgentContext()` — throws outside the provider (strict)
 *   - `useAgentContextOptional()` — returns null outside (defensive)
 */

import { createContext, useContext, type ReactNode } from "react";
import type { UseAgentReturn } from "./useAgent";

const AgentContext = createContext<UseAgentReturn | null>(null);

export interface AgentProviderProps {
  agent: UseAgentReturn;
  children: ReactNode;
}

/**
 * Share an agent object (the return value of `useAgent`) with any
 * descendant component. Single subscription, no prop drilling.
 */
export function AgentProvider({ agent, children }: AgentProviderProps) {
  return <AgentContext.Provider value={agent}>{children}</AgentContext.Provider>;
}

/**
 * Read the shared agent object. Throws if used outside <AgentProvider>.
 *
 * The returned object is the SAME reference as the one passed to
 * <AgentProvider agent={...}>. Re-renders happen when the agent's
 * internal state changes (events arrive, status flips, etc).
 */
export function useAgentContext(): UseAgentReturn {
  const ctx = useContext(AgentContext);
  if (!ctx) {
    throw new Error("useAgentContext must be used inside <AgentProvider>");
  }
  return ctx;
}

/**
 * Same as `useAgentContext()` but returns null outside the provider.
 * Useful for components that should work both with and without a
 * shared agent (e.g. a "ChatUI" component that creates its own
 * agent if none is shared).
 */
export function useAgentContextOptional(): UseAgentReturn | null {
  return useContext(AgentContext);
}