import type { DocumentMetadata, PageResources, StructuredDataItem } from '../types.js';

export function renderJsonEnvelope(
  metadata: DocumentMetadata,
  markdown: string,
  resources?: PageResources,
  structuredData?: StructuredDataItem[],
): string {
  return `${JSON.stringify({ ...metadata, markdown, resources, structured_data: structuredData }, null, 2)}\n`;
}
