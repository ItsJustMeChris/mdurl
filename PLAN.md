# Plan: `mdurl` — agent-friendly markdown fetcher

## Context

`mdurl` is a brand-new CLI: a `curl`-shaped tool that takes a URL and emits the page as clean markdown instead of raw HTML, designed to be the default "read a webpage" primitive for coding agents and other LLM tools. The repo is empty (`.git` only), so this plan covers the full initial build.

Three product decisions are already locked in from the user:

1. **Runtime** — Node.js, distributed via npm (so agents can run `npx mdurl <url>` with zero install).
2. **JS rendering** — Smart default: try a plain HTTP fetch first, auto-fall-back to a headless browser if the response looks like an SPA shell. `--js` / `--no-js` override.
3. **Default output** — Markdown body with a small YAML frontmatter block (`url`, `title`, `fetched_at`, `status`, `render_mode`, `word_count`, …). `--json` flag offered as an envelope alternative.

The goal is output that's optimized for agent consumption: stable structure, predictable metadata, absolute links, minimal boilerplate, and a well-defined error envelope.

## Stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript, Node >= 20 | Native `fetch`, ESM, type safety. |
| CLI parsing | `commander` | Light, mature, ergonomic subcommand support. |
| HTTP fetch | Built-in `fetch` + `undici` redirects | Zero extra deps for the fast path. |
| Headless browser | `playwright-core` (lazy-loaded) | First-class JS rendering. `-core` skips the ~150 MB chromium download by default; we ship an `mdurl install-browser` subcommand and also auto-detect system Chrome. Keeps `npx mdurl` cheap when the page doesn't need JS. |
| DOM parsing | `linkedom` | ~10× lighter than `jsdom`; documented to work with Readability. |
| Main-content extraction | `@mozilla/readability` | Battle-tested. `--full` flag skips it. |
| HTML → Markdown | `turndown` + `turndown-plugin-gfm` | Handles tables, strikethrough, task lists; extensible rules. |
| YAML | `yaml` | Frontmatter emission. |
| Tests | `vitest` + local HTML fixtures | Fast, ESM-native. |
| Build | `tsup` | Single command → `dist/cli.js` with shebang, sourcemaps. |

Decision worth confirming during review: **`playwright-core` (no bundled chromium) vs full `playwright` (auto-downloads chromium on `npm install`).** I'm recommending `playwright-core` so `npx mdurl https://example.com` stays a few-MB download for the common case, with an explicit `mdurl install-browser` step for users who hit JS-rendered pages. Trade-off: first SPA fetch on a fresh machine fails with a clear "run `mdurl install-browser`" message rather than Just Working.

## Project layout

```
mdurl/
├── package.json              # bin: { mdurl: "./dist/cli.js" }, type: "module"
├── tsconfig.json
├── tsup.config.ts
├── README.md                 # usage, flags, agent recipes
├── .gitignore                # dist/, node_modules/
├── src/
│   ├── cli.ts                # commander setup, subcommands, orchestration
│   ├── pipeline.ts           # fetch → extract → convert → emit
│   ├── fetch/
│   │   ├── plain.ts          # native fetch w/ redirect tracking, headers, cookies
│   │   ├── browser.ts        # playwright-core, lazy import, wait strategies
│   │   └── detectSpa.ts      # heuristic deciding whether to fall back
│   ├── extract/
│   │   ├── readability.ts    # linkedom + Readability wrapper
│   │   └── clean.ts          # strip nav/aside/scripts/hidden when --full
│   ├── convert/
│   │   ├── markdown.ts       # turndown setup + gfm plugin + custom rules
│   │   └── links.ts          # absolute-URL rewrite, link-table builder
│   ├── output/
│   │   ├── frontmatter.ts    # YAML emission
│   │   └── envelope.ts       # JSON-mode emission
│   ├── installBrowser.ts     # `mdurl install-browser` subcommand
│   ├── errors.ts             # typed error class + exit-code mapping
│   └── types.ts
├── tests/
│   ├── fixtures/
│   │   ├── static.html
│   │   ├── gfm-tables.html
│   │   ├── spa-shell.html
│   │   └── redirects/
│   ├── detectSpa.test.ts
│   ├── markdown.test.ts
│   ├── frontmatter.test.ts
│   ├── links.test.ts
│   └── pipeline.e2e.test.ts  # end-to-end against local http server
└── bin/                      # not needed; tsup writes dist/cli.js with shebang
```

## Pipeline

```
parse args
  → plain fetch (native fetch, follow redirects, capture chain, status, headers)
    → if --no-js: skip detection
    → else: detectSpa(html, response) — visible-text length, empty mount nodes,
            <noscript>js-required</noscript> markers, scripts:body-text ratio
       → if SPA-shell or --js: lazy-import playwright-core, render
  → linkedom.parseHTML
  → if --selector <css>: scope to that element
    elif --full: clean.ts strips nav/aside/script/style/hidden
    else: Readability.parse() (fallback to clean+full if Readability returns null)
  → turndown(html) with GFM + custom rules
  → links.ts: rewrite relative → absolute against final URL
  → optional: append "## Links" table if --include-links
  → optional: truncate to --max-bytes with explicit `[truncated]` marker
  → emit frontmatter + body to stdout (or JSON envelope if --json)
```

## CLI surface

```
mdurl <url> [options]
mdurl install-browser           # downloads chromium for playwright-core
mdurl --version | --help

Fetching:
  --timeout <ms>          default 30000
  -H, --header <k:v>      repeatable
  --cookie <str>          single Cookie header value
  --user-agent <str>      default: modern Chrome UA string
  --max-redirects <n>     default 5
  --referer <url>

Rendering:
  --js                    force headless browser
  --no-js                 force plain HTTP only
  --wait-selector <css>   wait for selector before extracting (browser mode)
  --wait-ms <n>           extra settle delay after networkidle
  --browser-path <path>   override Chrome/Chromium binary location

Extraction:
  --full                  skip Readability, keep cleaned full body
  --selector <css>        only extract matching element subtree
  --include-links         append a "## Links" table
  --max-bytes <n>         truncate body with [truncated] marker

Output:
  --json                  emit JSON envelope instead of frontmatter+md
  --no-frontmatter        markdown body only
  -o, --output <file>     write to file instead of stdout
  --quiet                 suppress stderr progress lines
```

## Frontmatter schema

```yaml
---
url: <final URL after redirects>
original_url: <only if different from url>
title: <string>
fetched_at: <ISO 8601 UTC>
status: <int>
render_mode: http | js
elapsed_ms: <int>
word_count: <int>
content_type: <string>
lang: <string, if detected>
redirect_chain: [<url>, ...]   # only if redirects > 0
truncated: <bool>              # only if true
error: <string>                # only on failure
---
```

## Error / exit-code contract

Even on failure, mdurl emits a frontmatter block with `status` and `error` populated, followed by an empty body. Agents can parse the same shape on success or failure.

| Exit | Meaning |
|---|---|
| 0 | HTTP 2xx, body produced |
| 1 | HTTP non-2xx |
| 2 | Timeout |
| 3 | Network / DNS / TLS |
| 4 | Parse / internal error |
| 5 | Browser unavailable (and `--js` was forced or SPA detected) — message points at `mdurl install-browser` |

## SPA-detection heuristic (`detectSpa.ts`)

Apply after plain fetch; any single signal triggers fallback unless `--no-js`:

- Visible body text (text content excluding `<script>`/`<style>`) < 250 chars **and** `<script>` count ≥ 3.
- Common SPA mount nodes (`#root`, `#app`, `[data-reactroot]`, `#__next`) exist and are empty / contain only whitespace.
- A `<noscript>` element contains text matching `/javascript|enable JS/i`.
- Readability returns `null` or an article whose text is < 200 chars while the `<head>` advertises an article (`og:type=article` or `<title>` non-empty).

Heuristic is unit-tested via fixtures so we can tune thresholds without regressions.

## Implementation phases

1. **Scaffold** — `package.json` (`bin`, `type: module`, scripts), `tsconfig`, `tsup` config, `.gitignore`, commander skeleton with `--version` / `--help`. Verifies `npx .` runs.
2. **Plain HTTP happy path** — `fetch/plain.ts`, `extract/readability.ts` (linkedom + Readability), `convert/markdown.ts` (turndown + GFM), `output/frontmatter.ts`. End-to-end: `mdurl https://example.com` produces frontmatter + "Example Domain" heading.
3. **SPA detection + browser fallback** — `detectSpa.ts`, `fetch/browser.ts` lazy-importing `playwright-core`, `installBrowser.ts` subcommand. `--js` / `--no-js` overrides. Surface clear error 5 if chromium isn't installed.
4. **Agent polish flags** — headers/cookies/UA/referer/redirects, `--full`, `--selector`, `--include-links`, `--json`, `--no-frontmatter`, `--max-bytes`, `--output`, `--quiet`. Error envelope semantics + exit codes.
5. **Tests** — vitest with fixtures (static page, GFM tables, SPA shell, redirect chain) and a local http-server based e2e test for the plain-fetch path. Mock `playwright-core` for the JS-mode test (don't require chromium in CI).
6. **Docs & DX** — README with `npx mdurl <url>` quickstart, full flag table, agent-recipe examples (e.g., "fetch and pipe into another tool", "use `--json` for structured access", "force JS for known SPAs"). Add a `scripts/smoke.sh` running mdurl against ~5 known URL types for manual sanity-checking.

## Files to create (summary)

- `package.json`, `tsconfig.json`, `tsup.config.ts`, `.gitignore`, `README.md`
- `src/cli.ts`, `src/pipeline.ts`, `src/types.ts`, `src/errors.ts`, `src/installBrowser.ts`
- `src/fetch/{plain,browser,detectSpa}.ts`
- `src/extract/{readability,clean}.ts`
- `src/convert/{markdown,links}.ts`
- `src/output/{frontmatter,envelope}.ts`
- `tests/**` with fixtures

No existing utilities to reuse — repo is empty.

## Verification

After phase 2 (HTTP path) — manual:
```
npm run build
node dist/cli.js https://example.com
# → frontmatter (status: 200, render_mode: http) + "# Example Domain" body
node dist/cli.js https://news.ycombinator.com --include-links
# → render_mode: http, story list as markdown, link table appended
```

After phase 3 (browser fallback) — manual:
```
node dist/cli.js install-browser
node dist/cli.js https://<a-known-CSR-SPA>
# → render_mode: js, real content (not the empty mount-node shell)
node dist/cli.js https://<same-SPA> --no-js
# → render_mode: http, body mostly empty, frontmatter still well-formed
```

After phase 4:
```
node dist/cli.js https://example.com --json | jq .
# → valid JSON envelope with markdown field
node dist/cli.js https://httpstat.us/500
# → exit code 1, frontmatter has status: 500, error populated, empty body
node dist/cli.js https://example.com --max-bytes 100
# → body ends with "[truncated]" marker, frontmatter truncated: true
```

Automated:
```
npm test          # vitest unit + e2e (local http-server)
npm run typecheck # tsc --noEmit
```

CI gate before publishing v0.1: all of the above pass, plus a manual smoke run against a representative list of pages (static blog, doc site with GFM tables, news aggregator, CSR SPA, page behind redirects).
