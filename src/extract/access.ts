import { parseHTML } from 'linkedom';
import type { AccessStatus } from '../types.js';

export function detectAccessStatus(html: string, status: number): AccessStatus | undefined {
  if (!html.trim()) {
    return undefined;
  }

  const text = visibleText(html);

  if (isBotChallenge(html, text, status)) {
    return 'bot_challenge';
  }

  if (isPaywall(text)) {
    return 'paywall';
  }

  if (isLoginWall(text)) {
    return 'login_wall';
  }

  return undefined;
}

export function accessStatusLabel(status: AccessStatus): string {
  switch (status) {
    case 'bot_challenge':
      return 'bot challenge detected';
    case 'paywall':
      return 'paywall detected';
    case 'login_wall':
      return 'login wall detected';
  }
}

function visibleText(html: string): string {
  try {
    const { document } = parseHTML(html);
    for (const element of Array.from(document.querySelectorAll('script, style, template'))) {
      element.remove();
    }

    return normalizeText(
      [
        document.body?.textContent,
        document.documentElement?.textContent,
        html.replace(/<[^>]+>/g, ' '),
      ].join(' '),
    );
  } catch {
    return normalizeText(html.replace(/<[^>]+>/g, ' '));
  }
}

function isBotChallenge(html: string, text: string, status: number): boolean {
  const signature = `${html} ${text}`.toLowerCase();
  const challengePatterns = [
    /\bjust a moment\b/,
    /\bchecking (?:your )?browser\b/,
    /\bverify (?:that )?you are human\b/,
    /\battention required\b.*\bcloudflare\b/,
    /\bcf-browser-verification\b/,
    /\bcf-challenge\b/,
    /\bturnstile\b.*\bchallenge\b/,
    /\benable javascript and cookies to continue\b/,
  ];

  return (status === 403 || status === 429 || status === 503) && challengePatterns.some((pattern) => pattern.test(signature));
}

function isPaywall(text: string): boolean {
  return [
    /\bsubscribe to (?:continue|read|unlock)\b/,
    /\bsubscription required\b/,
    /\bthis article is (?:for|only for) subscribers\b/,
    /\bto continue reading,? subscribe\b/,
    /\bcreate an account to continue reading\b/,
    /\balready a subscriber\?\s*(?:log|sign) in\b/,
  ].some((pattern) => pattern.test(text));
}

function isLoginWall(text: string): boolean {
  return [
    /\b(?:log|sign) in to (?:continue|view|read|access)\b/,
    /\blogin required\b/,
    /\bmembers only\b/,
    /\bjoin .* to view\b/,
    /\bplease (?:log|sign) in\b.*\bcontinue\b/,
  ].some((pattern) => pattern.test(text));
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}
