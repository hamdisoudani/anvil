#!/bin/bash
# Launcher for the Perplexity server in production mode.
# Reads keys from /home/dinzab/.hermes/.env.
set -a
source /home/dinzab/.hermes/.env
set +a

export OPENAI_API_KEY="$CKEY_API_KEY"
export OPENAI_BASE_URL="https://ckey.vn/v1"
export OPENAI_MODEL="deepseek-v4-flash-free"

cd /home/dinzab/anvil
exec /tmp/perplexity-server
