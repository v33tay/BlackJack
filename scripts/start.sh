#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

PORT="${PORT:-3000}"
HOST="${HOST:-0.0.0.0}"
export PORT HOST

if [ ! -d node_modules/ws ]; then
  echo "Installing dependencies..."
  npm install
fi

echo "Starting BlackJack server..."
node src/server/index.js
