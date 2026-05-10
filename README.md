# mdurl

`mdurl` is a curl-shaped CLI that fetches a webpage and emits clean markdown with small, predictable metadata. It is designed as a default "read a webpage" primitive for coding agents and other LLM tools.

```sh
npx mdurl https://example.com
```

Default output is a YAML frontmatter block followed by markdown:

```markdown
---
url: https://example.com/
title: Example Domain
fetched_at: 2026-05-09T00:00:00.000Z
status: 200
render_mode: http
elapsed_ms: 120
word_count: 21
content_type: text/html
content_kind: html
byte_count: 1256
description: A concise page summary from meta tags
site_name: Example
canonical_url: https://example.com/
---

# Example Domain
```

## Usage

```sh
mdurl <url> [options]
mdurl <url1> <url2> [options]
mdurl install-browser
mdurl --version
mdurl --help
```

When multiple URLs are provided, mdurl fetches them concurrently while preserving output order. Markdown/frontmatter outputs are concatenated with `<!-- mdurl-next-url -->` separators. With `--json`, output is a JSON array of envelopes. In browser mode, batched URLs reuse one Chromium session.

### Fetching

Plain HTTP fetches retry transient `429`/`5xx` responses and request timeouts with short backoff. Manual redirects preserve `Set-Cookie` values for the next hop. `--cache <dir>` enables an on-disk cache that stores successful HTTP responses and revalidates with `If-None-Match` / `If-Modified-Since` when possible. `--archive-fallback` tries the latest Wayback Machine snapshot after a 4xx response.

| Flag | Default | Description |
|---|---:|---|
| `--timeout <ms>` | `30000` | Request timeout. |
| `-H, --header <k:v>` | | Extra request header; repeatable. |
| `--cookie <str>` | | Single `Cookie` header value. |
| `--bearer <token>` | | Bearer token for the `Authorization` header. |
| `--user-agent <str>` | modern Chrome UA | User-Agent header. |
| `--max-redirects <n>` | `5` | Redirect limit. |
| `--referer <url>` | | Referer header. |
| `--cache <dir>` | | Enable on-disk HTTP cache in a directory. |
| `--archive-fallback` | | Try the latest Wayback Machine snapshot after a 4xx response. |
| `--concurrency <n>` | `4` | Maximum URLs to fetch at once. |

### Rendering

`mdurl` tries plain HTTP first. If the response looks like a sparse SPA shell, it falls back to headless browser rendering. Browser mode waits for `domcontentloaded`, then uses a short DOM-stability settle unless `--wait-selector` is provided. To keep extraction fast, browser mode skips downloading images, media, and fonts by default while still preserving their DOM URLs for markdown resource tables.

| Flag | Description |
|---|---|
| `--js` | Force browser rendering. |
| `--no-js` | Disable automatic browser fallback. |
| `--wait-selector <css>` | Wait for a selector in browser mode before extracting. |
| `--settle-ms <n>` | Maximum DOM-stability wait after browser rendering. Defaults to `800`. |
| `--wait-ms <n>` | Extra settle delay after browser rendering. |
| `--browser-path <path>` | Override Chrome/Chromium executable path. |
| `--load-assets` | Allow browser mode to fetch images, media, and fonts. |

`mdurl` uses `playwright-core`, so Chromium is not downloaded during npm install. Install it only when needed:

```sh
mdurl install-browser
```

### Extraction

| Flag | Description |
|---|---|
| `--full` | Skip Readability and keep a cleaned full body. |
| `--selector <css>` | Extract only a matching element subtree. |
| `--section <heading>` | Emit only the rendered markdown section matching a heading. |
| `--include-links` | Append an extracted-content `## Links` table. |
| `--no-resources` | Omit the default `## Page Resources` section. |
| `--no-structured-data` | Omit the default `## Structured Data` section. |
| `--no-transcripts` | Omit default video transcript extraction. |
| `--max-bytes <n>` | Truncate markdown with a `[truncated]` marker. |

HTML pages use Readability plus a cleaned full-page resource inventory. Non-HTML responses are handled before the HTML pipeline so agents do not receive binary or XML as mangled article text:

| Content | Output |
|---|---|
| PDF | Extracted page text, PDF title when available, `content_kind: pdf`, `page_count`, and `byte_count`. |
| RSS/Atom | Feed title, description, site link, and recent entries as markdown. |
| Sitemap XML | URL lists with last-modified dates when present. |
| JSON | Pretty-printed fenced `json` block. |
| XML | Fenced `xml` block unless it is recognized as a feed. |
| Plain text | Text body with source metadata. |
| Image/audio/video/binary | Markdown resource stub with source URL and content type. |

By default, `mdurl` appends a compact `## Structured Data` section when the page includes JSON-LD. This is useful on recipe, product, event, article, FAQ, Q&A, and local-business pages where the HTML may be noisy but the embedded schema contains concise facts such as ingredients, instructions, questions, answers, event dates, venues, performers, offers, ratings, authors, dates, and canonical images.

When a YouTube-style player response exposes caption tracks, `mdurl` fetches an available caption track and appends it as a timestamped `## Transcript` section.

Example:

```markdown
## Structured Data

### 1. Recipe: Banana Banana Bread

- **Description:** A moist banana bread recipe.
- **Author:** Shelley Albeluhn
- **Yield:** 1 9x5-inch loaf
- **Total time:** PT1H15M

**Ingredients:**

- 2 cups all-purpose flour
- 1 teaspoon baking soda

**Instructions:**

1. Preheat oven to 350 degrees F.
2. Mix ingredients and bake.

**Questions:**

1. **Can I freeze banana bread?**
   Yes. Wrap it tightly and freeze for up to 3 months.
```

By default, `mdurl` appends a `## Page Resources` section built from the full fetched page, even when the main markdown body is extracted with Readability. This section includes a heading table of contents, pagination links, navigation/header/footer links, linked images, logos, favicons, Open Graph images, lazy-loaded `data-src`/`data-srcset` images, responsive `<picture>` sources, forms, and embedded iframe/video/audio URLs that are useful for agents that need to follow the page, retrieve assets, or understand available page actions.

Example:

```markdown
## Page Resources

### Table of Contents

| # | Level | Text | URL |
|---:|---:|---|---|
| 1 | 1 | Menu | https://example.com/menu/#menu |

### Navigation

| # | Area | Text | URL |
|---:|---|---|---|
| 1 | navigation | Menu | https://example.com/menu/ |

### Pagination

| # | Rel | Text | URL |
|---:|---|---|---|
| 1 | next | Next page | https://example.com/menu/page/2 |

### Links

| # | Context | Text | URL |
|---:|---|---|---|
| 1 | navigation | Menu | https://example.com/menu/ |

### Images

| # | Context | Label | Source | URL | Linked URL |
|---:|---|---|---|---|---|
| 1 | header/logo | [logo] Site logo | img | https://example.com/logo.png | https://example.com/ |
```

### Output

| Flag | Description |
|---|---|
| `--json` | Emit a JSON envelope with `markdown`. |
| `--no-frontmatter` | Emit markdown body only. |
| `-o, --output <file>` | Write to a file instead of stdout. |
| `--quiet` | Suppress stderr progress lines. |

## Agent Recipes

Fetch a page and pipe it into another tool:

```sh
mdurl https://example.com | your-agent
```

Use structured access:

```sh
mdurl https://example.com --json | jq '.title, .markdown'
```

Retrieve page assets from structured JSON:

```sh
mdurl https://example.com --json | jq '.resources.images[] | select(.label | test("logo"; "i"))'
```

Inspect recipe or product schema:

```sh
mdurl https://example.com/recipe --json | jq '.structured_data[] | {type, name, ingredients, offers}'
```

Force JavaScript rendering for a known client-side app:

```sh
mdurl https://app.example.com --js
```

Limit context size:

```sh
mdurl https://example.com/long-article --max-bytes 20000
```

Fetch only one heading range from long documentation:

```sh
mdurl https://example.com/docs --section Installation
```

## Error Contract

Failures keep the same output shape. The frontmatter or JSON envelope includes `status` and `error`, followed by an empty markdown body. When mdurl detects an access barrier, metadata also includes `access_status` with `bot_challenge`, `paywall`, or `login_wall`.

| Exit | Meaning |
|---:|---|
| `0` | HTTP 2xx, body produced. |
| `1` | HTTP non-2xx. |
| `2` | Timeout. |
| `3` | Network / DNS / TLS. |
| `4` | Parse / internal error. |
| `5` | Browser unavailable. |

## Development

```sh
npm install
npm test
npm run typecheck
npm run build
```

Manual smoke checks:

```sh
npm run smoke
```
