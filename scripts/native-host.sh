#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="$(command -v node || echo "/usr/bin/node")"

if [ -f "$DIR/scripts/native-host.mjs" ]; then
  exec "$NODE_BIN" "$DIR/scripts/native-host.mjs" "$@"
else
  exec "$NODE_BIN" "$DIR/node_modules/tsx/dist/cli.mjs" "$DIR/scripts/native-host.ts" "$@"
fi
