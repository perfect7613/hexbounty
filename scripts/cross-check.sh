#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
COUNT=$(find "$ROOT/vectors" -name '*.expected' -type f | wc -l | tr -d ' ')

echo "HexBounty evidence cross-language check"
echo "Python: running $COUNT shared vectors plus unit tests"
if command -v uv >/dev/null 2>&1; then
  uv run --project "$ROOT/python" --extra test pytest -q "$ROOT/python/tests"
else
  echo "error: uv is required for the reproducible Python test environment" >&2
  exit 1
fi

echo "TypeScript: running $COUNT shared vectors plus unit tests"
if [ ! -x "$ROOT/js/node_modules/.bin/vitest" ]; then
  npm --prefix "$ROOT/js" ci --silent
fi
npm --prefix "$ROOT/js" test -- --reporter=dot
npm --prefix "$ROOT/js" run build --silent

echo "PASS: Python and TypeScript matched all $COUNT shared vectors byte-for-byte."
