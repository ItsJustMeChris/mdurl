#!/usr/bin/env bash
set -euo pipefail

bun run build:bun

out_dir="${TMPDIR:-/tmp}/mdurl-bun-smoke"
mkdir -p "$out_dir"

bun src/cli.ts https://example.com --quiet --no-resources --no-structured-data --no-transcripts >"$out_dir/bun-runtime.md"
grep -q "render_mode: http" "$out_dir/bun-runtime.md"
grep -q "# Example Domain" "$out_dir/bun-runtime.md"

dist/mdurl-bun https://example.com --quiet --no-resources --no-structured-data --no-transcripts >"$out_dir/compiled-html.md"
grep -q "render_mode: http" "$out_dir/compiled-html.md"
grep -q "# Example Domain" "$out_dir/compiled-html.md"

dist/mdurl-bun https://example.com --js --quiet --no-resources --no-structured-data --no-transcripts >"$out_dir/compiled-js.md"
grep -q "render_mode: js" "$out_dir/compiled-js.md"

dist/mdurl-bun https://api.github.com/repos/octocat/Hello-World --max-bytes 1200 --quiet >"$out_dir/compiled-json.md"
grep -q "content_kind: json" "$out_dir/compiled-json.md"

dist/mdurl-bun https://www.tutorialspoint.com/rss/pdf/rss-feed-formats.pdf --max-bytes 1200 --quiet >"$out_dir/compiled-pdf.md"
grep -q "content_kind: pdf" "$out_dir/compiled-pdf.md"
grep -q "page_count:" "$out_dir/compiled-pdf.md"

echo "Bun smoke outputs written to $out_dir"
