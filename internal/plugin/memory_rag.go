package plugin

import "context"

// InMemoryVectorStore is a tiny vector store for testing RAG memory.
// Real implementations: pgvector, Qdrant, Redis vector search, Pinecone.
type InMemoryVectorStore struct {
	vectors map[string][]float32
}

// NewInMemoryVectorStore returns an in-memory store.
func NewInMemoryVectorStore() *InMemoryVectorStore {
	return &InMemoryVectorStore{vectors: make(map[string][]float32)}
}

// Upsert stores an embedding.
func (s *InMemoryVectorStore) Upsert(ctx context.Context, id string, embedding []float32, metadata map[string]interface{}) error {
	s.vectors[id] = embedding
	return nil
}

// Query returns the top-K most similar vectors (by cosine similarity).
func (s *InMemoryVectorStore) Query(ctx context.Context, embedding []float32, topK int) ([]VectorHit, error) {
	type scored struct {
		id    string
		score float32
	}
	var all []scored
	for id, v := range s.vectors {
		all = append(all, scored{id: id, score: cosine(v, embedding)})
	}
	// Sort by score desc (simple bubble for small N)
	for i := 0; i < len(all); i++ {
		for j := i + 1; j < len(all); j++ {
			if all[j].score > all[i].score {
				all[i], all[j] = all[j], all[i]
			}
		}
	}
	if topK > len(all) {
		topK = len(all)
	}
	out := make([]VectorHit, topK)
	for i := 0; i < topK; i++ {
		out[i] = VectorHit{ID: all[i].id, Score: all[i].score}
	}
	return out, nil
}

func cosine(a, b []float32) float32 {
	if len(a) != len(b) {
		return 0
	}
	var dot, na, nb float32
	for i := range a {
		dot += a[i] * b[i]
		na += a[i] * a[i]
		nb += b[i] * b[i]
	}
	if na == 0 || nb == 0 {
		return 0
	}
	return dot / (sqrt(na) * sqrt(nb))
}

func sqrt(x float32) float32 {
	// Newton's method, good enough
	z := x / 2
	for i := 0; i < 10; i++ {
		z = (z + x/z) / 2
	}
	return z
}

// RAGMemory is a Memory implementation backed by a vector store.
// Stores every observation, retrieves the top-K most relevant on each step.
type RAGMemory struct {
	store VectorStore
}

// NewRAGMemory creates a RAG-backed memory.
func NewRAGMemory(store VectorStore) Memory {
	return &RAGMemory{store: store}
}

// Recall returns relevant past observations (stub — real impl embeds the
// current state and queries the vector store).
func (r *RAGMemory) Recall(ctx context.Context, s StateView) (string, error) {
	// Real impl: embed s.History[-1].Content, query store, format hits
	return "[RAG] no past observations yet", nil
}

// Remember upserts an observation.
func (r *RAGMemory) Remember(ctx context.Context, s StateView, key string, value interface{}) error {
	// Real impl: embed key+value, call store.Upsert
	return nil
}

// LongTerm returns the summarized long-term history.
func (r *RAGMemory) LongTerm(ctx context.Context, s StateView) (string, error) {
	return "", nil
}

// Compile-time checks
var (
	_ VectorStore = (*InMemoryVectorStore)(nil)
	_ Memory      = (*RAGMemory)(nil)
)

var _ = context.Background
