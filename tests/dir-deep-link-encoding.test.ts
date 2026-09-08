import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { app } from '../src/server/index.js';
import { closeDb } from '../src/db/index.js';
import { addDirAuthorization } from '../src/db/dir-authorizations.js';

function withTempDb(): string {
  closeDb();
  const root = mkdtempSync(join(tmpdir(), 'drop-dir-url-encoding-'));
  process.env.DROP_DB = join(root, 'drop.db');
  return root;
}

afterEach(() => {
  closeDb();
  delete process.env.DROP_DB;
});

describe('directory deep-link path decoding', () => {
  test('a malformed percent-escape in the deep-link path returns 400, not 500', async () => {
    const root = withTempDb();
    try {
      const dir = join(root, 'share');
      mkdirSync(dir);
      writeFileSync(join(dir, 'a.txt'), 'hello');
      const token = addDirAuthorization(dir, 60, []).token;

      const res = await app.request(`/d/${token}/100%zz.txt`);
      expect(res.status).toBe(400);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a percent-encoded Chinese filename in the deep-link path still resolves', async () => {
    const root = withTempDb();
    try {
      const dir = join(root, 'share');
      mkdirSync(dir);
      const filename = '笔记.md';
      writeFileSync(join(dir, filename), '# hi');
      const token = addDirAuthorization(dir, 60, []).token;

      const res = await app.request(`/d/${token}/${encodeURIComponent(filename)}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain(JSON.stringify(filename));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
