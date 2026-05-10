import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Command, InvalidArgumentError } from 'commander';
import type { BrowserSession, CliOptions, HeaderPair, JsMode, PipelineResult, SearchEngine } from './types.js';

type FormatResult = typeof import('./pipeline.js').formatResult;
type JsonEnvelopeObject = typeof import('./output/envelope.js').jsonEnvelopeObject;

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 mdurl/0.1.0';

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('mdurl')
    .description('Fetch a webpage or web search and emit clean markdown for agents.')
    .version('0.1.0')
    .enablePositionalOptions()
    .argument('[urls...]', 'URL(s) to fetch');

  addCommonOptions(program)
    .action(async (urls: string[], rawOptions: RawCommandOptions) => {
      if (urls.length === 0) {
        program.help({ error: true });
        return;
      }

      await runUrlCommand(urls, rawOptions);
    });

  const searchCommand = addCommonOptions(
    program
      .command('search')
      .description('Search the web and emit cleaned search results.')
      .argument('<terms...>', 'search query terms')
      .option('--engine <name>', 'search engine: google, bing, or duckduckgo', 'google'),
  );

  searchCommand.action(async (terms: string[], rawOptions: RawCommandOptions) => {
    const query = terms.join(' ').trim();
    if (!query) {
      searchCommand.help({ error: true });
      return;
    }

    await runSearchCommand(query, rawOptions);
  });

  program
    .command('install-browser')
    .description('Download Chromium for Playwright browser rendering.')
    .action(async () => {
      const { installBrowser } = await import('./installBrowser.js');
      await installBrowser();
    });

  return program;
}

function addCommonOptions(command: Command): Command {
  return command
    .option('--timeout <ms>', 'request timeout in milliseconds', parsePositiveInteger, 30_000)
    .option('-H, --header <k:v>', 'extra request header; repeatable', collectHeader, [])
    .option('--cookie <str>', 'Cookie header value')
    .option('--bearer <token>', 'Bearer token for the Authorization header')
    .option('--user-agent <str>', 'User-Agent header value', DEFAULT_USER_AGENT)
    .option('--max-redirects <n>', 'maximum redirects to follow', parseNonNegativeInteger, 5)
    .option('--referer <url>', 'Referer header value')
    .option('--cache <dir>', 'enable on-disk HTTP cache in a directory')
    .option('--archive-fallback', 'try the latest Wayback Machine snapshot after a 4xx response')
    .option('--concurrency <n>', 'maximum URLs to fetch at once', parsePositiveInteger, 4)
    .option('--js', 'force headless browser rendering')
    .option('--no-js', 'disable automatic browser fallback')
    .option('--wait-selector <css>', 'wait for a selector before extracting in browser mode')
    .option('--settle-ms <n>', 'maximum DOM stability wait after browser rendering', parseNonNegativeInteger, 800)
    .option('--wait-ms <n>', 'extra settle delay after browser rendering', parseNonNegativeInteger, 0)
    .option('--browser-path <path>', 'Chrome/Chromium executable path')
    .option('--load-assets', 'allow browser mode to fetch images, media, and fonts')
    .option('--full', 'skip Readability and keep cleaned full body')
    .option('--selector <css>', 'extract only a matching element subtree')
    .option('--section <heading>', 'emit only the rendered markdown section matching a heading')
    .option('--include-links', 'append an extracted-content Links table')
    .option('--no-resources', 'omit the default Page Resources section')
    .option('--no-structured-data', 'omit the default Structured Data section')
    .option('--no-transcripts', 'omit default video transcript extraction')
    .option('--max-bytes <n>', 'truncate markdown to this many bytes', parsePositiveInteger)
    .option('--json', 'emit a JSON envelope')
    .option('--no-frontmatter', 'emit markdown body only')
    .option('-o, --output <file>', 'write output to a file')
    .option('--quiet', 'suppress stderr progress lines');
}

async function runUrlCommand(urls: string[], rawOptions: RawCommandOptions): Promise<void> {
  const options = normalizeOptions(rawOptions);
  const [{ createBrowserSession }, { formatResult, runPipeline, writeResult }, { jsonEnvelopeObject }] =
    await Promise.all([import('./fetch/browser.js'), import('./pipeline.js'), import('./output/envelope.js')]);
  let browserSession: BrowserSession | undefined;
  let browserSessionPromise: Promise<BrowserSession> | undefined;

  if (urls.length > 1 && options.jsMode !== 'disabled') {
    options.getBrowserSession = async () => {
      browserSessionPromise ??= createBrowserSession(options).then((session) => {
        browserSession = session;
        return session;
      });
      return browserSessionPromise;
    };
  }

  let results: PipelineResult[] = [];

  try {
    results = await mapConcurrent(urls, rawOptions.concurrency, (url) => runPipeline(url, options));
  } finally {
    await browserSession?.close();
  }

  await emitCliResults(results, options, formatResult, jsonEnvelopeObject, writeResult);
}

async function runSearchCommand(query: string, rawOptions: RawCommandOptions): Promise<void> {
  const options = normalizeOptions(rawOptions);
  const [{ formatResult, runSearchPipeline, writeResult }, { jsonEnvelopeObject }] = await Promise.all([
    import('./pipeline.js'),
    import('./output/envelope.js'),
  ]);
  const results = [await runSearchPipeline(query, options)];

  await emitCliResults(results, options, formatResult, jsonEnvelopeObject, writeResult);
}

async function emitCliResults(
  results: PipelineResult[],
  options: CliOptions,
  formatResult: FormatResult,
  jsonEnvelopeObject: JsonEnvelopeObject,
  writeResult: typeof import('./pipeline.js').writeResult,
): Promise<void> {
  const output = formatCliResults(results, options, formatResult, jsonEnvelopeObject);
  await writeResult(output, options);

  if (!options.quiet && !options.output) {
    for (const result of results) {
      if (!result.ok) {
        process.stderr.write(`mdurl: ${result.metadata.url}: ${result.metadata.error}\n`);
      }
    }
  }

  process.exitCode = Math.max(...results.map((result) => result.exitCode));
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

export async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= items.length) {
        return;
      }

      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));

  return results;
}

function formatCliResults(
  results: PipelineResult[],
  options: CliOptions,
  formatResult: FormatResult,
  jsonEnvelopeObject: JsonEnvelopeObject,
): string {
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
  engine?: string;
  timeout: number;
  header: HeaderPair[];
  cookie?: string;
  bearer?: string;
  userAgent: string;
  maxRedirects: number;
  referer?: string;
  cache?: string;
  archiveFallback?: boolean;
  concurrency: number;
  js?: boolean;
  waitSelector?: string;
  settleMs: number;
  waitMs: number;
  browserPath?: string;
  loadAssets?: boolean;
  full?: boolean;
  selector?: string;
  section?: string;
  includeLinks?: boolean;
  resources?: boolean;
  structuredData?: boolean;
  transcripts?: boolean;
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
    cacheDir: raw.cache,
    archiveFallback: Boolean(raw.archiveFallback),
    jsMode: normalizeJsMode(raw),
    waitSelector: raw.waitSelector,
    settleMs: raw.settleMs,
    waitMs: raw.waitMs,
    browserPath: raw.browserPath,
    loadAssets: Boolean(raw.loadAssets),
    searchEngine: normalizeSearchEngine(raw.engine ?? 'google'),
    full: Boolean(raw.full),
    selector: raw.selector,
    section: raw.section,
    includeLinks: Boolean(raw.includeLinks),
    resources: raw.resources !== false,
    structuredData: raw.structuredData !== false,
    transcripts: raw.transcripts !== false,
    maxBytes: raw.maxBytes,
    json: Boolean(raw.json),
    frontmatter: raw.frontmatter !== false,
    output: raw.output,
    quiet: Boolean(raw.quiet),
  };
}

function normalizeSearchEngine(value: string): SearchEngine {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'google' || normalized === 'g') {
    return 'google';
  }

  if (normalized === 'bing' || normalized === 'b') {
    return 'bing';
  }

  if (normalized === 'duckduckgo' || normalized === 'duckduckgo.com' || normalized === 'duck' || normalized === 'ddg') {
    return 'duckduckgo';
  }

  throw new InvalidArgumentError('Expected search engine: google, bing, or duckduckgo');
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
