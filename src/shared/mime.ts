import { extname } from 'path';

const MIME_BY_EXTENSION: Record<string, string> = {
  '.html': 'text/html', '.htm': 'text/html',
  '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.ico': 'image/x-icon', '.bmp': 'image/bmp',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.flac': 'audio/flac', '.aac': 'audio/aac', '.m4a': 'audio/mp4',
  '.opus': 'audio/opus', '.weba': 'audio/webm',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg',
  '.mov': 'video/quicktime', '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska',
  '.txt': 'text/plain', '.md': 'text/markdown',
  '.csv': 'text/csv', '.tsv': 'text/tab-separated-values', '.tab': 'text/tab-separated-values',
  '.py': 'text/plain', '.ts': 'text/plain', '.go': 'text/plain', '.rs': 'text/plain',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.doc': 'application/msword', '.xls': 'application/vnd.ms-excel', '.ppt': 'application/vnd.ms-powerpoint',
  '.zip': 'application/zip', '.gz': 'application/gzip', '.tar': 'application/x-tar',
};

export function guessMime(filepath: string): string {
  return MIME_BY_EXTENSION[extname(filepath).toLowerCase()] || 'application/octet-stream';
}

/** Types a browser cannot render inline; serve them as attachments so the saved file keeps its name and extension. */
export const DOWNLOAD_ONLY_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
  'application/zip', 'application/gzip', 'application/x-tar', 'application/octet-stream',
]);

/**
 * Types a browser would render as an active document if served inline. Share
 * URLs are public and same-origin with the owner-cookied /dashboard and
 * /api/stats, so a script inside such a document could read every share token
 * and local path. Covers HTML, XHTML, generic XML (an XML file whose root is in
 * the XHTML namespace runs its <script>) and every `+xml` type (SVG, RSS, Atom,
 * MathML, ...).
 */
export function isUnsafeInline(mime: string): boolean {
  const type = mime.split(';')[0].trim().toLowerCase();
  return (
    type === 'text/html' ||
    type === 'application/xhtml+xml' ||
    type === 'application/xml' ||
    type === 'text/xml' ||
    type.endsWith('+xml')
  );
}
