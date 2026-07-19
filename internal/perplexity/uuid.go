package perplexity

import "github.com/google/uuid"

// uuidNew returns a new UUID string. Centralized so we can swap
// implementations (e.g. ULID, Snowflake) without touching the rest.
func uuidNew() string {
	return uuid.NewString()
}
