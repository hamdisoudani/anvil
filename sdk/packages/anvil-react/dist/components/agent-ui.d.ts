/**
 * AgentUI — Zero-config, production chat surface for Anvil.
 *
 * Pass the return value of useAgent() and get:
 * - Thread-aware multi-turn send (reuses agent.threadId)
 * - Streaming markdown answers
 * - Live thinking / plan steps
 * - Sources + related questions
 * - HITL interrupt dialogs
 * - Mobile-safe composer (native textarea, safe-area, ≥44px targets)
 *
 * Example:
 * ```tsx
 * const agent = useAgent({ url: "/api/agent" });
 * return <AgentUI agent={agent} />;
 * ```
 */
import * as React from "react";
import type { UseAgentReturn } from "@anvil/react-headless";
interface AgentUIProps {
    agent: UseAgentReturn;
    className?: string;
    placeholder?: string;
    renderTool?: Record<string, (data: any) => React.ReactNode>;
    emptyTitle?: string;
    emptyDescription?: string;
}
export declare function AgentUI({ agent, className, placeholder, renderTool, emptyTitle, emptyDescription, }: AgentUIProps): React.JSX.Element;
export {};
//# sourceMappingURL=agent-ui.d.ts.map