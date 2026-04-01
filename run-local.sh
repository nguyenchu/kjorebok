#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCAL_NODE_DIR="$(find "$ROOT_DIR/.tools" -maxdepth 1 -type d -name 'node-*' | head -n 1 || true)"

if [[ -n "$LOCAL_NODE_DIR" && -x "$LOCAL_NODE_DIR/bin/node" ]]; then
  export PATH="$LOCAL_NODE_DIR/bin:$PATH"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Fant ikke Node.js."
  echo "Installer Node 22+ eller legg en lokal runtime i .tools/."
  exit 1
fi

if ! command -v corepack >/dev/null 2>&1; then
  echo "Fant ikke corepack."
  echo "Node-installasjonen ma inkludere corepack for a kjore pnpm."
  exit 1
fi

pnpm_cmd() {
  corepack pnpm "$@"
}

cleanup() {
  trap - EXIT INT TERM
  [[ -n "${API_PID:-}" ]] && kill "$API_PID" 2>/dev/null || true
  [[ -n "${WEB_PID:-}" ]] && kill "$WEB_PID" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

echo "Starter API pa http://localhost:3020"
pnpm_cmd --filter @kjorebok/api exec node --import tsx src/index.ts &
API_PID=$!

echo "Starter web pa http://localhost:3021"
pnpm_cmd --filter @kjorebok/web dev &
WEB_PID=$!

echo "Begge prosessene er startet. Trykk Ctrl+C for a stoppe."

wait "$API_PID" "$WEB_PID"
