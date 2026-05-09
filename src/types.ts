export type RenderMode = 'http' | 'js';

export type JsMode = 'auto' | 'force' | 'disabled';

export interface HeaderPair {
  name: string;
  value: string;
}

export interface CliOptions {
  timeoutMs: number;
  headers: HeaderPair[];
  cookie?: string;
  userAgent: string;
  maxRedirects: number;
  referer?: string;
  jsMode: JsMode;
  waitSelector?: string;
  waitMs: number;
  browserPath?: string;
  full: boolean;
  selector?: string;
  includeLinks: boolean;
  resources: boolean;
  structuredData: boolean;
  maxBytes?: number;
  json: boolean;
  frontmatter: boolean;
  output?: string;
  quiet: boolean;
}

export interface PlainFetchOptions {
  timeoutMs: number;
  headers: HeaderPair[];
  cookie?: string;
  userAgent: string;
  maxRedirects: number;
  referer?: string;
}

export interface BrowserFetchOptions extends PlainFetchOptions {
  waitSelector?: string;
  waitMs: number;
  browserPath?: string;
}

export interface FetchResult {
  originalUrl: string;
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  contentType?: string;
  html: string;
  redirectChain: string[];
  elapsedMs: number;
  renderMode: RenderMode;
}

export interface SpaDetectionResult {
  isSpa: boolean;
  reasons: string[];
}

export interface ExtractedContent {
  title?: string;
  lang?: string;
  html: string;
  textContent: string;
}

export interface LinkReference {
  index: number;
  text: string;
  url: string;
}

export interface PageLinkReference extends LinkReference {
  context: string;
}

export interface PageImageReference {
  index: number;
  context: string;
  label: string;
  url: string;
  linked_url?: string;
  source: 'img' | 'srcset' | 'data' | 'source' | 'icon' | 'meta' | 'style';
}

export interface PageResources {
  links: PageLinkReference[];
  images: PageImageReference[];
}

export interface StructuredDataItem {
  index: number;
  type: string;
  name?: string;
  description?: string;
  url?: string;
  images?: string[];
  authors?: string[];
  date_published?: string;
  date_modified?: string;
  recipe_yield?: string;
  prep_time?: string;
  cook_time?: string;
  total_time?: string;
  recipe_category?: string[];
  recipe_cuisine?: string[];
  ingredients?: string[];
  instructions?: string[];
  questions?: StructuredDataQuestion[];
  rating?: string;
  offers?: string[];
}

export interface StructuredDataQuestion {
  question: string;
  answer?: string;
  url?: string;
}

export interface MarkdownResult {
  markdown: string;
  links: LinkReference[];
}

export interface DocumentMetadata {
  url: string;
  original_url?: string;
  title?: string;
  fetched_at: string;
  status: number;
  render_mode: RenderMode;
  elapsed_ms: number;
  word_count: number;
  content_type?: string;
  lang?: string;
  link_count?: number;
  image_count?: number;
  structured_data_count?: number;
  redirect_chain?: string[];
  truncated?: boolean;
  error?: string;
}

export interface PipelineSuccess {
  ok: true;
  metadata: DocumentMetadata;
  markdown: string;
  resources: PageResources;
  structuredData: StructuredDataItem[];
  exitCode: 0;
}

export interface PipelineFailure {
  ok: false;
  metadata: DocumentMetadata;
  markdown: '';
  resources: PageResources;
  structuredData: StructuredDataItem[];
  exitCode: number;
}

export type PipelineResult = PipelineSuccess | PipelineFailure;
