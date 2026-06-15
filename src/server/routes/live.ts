/**
 * Live poll endpoint: GET /live/:token/poll
 */

import { Hono } from 'hono';
import { existsSync, statSync } from 'fs';
import { lookupAuthorization } from '../../db/authorizations.js';
import { lookupDirAuthorization } from '../../db/dir-authorizations.js';
import { resolveShareToken } from '../../db/share-aliases.js';
import { STATUS_NOT_FOUND, STATUS_EXPIRED } from '../../shared/constants.js';

const liveRoutes = new Hono();

liveRoutes.get('/live/:token/poll', (c) => {
  const publicId = c.req.param('token');
  const since = parseFloat(c.req.query('since') || '0');

  // Try file authorizations first, then dir
  let token = resolveShareToken('file', publicId);
  let { row, status } = lookupAuthorization(token);
  let filepath: string | undefined;

  if (status === STATUS_NOT_FOUND) {
    token = resolveShareToken('dir', publicId);
    const dirResult = lookupDirAuthorization(token);
    row = dirResult.row as any;
    status = dirResult.status;
    if (row) {
      filepath = (row as any).dirpath;
    }
  } else if (row) {
    filepath = (row as any).filepath;
  }

  if (status === STATUS_NOT_FOUND) {
    return c.text('Not found', 404);
  }

  if (status === STATUS_EXPIRED) {
    c.header('Cache-Control', 'no-cache');
    return c.json({ expired: true });
  }

  if (!filepath || !existsSync(filepath)) {
    c.header('Cache-Control', 'no-cache');
    return c.json({ changed: false, mtime: 0, deleted: true });
  }

  let mtime = 0;
  try {
    mtime = statSync(filepath).mtimeMs / 1000;
  } catch {
    mtime = 0;
  }

  c.header('Cache-Control', 'no-cache');
  return c.json({ changed: mtime > since, mtime });
});

export { liveRoutes };
