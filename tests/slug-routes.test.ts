import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { app } from '../src/server/index.js';
import { closeDb } from '../src/db/index.js';
import { addAuthorization } from '../src/db/authorizations.js';
import { addDirAuthorization } from '../src/db/dir-authorizations.js';
import { createShareAlias } from '../src/db/share-aliases.js';

function withTempDb(): string {
  closeDb();
  const root = mkdtempSync(join(tmpdir(), 'drop-slug-routes-'));
  process.env.DROP_DB = join(root, 'drop.db');
  return root;
}

afterEach(() => {
  closeDb();
  delete process.env.DROP_DB;
});

describe('slug routes', () => {
  test('serves file routes by slug while token URL still works', async () => {
    const root = withTempDb();
    try {
      const file = join(root, 'hello.txt');
      writeFileSync(file, 'hello slug');
      const { token } = addAuthorization(file, 60);
      createShareAlias('hello-file', 'file', token);

      const bySlug = await app.request('/f/hello-file');
      const byToken = await app.request(`/f/${token}`);

      expect(bySlug.status).toBe(200);
      expect(await bySlug.text()).toContain('hello slug');
      expect(byToken.status).toBe(200);
      expect(await byToken.text()).toContain('hello slug');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('directory shell and API use the requested public id instead of leaking token', async () => {
    const root = withTempDb();
    try {
      const dir = join(root, 'docs');
      mkdirSync(dir);
      writeFileSync(join(dir, 'a.bin'), 'alpha');
      const { token } = addDirAuthorization(dir, 60, []);
      createShareAlias('docs-slug', 'dir', token);

      const page = await app.request('/d/docs-slug');
      const html = await page.text();
      expect(page.status).toBe(200);
      expect(html).toContain('"docs-slug"');
      expect(html).not.toContain(token);

      const api = await app.request('/d/docs-slug/api/file?path=a.bin');
      const json = await api.json() as { url: string };
      expect(api.status).toBe(200);
      expect(json.url).toContain('/d/docs-slug/raw?path=a.bin');
      expect(json.url).not.toContain(token);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
