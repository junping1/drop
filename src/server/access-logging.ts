import type { Context } from 'hono';
import { loadConfig } from '../shared/config.js';
import { getClientIpFromHeaders } from './middleware/rate-limit.js';
import { recordAccessEvent, type AccessEventType, type ShareType } from '../db/access-events.js';

export function recordRouteAccess(
  c: Context,
  token: string,
  shareType: ShareType,
  eventType: AccessEventType,
  targetPath?: string | null,
): void {
  if (isFollowUpByteRequest(c)) return;
  const cfg = loadConfig();
  const trustProxy = cfg.trust_proxy === true;
  recordAccessEvent({
    token,
    shareType,
    eventType,
    success: true,
    ip: getClientIpFromHeaders(c.req.raw.headers, trustProxy),
    userAgent: c.req.header('user-agent'),
    referer: c.req.header('referer'),
    targetPath,
  });
}

/**
 * Whether a request is a follow-up fetch of bytes the client already started
 * reading — a HEAD probe, or a Range that does not begin at byte 0 (media
 * seeking/buffering, suffix ranges). Those are not new views; access logging
 * skips them so one playback is not counted dozens of times.
 */
export function isFollowUpByteRequest(c: Context): boolean {
  if (c.req.method === 'HEAD') return true;
  const range = c.req.header('range');
  if (!range) return false;
  const m = /^\s*bytes=(\d*)-/i.exec(range);
  if (!m) return false;
  return m[1] === '' || parseInt(m[1], 10) > 0;
}
