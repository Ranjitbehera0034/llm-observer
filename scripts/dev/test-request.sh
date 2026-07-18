#!/bin/bash

# Simple test script to verify LLM Observer Proxy
# Usage: ./test-request.sh <YOUR_OPENAI_API_KEY>

API_KEY=$1

if [ -z "$API_KEY" ]; then
  echo "Usage: ./test-request.sh <OPENAI_API_KEY>"
  exit 1
fi

echo "🚀 Sending request to LLM Observer Proxy (localhost:4000)..."

curl -X POST http://localhost:4000/v1/openai/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello! Just testing the proxy plumbing."}
    ]
  }'

echo -e "\n\n✅ Request sent. Checking database..."
sleep 2 # Wait for async logger to flush

DB_PATH=~/.llm-observer/data.db
if [ -f "$DB_PATH" ]; then
  sqlite3 "$DB_PATH" "SELECT id, model, prompt_tokens, completion_tokens, cost_usd FROM requests ORDER BY created_at DESC LIMIT 1;"
else
  echo "❌ Database not found at $DB_PATH"
fi
