/**
 * @anvil/client — framework-agnostic Anvil wire-protocol client.
 *
 * This is the lowest layer. It knows nothing about React. It speaks
 * the canonical schema (see `./schema`) and handles reconnection.
 *
 * Use it directly in vanilla JS, Vue, Svelte, server-side, anywhere.
 *
 * Public API:
 *   - `AnvilClient`                — HTTP + SSE client
 *   - `AnvilEvent` / `*Payload`    — canonical event schema
 *   - `fromWire` / `toWire`        — wire ↔ typed mappers
 *   - `isXxxEvent`                 — runtime type guards
 *   - `reduceAgentStateFromEvents` — pure reducer (shared with React)
 *   - `reduceEventsToMessages`     — pure reducer (shared with React)
 *   - `threadToEvents`             — hydrate TurnRecord[] → events
 *   - `agentStateFromTurns`        — hydrate TurnRecord[] → AgentState
 *   - `messagesFromTurns`          — hydrate TurnRecord[] → ChatMessage[]
 *   - `ThreadHistoryResponse`      — full thread state from server
 */
export { AnvilClient } from "./client";
export { reduceAgentState, reduceAgentStateFromEvents, reduceEventsToMessages, agentStateFromTurns, messagesFromTurns, threadToEvents, } from "./reducers";
export { INITIAL_AGENT_STATE } from "./types/agent-state";
// Catch-all re-export of the schema module so consumers can import
// any payload type / type guard / helper from "@anvil/client" directly.
export * from "./schema";
//# sourceMappingURL=index.js.map