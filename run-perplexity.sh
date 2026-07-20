#!/bin/bash
# Launcher for the Perplexity server in production mode.
# Reads keys from /home/dinzab/.hermes/.env and local .env file.
set -a
source /home/dinzab/.hermes/.env
if [ -f /home/dinzab/anvil/.env ]; then
  source /home/dinzab/anvil/.env
fi
set +a

# LLM — uses GROQ_API_KEY from .env
export OPENAI_API_KEY="${GROQ_API_KEY:-$OPENAI_API_KEY}"
export OPENAI_BASE_URL="https://api.groq.com/openai/v1"
export OPENAI_MODEL="openai/gpt-oss-120b"

cd /home/dinzab/anvil
exec /tmp/perplexity-server
