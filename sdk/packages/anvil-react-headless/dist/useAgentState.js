/**
 * useAgentState — tracks the agent's thinking process in real-time.
 *
 * Takes an event stream (from useEvents or sharedEvents) and produces
 * a reactive state object describing what the agent is doing:
 *   - phase: high-level state machine (idle → planning → searching → ...)
 *   - activity: human-readable current action
 *   - steps[]: full timeline of plan.step events
 *   - plan: the parsed search/action plan
 *   - sources[]: discovered sources
 *   - progress: counters for searches, fetches, etc.
 *   - answer: accumulated text so far
 *
 * Works with ANY Anvil agent — not tied to Perplexity.
 */
import { useMemo } from "react";
// ── Hook ─────────────────────────────────────────────────────────
export function useAgentState(events) {
    return useMemo(() => {
        const steps = [];
        let phase = "idle";
        let activity = "";
        let plan = null;
        let sources = [];
        let answer = "";
        let error = null;
        let searchesDone = 0;
        let searchesTotal = 0;
        let pagesRead = 0;
        let pagesTotal = 0;
        let runningStepCount = 0;
        for (const e of events) {
            const p = e.payload;
            switch (e.type) {
                case "session.start": {
                    phase = "planning";
                    activity = "Analyzing your question…";
                    break;
                }
                case "plan.step": {
                    const step = {
                        id: p.id,
                        intent: p.intent,
                        status: p.status || "running",
                        detail: p.detail,
                        timestamp: Date.parse(e.createdAt),
                    };
                    steps.push(step);
                    // Track searches
                    if (p.intent?.toLowerCase().includes("search")) {
                        if (p.status === "running") {
                            searchesDone++;
                            // If this is the first search, set total
                            if (searchesTotal === 0)
                                searchesTotal = 1; // default
                        }
                    }
                    // Track page reads
                    if (p.intent?.toLowerCase().includes("read")) {
                        if (p.status === "running") {
                            pagesRead++;
                        }
                    }
                    // Update phase based on intent
                    if (p.status === "running") {
                        runningStepCount++;
                        // Infer phase from intent keywords
                        const intent = (p.intent || "").toLowerCase();
                        if (intent.includes("plan"))
                            phase = "planning";
                        else if (intent.includes("search"))
                            phase = "searching";
                        else if (intent.includes("read") || intent.includes("fetch"))
                            phase = "fetching";
                        else if (intent.includes("writ") || intent.includes("synthes"))
                            phase = "synthesizing";
                        // Generate human-readable activity
                        if (p.detail) {
                            activity = p.detail;
                        }
                        else {
                            activity = p.intent + "…";
                        }
                    }
                    break;
                }
                case "sources.found": {
                    sources = (p.sources || []);
                    if (sources.length > 0) {
                        activity = `Found ${sources.length} sources`;
                    }
                    break;
                }
                case "frontend.call": {
                    const input = p.input || {};
                    if (p.name === "show_plan_step") {
                        plan = {
                            needs_search: !!input.needs_search,
                            reason: input.reason || "",
                            sub_queries: input.sub_queries || [],
                            synthesize_hint: input.synthesize_hint,
                        };
                        // Set total searches from plan
                        if (plan.sub_queries.length > 0) {
                            searchesTotal = plan.sub_queries.length;
                            activity = `Planning ${searchesTotal} search queries…`;
                        }
                        if (!plan.needs_search) {
                            activity = "Answering from knowledge…";
                            phase = "synthesizing";
                        }
                    }
                    if (p.name === "render_sources") {
                        if (input.sources) {
                            sources = input.sources;
                        }
                    }
                    break;
                }
                case "answer.chunk":
                case "think.chunk": {
                    answer += (p.delta || "");
                    if (phase !== "done") {
                        phase = "synthesizing";
                        activity = "Writing answer…";
                    }
                    break;
                }
                case "error": {
                    error = p.message || "An error occurred";
                    phase = "error";
                    activity = "Error: " + error;
                    break;
                }
                case "done": {
                    phase = "done";
                    activity = "Done";
                    // Attach any final sources from the done payload
                    if (p.sources && p.sources.length > 0) {
                        sources = p.sources;
                    }
                    break;
                }
            }
        }
        // Determine current step (last running step)
        const currentStep = [...steps].reverse().find(s => s.status === "running") || null;
        return {
            phase,
            activity,
            steps,
            currentStep,
            plan,
            sources,
            progress: {
                searchesDone,
                searchesTotal,
                pagesRead,
                pagesTotal,
            },
            answer,
            error,
        };
    }, [events]);
}
//# sourceMappingURL=useAgentState.js.map