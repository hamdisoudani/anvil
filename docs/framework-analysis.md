# Anvil Framework Analysis: Distinctive Patterns Across Major Agent Frameworks

> **Goal.** Distill the *one pattern each framework does best* and synthesize the orthogonal "axes" of agent design so Anvil (a Go-based agent engine) can position itself as a best-of-breed **meta-framework** with a plugin architecture that lets users mix and match rather than pick a single philosophy.

> **Method.** Reviewed official docs, GitHub READMEs, and 2024–2026 production writeups for 14 frameworks. Each section below answers: (1) the distinctive pattern, (2) what makes it irreplaceable, (3) a concrete code snippet, (4) trade-offs.

---

## Part 1 — Per-Framework Deep Dives

### 1. LangGraph (LangChain) — *Stateful graph execution with checkpointing as a first-class primitive*

**Distinctive pattern.** A `StateGraph` of nodes + conditional edges plus a **pluggable checkpointer** that snapshots state at every *super-step* (atomic batch of parallel node executions). Checkpointing is not an afterthought — it is the foundation that powers human-in-the-loop interrupts, time-travel debugging, and fault recovery.

**Why irreplaceable.** No other framework makes "where is execution right now, and can I rewind?" a first-class API surface. The checkpointer is decoupled from the model, the storage backend (Memory / SQLite / Postgres / Redis), and the graph topology.

```python
from typing import TypedDict, Annotated
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import MemorySaver
from langgraph.checkpoint.postgres import PostgresSaver

class State(TypedDict):
    draft: str
    critique: str
    approved: bool

def writer(state: State):
    return {"draft": f"Draft based on: {state['critique'] or state.get('topic','')}"}

def reviewer(state: State):
    return {"critique": "Looks good", "approved": True}

def should_continue(state: State) -> str:
    return END if state["approved"] else "writer"

g = StateGraph(State)
g.add_node("writer", writer)
g.add_node("reviewer", reviewer)
g.add_edge(START, "writer")
g.add_edge("writer", "reviewer")
g.add_conditional_edges("reviewer", should_continue)

# The pattern: same code, swap backend
checkpointer = PostgresSaver(conn)        # prod
app = g.compile(checkpointer=checkpointer, interrupt_before=["writer"])

# Time travel
config = {"configurable": {"thread_id": "1", "checkpoint_id": "1f070a87-..."}}
app.get_state(config)        # inspect
app.update_state(config, {"critique": "Tighten intro"})  # mutate
app.invoke(None, config)     # resume from that point
```

**Trade-offs.** Graph topology is the wrong abstraction for purely conversational multi-agent flows. Checkpointing every super-step can become a write-storm. The framework is verbose for simple ReAct loops; you end up re-implementing them as graphs.

---

### 2. CrewAI — *Role-based agent collaboration with delegation*

**Distinctive pattern.** A **Crew** of `Agent`s, each with a `role`, `goal`, `backstory`, and `allow_delegation=True` flag, that collaborate through an implicit orchestration loop. The mental model is a workplace where agents can ask each other for help rather than a workflow you wire up.

**Why irreplaceable.** The role/backstory framing is the most ergonomic way to get emergent multi-agent behavior from a single LLM call. The `allow_delegation` flag is the cleanest "this agent may interrupt another" primitive in the ecosystem.

```python
from crewai import Agent, Crew, Task, Process

researcher = Agent(
    role="Research Specialist",
    goal="Conduct thorough research on any topic",
    backstory="Expert researcher with access to various sources",
    allow_delegation=True,            # may hand off to writer
    verbose=True,
)
writer = Agent(
    role="Content Writer",
    goal="Create engaging content based on research",
    backstory="Skilled writer who transforms research into compelling content",
    allow_delegation=True,
)

research_task = Task(
    description="Research quantum computing milestones in 2026",
    expected_output="Bullet list of 5 milestones with citations",
    agent=researcher,
)
write_task = Task(
    description="Write a blog post from the research",
    expected_output="1200-word blog post",
    agent=writer,
    context=[research_task],          # explicit data flow
)

crew = Crew(
    agents=[researcher, writer],
    tasks=[research_task, write_task],
    process=Process.sequential,        # or Process.hierarchical
)
result = crew.kickoff(inputs={"topic": "quantum computing"})
```

**Trade-offs.** The "roleplay" abstraction is LLM-flavored prose — hard to test deterministically. Hierarchical process adds a manager LLM call that can dominate cost. The newest layer ("Flows") is a bolted-on deterministic control layer, evidence the Crew model alone isn't enough.

---

### 3. AutoGen (Microsoft) — *Conversable agents and group-chat manager*

**Distinctive pattern.** A `GroupChatManager` arbitrates who speaks next in a multi-agent conversation, treating the **transcript** as the canonical shared state. The classic two-agent pattern is `AssistantAgent` (writes code) ↔ `UserProxyAgent` (executes it), enabling closed-loop code generation+execution.

**Why irreplaceable.** The transcript-as-state model is the most natural representation for brainstorming, code review, and debate-style multi-agent work. Code-execution-in-the-loop is wired in by default, not bolted on.

```python
from autogen import AssistantAgent, UserProxyAgent, GroupChat, GroupChatManager

assistant = AssistantAgent(
    name="Coder",
    llm_config={"config_list": [{"model": "gpt-4o"}]},
    system_message="You write Python. Reply TERMINATE when done.",
)
executor = UserProxyAgent(
    name="Executor",
    human_input_mode="NEVER",
    code_execution_config={"work_dir": "coding", "use_docker": True},
)
critic = AssistantAgent(
    name="Critic",
    llm_config={"config_list": [{"model": "gpt-4o"}]},
    system_message="Review code; demand fixes if wrong.",
)

group = GroupChat(
    agents=[assistant, executor, critic],
    messages=[],
    max_round=12,
    speaker_selection_method="auto",    # manager LLM picks next speaker
)
manager = GroupChatManager(groupchat=group, llm_config=assistant.llm_config)

executor.initiate_chat(
    manager,
    message="Plot the first 50 Fibonacci numbers and explain trends.",
)
```

**Trade-offs.** Conversation transcripts are unbounded, lose structure, and bleed tokens. The "next speaker" manager adds latency and nondeterminism. Code execution requires Docker or a sandbox, raising ops burden.

---

### 4. Pydantic AI — *FastAPI-feel type-safe agents*

**Distinctive pattern.** Agents return **Pydantic models**, not strings. Tool inputs/outputs are typed Python functions with automatic JSON-schema generation and validation. "If it type-checks, it runs" is the explicit goal.

**Why irreplaceable.** It is the only mainstream framework that gives you the same compile-time-ish confidence in agent I/O that FastAPI gives you for HTTP. Drop-in Instructor-style validation; IDE auto-complete works for tool args.

```python
from pydantic import BaseModel
from pydantic_ai import Agent, RunContext
from pydantic_ai.models.anthropic import AnthropicModel

class SupportAnswer(BaseModel):
    answer: str
    confidence: float
    escalate: bool

model = AnthropicModel("claude-sonnet-4-6")
agent = Agent(
    model,
    result_type=SupportAnswer,
    system_prompt="You are a bank support agent. Escalate fraud to a human.",
)

@agent.tool
async def get_balance(ctx: RunContext, account_id: str) -> float:
    return db.get_balance(account_id)

# Result is guaranteed-valid SupportAnswer
result: SupportAnswer = await agent.run("Is my card used in Brazil?")
print(result.escalate)        # bool, not Optional[str]
```

**Trade-offs.** Schema rigidity fights open-ended generation (long-form writing, planning). Validation runs *after* the LLM call, so you still pay for bad outputs. Tied to the Pydantic v2 ecosystem.

---

### 5. LlamaIndex — *RAG-native, query-engine–first data agents*

**Distinctive pattern.** A **Workflow** of `@step`-decorated async functions wired by typed events, with a deep library of `QueryEngine` / `Retriever` / `RouterQueryEngine` building blocks. The data agent is *one* consumer of those building blocks, not the center of the universe.

**Why irreplaceable.** The richest out-of-the-box data connectors and indexing strategies (80+ loaders, hierarchical/node parsers, sentence-window, auto-merging retrievers). The `@step` + event system is the cleanest "RAG pipeline as a graph" abstraction in Python.

```python
from llama_index.core import VectorStoreIndex, SimpleDirectoryReader
from llama_index.core.workflow import Workflow, step, Event, StartEvent, StopEvent

class QueryEvent(Event):
    query: str
    docs: list

class AnswerEvent(Event):
    answer: str

class RAGWorkflow(Workflow):
    @step
    async def retrieve(self, ev: StartEvent) -> QueryEvent:
        docs = self.index.as_retriever().retrieve(ev.query)
        return QueryEvent(query=ev.query, docs=docs)

    @step
    async def synthesize(self, ev: QueryEvent) -> StopEvent:
        ans = self.llm.complete(f"Context: {ev.docs}\nQ: {ev.query}")
        return StopEvent(result=ans)

docs = SimpleDirectoryReader("data").load_data()
index = VectorStoreIndex.from_documents(docs)
wf = RAGWorkflow(index=index, timeout=60, verbose=True)
result = await wf.run(query="What is the refund policy?")
```

**Trade-offs.** The surface area is huge — the framework can feel like a kitchen sink. Many advanced patterns require staying in their object graph. Less ergonomic for non-RAG agents.

---

### 6. Mastra — *TypeScript-native, batteries-included agent framework*

**Distinctive pattern.** Brings LangGraph-style workflow primitives (with `suspend` / `resume` for human-in-the-loop and **rewind-and-replay**) to the TypeScript ecosystem as a *first-class* framework rather than a port. Includes agents, workflows, memory, RAG, evals, and observability in one modular package.

**Why irreplaceable.** The only mature, opinionated, production-grade agent framework *natively* in the TypeScript world. The "rewind to any step with original context" debugging feature is unusual outside LangGraph.

```typescript
import { Agent } from "@mastra/core/agent";
import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";

const researchAgent = new Agent({
  id: "researcher",
  name: "Researcher",
  instructions: "You research topics thoroughly.",
  model: "openai/gpt-4o",
  tools: { webSearch },
});

const researchStep = createStep({
  id: "research",
  inputSchema: z.object({ topic: z.string() }),
  outputSchema: z.object({ facts: z.array(z.string()) }),
  execute: async ({ inputData }) => {
    const r = await researchAgent.generate(`Research ${inputData.topic}`);
    return { facts: parseFacts(r.text) };
  },
});

const approvalStep = createStep({
  id: "approval",
  inputSchema: z.object({ facts: z.array(z.string()) }),
  outputSchema: z.object({ approved: z.boolean() }),
  // Suspends here for human review
  execute: async ({ inputData, resumeData, suspend }) => {
    if (!resumeData?.approved) {
      return await suspend({ facts: inputData.facts });
    }
    return { approved: true };
  },
});

const wf = createWorkflow({ id: "blog", inputSchema: z.object({ topic: z.string() }) })
  .then(researchStep)
  .then(approvalStep)
  .commit();

// Rewind to any step
const run = await wf.createRunAsync({ inputData: { topic: "DSPy" } });
await run.rewindToStep("research", { inputData: { topic: "DSPy v3" } });
```

**Trade-offs.** Opinionated — works best when you buy the whole stack. Younger ecosystem than LangChain. The TS-only stance makes Python interop a chore.

---

### 7. Smolagents (HuggingFace) — *Code-as-action*

**Distinctive pattern.** The `CodeAgent` emits a **real Python program** (not JSON tool-call blobs) and executes it in a sandboxed interpreter. Tools become Python functions, so the model can do `loops`, `if/else`, `list comprehensions`, and **nesting tool calls inside tool calls** with no ceremony.

**Why irreplaceable.** "Executable Code Actions Elicit Better LLM Agents" (Wang et al., 2024) showed code-action agents outperform JSON-tool-call agents on many benchmarks. Smolagents is the cleanest open implementation of that finding — ~1000 LOC.

```python
from smolagents import CodeAgent, DuckDuckGoSearchTool, HfApiModel

model = HfApiModel("Qwen/Qwen2.5-Coder-32B-Instruct")
agent = CodeAgent(
    tools=[DuckDuckGoSearchTool()],
    model=model,
    additional_authorized_imports=["requests", "pandas"],
)

# The model writes a Python program; smolagents executes it
agent.run(
    "Find the population of France and Germany, return the higher one as JSON."
)
# Internally the model may emit:
# result = max(france_pop, germany_pop)
# final_answer({"country": "...", "population": ...})
```

**Trade-offs.** You need a real sandbox (E2B, Docker, or restricted `exec`). Smaller models hallucinate imports and produce unsafe code. Step-level observability is harder than with JSON tool calls because the action is opaque.

---

### 8. OpenAI Swarm — *Stateless handoffs and routines*

**Distinctive pattern.** Just two primitives — `Agent` and `handoff` — over the Chat Completions API. A handoff is simply: an agent's tool *returns another agent* as its value. Stateless, ~300 LOC, designed for educational clarity.

**Why irreplaceable.** The handoff-as-return-value pattern is the smallest possible multi-agent abstraction and was the design template for the production OpenAI Agents SDK. Demonstrates that multi-agent can be a function, not a framework.

```python
from swarm import Swarm, Agent

client = Swarm()

def transfer_to_sales():
    return sales_agent

def transfer_to_support():
    return support_agent

triage = Agent(
    name="Triage",
    instructions="Route the user to sales or support.",
    functions=[transfer_to_sales, transfer_to_support],
)
sales_agent = Agent(
    name="Sales",
    instructions="Sell premium plans. Be terse.",
)
support_agent = Agent(
    name="Support",
    instructions="Help with refunds.",
)

resp = client.run(
    agent=triage,
    messages=[{"role": "user", "content": "I want a refund"}],
)
print(resp.messages[-1]["content"])
```

**Trade-offs.** Stateless: persistence, retries, and human-in-the-loop are all *your* problem. No state graph, no parallelism, no streaming events. Explicitly labeled "educational, do not use in production."

---

### 9. Atomic Agents (BrainBlend) — *Atomic I/O-schema chaining*

**Distinctive pattern.** Every agent and tool is an **atomic unit** with a strict Pydantic *input schema* and *output schema*. The killer feature: when an agent's output schema matches a downstream tool's input schema, they can be **chained or swapped** like typed Lego blocks. `ContextProvider`s inject dynamic context into system prompts.

**Why irreplaceable.** The most disciplined take on *schema-as-contract* in the ecosystem. Solves the "swapping OpenSearch for Pinecone" problem by treating the search tool as an interface, not a class.

```python
from atomic_agents import Agent, AtomicAgentFactory
from pydantic import BaseModel, Field
from typing import List

class SearchQuery(BaseModel):
    query: str = Field(..., description="Search string")

class SearchResult(BaseModel):
    title: str
    url: str
    snippet: str

SearchAgent = AtomicAgentFactory.create(
    output_schema=SearchResult,
    input_schema=SearchQuery,
    system_prompt="You are a precise web search agent.",
)

class SummarizeInput(BaseModel):
    results: List[SearchResult]
    question: str

class Summary(BaseModel):
    text: str

SummaryAgent = AtomicAgentFactory.create(
    input_schema=SummarizeInput,
    output_schema=Summary,
    system_prompt="Summarize the search results to answer the question.",
)

# Chain by schema compatibility — the input of the second matches the output type of the first
def pipeline(question: str) -> Summary:
    results = [SearchAgent.run(SearchQuery(query=question))]
    return SummaryAgent.run(SummarizeInput(results=results, question=question))
```

**Trade-offs.** Heavy reliance on Pydantic and Instructor under the hood. The "atomic" discipline can fragment a coherent agent into many tiny ones. Less suitable for freeform reasoning or open-ended generation.

---

### 10. DSPy — *Signatures + teleprompter optimizers*

**Distinctive pattern.** Define `Signature`s (typed `input -> output` declarations), compose them into `Module`s, and let a **teleprompter optimizer** automatically search for the best prompts and few-shot examples against a labeled training set and a metric.

**Why irreplaceable.** The only framework that treats prompts as a *compiled artifact* rather than a hand-tuned string. MIPROv2 / GEPA can lift a baseline `gpt-5.4-mini` zero-shot program from 41% to 63% F1 with no code changes. The signature is a stable interface across model swaps.

```python
import dspy
from dspy import Signature, InputField, OutputField, ChainOfThought, Predict, GEPA

class RAGAnswer(Signature):
    """Answer a question using the provided context."""
    context: list[str] = InputField()
    question: str = InputField()
    answer: str = OutputField()

class RAG(dspy.Module):
    def __init__(self, num_passages=3):
        self.retrieve = dspy.Retrieve(k=num_passages)
        self.generate = ChainOfThought(RAGAnswer)
    def forward(self, question):
        ctx = self.retrieve(question).passages
        return self.generate(context=ctx, question=question)

lm = dspy.LM("openai/gpt-5.4-nano")
dspy.configure(lm=lm)

rag = RAG()
# Compile against a metric
optimizer = GEPA(metric=dspy.metrics.SemanticF1(), auto="medium")
optimized = optimizer.compile(rag, trainset=trainset)
optimized.save("rag.v2.json")         # prompts are a saved artifact
```

**Trade-offs.** Optimization needs labeled data and a metric — non-trivial for open-ended tasks. The optimizer is opaque; debugging "why did the compiler pick this prompt" is hard. Some signatures don't optimize well.

---

### 11. Guidance (Microsoft) — *Token-level programming with CFG/regex constraints*

**Distinctive pattern.** A DSL where `gen()` calls can be constrained to a **regular expression** or **context-free grammar**, and where token generation is **fast-forwarded** when the next token is known deterministically (e.g., the closing `</h1>` tag). Generation and control flow (`if/else`, `for`, `@guidance`-decorated functions) interleave in one Python program.

**Why irreplaceable.** Only framework that lets you reason at the **token level** — skip the model when the answer is forced, hard-constrain output to a grammar, and read intermediate logits. Reduces latency and cost dramatically for structured outputs.

```python
from guidance import system, user, assistant, gen, select, guidance
from guidance.models import Transformers
from pydantic import BaseModel, Field

class BloodPressure(BaseModel):
    systolic: int = Field(gt=300, le=400)
    diastolic: int = Field(gt=0, le=20)
    location: str = Field(max_length=50)

lm = Transformers("microsoft/Phi-4-mini-instruct")
with system():
    lm += "You are a doctor taking a patient's blood pressure."
with user():
    lm += "Report the blood pressure."
with assistant():
    lm += gen_json(name="bp", schema=BloodPressure)  # grammar-constrained JSON

result = BloodPressure.model_validate_json(lm["bp"])
print(result.systolic, result.diastolic, result.location)
# Tokens like the closing `"systolic":` are fast-forwarded — no model call
```

**Trade-offs.** Tightly bound to specific backends (Transformers, llama.cpp, OpenAI; not every API supports it). DSL is an extra mental layer. Doesn't address tool selection, multi-agent, or memory.

---

### 12. Semantic Kernel (Microsoft) — *Enterprise .NET, function-calling planner*

**Distinctive pattern.** A `Kernel` is a DI container of `Plugin`s (groups of `[KernelFunction]`-decorated methods) and a **planner** that decomposes a goal into a sequence of function calls (`FunctionCallingStepwisePlanner`). Tight Azure / Microsoft 365 / Copilot Stack integration.

**Why irreplaceable.** The only enterprise-grade agent SDK in the .NET / C# world with first-class Microsoft Fabric, Microsoft Graph, and Azure AI integration. Function-calling model is reusable across AI connectors via the new v1.20+ abstraction.

```csharp
using Microsoft.SemanticKernel;
using Microsoft.SemanticKernel.Planning;

var builder = Kernel.CreateBuilder();
builder.AddAzureOpenAIChatCompletion("gpt-4o", endpoint, apiKey);

builder.Plugins.AddFromType<WeatherPlugin>();
builder.Plugins.AddFromType<TimePlugin>();

Kernel kernel = builder.Build();

// Stepwise planner: decomposes the goal into a sequence of function calls
var planner = new FunctionCallingStepwisePlanner();
var result = await planner.ExecuteAsync(kernel,
    "Check current UTC time and return current weather in Boston.");
Console.WriteLine(result.FinalAnswer);
// "The current UTC time is Sat, 06 Jul 2026 02:11:10 GMT and the weather in Boston is 61 and rainy."

// Or with auto function calling:
var settings = new OpenAIPromptExecutionSettings { ToolCallBehavior = ToolCallBehavior.AutoInvokeKernelFunctions };
var answer = await kernel.InvokePromptAsync("Check current UTC time and weather in Boston.", new(settings));
```

**Trade-offs.** The C#-first design is a non-starter for many data science teams. Historical planner variants were unreliable; the v1.20+ function-calling model is solid but new. Less vibrant ecosystem than LangChain.

---

### 13. Haystack (deepset) — *Directed-multigraph pipelines with typed joining*

**Distinctive pattern.** A `Pipeline` is a **directed multigraph of components** joined by implicit **type matching**: if component A outputs `{"documents": ...}` and B declares `documents` as a `InputSlot`, they're connected automatically. `ConditionalRouter` and loops enable self-correcting flows.

**Why irreplaceable.** The "smart connection" type-matching + explicit conditional routing is a sweet spot between rigid ETL DAGs and free-form graph runtimes. The `Agent` component integrates cleanly as *one* node in a larger retrieval+generation pipeline.

```python
from haystack import Pipeline
from haystack.components.routers import ConditionalRouter
from haystack.components.builders import PromptBuilder
from haystack.components.generators import OpenAIGenerator
from haystack.components.agents import Agent

routes = [
    {"condition": "{{query|length > 100}}", "output": "{{query}}",
     "output_name": "long_query", "output_type": str},
    {"condition": "{{query|length <= 100}}", "output": "{{query}}",
     "output_name": "short_query", "output_type": str},
]

pipe = Pipeline()
pipe.add_component("router", ConditionalRouter(routes))
pipe.add_component("long_prompt", PromptBuilder(template="Answer in detail: {{query}}"))
pipe.add_component("short_prompt", PromptBuilder(template="Answer briefly: {{query}}"))
pipe.add_component("gen", OpenAIGenerator(model="gpt-4o"))

# Smart connections: typed inputs are wired by name
pipe.connect("router.long_query", "long_prompt.query")
pipe.connect("router.short_query", "short_prompt.query")
pipe.connect("long_prompt", "gen")
pipe.connect("short_prompt", "gen")

result = pipe.run({"router": {"query": "What is quantum entanglement?"}})
```

**Trade-offs.** Multigraph mind-shift is a hurdle for users coming from linear chains. Self-correcting loops are powerful but can run unbounded without careful budget control. The agent component is a recent addition, not the focus.

---

### 14. Rivet (Ironclad) — *Visual graph editor + remote runtime*

**Distinctive pattern.** A **desktop GUI** for building prompt chains as drag-and-drop graphs (text, chat, prompt, code, vector-store, KNN nodes), plus a **remote runtime** that connects the running app to the GUI for live inspection. The TS core library (`@ironclad/rivet-core`) executes the graph in production.

**Why irreplaceable.** A "live debugger for agents" pattern: open the GUI, attach to a running process, watch tokens and node transitions in real time. No other framework treats the visual editor as a first-class runtime, not just a code generator.

```typescript
// rivet-core: a graph is data
import { project } from "@ironclad/rivet-core";

const graph = project.graphs[0];
const result = await project.runGraph(graph, {
  inputs: { userQuery: "What's the weather in Boston?" },
  external: { openai: openaiClient },
  onPartialOutputs: (partial) => console.log(partial),  // stream to UI
});
```

**Trade-offs.** Visual-first is a polarizing design; many engineers prefer code. Limited vector-store/LLM choices compared to LangChain. The Ironclad legal-contracts focus shaped many node types that don't transfer.

---

## Part 2 — Synthesis: Orthogonal Axes of Agent Design

After studying the 14 frameworks, **agent design is a multi-dimensional space**. I identify 10 orthogonal axes, each with a spectrum of choices, plus which frameworks sit where.

| # | Axis | Spectrum | Frameworks |
|---|---|---|---|
| **A1** | **State model** | stateless → checkpointed graph | Swarm (none) · CrewAI (implicit) · AutoGen (transcript) · LangGraph (typed state + checkpointer) · Haystack (component slots) · Mastra (workflow + rewind) |
| **A2** | **Control-flow shape** | linear → DAG → cyclic graph → conversation | LlamaIndex (workflow DAG) · Haystack (multigraph) · LangGraph (cyclic) · CrewAI (sequential/hierarchical) · Mastra (workflow) · AutoGen (group chat) |
| **A3** | **Agent granularity** | monolith → role-based team → atomic Lego | DSPy (module) · CrewAI (role+goal) · LangGraph (node) · Atomic Agents (input/output contract) |
| **A4** | **Tool-call style** | JSON blob → Python code → constrained grammar | LangGraph/CrewAI/Pydantic AI (JSON) · Smolagents (Python) · Guidance (regex/CFG/JSON-schema) |
| **A5** | **I/O contract** | string → Pydantic-typed → schema-chainable | Pydantic AI · Atomic Agents (Pydantic as the interface) |
| **A6** | **Prompt lifecycle** | hand-written → library → optimized/compiled | LangChain/LangGraph (templates) · DSPy (teleprompter compilation) |
| **A7** | **Handoff model** | none → function-return → graph edge → conversation speaker | none (most) · Swarm (return agent) · LangGraph (edge) · AutoGen (GroupChatManager) |
| **A8** | **Memory model** | stateless → chat history → checkpointer thread → vector store | Swarm · CrewAI · LangGraph + checkpointer · LlamaIndex (vector) |
| **A9** | **Determinism vs emergence** | scripted → hybrid → emergent | Haystack/Semantic Kernel · LangGraph/Mastra · CrewAI/AutoGen |
| **A10** | **Distribution target** | Python-only · TypeScript-only · language-portable | Python club · Mastra (TS) · Anvil opportunity (Go + polyglot plugins) |

### Complementary vs. Mutually Exclusive Patterns

**Strongly complementary (orthogonal — can be combined cleanly):**

- **A4 (tool-call style) + A5 (I/O contract):** Pydantic-typed + JSON or Guidance-grammar — pick one per tool.
- **A1 (state model) + A2 (control flow):** Any checkpointer can sit behind any DAG/graph engine.
- **A3 (granularity) + A7 (handoff):** Atomic units + handoff functions = pluggable specialists.
- **A6 (prompt lifecycle) + everything:** DSPy-style optimization is a *cross-cutting concern* that can layer over any architecture.
- **A10 + everything:** Language portability is a *deployment* concern, separable from semantics.

**Mutually exclusive (force you to pick one):**

- **A2 conversation vs cyclic graph:** AutoGen's group chat and LangGraph's cyclic graph represent *the same problem* — "who runs next?" — with opposing models. You either believe in a transcript or a typed state.
- **A4 JSON vs code-as-action:** A `CodeAgent` and a `ToolCallingAgent` use different action representations; mixing them in one turn is awkward.
- **A6 hand-tuned vs compiled prompts:** Once you compile with DSPy, hand-editing the prompt string is incoherent.
- **A9 scripted vs emergent:** A Haystack pipeline and a CrewAI crew are different postures toward the LLM — choose per task.

### What's Missing in *All* of Them — Anvil's Opportunity

1. **No language-portable meta-framework.** Every one of these is Python-only (or TS-only for Mastra). A Go-based engine with a small, well-typed **plugin protocol** (think gRPC or WebAssembly) could host patterns from any of them.

2. **No "compose the philosophy" layer.** Users who want CrewAI's role ergonomics *and* Smolagents' code-action *and* LangGraph's checkpointer must glue 3 frameworks. Anvil's *plugin architecture* can let users pick the role-assignment plugin, the action-representation plugin, and the persistence plugin independently.

3. **No cross-framework checkpointer standard.** LangGraph's checkpoint schema, AutoGen's transcript, and CrewAI's memory are all different. Anvil could define a **canonical run record** (thread ID, super-step, state snapshot, action, observation, tool call) that all plugins write to.

4. **No first-class observability for the pattern itself.** Most frameworks expose logs of LLM calls; few expose logs of *which pattern was exercised and why*. A meta-framework can surface that.

5. **No "pattern profiler."** DSPy has teleprompters; nobody has a profiler that says "your graph is doing 80% redundant LLM calls" or "your handoffs thrash — collapse two agents."

6. **Single-tenant execution model.** None of these treat an agent as a long-lived OS process with backpressure, signal handling, and graceful shutdown. Go's concurrency primitives give Anvil a natural home for this.

7. **Polyglot tools.** Tool calls are nearly always Python (in Python frameworks). A Go runtime can call tools written in any language via RPC/WASM without language lock-in.

---

## Part 3 — Design Implications for Anvil's Plugin Architecture

Translate the axes into concrete plugin boundaries. Each axis becomes a *plugin slot*; each framework's distinctive pattern becomes a *concrete implementation* a user can drop in.

### Core plugin slots (one per axis)

```go
// anvil/plugin.go — skeleton
type Plugin interface {
    Name() string
    Version() string
}

// A1: State backend — checkpointer, transcript, multigraph slots
type Checkpointer interface {
    Plugin
    Save(threadID string, step int, state []byte) (checkpointID string, err error)
    Load(threadID, checkpointID string) (state []byte, err error)
    List(threadID string) ([]CheckpointMeta, error)
}

// A2: Control-flow engine — graph, workflow, conversation
type Engine interface {
    Plugin
    Compile(spec EngineSpec) (Runnable, error)
}

// A3: Agent factory — role, atomic, monolithic
type AgentFactory interface {
    Plugin
    New(spec AgentSpec) (Agent, error)
}

// A4: Action representation — JSON tool call, code-as-action, grammar-constrained
type ActionCodec interface {
    Plugin
    Encode(tool string, args any) (Action, error)
    Decode(observation []byte) (any, error)
    Sandbox() Sandbox                // for code-action: returns E2B/Docker/etc.
}

// A5: I/O contract — Pydantic-style, JSON Schema, typed structs
type Contract interface {
    Plugin
    Validate(value any, schemaID string) error
    GenerateSchema(typ any) (schemaID string, jsonSchema []byte, err error)
}

// A6: Prompt lifecycle — templating, optimization, hand-tuning
type PromptCompiler interface {
    Plugin
    Compile(task Task, metric Metric, trainset []Example) (CompiledPrompt, error)
}

// A7: Handoff policy — return-an-agent, edge transition, group-chat manager
type HandoffPolicy interface {
    Plugin
    Decide(current Agent, message Message, peers []Agent) (next Agent, error)
}

// A8: Memory — chat history, vector store, thread, none
type Memory interface {
    Plugin
    Recall(ctx Context, query string, k int) ([]Document, error)
    Persist(ctx Context, doc Document) error
}

// A9: Determinism level — scripted, hybrid, emergent
type Posture interface {
    Plugin
    Score(state State) (determinism float64)   // used for routing/logging
}

// A10: Runtime — Go-native, polyglot RPC, WASM
type Runtime interface {
    Plugin
    Spawn(spec AgentSpec) (Process, error)
}
```

### Concrete plugin packs to ship (each maps to a framework pattern)

| Pack | Source framework | Implements slots |
|---|---|---|
| `anvil-langgraph-compat` | LangGraph | `Checkpointer` (Postgres/SQLite/Redis backends), `Engine` (cyclic graph) |
| `anvil-swarm-handoffs` | OpenAI Swarm | `HandoffPolicy` (return-an-agent) |
| `anvil-creator` | CrewAI | `AgentFactory` (role+goal+backstory), `HandoffPolicy` (delegation) |
| `anvil-conversation` | AutoGen | `Engine` (group-chat), `HandoffPolicy` (manager) |
| `anvil-typed` | Pydantic AI | `Contract` (Pydantic schema validation) |
| `anvil-atomic` | Atomic Agents | `AgentFactory` (input/output schema chainable) |
| `anvil-rag` | LlamaIndex / Haystack | `Memory` (vector), `Engine` (typed multigraph) |
| `anvil-workflow` | Mastra | `Engine` (suspend/resume/rewind workflow) |
| `anvil-code-agent` | Smolagents | `ActionCodec` (Python code action + sandbox) |
| `anvil-grammar` | Guidance | `ActionCodec` (regex/CFG/JSON-schema) |
| `anvil-teleprompter` | DSPy | `PromptCompiler` (MIPRO/GEPA-style) |
| `anvil-visual` | Rivet | Standalone desktop app that reads Anvil graph specs |

### What the *core* must provide (the irreducible meta-framework)

1. **A canonical run record** — `Run{ThreadID, Step, StateRef, Action, Observation, Cost, Tokens, Latency}`. Every plugin writes here. Tools like `anvil replay` and `anvil inspect` work across patterns.
2. **A gRPC/WASM plugin contract** so the core stays small and users can implement any slot in any language.
3. **Built-in backpressure, signal handling, and graceful shutdown** — Go's strengths applied to long-lived agents.
4. **A posture router** — let the user declare "this branch is emergent, that branch is scripted" and have Anvil pick engines accordingly.
5. **First-class observability** — OpenTelemetry spans for *plugin decisions*, not just LLM calls.
6. **A "pattern profiler"** CLI that diffs two runs and reports which plugin slots behaved differently (e.g., "you switched handoffs from `swarm` to `creator` and latency rose 30%").

### Anti-recommendations — what NOT to bake in

- **Don't pick a control-flow default.** Ships the *empty* engine; user picks LangGraph / Haystack / Mastra style.
- **Don't pick a state schema.** The contract is just `[]byte` plus a typed adapter per checkpointer.
- **Don't pick an action representation.** JSON, code, and grammar are *all* first-class via `ActionCodec`.
- **Don't ship a teleprompter in core.** Cross-cutting; it's a `PromptCompiler` like any other.
- **Don't try to be a UI.** Leave visualization to Rivet-style companion tools that read your graph spec.

### Reference architecture (a "best-of-breed" user story)

A user building a research assistant might combine:

- `anvil-creator` for the *role-based agent* (researcher / writer / critic)
- `anvil-typed` for *I/O contracts* on every tool (Pydantic schemas)
- `anvil-code-agent` for the *data-analysis agent* (Python REPL)
- `anvil-workflow` for the *outer orchestration* (suspend on human approval, rewind to retry)
- `anvil-langgraph-compat` for the *checkpointer* (Postgres for prod)
- `anvil-rag` for *vector memory*
- `anvil-teleprompter` for *optimizing the critic's prompt* once a labeled eval set exists

Every one of these is a plugin. None of them is a framework lock-in. That's the meta-framework promise.

---

## Appendix — One-Line Pattern Summary

| Framework | One-line pattern |
|---|---|
| LangGraph | Cyclic state graph + checkpointer + time-travel |
| CrewAI | Role+goal+backstory agents with `allow_delegation` |
| AutoGen | Multi-agent *conversation* arbitrated by a `GroupChatManager` |
| Pydantic AI | Agents that *return Pydantic models*, not strings |
| LlamaIndex | RAG-first `@step` workflow over the richest data-connector library |
| Mastra | LangGraph-style workflow + rewind, *natively TypeScript* |
| Smolagents | Code-as-action: model emits Python, not JSON |
| OpenAI Swarm | Stateless handoffs: return-an-agent-as-tool-value |
| Atomic Agents | Atomic units with chained I/O Pydantic schemas |
| DSPy | Signatures + teleprompter compilers that *optimize prompts* |
| Guidance | Token-level CFG/regex-constrained generation in a Python DSL |
| Semantic Kernel | Enterprise .NET `Kernel` + `FunctionCallingStepwisePlanner` |
| Haystack | Directed multigraph pipelines with *typed-slot* smart connections |
| Rivet | Visual graph editor + remote-debuggable runtime |
| **Anvil** | **Meta-framework: pick a plugin for every axis** |
