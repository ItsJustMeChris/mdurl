import type { AccessStatus } from './types.js';

export type MdurlErrorKind =
  | 'http'
  | 'timeout'
  | 'network'
  | 'parse'
  | 'browser'
  | 'usage';

export class MdurlError extends Error {
  readonly kind: MdurlErrorKind;
  readonly exitCode: number;
  readonly status?: number;
  readonly url?: string;
  readonly contentType?: string;
  readonly accessStatus?: AccessStatus;

  constructor(
    kind: MdurlErrorKind,
    message: string,
    options: {
      status?: number;
      url?: string;
      contentType?: string;
      accessStatus?: AccessStatus;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = 'MdurlError';
    this.kind = kind;
    this.exitCode = exitCodeForKind(kind);
    this.status = options.status;
    this.url = options.url;
    this.contentType = options.contentType;
    this.accessStatus = options.accessStatus;
    this.cause = options.cause;
  }
}

export function exitCodeForKind(kind: MdurlErrorKind): number {
  switch (kind) {
    case 'http':
      return 1;
    case 'timeout':
      return 2;
    case 'network':
      return 3;
    case 'parse':
    case 'usage':
      return 4;
    case 'browser':
      return 5;
  }
}

export function normalizeError(error: unknown): MdurlError {
  if (error instanceof MdurlError) {
    return error;
  }

  if (error instanceof DOMException && error.name === 'AbortError') {
    return new MdurlError('timeout', 'Request timed out', { cause: error });
  }

  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return new MdurlError('timeout', 'Request timed out', { cause: error });
    }

    return new MdurlError('network', error.message, { cause: error });
  }

  return new MdurlError('parse', 'Unknown error');
}
