#!/usr/bin/env bash
set -euo pipefail

npm run build

node dist/cli.js https://example.com --quiet >/tmp/mdurl-example.md
node dist/cli.js https://example.com --json --quiet >/tmp/mdurl-example.json
node dist/cli.js https://news.ycombinator.com --include-links --quiet >/tmp/mdurl-hn.md
node dist/cli.js https://github.com --max-bytes 2000 --quiet >/tmp/mdurl-github.md

echo "Smoke outputs written to /tmp/mdurl-*.md and /tmp/mdurl-example.json"
