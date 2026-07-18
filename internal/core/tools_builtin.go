package core

import (
	"context"
	"fmt"
)

// Builtin tool: a calculator. Demonstrates the Tool interface.
type CalculatorTool struct{}

func (t *CalculatorTool) Name() string { return "calculator" }
func (t *CalculatorTool) Description() string {
	return "Evaluate a basic arithmetic expression like '2 + 2 * 3'. Returns the result as a number."
}
func (t *CalculatorTool) Schema() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"expression": map[string]interface{}{
				"type":        "string",
				"description": "The expression to evaluate, e.g. '2 + 2 * 3'",
			},
		},
		"required": []string{"expression"},
	}
}
func (t *CalculatorTool) Execute(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	expr, ok := args["expression"].(string)
	if !ok {
		return nil, fmt.Errorf("expression must be a string")
	}
	return eval(expr)
}

// Tiny expression evaluator. Real impl would use a proper math parser.
func eval(expr string) (float64, error) {
	// Lazy: only handles two-operand expressions for the demo.
	// In real code, use a real parser or shell out to python.
	var a, b float64
	var op byte
	n, err := fmt.Sscanf(expr, "%f %c %f", &a, &op, &b)
	if n != 3 || err != nil {
		return 0, fmt.Errorf("unsupported expression: %s", expr)
	}
	switch op {
	case '+':
		return a + b, nil
	case '-':
		return a - b, nil
	case '*':
		return a * b, nil
	case '/':
		if b == 0 {
			return 0, fmt.Errorf("divide by zero")
		}
		return a / b, nil
	}
	return 0, fmt.Errorf("unknown operator: %c", op)
}

// DefaultTools returns the built-in toolset.
func DefaultTools() map[string]Tool {
	return map[string]Tool{
		"calculator": &CalculatorTool{},
	}
}
