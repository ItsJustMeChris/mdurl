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
---

# Example Domain
```

## Usage

```sh
mdurl <url> [options]
mdurl install-browser
mdurl --version
mdurl --help
```

### Fetching

| Flag | Default | Description |
|---|---:|---|
| `--timeout <ms>` | `30000` | Request timeout. |
| `-H, --header <k:v>` | | Extra request header; repeatable. |
| `--cookie <str>` | | Single `Cookie` header value. |
| `--user-agent <str>` | modern Chrome UA | User-Agent header. |
| `--max-redirects <n>` | `5` | Redirect limit. |
| `--referer <url>` | | Referer header. |

### Rendering

`mdurl` tries plain HTTP first. If the response looks like a sparse SPA shell, it falls back to headless browser rendering.

| Flag | Description |
|---|---|
| `--js` | Force browser rendering. |
| `--no-js` | Disable automatic browser fallback. |
| `--wait-selector <css>` | Wait for a selector in browser mode before extracting. |
| `--wait-ms <n>` | Extra settle delay after browser network idle. |
| `--browser-path <path>` | Override Chrome/Chromium executable path. |

`mdurl` uses `playwright-core`, so Chromium is not downloaded during npm install. Install it only when needed:

```sh
mdurl install-browser
```

### Extraction

| Flag | Description |
|---|---|
| `--full` | Skip Readability and keep a cleaned full body. |
| `--selector <css>` | Extract only a matching element subtree. |
| `--include-links` | Append an extracted-content `## Links` table. |
| `--no-resources` | Omit the default `## Page Resources` links/images section. |
| `--no-structured-data` | Omit the default `## Structured Data` section. |
| `--max-bytes <n>` | Truncate markdown with a `[truncated]` marker. |

By default, `mdurl` appends a compact `## Structured Data` section when the page includes JSON-LD. This is useful on recipe, product, event, article, FAQ, Q&A, and local-business pages where the HTML may be noisy but the embedded schema contains concise facts such as ingredients, instructions, questions, answers, offers, ratings, authors, dates, and canonical images.

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

By default, `mdurl` appends a `## Page Resources` section built from the full fetched page, even when the main markdown body is extracted with Readability. This section includes navigation/header/footer links, linked images, logos, favicons, Open Graph images, lazy-loaded `data-src`/`data-srcset` images, responsive `<picture>` sources, and other image URLs that are useful for agents that need to follow the page or retrieve assets.

Example:

```markdown
## Page Resources

### Links

| # | Context | Text | URL |
|---:|---|---|---|
| 1 | navigation | Menu | https://example.com/menu/ |

### Images

| # | Context | Label | URL | Linked URL |
|---:|---|---|---|---|
| 1 | header/logo | [logo] Site logo | https://example.com/logo.png | https://example.com/ |
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

## Error Contract

Failures keep the same output shape. The frontmatter or JSON envelope includes `status` and `error`, followed by an empty markdown body.

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
