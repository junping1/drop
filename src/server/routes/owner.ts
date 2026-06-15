/**
 * Owner auth route: GET /owner/auth
 */

import { Hono } from 'hono';
import { getOwnerKey } from '../../shared/config.js';
import { getAccessStats, getAggregateAccessStats, listAccessStats, parseStatsSince } from '../../db/access-events.js';
import { lookupShareAlias } from '../../db/share-aliases.js';
import { setOwnerCookie, safeCompare, checkOwnerAuth } from '../middleware/auth.js';

const ownerRoutes = new Hono();

function checkOwnerApiAuth(c: any): boolean {
  // Accept the owner key only via header (not query string) so the master
  // secret can't leak into server access logs, browser history, or Referer
  // headers. Cookie auth (set via /owner/auth or /dashboard?key=) also works.
  const key = c.req.header('x-owner-key') || '';
  if (key && safeCompare(key, getOwnerKey())) return true;
  return checkOwnerAuth(c);
}

function statsOptions(c: any) {
  return {
    since: parseStatsSince(c.req.query('since') || undefined),
    includeLive: c.req.query('include_live') === '1' || c.req.query('include_live') === 'true',
  };
}

ownerRoutes.get('/api/stats', (c) => {
  if (!checkOwnerApiAuth(c)) return c.text('Access denied', 403);
  const opts = statsOptions(c);
  return c.json({ totals: getAggregateAccessStats(opts), tokens: listAccessStats(opts) });
});

ownerRoutes.get('/api/stats/:token', (c) => {
  if (!checkOwnerApiAuth(c)) return c.text('Access denied', 403);
  const publicId = c.req.param('token');
  const token = lookupShareAlias(publicId)?.token || publicId;
  return c.json(getAccessStats(token, statsOptions(c)));
});


ownerRoutes.get('/owner/auth', (c) => {
  const key = c.req.query('key') || '';
  let nextUrl = c.req.query('next') || '/dashboard';
  if (!nextUrl.startsWith('/')) {
    nextUrl = '/dashboard';
  }

  const ownerKey = getOwnerKey();
  if (!key || !safeCompare(key, ownerKey)) {
    return c.text('Invalid key', 403);
  }

  setOwnerCookie(c);
  return c.redirect(nextUrl);
});

export { ownerRoutes };
