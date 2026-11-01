export * from './types.js';
export * from './host.js';
export * from './server.js';

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { SendFileInput } from './types.js';

/** Convenience: load a local file as a sendable attachment. */
export function fileFromPath(path: string, mimeType?: string): SendFileInput {
  const buffer = readFileSync(path);
  return {
    name: basename(path),
    mimeType: mimeType ?? guessMime(path),
    buffer,
  };
}

function guessMime(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const table: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    json: 'application/json',
    zip: 'application/zip',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  return table[ext] ?? 'application/octet-stream';
}
