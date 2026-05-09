import type { DocumentMetadata, PageResources } from '../types.js';

export function renderJsonEnvelope(metadata: DocumentMetadata, markdown: string, resources?: PageResources): string {
  return `${JSON.stringify({ ...metadata, markdown, resources }, null, 2)}\n`;
}
