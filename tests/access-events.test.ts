import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { closeDb, getDb } from '../src/db/index.js';
import {
  deleteAccessEventsForToken,
  getAccessStats,
  recordAccessEvent,
} from '../src/db/access-events.js';

function withTempDb(): string {
  closeDb();
  const root = mkdtempSync(join(tmpdir(), 'drop-access-events-'));
  process.env.DROP_DB = join(root, 'drop.db');
  return root;
}

afterEach(() => {
  closeDb();
  delete process.env.DROP_DB;
});

describe('access events storage and stats', () => {
  test('creates access_events with privacy-safe fields only', () => {
    const root = withTempDb();
    try {
      recordAccessEvent({
        token: 'tok123',
        shareType: 'dir',
        eventType: 'raw_view',
        success: true,
        ip: '203.0.113.9',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/605.1.15',
        referer: 'https://example.com/private/page?secret=1',
        targetPath: 'nested/private/report.pdf?download=token',
      });

      const db = getDb();
      const row = db.query('SELECT * FROM access_events WHERE token = ?').get('tok123') as any;

      expect(row.event_type).toBe('raw_view');
      expect(row.outcome).toBe('success');
      expect(row.client_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.client_hash).not.toContain('203.0.113.9');
      expect(row.ua_kind).toBe('safari');
      expect(row.referer_origin).toBe('https://example.com');
      expect(row.referer_origin).not.toContain('/private/page');
      expect(row.target_path_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.target_path_hash).not.toContain('nested/private/report.pdf');
      expect(row.target_ext).toBe('.pdf');
      expect(JSON.stringify(row)).not.toContain('203.0.113.9');
      expect(JSON.stringify(row)).not.toContain('Mozilla/5.0');
      expect(JSON.stringify(row)).not.toContain('secret=1');
      expect(JSON.stringify(row)).not.toContain('nested/private');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('default stats count successful page and raw views but exclude api and live events', () => {
    const root = withTempDb();
    try {
      for (const eventType of ['page_view', 'raw_view', 'api_tree', 'api_preview', 'live_poll'] as const) {
        recordAccessEvent({ token: 'tok123', shareType: 'dir', eventType, success: true, ip: '198.51.100.1' });
      }
      recordAccessEvent({ token: 'tok123', shareType: 'dir', eventType: 'page_view', success: false, ip: '198.51.100.2' });

      expect(getAccessStats('tok123')).toEqual({
        token: 'tok123',
        views: 2,
        unique: 1,
        last_access_at: expect.any(Number),
        by_event_type: { page_view: 1, raw_view: 1, api_tree: 1, api_preview: 1, live_poll: 1 },
      });

      expect(getAccessStats('tok123', { includeLive: true }).views).toBe(3);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('can delete all events for a revoked token', () => {
    const root = withTempDb();
    try {
      recordAccessEvent({ token: 'tok-a', shareType: 'file', eventType: 'page_view', success: true, ip: '1.1.1.1' });
      recordAccessEvent({ token: 'tok-b', shareType: 'file', eventType: 'page_view', success: true, ip: '1.1.1.1' });

      expect(deleteAccessEventsForToken('tok-a')).toBe(1);
      expect(getAccessStats('tok-a').views).toBe(0);
      expect(getAccessStats('tok-b').views).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
