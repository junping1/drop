/**
 * Raw byte responses shared by file shares (/f/:token, /f/:token/raw) and
 * directory shares (/d/:token/raw?path=). Callers do authorization, expiry and
 * path validation first; this module only turns an already-approved absolute
 * path into a Response.
 */

import { statSync } from 'fs';
import { basename } from 'path';
import type { Context } from 'hono';
import { DOWNLOAD_ONLY_TYPES, guessMime, isUnsafeInline } from '../shared/mime.js';

/**
 * Build a Content-Disposition header value that is safe for any filename.
 * Response headers must be Latin-1 and cannot contain quotes/backslashes/
 * control characters, so we emit an ASCII-sanitized `filename` fallback
 * alongside an RFC 5987 percent-encoded `filename*` for the real name.
 */
function contentDisposition(disposition: 'inline' | 'attachment', filename: string): string {
  const asciiFallback = filename
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_') || 'file';
  const encoded = encodeURIComponent(filename).replace(/['()*!~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

/** Largest body returned for one Range request (see rawFileResponse). */
export const MAX_RANGE_CHUNK = 8 * 1024 * 1024;

/**
 * Parse a single-range `Range: bytes=...` header against a file of `size`
 * bytes. Returns null when absent or not a single byte range (serve the whole
 * file), 'unsatisfiable' when it cannot be satisfied, else inclusive bounds.
 * The range unit is matched case-insensitively (RFC 9110 §14.1).
 */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start: number;
  let end: number;
  if (m[1] === '') {
    const n = parseInt(m[2], 10);
    if (n === 0) return 'unsatisfiable';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = parseInt(m[1], 10);
    end = m[2] === '' ? size - 1 : Math.min(parseInt(m[2], 10), size - 1);
  }
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

/**
 * True when an `If-Range` precondition still matches the current file
 * (RFC 9110 §13.1.5). An entity tag must match strongly (a weak tag never
 * matches); otherwise the value must be an HTTP date equal to Last-Modified.
 * Anything that does not match means "the client's partial copy is stale":
 * ignore the Range and send the whole file.
 */
function ifRangeMatches(ifRange: string | undefined, etag: string, lastModifiedMs: number): boolean {
  if (ifRange === undefined) return true;
  const value = ifRange.trim();
  if (value.startsWith('"') || value.startsWith('W/')) return value === etag;
  const date = Date.parse(value);
  return !Number.isNaN(date) && date === lastModifiedMs;
}

/**
 * Stream a file's bytes with the correct content type, an explicit
 * Content-Length and single-range support (206/416). Browser PDF viewers and
 * media players depend on these; Bun does not add them for a Response built
 * from Bun.file() with custom headers, and HEAD would otherwise report 0.
 *
 * Active document types (HTML, XML, SVG, ...) are never served inline: they
 * would run script on this origin, which also hosts the owner-cookied
 * /dashboard and /api/stats. They go out as a plain-text attachment with a
 * sandbox CSP instead.
 */
export async function rawFileResponse(c: Context, absPath: string): Promise<Response> {
  const guessedMime = guessMime(absPath);
  const unsafe = isUnsafeInline(guessedMime);
  const st = statSync(absPath);
  const size = st.size;
  const lastModifiedMs = Math.floor(st.mtimeMs / 1000) * 1000;
  const etag = `"${size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;

  const headers: Record<string, string> = {
    'Content-Type': unsafe ? 'text/plain; charset=utf-8' : guessedMime,
    'Content-Disposition': contentDisposition(
      unsafe || DOWNLOAD_ONLY_TYPES.has(guessedMime) ? 'attachment' : 'inline',
      basename(absPath),
    ),
    'Accept-Ranges': 'bytes',
    'ETag': etag,
    'Last-Modified': new Date(lastModifiedMs).toUTCString(),
  };
  if (unsafe) headers['Content-Security-Policy'] = 'sandbox';

  const file = Bun.file(absPath);
  const isHead = c.req.method === 'HEAD';
  // Range only applies to GET (RFC 9110 §14.2); HEAD describes the whole file.
  const range = !isHead && ifRangeMatches(c.req.header('if-range'), etag, lastModifiedMs)
    ? parseRange(c.req.header('range'), size)
    : null;

  if (range === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
  }
  if (range) {
    // Send ranged bodies as in-memory bytes so Bun emits an exact
    // Content-Length (a streamed body is sent chunked, and Safari refuses to
    // play media whose 206 responses are chunked). Cap each response at
    // MAX_RANGE_CHUNK; returning a shorter range than an open-ended request
    // asked for is allowed, and players request the next chunk.
    const end = Math.min(range.end, range.start + MAX_RANGE_CHUNK - 1);
    const body = new Uint8Array(await file.slice(range.start, end + 1).arrayBuffer());
    return new Response(body, {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${range.start}-${end}/${size}`, 'Content-Length': String(body.length) },
    });
  }
  return new Response(isHead ? null : file, { headers: { ...headers, 'Content-Length': String(size) } });
}
