import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { app } from '../src/server/index.js';
import { closeDb } from '../src/db/index.js';
import { addAuthorization } from '../src/db/authorizations.js';
import { createShareAlias } from '../src/db/share-aliases.js';
import { saveConfig } from '../src/shared/config.js';
import { CONFIG_PATH } from '../src/shared/constants.js';

let oldConfig: string | null = null;

function withTempDb(): string {
  closeDb();
  oldConfig = existsSync(CONFIG_PATH) ? readFileSync(CONFIG_PATH, 'utf-8') : null;
  const root = mkdtempSync(join(tmpdir(), 'drop-dashboard-slug-'));
  process.env.DROP_DB = join(root, 'drop.db');
  saveConfig({ owner_key: 'owner-secret', base_url: 'https://drop.example' });
  return root;
}

afterEach(() => {
  closeDb();
  delete process.env.DROP_DB;
  if (oldConfig === null) {
    saveConfig({});
    rmSync(CONFIG_PATH, { force: true });
  } else {
    saveConfig(JSON.parse(oldConfig));
  }
  oldConfig = null;
});

describe('dashboard slug support', () => {
  test('dashboard links to slug URL and displays slug when present', async () => {
    const root = withTempDb();
    try {
      const file = join(root, 'file.txt');
      writeFileSync(file, 'hello');
      const { token } = addAuthorization(file, 60);
      createShareAlias('dash-slug', 'file', token);

      const res = await app.request('/dashboard?key=owner-secret');
      const html = await res.text();
      expect(res.status).toBe(200);
      expect(html).toContain('https://drop.example/f/dash-slug');
      expect(html).toContain('dash-slug');
      expect(html).not.toContain(`https://drop.example/f/${token}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
