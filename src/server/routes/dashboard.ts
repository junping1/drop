/**
 * Dashboard route: GET /dashboard
 */

import { Hono } from 'hono';
import { loadConfig, getOwnerKey } from '../../shared/config.js';
import { STATUS_ACTIVE } from '../../shared/constants.js';
import { displayPath, formatTime } from '../../shared/utils.js';
import { listAllAuthorizations } from '../../db/cleanup.js';
import { getAccessStats } from '../../db/access-events.js';
import { checkOwnerAuth, setOwnerCookie, safeCompare } from '../middleware/auth.js';
import { dashboardPageHtml } from '../render/html-templates.js';

const dashboardRoutes = new Hono();

dashboardRoutes.get('/dashboard', (c) => {
  // Allow ?key= param to authenticate inline
  const key = c.req.query('key') || '';
  if (key) {
    const ownerKey = getOwnerKey();
    if (safeCompare(key, ownerKey)) {
      setOwnerCookie(c);
    } else {
      return c.text('Invalid key', 403);
    }
  } else if (!checkOwnerAuth(c)) {
    return c.text('Access denied', 403);
  }

  const cfg = loadConfig();
  const baseUrl = ((cfg.base_url as string) || '').replace(/\/$/, '');
  const shares = listAllAuthorizations();

  const prefixMap: Record<string, string> = {
    file: '/f/',
    dir: '/d/',
    git: '/git/',
  };

  const formattedShares = shares.map(s => {
    const publicId = s.slug || s.token;
    const stats = getAccessStats(s.token);
    return {
      type: s.type,
      display_path: displayPath(s.path),
      path: s.path,
      token: s.token,
      slug: s.slug,
      public_id: publicId,
      url: baseUrl ? `${baseUrl}${prefixMap[s.type]}${publicId}` : `${prefixMap[s.type]}${publicId}`,
      created_str: formatTime(s.created_at),
      expires_str: formatTime(s.expires_at),
      views: stats.views,
      unique: stats.unique,
      last_access_str: stats.last_access_at ? formatTime(stats.last_access_at) : '—',
      status: s.status,
    };
  });

  const activeCount = formattedShares.filter(s => s.status === STATUS_ACTIVE).length;

  return c.html(dashboardPageHtml({
    shares: formattedShares,
    shareCount: formattedShares.length,
    activeCount,
  }));
});

export { dashboardRoutes };
