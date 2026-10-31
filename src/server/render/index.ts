/**
 * Renderer dispatcher — returns rendered HTML for supported file types,
 * or null for types that should be served raw (images, PDF, binary).
 */

import { readFileSync } from 'fs';
import { extname, basename } from 'path';
import { getFileType, getFileMeta } from '../../shared/fs.js';
import { htmlEscape } from '../../shared/utils.js';
import { renderCode, highlightCode, getHighlightCss } from './code.js';
import { renderMarkdown } from './markdown.js';
import { renderCsv } from './csv.js';
import { mediaPageHtml } from './html-templates.js';

export { highlightCode, getHighlightCss } from './code.js';

const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.opus', '.weba']);

/**
 * Get rendered HTML for a file, or null if it should be served raw.
 * Returns null for images, PDFs, and unknown binary files.
 */
export function getRenderer(filepath: string): ((filepath: string, head?: number | null, tail?: number | null, rawUrl?: string) => string) | null {
  const fileType = getFileType(filepath);

  switch (fileType) {
    case 'code':
      return renderCode;
    case 'markdown':
      return renderMarkdown;
    case 'csv':
      return renderCsv;
    case 'media':
      return renderMedia;
    case 'svg':
      return renderSvg;
    case 'image':
    case 'pdf':
    case 'binary':
      return null;
    default:
      return null;
  }
}

function renderMedia(filepath: string, _head?: number | null, _tail?: number | null, rawUrl?: string): string {
  const ext = extname(filepath).toLowerCase();
  const meta = getFileMeta(filepath);

  // Determine content type
  const mimeTypes: Record<string, string> = {
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
    '.flac': 'audio/flac', '.aac': 'audio/aac', '.m4a': 'audio/mp4',
    '.opus': 'audio/opus', '.weba': 'audio/webm',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg',
    '.mov': 'video/quicktime', '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska',
  };
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  const isAudio = AUDIO_EXTS.has(ext);
  const tag = isAudio ? 'audio' : 'video';
  const src = htmlEscape(rawUrl || '');
  const mediaHtml = `<${tag} controls><source src="${src}" type="${contentType}">Your browser does not support this media.</${tag}>`;

  return mediaPageHtml({
    displayPath: meta.display_path,
    fileMeta: `${meta.size} \u00b7 ${meta.mtime}`,
    mediaHtml,
  });
}

function renderSvg(filepath: string): string {
  const svgContent = readFileSync(filepath);
  const meta = getFileMeta(filepath);
  const dataUri = `data:image/svg+xml;base64,${svgContent.toString('base64')}`;
  const mediaHtml = `<div class="svg-container"><img src="${dataUri}" alt=""></div>`;

  return mediaPageHtml({
    displayPath: meta.display_path,
    fileMeta: `${meta.size} \u00b7 ${meta.mtime}`,
    mediaHtml,
  });
}
