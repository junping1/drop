import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { closeDb } from '../src/db/index.js';
import { recordAccessEvent } from '../src/db/access-events.js';
import { addAuthorization } from '../src/db/authorizations.js';
import { createShareAlias } from '../src/db/share-aliases.js';
import { getOwnerKey } from '../src/shared/config.js';
import { app } from '../src/server/index.js';

function withTempDb(): string {
  closeDb();
  const root = mkdtempSync(join(tmpdir(), 'drop-stats-api-'));
  process.env.DROP_DB = join(root, 'drop.db');
  return root;
}

afterEach(() => {
  closeDb();
  delete process.env.DROP_DB;
});

describe('owner-only stats API', () => {
  test('rejects unauthenticated callers', async () => {
    const root = withTempDb();
    try {
      const res = await app.fetch(new Request('http://drop.test/api/stats'));
      expect(res.status).toBe(403);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects the owner key passed via query string (header-only)', async () => {
    const root = withTempDb();
    try {
      const key = getOwnerKey();
      const res = await app.fetch(new Request(`http://drop.test/api/stats?key=${key}`));
      expect(res.status).toBe(403);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('returns aggregate and per-token stats for authenticated owners without counting api routes as views', async () => {
    const root = withTempDb();
    try {
      recordAccessEvent({ token: 'tok-a', shareType: 'file', eventType: 'page_view', success: true, ip: '1.1.1.1' });
      recordAccessEvent({ token: 'tok-a', shareType: 'file', eventType: 'api_preview', success: true, ip: '1.1.1.2' });
      recordAccessEvent({ token: 'tok-b', shareType: 'dir', eventType: 'raw_view', success: true, ip: '2.2.2.2' });
      const key = getOwnerKey();

      const all = await app.fetch(new Request('http://drop.test/api/stats', { headers: { 'x-owner-key': key } }));
      expect(all.status).toBe(200);
      const allJson = await all.json() as any;
      expect(allJson.totals.views).toBe(2);
      expect(allJson.tokens).toHaveLength(2);

      const one = await app.fetch(new Request('http://drop.test/api/stats/tok-a', { headers: { 'x-owner-key': key } }));
      expect(one.status).toBe(200);
      expect(await one.json()).toMatchObject({ token: 'tok-a', views: 1, unique: 1 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('accepts a share slug for single-share stats lookup', async () => {
    const root = withTempDb();
    try {
      const file = join(root, 'note.txt');
      writeFileSync(file, 'hello');
      const { token } = addAuthorization(file, 3600);
      createShareAlias('api-stats-note', 'file', token);
      recordAccessEvent({ token, shareType: 'file', eventType: 'page_view', success: true, ip: '1.1.1.1' });

      const key = getOwnerKey();
      const res = await app.fetch(new Request('http://drop.test/api/stats/api-stats-note', { headers: { 'x-owner-key': key } }));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ token, views: 1, unique: 1 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
