import type { DocumentMetadata, PageResources, StructuredDataItem } from '../types.js';

export function renderJsonEnvelope(
  metadata: DocumentMetadata,
  markdown: string,
  resources?: PageResources,
  structuredData?: StructuredDataItem[],
): string {
  return `${JSON.stringify(jsonEnvelopeObject(metadata, markdown, resources, structuredData), null, 2)}\n`;
}

export function jsonEnvelopeObject(
  metadata: DocumentMetadata,
  markdown: string,
  resources?: PageResources,
  structuredData?: StructuredDataItem[],
): Record<string, unknown> {
  return { ...metadata, markdown, resources, structured_data: structuredData };
}
