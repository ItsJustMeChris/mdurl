import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import type { FetchResult, SpaDetectionResult } from '../types.js';

const EMPTY_MOUNT_SELECTORS = ['#root', '#app', '[data-reactroot]', '#__next'];

export function detectSpa(result: Pick<FetchResult, 'html' | 'status'>): SpaDetectionResult {
  if (!result.html.trim()) {
    return { isSpa: false, reasons: [] };
  }

  const { document } = parseHTML(result.html);
  const reasons: string[] = [];
  const visibleText = visibleBodyText(document);
  const scriptCount = document.querySelectorAll('script').length;

  if (visibleText.length < 250 && scriptCount >= 3) {
    reasons.push('short visible text with multiple scripts');
  }

  for (const selector of EMPTY_MOUNT_SELECTORS) {
    const node = document.querySelector(selector);
    if (node && (node.textContent ?? '').trim().length === 0) {
      reasons.push(`empty SPA mount node ${selector}`);
      break;
    }
  }

  const noscriptText = Array.from(document.querySelectorAll('noscript'))
    .map((node) => node.textContent ?? '')
    .join(' ');
  if (/javascript|enable JS/i.test(noscriptText)) {
    reasons.push('noscript asks for JavaScript');
  }

  if (headAdvertisesArticle(document)) {
    const clone = document.cloneNode(true) as Document;
    const article = new Readability(clone).parse();
    const articleTextLength = (article?.textContent ?? '').trim().length;

    if ((!article || articleTextLength < 200) && hasClientRenderHints(document, visibleText, scriptCount)) {
      reasons.push('article metadata with little readable content');
    }
  }

  return {
    isSpa: reasons.length > 0,
    reasons,
  };
}

function visibleBodyText(document: Document): string {
  const body = document.body;
  if (!body) {
    return '';
  }

  const clone = body.cloneNode(true) as HTMLElement;
  for (const node of Array.from(clone.querySelectorAll('script, style, noscript, template'))) {
    node.remove();
  }

  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function headAdvertisesArticle(document: Document): boolean {
  const ogType = document.querySelector('meta[property="og:type"], meta[name="og:type"]')?.getAttribute('content');
  const title = document.querySelector('title')?.textContent?.trim();
  return ogType === 'article' || Boolean(title);
}

function hasClientRenderHints(document: Document, visibleText: string, scriptCount: number): boolean {
  return scriptCount > 0 || visibleText.length === 0 || EMPTY_MOUNT_SELECTORS.some((selector) => Boolean(document.querySelector(selector)));
}
