import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Command, InvalidArgumentError } from 'commander';
import { installBrowser } from './installBrowser.js';
import { formatResult, runPipeline, writeResult } from './pipeline.js';
import { jsonEnvelopeObject } from './output/envelope.js';
import type { CliOptions, HeaderPair, JsMode, PipelineResult } from './types.js';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 mdurl/0.1.0';

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('mdurl')
    .description('Fetch a webpage and emit clean markdown for agents.')
    .version('0.1.0')
    .argument('[urls...]', 'URL(s) to fetch')
    .option('--timeout <ms>', 'request timeout in milliseconds', parsePositiveInteger, 30_000)
    .option('-H, --header <k:v>', 'extra request header; repeatable', collectHeader, [])
    .option('--cookie <str>', 'Cookie header value')
    .option('--bearer <token>', 'Bearer token for the Authorization header')
    .option('--user-agent <str>', 'User-Agent header value', DEFAULT_USER_AGENT)
    .option('--max-redirects <n>', 'maximum redirects to follow', parseNonNegativeInteger, 5)
    .option('--referer <url>', 'Referer header value')
    .option('--js', 'force headless browser rendering')
    .option('--no-js', 'disable automatic browser fallback')
    .option('--wait-selector <css>', 'wait for a selector before extracting in browser mode')
    .option('--wait-ms <n>', 'extra settle delay after browser networkidle', parseNonNegativeInteger, 0)
    .option('--browser-path <path>', 'Chrome/Chromium executable path')
    .option('--full', 'skip Readability and keep cleaned full body')
    .option('--selector <css>', 'extract only a matching element subtree')
    .option('--section <heading>', 'emit only the rendered markdown section matching a heading')
    .option('--include-links', 'append an extracted-content Links table')
    .option('--no-resources', 'omit the default Page Resources section')
    .option('--no-structured-data', 'omit the default Structured Data section')
    .option('--max-bytes <n>', 'truncate markdown to this many bytes', parsePositiveInteger)
    .option('--json', 'emit a JSON envelope')
    .option('--no-frontmatter', 'emit markdown body only')
    .option('-o, --output <file>', 'write output to a file')
    .option('--quiet', 'suppress stderr progress lines')
    .action(async (urls: string[], rawOptions: RawCommandOptions) => {
      if (urls.length === 0) {
        program.help({ error: true });
        return;
      }

      const options = normalizeOptions(rawOptions);
      const results: PipelineResult[] = [];

      for (const url of urls) {
        results.push(await runPipeline(url, options));
      }

      const output = formatCliResults(results, options);
      await writeResult(output, options);

      if (!options.quiet && !options.output) {
        for (const result of results) {
          if (!result.ok) {
            process.stderr.write(`mdurl: ${result.metadata.url}: ${result.metadata.error}\n`);
          }
        }
      }

      process.exitCode = Math.max(...results.map((result) => result.exitCode));
    });

  program
    .command('install-browser')
    .description('Download Chromium for Playwright browser rendering.')
    .action(async () => {
      await installBrowser();
    });

  return program;
}

export async function main(argv = process.argv): Promise<void> {
  const program = buildProgram();

  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof Error) {
      process.stderr.write(`mdurl: ${error.message}\n`);
      process.exitCode = 4;
      return;
    }

    throw error;
  }
}

function formatCliResults(results: PipelineResult[], options: CliOptions): string {
  if (results.length === 1) {
    return formatResult(results[0], options);
  }

  if (options.json) {
    return `${JSON.stringify(
      results.map((result) =>
        jsonEnvelopeObject(result.metadata, result.markdown, result.resources, result.structuredData),
      ),
      null,
      2,
    )}\n`;
  }

  return results.map((result) => formatResult(result, options).trimEnd()).join('\n\n<!-- mdurl-next-url -->\n\n');
}

interface RawCommandOptions {
  timeout: number;
  header: HeaderPair[];
  cookie?: string;
  bearer?: string;
  userAgent: string;
  maxRedirects: number;
  referer?: string;
  js?: boolean;
  waitSelector?: string;
  waitMs: number;
  browserPath?: string;
  full?: boolean;
  selector?: string;
  section?: string;
  includeLinks?: boolean;
  resources?: boolean;
  structuredData?: boolean;
  maxBytes?: number;
  json?: boolean;
  frontmatter?: boolean;
  output?: string;
  quiet?: boolean;
}

function normalizeOptions(raw: RawCommandOptions): CliOptions {
  return {
    timeoutMs: raw.timeout,
    headers: raw.header ?? [],
    cookie: raw.cookie,
    bearer: raw.bearer,
    userAgent: raw.userAgent,
    maxRedirects: raw.maxRedirects,
    referer: raw.referer,
    jsMode: normalizeJsMode(raw),
    waitSelector: raw.waitSelector,
    waitMs: raw.waitMs,
    browserPath: raw.browserPath,
    full: Boolean(raw.full),
    selector: raw.selector,
    section: raw.section,
    includeLinks: Boolean(raw.includeLinks),
    resources: raw.resources !== false,
    structuredData: raw.structuredData !== false,
    maxBytes: raw.maxBytes,
    json: Boolean(raw.json),
    frontmatter: raw.frontmatter !== false,
    output: raw.output,
    quiet: Boolean(raw.quiet),
  };
}

function normalizeJsMode(raw: RawCommandOptions): JsMode {
  if (raw.js === true) {
    return 'force';
  }

  if (raw.js === false) {
    return 'disabled';
  }

  return 'auto';
}

function parsePositiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError('Expected a positive integer');
  }
  return parsed;
}

function parseNonNegativeInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new InvalidArgumentError('Expected a non-negative integer');
  }
  return parsed;
}

function collectHeader(value: string, previous: HeaderPair[]): HeaderPair[] {
  const separator = value.indexOf(':');
  if (separator <= 0) {
    throw new InvalidArgumentError('Headers must use k:v format');
  }

  return [
    ...previous,
    {
      name: value.slice(0, separator).trim(),
      value: value.slice(separator + 1).trim(),
    },
  ];
}

if (isEntrypoint()) {
  void main();
}

function isEntrypoint(): boolean {
  if (!process.argv[1]) {
    return false;
  }

  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return fileURLToPath(import.meta.url) === process.argv[1];
  }
}
