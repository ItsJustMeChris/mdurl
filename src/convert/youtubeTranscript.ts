import { buildHeaders } from '../fetch/plain.js';
import type { PlainFetchOptions } from '../types.js';

export interface YouTubeTranscript {
  language?: string;
  lines: YouTubeTranscriptLine[];
}

export interface YouTubeTranscriptLine {
  startMs?: number;
  text: string;
}

interface CaptionTrack {
  baseUrl?: string;
  languageCode?: string;
  name?: { simpleText?: string; runs?: Array<{ text?: string }> };
  kind?: string;
}

export async function extractYouTubeTranscript(
  html: string,
  pageUrl: string,
  options: PlainFetchOptions,
): Promise<YouTubeTranscript | undefined> {
  if (!/youtu(?:be\.com|\.be)|ytInitialPlayerResponse|playerCaptionsTracklistRenderer/i.test(`${pageUrl} ${html}`)) {
    return undefined;
  }

  const player = playerResponse(html);
  const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!Array.isArray(tracks) || tracks.length === 0) {
    return undefined;
  }

  const track = (tracks as CaptionTrack[]).find((candidate) => candidate.kind !== 'asr') ?? (tracks[0] as CaptionTrack);
  if (!track.baseUrl) {
    return undefined;
  }

  const captionsUrl = captionJsonUrl(track.baseUrl, pageUrl);
  const response = await fetch(captionsUrl, {
    headers: buildHeaders(options),
    signal: AbortSignal.timeout(options.timeoutMs),
  });

  if (!response.ok) {
    return undefined;
  }

  const lines = parseJson3(await response.text());
  if (lines.length === 0) {
    return undefined;
  }

  return {
    language: captionLanguage(track),
    lines,
  };
}

export function appendYouTubeTranscript(markdown: string, transcript: YouTubeTranscript): string {
  const sections = ['## Transcript', ''];

  if (transcript.language) {
    sections.push(`- **Language:** ${transcript.language}`, '');
  }

  for (const line of transcript.lines) {
    sections.push(`${formatTimestamp(line.startMs)} ${line.text}`.trim());
  }

  return `${markdown.trimEnd()}\n\n${sections.join('\n').trimEnd()}\n`;
}

function playerResponse(html: string): any {
  const marker = 'ytInitialPlayerResponse';
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) {
    return undefined;
  }

  const start = html.indexOf('{', markerIndex);
  if (start < 0) {
    return undefined;
  }

  const json = balancedJson(html, start);
  if (!json) {
    return undefined;
  }

  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

function balancedJson(value: string, start: number): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < value.length; index += 1) {
    const character = value[index];

    if (inString) {
      escaped = !escaped && character === '\\';
      if (character === '"' && !escaped) {
        inString = false;
      } else if (character !== '\\') {
        escaped = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, index + 1);
      }
    }
  }

  return undefined;
}

function captionJsonUrl(value: string, pageUrl: string): string {
  const url = new URL(value, pageUrl);
  url.searchParams.set('fmt', 'json3');
  return url.toString();
}

function parseJson3(value: string): YouTubeTranscriptLine[] {
  let parsed: any;

  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed.events)) {
    return [];
  }

  return parsed.events
    .map((event: any) => ({
      startMs: typeof event.tStartMs === 'number' ? event.tStartMs : undefined,
      text: Array.isArray(event.segs)
        ? event.segs.map((segment: any) => segment.utf8).filter(Boolean).join('')
        : '',
    }))
    .map((line: YouTubeTranscriptLine) => ({ ...line, text: normalizeText(line.text) }))
    .filter((line: YouTubeTranscriptLine) => line.text);
}

function captionLanguage(track: CaptionTrack): string | undefined {
  const name = track.name?.simpleText || track.name?.runs?.map((run) => run.text).filter(Boolean).join('');
  return [name, track.languageCode].filter(Boolean).join(' / ') || undefined;
}

function formatTimestamp(startMs: number | undefined): string {
  if (startMs === undefined) {
    return '';
  }

  const totalSeconds = Math.floor(startMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `[${minutes}:${String(seconds).padStart(2, '0')}]`;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
