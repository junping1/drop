import { createHmac } from 'crypto';
import { extname } from 'path';
import { getDb } from './index.js';
import { getOwnerKey } from '../shared/config.js';

export type AccessEventType = 'page_view' | 'raw_view' | 'api_tree' | 'api_preview' | 'live_poll';
export type ShareType = 'file' | 'dir' | 'git';

export interface RecordAccessEventInput {
  token: string;
  shareType: ShareType;
  eventType: AccessEventType;
  success: boolean;
  ip?: string | null;
  userAgent?: string | null;
  referer?: string | null;
  targetPath?: string | null;
  createdAt?: number;
}

export interface AccessStatsOptions {
  since?: number;
  includeLive?: boolean;
}

export interface AccessStats {
  token: string;
  views: number;
  unique: number;
  last_access_at: number | null;
  by_event_type: Record<string, number>;
}

function hmac(value: string): string {
  return createHmac('sha256', getOwnerKey()).update(value).digest('hex');
}

function classifyUserAgent(userAgent?: string | null): string | null {
  if (!userAgent) return null;
  const ua = userAgent.toLowerCase();
  if (ua.includes('curl')) return 'curl';
  if (ua.includes('wget')) return 'wget';
  if (ua.includes('bot') || ua.includes('crawler') || ua.includes('spider')) return 'bot';
  if (ua.includes('firefox')) return 'firefox';
  if (ua.includes('edg/')) return 'edge';
  if (ua.includes('chrome') || ua.includes('chromium')) return 'chrome';
  if (ua.includes('safari')) return 'safari';
  if (ua.includes('node') || ua.includes('bun')) return 'script';
  return 'other';
}

function refererOrigin(referer?: string | null): string | null {
  if (!referer) return null;
  try {
    const url = new URL(referer);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function cleanTargetPath(targetPath?: string | null): string | null {
  if (!targetPath) return null;
  return targetPath.split('?')[0].split('#')[0];
}

function targetExt(targetPath?: string | null): string | null {
  const path = cleanTargetPath(targetPath);
  if (!path) return null;
  const ext = extname(path).toLowerCase();
  return ext || null;
}

export function recordAccessEvent(input: RecordAccessEventInput): void {
  const path = cleanTargetPath(input.targetPath);
  getDb().query(`
    INSERT INTO access_events (
      token, share_type, event_type, outcome, created_at,
      client_hash, ua_kind, referer_origin, target_path_hash, target_ext
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.token,
    input.shareType,
    input.eventType,
    input.success ? 'success' : 'failure',
    input.createdAt ?? Date.now() / 1000,
    hmac((input.ip || 'unknown').trim() || 'unknown'),
    classifyUserAgent(input.userAgent),
    refererOrigin(input.referer),
    path ? hmac(path) : null,
    targetExt(path),
  );
}

function countableTypes(includeLive = false): string[] {
  return includeLive ? ['page_view', 'raw_view', 'live_poll'] : ['page_view', 'raw_view'];
}

function sinceWhere(opts: AccessStatsOptions, prefix = ''): { sql: string; params: any[] } {
  if (!opts.since) return { sql: '', params: [] };
  return { sql: ` AND ${prefix}created_at >= ?`, params: [opts.since] };
}

export function getAccessStats(token: string, opts: AccessStatsOptions = {}): AccessStats {
  const types = countableTypes(opts.includeLive);
  const since = sinceWhere(opts);
  const placeholders = types.map(() => '?').join(', ');
  const totals = getDb().query(`
    SELECT COUNT(*) AS views, COUNT(DISTINCT client_hash) AS unique_count, MAX(created_at) AS last_access_at
    FROM access_events
    WHERE token = ? AND outcome = 'success' AND event_type IN (${placeholders})${since.sql}
  `).get(token, ...types, ...since.params) as { views: number; unique_count: number; last_access_at: number | null };
  const byRows = getDb().query(`
    SELECT event_type, COUNT(*) AS cnt
    FROM access_events
    WHERE token = ? AND outcome = 'success'${since.sql}
    GROUP BY event_type
    ORDER BY event_type
  `).all(token, ...since.params) as { event_type: string; cnt: number }[];
  const by_event_type: Record<string, number> = {};
  for (const row of byRows) by_event_type[row.event_type] = row.cnt;
  return { token, views: totals.views || 0, unique: totals.unique_count || 0, last_access_at: totals.last_access_at ?? null, by_event_type };
}

export function listAccessStats(opts: AccessStatsOptions = {}): AccessStats[] {
  const since = sinceWhere(opts, 'e.');
  const rows = getDb().query(`
    SELECT DISTINCT e.token
    FROM access_events e
    WHERE 1 = 1${since.sql}
    ORDER BY e.token
  `).all(...since.params) as { token: string }[];
  return rows.map((row) => getAccessStats(row.token, opts));
}

export function getAggregateAccessStats(opts: AccessStatsOptions = {}): Omit<AccessStats, 'token'> {
  const stats = listAccessStats(opts);
  return {
    views: stats.reduce((sum, item) => sum + item.views, 0),
    unique: stats.reduce((sum, item) => sum + item.unique, 0),
    last_access_at: stats.reduce<number | null>((latest, item) => item.last_access_at == null ? latest : latest == null ? item.last_access_at : Math.max(latest, item.last_access_at), null),
    by_event_type: stats.reduce<Record<string, number>>((acc, item) => {
      for (const [type, count] of Object.entries(item.by_event_type)) acc[type] = (acc[type] || 0) + count;
      return acc;
    }, {}),
  };
}

export function deleteAccessEventsForToken(token: string): number {
  return getDb().query('DELETE FROM access_events WHERE token = ?').run(token).changes;
}

export function parseStatsSince(value?: string): number | undefined {
  if (!value) return undefined;
  const seconds: Record<string, number> = { '24h': 86400, '7d': 7 * 86400, '30d': 30 * 86400 };
  if (!(value in seconds)) throw new Error('Invalid --since value. Use 24h, 7d, or 30d.');
  return Date.now() / 1000 - seconds[value];
}
