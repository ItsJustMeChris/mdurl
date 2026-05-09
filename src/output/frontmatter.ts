import YAML from 'yaml';
import type { DocumentMetadata } from '../types.js';

export function renderFrontmatter(metadata: DocumentMetadata, markdown: string): string {
  const yaml = YAML.stringify(metadata, {
    sortMapEntries: false,
    lineWidth: 0,
  }).trimEnd();

  return `---\n${yaml}\n---\n\n${markdown}`;
}
