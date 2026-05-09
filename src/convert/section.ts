export interface SectionSelection {
  markdown: string;
  found: boolean;
}

interface HeadingMatch {
  index: number;
  lineEnd: number;
  level: number;
  text: string;
}

export function selectMarkdownSection(markdown: string, query: string | undefined): SectionSelection {
  const normalizedQuery = normalizeHeading(query ?? '');
  if (!normalizedQuery) {
    return { markdown, found: false };
  }

  const headings = markdownHeadings(markdown);
  const heading =
    headings.find((candidate) => normalizeHeading(candidate.text) === normalizedQuery) ??
    headings.find((candidate) => normalizeHeading(candidate.text).includes(normalizedQuery));

  if (!heading) {
    return { markdown, found: false };
  }

  const next = headings.find((candidate) => candidate.index > heading.index && candidate.level <= heading.level);
  return {
    markdown: `${markdown.slice(heading.index, next?.index).trimEnd()}\n`,
    found: true,
  };
}

function markdownHeadings(markdown: string): HeadingMatch[] {
  const headings: HeadingMatch[] = [];
  const pattern = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(markdown))) {
    headings.push({
      index: match.index,
      lineEnd: pattern.lastIndex,
      level: match[1].length,
      text: match[2],
    });
  }

  return headings;
}

function normalizeHeading(value: string): string {
  return value
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
