/**
 * AgentUI — A zero-config, fully working agent UI.
 *
 * Just pass the return value of useAgent() and it renders the
 * entire chat interface: messages, thinking state, sources,
 * streaming text, input box, action buttons.
 *
 * Example:
 * ```tsx
 * function App() {
 *   const agent = useAgent({ url: "/api/agent" });
 *   return <AgentUI agent={agent} />;
 * }
 * ```
 *
 * Fully customizable via slots/children (coming soon).
 */
import * as React from "react";
import type { UseAgentReturn } from "@anvil/react-headless";
interface AgentUIProps {
    agent: UseAgentReturn;
    className?: string;
    placeholder?: string;
    renderTool?: Record<string, (data: any) => React.ReactNode>;
}
export declare function AgentUI({ agent, className, placeholder, renderTool }: AgentUIProps): React.JSX.Element;
export {};
//# sourceMappingURL=agent-ui.d.ts.map