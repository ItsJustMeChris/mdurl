#!/usr/bin/env bash
set -euo pipefail

npm run build

out_dir="${TMPDIR:-/tmp}/mdurl-smoke"
mkdir -p "$out_dir"

node dist/cli.js https://example.com --quiet >"$out_dir/example.md"
node dist/cli.js https://example.com --json --quiet >"$out_dir/example.json"
node dist/cli.js https://news.ycombinator.com --include-links --quiet >"$out_dir/hn.md"
node dist/cli.js https://github.com --max-bytes 2000 --quiet >"$out_dir/github.md"

node dist/cli.js https://www.nasa.gov/feed/ --max-bytes 2500 --quiet >"$out_dir/feed.md"
grep -q "content_kind: feed" "$out_dir/feed.md"

node dist/cli.js https://www.tutorialspoint.com/rss/pdf/rss-feed-formats.pdf --max-bytes 2500 --quiet >"$out_dir/pdf.md"
grep -q "content_kind: pdf" "$out_dir/pdf.md"
grep -q "page_count:" "$out_dir/pdf.md"

node dist/cli.js https://api.github.com/repos/octocat/Hello-World --max-bytes 2000 --quiet >"$out_dir/json.md"
grep -q "content_kind: json" "$out_dir/json.md"

node dist/cli.js https://www.google.com/robots.txt --max-bytes 1200 --quiet >"$out_dir/text.md"
grep -q "content_kind: text" "$out_dir/text.md"

node dist/cli.js https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch --section "Making a request" --max-bytes 1800 --quiet >"$out_dir/section.md"
grep -q "section_found: true" "$out_dir/section.md"

echo "Smoke outputs written to $out_dir"
