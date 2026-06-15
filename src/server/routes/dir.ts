/**
 * Directory browsing routes.
 * Ported from Python server.py dir routes.
 */

import { Hono } from 'hono';
import { existsSync, statSync, readFileSync } from 'fs';
import { join, basename } from 'path';
import { lookupDirAuthorization } from '../../db/dir-authorizations.js';
import { resolveShareToken } from '../../db/share-aliases.js';
import {
  STATUS_NOT_FOUND, STATUS_EXPIRED, MAX_RENDER_SIZE,
} from '../../shared/constants.js';
import { loadConfig } from '../../shared/config.js';
import { walkDirectory, getFileType, isExcluded } from '../../shared/fs.js';
import { jsSafeJson, isSafeSubpath } from '../../shared/utils.js';
import { handleExpired } from '../middleware/auth.js';
import { dirBrowserShellHtml } from '../render/html-templates.js';
import { getRenderer } from '../render/index.js';
import { guessMime } from '../../shared/mime.js';
import { recordRouteAccess } from '../access-logging.js';
import type { DirAuthorization } from '../../shared/types.js';

const dirRoutes = new Hono();

function getDirAuth(c: any): { row: DirAuthorization | null; expiredHtml: string | null; publicId: string } {
  const publicId = c.req.param('token');
  const token = resolveShareToken('dir', publicId);
  const { row, status } = lookupDirAuthorization(token);

  if (status === STATUS_NOT_FOUND) {
    return { row: null, expiredHtml: null, publicId };
  }

  if (status === STATUS_EXPIRED) {
    const html = handleExpired(c, row!, 'dirname', token, 'dir_authorizations');
    if (html !== null) {
      return { row: null, expiredHtml: html, publicId };
    }
    // Owner/password auth extended — continue
  }

  return { row: row!, expiredHtml: null, publicId };
}

function getExcludes(row: DirAuthorization): string[] {
  return JSON.parse(row.excludes);
}

function validateDirPath(dirpath: string, relPath: string, excludes: string[]): string | null {
  // Reject obvious traversal attempts
  if (relPath.split('/').includes('..') || relPath.startsWith('/')) {
    return null;
  }

  const absPath = join(dirpath, relPath);
  if (!isSafeSubpath(dirpath, absPath)) {
    return null;
  }

  if (!existsSync(absPath)) {
    return null;
  }

  // Check excludes for each path segment
  const parts = relPath.split('/');
  for (let i = 0; i < parts.length; i++) {
    const isDir = i < parts.length - 1 || statSync(absPath).isDirectory();
    if (isExcluded(parts[i], isDir, excludes)) {
      return null;
    }
  }

  return absPath;
}

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

function renderDirBrowser(row: DirAuthorization, initialFile: string = '', publicId: string = row.token): string | Response {
  const dirpath = row.dirpath;
  if (!existsSync(dirpath) || !statSync(dirpath).isDirectory()) {
    return 'Directory no longer exists on disk';
  }

  const excludes = getExcludes(row);
  const tree = walkDirectory(dirpath, excludes);

  const cfg = loadConfig();
  const basePath = (cfg.base_url as string || '').replace(/\/$/, '');

  let html = dirBrowserShellHtml({
    dirname: row.dirname,
    token: publicId,
    treeJson: jsSafeJson(tree),
    expiresAt: `${Math.floor(row.expires_at)}`,
    initialFile,
    basePath,
  });

  if (row.live && html.includes('</body>')) {
    html = injectLiveJs(html, publicId);
  }

  return html;
}

// GET /d/:token and GET /d/:token/
dirRoutes.get('/d/:token', (c) => {
  const { row, expiredHtml } = getDirAuth(c);
  if (!row && !expiredHtml) return c.text('Not found', 404);
  if (expiredHtml) return c.html(expiredHtml);

  const result = renderDirBrowser(row!, '', c.req.param('token'));
  if (typeof result === 'string') {
    if (result === 'Directory no longer exists on disk') return c.text(result, 404);
    recordRouteAccess(c, row!.token, 'dir', 'page_view');
    return c.html(result);
  }
  recordRouteAccess(c, row!.token, 'dir', 'page_view');
  return result;
});

// API: tree
dirRoutes.get('/d/:token/api/tree', (c) => {
  const { row, expiredHtml } = getDirAuth(c);
  if (!row && !expiredHtml) return c.text('Not found', 404);
  if (expiredHtml) return c.text('Expired', 403);

  const excludes = getExcludes(row!);
  const tree = walkDirectory(row!.dirpath, excludes);

  recordRouteAccess(c, row!.token, 'dir', 'api_tree');
  return c.json({ tree, dirname: row!.dirname, token: c.req.param('token') });
});

// API: file preview
dirRoutes.get('/d/:token/api/file', (c) => {
  const { row, expiredHtml } = getDirAuth(c);
  if (!row && !expiredHtml) return c.text('Not found', 404);
  if (expiredHtml) return c.text('Expired', 403);

  const relPath = c.req.query('path') || '';
  if (!relPath) return c.text('Missing path parameter', 400);

  const excludes = getExcludes(row!);
  const absPath = validateDirPath(row!.dirpath, relPath, excludes);
  if (!absPath) return c.text('Access denied', 403);

  const fileType = getFileType(absPath);
  const cfg = loadConfig();
  const baseUrl = ((cfg.base_url as string) || '').replace(/\/$/, '');

  let fileSize = 0;
  let fileMtime = 0;
  try {
    const st = statSync(absPath);
    fileSize = st.size;
    fileMtime = Math.floor(st.mtimeMs / 1000);
  } catch {
    // ignore
  }

  const rawUrl = `${baseUrl}/d/${c.req.param('token')}/raw?path=${encodeURIComponent(relPath)}`;

  if (fileType === 'image' || fileType === 'svg') {
    recordRouteAccess(c, row!.token, 'dir', 'api_preview', relPath);
    return c.json({ type: 'image', url: rawUrl, size: fileSize, mtime: fileMtime });
  }

  if (fileType === 'pdf') {
    recordRouteAccess(c, row!.token, 'dir', 'api_preview', relPath);
    return c.json({ type: 'pdf', url: rawUrl, size: fileSize, mtime: fileMtime });
  }

  if ((fileType === 'code' || fileType === 'markdown' || fileType === 'csv') && fileSize <= MAX_RENDER_SIZE) {
    const renderer = getRenderer(absPath);
    if (renderer) {
      const htmlContent = renderer(absPath);
      recordRouteAccess(c, row!.token, 'dir', 'api_preview', relPath);
      return c.json({ type: 'html', content: htmlContent, size: fileSize, mtime: fileMtime });
    }
  }

  if (fileType === 'media') {
    recordRouteAccess(c, row!.token, 'dir', 'api_preview', relPath);
    return c.json({ type: 'media', url: rawUrl, filename: basename(absPath), size: fileSize, mtime: fileMtime });
  }

  // Binary / unknown / oversized
  recordRouteAccess(c, row!.token, 'dir', 'api_preview', relPath);
  return c.json({ type: 'binary', filename: basename(absPath), size: fileSize, mtime: fileMtime, url: rawUrl });
});

// Raw file serving
dirRoutes.get('/d/:token/raw', (c) => {
  const { row, expiredHtml } = getDirAuth(c);
  if (!row && !expiredHtml) return c.text('Not found', 404);
  if (expiredHtml) return c.text('Expired', 403);

  const relPath = c.req.query('path') || '';
  if (!relPath) return c.text('Missing path parameter', 400);

  const excludes = getExcludes(row!);
  const absPath = validateDirPath(row!.dirpath, relPath, excludes);
  if (!absPath) return c.text('Access denied', 403);

  const contentType = guessMime(absPath);

  const data = readFileSync(absPath);
  recordRouteAccess(c, row!.token, 'dir', 'raw_view', relPath);
  return new Response(data, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="${basename(absPath)}"`,
    },
  });
});

// Catch-all for deep links: /d/:token/* (MUST be last)
dirRoutes.get('/d/:token/*', (c) => {
  const { row, expiredHtml } = getDirAuth(c);
  if (!row && !expiredHtml) return c.text('Not found', 404);
  if (expiredHtml) return c.html(expiredHtml);

  // Extract the filepath from the wildcard
  const fullPath = c.req.path;
  const prefix = `/d/${c.req.param('token')}/`;
  let filepath = '';
  const idx = fullPath.indexOf(prefix);
  if (idx !== -1) {
    filepath = decodeURIComponent(fullPath.slice(idx + prefix.length));
  }

  // Skip API routes (they should be handled above but just in case)
  if (filepath.startsWith('api/')) {
    return c.text('Not found', 404);
  }

  const result = renderDirBrowser(row!, filepath, c.req.param('token'));
  if (typeof result === 'string') {
    if (result === 'Directory no longer exists on disk') return c.text(result, 404);
    recordRouteAccess(c, row!.token, 'dir', 'page_view', filepath);
    return c.html(result);
  }
  recordRouteAccess(c, row!.token, 'dir', 'page_view', filepath);
  return result;
});

export { dirRoutes };
