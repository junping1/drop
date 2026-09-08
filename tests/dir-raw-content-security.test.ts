import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { app } from '../src/server/index.js';
import { closeDb } from '../src/db/index.js';
import { addDirAuthorization } from '../src/db/dir-authorizations.js';

function withTempDb(): string {
  closeDb();
  const root = mkdtempSync(join(tmpdir(), 'drop-raw-content-security-'));
  process.env.DROP_DB = join(root, 'drop.db');
  return root;
}

afterEach(() => {
  closeDb();
  delete process.env.DROP_DB;
});

describe('dir raw route content security', () => {
  test('serves evil.html as a download, not an executable document', async () => {
    const root = withTempDb();
    try {
      const dir = join(root, 'share');
      mkdirSync(dir);
      writeFileSync(join(dir, 'evil.html'), '<script>alert(document.cookie)</script>');
      const { token } = addDirAuthorization(dir, 60, []);

      const res = await app.request(`/d/${token}/raw?path=evil.html`);

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).not.toContain('text/html');
      expect(res.headers.get('Content-Disposition')).toContain('attachment');
      expect(res.headers.get('Content-Security-Policy')).toContain('sandbox');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('serves evil.svg as a download, not an executable document', async () => {
    const root = withTempDb();
    try {
      const dir = join(root, 'share');
      mkdirSync(dir);
      writeFileSync(
        join(dir, 'evil.svg'),
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script></svg>',
      );
      const { token } = addDirAuthorization(dir, 60, []);

      const res = await app.request(`/d/${token}/raw?path=evil.svg`);

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).not.toContain('image/svg+xml');
      expect(res.headers.get('Content-Disposition')).toContain('attachment');
      expect(res.headers.get('Content-Security-Policy')).toContain('sandbox');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a non-ASCII filename does not make the raw route throw', async () => {
    const root = withTempDb();
    try {
      const dir = join(root, 'share');
      mkdirSync(dir);
      writeFileSync(join(dir, '报告.html'), '<script>alert(document.cookie)</script>');
      const { token } = addDirAuthorization(dir, 60, []);

      const res = await app.request(`/d/${token}/raw?path=${encodeURIComponent('报告.html')}`);

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).not.toContain('text/html');
      expect(res.headers.get('Content-Disposition')).toContain('attachment');
      expect(res.headers.get('Content-Security-Policy')).toContain('sandbox');
      expect(res.headers.get('Content-Disposition')).toContain("filename*=UTF-8''");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a filename containing a double quote produces a valid single header value', async () => {
    const root = withTempDb();
    try {
      const dir = join(root, 'share');
      mkdirSync(dir);
      writeFileSync(join(dir, 'a"b.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
      const { token } = addDirAuthorization(dir, 60, []);

      const res = await app.request(`/d/${token}/raw?path=${encodeURIComponent('a"b.svg')}`);

      expect(res.status).toBe(200);
      const disposition = res.headers.get('Content-Disposition');
      expect(disposition).not.toBeNull();
      expect(disposition).toContain('attachment');
      // The ASCII fallback filename must not contain a raw double quote that
      // would break out of the quoted string.
      const fallbackMatch = disposition!.match(/filename="([^"]*)"/);
      expect(fallbackMatch).not.toBeNull();
      expect(fallbackMatch![1]).not.toContain('"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a .png in the same share still serves inline with its real content type', async () => {
    const root = withTempDb();
    try {
      const dir = join(root, 'share');
      mkdirSync(dir);
      // Not a real PNG, but content type is decided purely by extension.
      writeFileSync(join(dir, 'photo.png'), 'not-really-png-bytes');
      const { token } = addDirAuthorization(dir, 60, []);

      const res = await app.request(`/d/${token}/raw?path=photo.png`);

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/png');
      expect(res.headers.get('Content-Disposition')).toContain('inline');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
