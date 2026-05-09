export type RenderMode = 'http' | 'js';

export type JsMode = 'auto' | 'force' | 'disabled';

export type ContentKind = 'html' | 'pdf' | 'feed' | 'json' | 'xml' | 'text' | 'image' | 'media' | 'binary';

export type AccessStatus = 'bot_challenge' | 'paywall' | 'login_wall';

export interface HeaderPair {
  name: string;
  value: string;
}

export interface CliOptions {
  timeoutMs: number;
  headers: HeaderPair[];
  cookie?: string;
  bearer?: string;
  userAgent: string;
  maxRedirects: number;
  referer?: string;
  jsMode: JsMode;
  waitSelector?: string;
  waitMs: number;
  browserPath?: string;
  full: boolean;
  selector?: string;
  section?: string;
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
  bearer?: string;
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
  body?: Uint8Array;
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

export interface PageHeadingReference {
  index: number;
  level: number;
  text: string;
  url?: string;
}

export interface PageImageReference {
  index: number;
  context: string;
  label: string;
  url: string;
  linked_url?: string;
  source: 'img' | 'srcset' | 'data' | 'source' | 'icon' | 'meta' | 'style';
}

export interface PageFormReference {
  index: number;
  context: string;
  label: string;
  action: string;
  method: string;
  fields: PageFormField[];
  buttons: string[];
}

export interface PageFormField {
  name?: string;
  type: string;
  label?: string;
  required?: boolean;
  placeholder?: string;
  value?: string;
  options?: string[];
}

export interface PageEmbedReference {
  index: number;
  context: string;
  label: string;
  url: string;
  type: 'iframe' | 'embed' | 'object' | 'video' | 'audio';
  width?: string;
  height?: string;
}

export interface PageResources {
  headings: PageHeadingReference[];
  links: PageLinkReference[];
  images: PageImageReference[];
  forms: PageFormReference[];
  embeds: PageEmbedReference[];
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
  start_date?: string;
  end_date?: string;
  previous_start_date?: string;
  event_status?: string;
  attendance_mode?: string;
  location?: string;
  organizers?: string[];
  performers?: string[];
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
  description?: string;
  site_name?: string;
  canonical_url?: string;
  fetched_at: string;
  status: number;
  render_mode: RenderMode;
  elapsed_ms: number;
  word_count: number;
  content_type?: string;
  content_kind?: ContentKind;
  byte_count?: number;
  page_count?: number;
  section?: string;
  section_found?: boolean;
  access_status?: AccessStatus;
  lang?: string;
  link_count?: number;
  heading_count?: number;
  image_count?: number;
  form_count?: number;
  embed_count?: number;
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
