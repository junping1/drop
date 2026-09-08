import type { Context } from 'hono';
import { isProxyTrusted } from '../shared/config.js';
import { getClientIpFromHeaders } from './middleware/rate-limit.js';
import { recordAccessEvent, type AccessEventType, type ShareType } from '../db/access-events.js';

export function recordRouteAccess(
  c: Context,
  token: string,
  shareType: ShareType,
  eventType: AccessEventType,
  targetPath?: string | null,
): void {
  recordAccessEvent({
    token,
    shareType,
    eventType,
    success: true,
    ip: getClientIpFromHeaders(c.req.raw.headers, isProxyTrusted()),
    userAgent: c.req.header('user-agent'),
    referer: c.req.header('referer'),
    targetPath,
  });
}
