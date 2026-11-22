/**
 * File serving routes: GET /f/:token, GET /f/:token/raw, GET /f/:token/render
 * and GET /f/:token/:filename
 */

import { Hono } from 'hono';
import { existsSync, statSync } from 'fs';
import { lookupAuthorization } from '../../db/authorizations.js';
import { resolveShareToken } from '../../db/share-aliases.js';
import { STATUS_NOT_FOUND, STATUS_EXPIRED, MAX_RENDER_SIZE } from '../../shared/constants.js';
import { getFileType } from '../../shared/fs.js';
import { getRenderer } from '../render/index.js';
import { handleExpired } from '../middleware/auth.js';
import { recordRouteAccess } from '../access-logging.js';
import { isPreviewableHtml, rawFileResponse, renderHtmlResponse } from '../raw-response.js';
import type { FileAuthorization } from '../../shared/types.js';

const fileRoutes = new Hono();

function injectLiveJs(html: string, token: string): string {
  const script =
    '<script>' +
    '(function(){' +
    'var mtime=0;' +
    'function poll(){' +
    'fetch("/live/' + token + '/poll?since="+mtime)' +
    '.then(function(r){return r.json()})' +
    '.then(function(d){' +
    'if(d.expired||d.deleted){clearInterval(iv);return}' +
    'if(d.changed){mtime=d.mtime;location.reload()}' +
    'else if(!mtime){mtime=d.mtime}' +
    '})' +
    '.catch(function(){});' +
    '}' +
    'var iv=setInterval(poll,2000);' +
    'poll();' +
    '})();' +
    '</script>';
  return html.replace('</body>', script + '</body>');
}

/**
 * Resolve the share token from the request, look up its authorization row,
 * and handle the not-found/expired states. Shared by both the page route
 * and the raw route so they enforce identical authorization and expiry.
 */
function getFileAuth(c: any): { row: FileAuthorization | null; expiredHtml: string | null; token: string; publicId: string } {
  const publicId = c.req.param('token');
  const token = resolveShareToken('file', publicId);
  const { row, status } = lookupAuthorization(token);

  if (status === STATUS_NOT_FOUND) {
    return { row: null, expiredHtml: null, token, publicId };
  }

  if (status === STATUS_EXPIRED) {
    const html = handleExpired(c, row!, 'filename', token, 'authorizations');
    if (html !== null) {
      return { row: null, expiredHtml: html, token, publicId };
    }
    // If null, owner/password auth extended the expiry — continue serving
  }

  return { row: row!, expiredHtml: null, token, publicId };
}

function serveFileHandler(c: any) {
  const { row, expiredHtml, token, publicId } = getFileAuth(c);

  if (!row && !expiredHtml) {
    return c.text('Not found', 404);
  }

  if (expiredHtml) {
    return c.html(expiredHtml);
  }

  const filepath = row!.filepath;
  if (!existsSync(filepath)) {
    return c.text('File no longer exists on disk', 404);
  }

  const headParam = c.req.query('head');
  const tailParam = c.req.query('tail');
  const head = headParam ? parseInt(headParam, 10) : null;
  const tail = tailParam ? parseInt(tailParam, 10) : null;

  const fileType = getFileType(filepath);
  const isTextish = fileType === 'code' || fileType === 'markdown' || fileType === 'csv';
  let renderer = getRenderer(filepath);

  // Text-ish renderers build the whole file into one HTML string; skip them
  // for oversized files and serve raw instead (mirrors dir.ts's API cap).
  if (renderer && isTextish) {
    const st = statSync(filepath);
    if (st.size > MAX_RENDER_SIZE) {
      renderer = null;
    }
  }

  if (renderer) {
    const rawUrl = `/f/${publicId}/raw`;
    // HTML files get a Preview/Source toggle; the preview is a sandboxed
    // iframe on /render, never this page (which shares drop's origin).
    const htmlPreview = fileType === 'code' && isPreviewableHtml(filepath)
      ? {
          sourceUrl: `/f/${publicId}`,
          previewUrl: `/f/${publicId}?view=preview`,
          renderUrl: `/f/${publicId}/render`,
          view: c.req.query('view') === 'preview' ? 'preview' as const : 'source' as const,
        }
      : undefined;
    let html = renderer(filepath, head, tail, rawUrl, htmlPreview);
    if (row!.live && html.includes('</body>')) {
      html = injectLiveJs(html, publicId);
    }
    recordRouteAccess(c, token, 'file', 'page_view');
    return c.html(html);
  }

  // Serve raw file (images, PDFs, binary, and oversized text-ish files)
  recordRouteAccess(c, token, 'file', 'page_view');
  return rawFileResponse(c, filepath);
}

/**
 * Authorization, expiry and on-disk checks shared by the byte-serving routes
 * (/raw and /render). Returns either an early Response or the approved file.
 */
function resolveFileBytesRequest(c: any): Response | { filepath: string; token: string } {
  const { row, expiredHtml, token } = getFileAuth(c);

  if (!row && !expiredHtml) {
    return c.text('Not found', 404);
  }

  if (expiredHtml) {
    return c.html(expiredHtml);
  }

  const filepath = row!.filepath;
  if (!existsSync(filepath)) {
    return c.text('File no longer exists on disk', 404);
  }
  return { filepath, token };
}

function serveFileRawHandler(c: any) {
  const resolved = resolveFileBytesRequest(c);
  if (resolved instanceof Response) return resolved;

  // Every access to file bytes is recorded (matches dir.ts's /raw route), so
  // a direct request to this URL — saved, reposted, or curled — still shows
  // up in `drop stats`. The browser also auto-fetches this URL as a
  // sub-resource of a page visit already logged as `page_view` (e.g. the
  // <video>/<audio> `src`); to avoid double-counting that as two views, the
  // headline view count in access-events.ts excludes `raw_view` for file
  // shares specifically, while still keeping the raw_view row in the log and
  // in the by_event_type breakdown.
  recordRouteAccess(c, resolved.token, 'file', 'raw_view');
  return rawFileResponse(c, resolved.filepath);
}

/**
 * Live HTML for the sandboxed preview iframe. Recorded as `raw_view` like the
 * raw route: it is normally a sub-resource of an already-logged page view.
 */
function serveFileRenderHandler(c: any) {
  const resolved = resolveFileBytesRequest(c);
  if (resolved instanceof Response) return resolved;

  const res = renderHtmlResponse(c, resolved.filepath);
  if (res.status === 200) recordRouteAccess(c, resolved.token, 'file', 'raw_view');
  return res;
}

// Specific /raw and /render routes must be registered before the generic :filename route.
fileRoutes.get('/f/:token/raw', serveFileRawHandler);
fileRoutes.get('/f/:token/render', serveFileRenderHandler);
fileRoutes.get('/f/:token', serveFileHandler);
fileRoutes.get('/f/:token/:filename', serveFileHandler);

export { fileRoutes };
