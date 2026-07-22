package plugin

import (
	"context"
	"errors"
	"testing"

	"github.com/hamdisoudani/anvil/internal/core"
)

type testVectorStore struct{}

func (testVectorStore) Upsert(context.Context, string, []float32, map[string]interface{}) error {
	return nil
}
func (testVectorStore) Query(ctx context.Context, embedding []float32, topK int) ([]VectorHit, error) {
	return nil, nil
}

type testExecutor struct{}

func (testExecutor) Run(context.Context, string) (string, error) {
	return "ok", nil
}

type dummyToolSource struct{}

func (dummyToolSource) Tools() []Tool          { return nil }
func (dummyToolSource) Refresh(context.Context) error { return nil }

type dummySubAgentCoord struct{}

func (dummySubAgentCoord) Dispatch(ctx context.Context, sess *core.Session, role string, task string) (core.SubAgentHandle, error) {
	return nil, nil
}
func (dummySubAgentCoord) Await(ctx context.Context, h core.SubAgentHandle) (core.SubAgentResult, error) {
	return core.SubAgentResult{}, nil
}

type dummySpeculation struct{}

func (dummySpeculation) Plan(ctx context.Context, s StateView) ([]Plan, error) {
	return nil, nil
}
func (dummySpeculation) Resolve(results []Plan) Plan {
	return Plan{}
}

func init() {
	// Initialize the function pointers so calling options doesn't panic on nil dereference
	NewMCPSource = func(endpoint string) ToolSource {
		return dummyToolSource{}
	}
	NewCrewCoord = func() SubAgentCoord {
		return dummySubAgentCoord{}
	}
	NewGroupChat = func() SubAgentCoord {
		return dummySubAgentCoord{}
	}
	NewCodeExecTools = func(sandbox Executor) ToolSource {
		return dummyToolSource{}
	}
	NewSpeculator = func() Speculation {
		return dummySpeculation{}
	}
}

func TestCheckpointDefaultsAndAlways(t *testing.T) {
	p, ok := NewStepCheckpoint(0).(*StepCheckpoint)
	if !ok || p.Every != 5 {
		t.Fatalf("default=%#v", p)
	}
	a, ok := NewAlwaysCheckpoint().(*AlwaysCheckpoint)
	if !ok || !a.ShouldCheckpoint(0, 100, Event{}) {
		t.Fatalf("always=%#v", a)
	}
}

func TestRecoveryPolicies(t *testing.T) {
	r, ok := NewReflectiveRecovery(0).(*ReflectiveRecovery)
	if !ok || r.MaxRetries != 3 {
		t.Fatalf("reflective=%#v", r)
	}
	action, err := r.OnError(context.Background(), errors.New("x"), StateView{Step: 15})
	if err != nil || action != RecoveryReflect {
		t.Fatalf("step15 action=%v err=%v", action, err)
	}
	action, err = r.OnError(context.Background(), errors.New("x"), StateView{Step: 16})
	if err != nil || action != RecoveryStop {
		t.Fatalf("step16 action=%v err=%v", action, err)
	}

	h, ok := NewHumanInTheLoop().(*HumanInTheLoop)
	if !ok || h.Threshold != "destructive" {
		t.Fatalf("human=%#v", h)
	}
	action, err = h.OnError(context.Background(), errors.New("x"), StateView{})
	if err != nil || action != RecoveryHumanLoop {
		t.Fatalf("human action=%v err=%v", action, err)
	}

	f, ok := NewFailFast().(*FailFast)
	if !ok {
		t.Fatal("failfast wrong type")
	}
	action, err = f.OnError(context.Background(), errors.New("x"), StateView{})
	if err != nil || action != RecoveryStop {
		t.Fatalf("failfast action=%v err=%v", action, err)
	}
}

func TestOptionsPopulateConfig(t *testing.T) {
	cfg := &Config{}
	llm := core.NewStubLLMRouter("answer")
	WithLLM(llm)(cfg)
	if cfg.LLM != llm {
		t.Error("LLM not set")
	}
	WithMCP("http://localhost:1234")(cfg)
	if cfg.Tools == nil {
		t.Error("MCP tools nil")
	}
	WithRAGMemory(testVectorStore{})(cfg)
	if cfg.Memory == nil {
		t.Error("RAG memory nil")
	}
	WithAGUI()(cfg)
	if cfg.Streamer == nil {
		t.Error("streamer nil")
	}
	WithCrewStyle()(cfg)
	if cfg.SubAgents == nil {
		t.Error("crew nil")
	}
	WithGroupChat()(cfg)
	if cfg.SubAgents == nil {
		t.Error("group nil")
	}
	WithHumanInTheLoop()(cfg)
	if cfg.Recovery == nil {
		t.Error("recovery nil")
	}
	WithCodeExecution(testExecutor{})(cfg)
	if cfg.Tools == nil {
		t.Error("code tools nil")
	}
	WithSpeculation()(cfg)
	if cfg.Speculation == nil {
		t.Error("speculation nil")
	}
}
