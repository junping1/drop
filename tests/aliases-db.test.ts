import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { closeDb, getDb } from '../src/db/index.js';
import { addAuthorization, removeAuthorization } from '../src/db/authorizations.js';
import { createShareAlias, lookupShareAlias, resolveShareToken } from '../src/db/share-aliases.js';

function withTempDb(): string {
  closeDb();
  const root = mkdtempSync(join(tmpdir(), 'drop-alias-db-'));
  process.env.DROP_DB = join(root, 'drop.db');
  return root;
}

afterEach(() => {
  closeDb();
  delete process.env.DROP_DB;
});

describe('share aliases db', () => {
  test('creates share_aliases without replacing token primary keys', () => {
    const root = withTempDb();
    try {
      const file = join(root, 'file.txt');
      writeFileSync(file, 'hello');
      const auth = addAuthorization(file, 60);

      const alias = createShareAlias('Friendly_Slug', 'file', auth.token);

      expect(alias.slug).toBe('friendly_slug');
      expect(alias.token).toBe(auth.token);
      expect(lookupShareAlias('FRIENDLY_SLUG')).toMatchObject({ token: auth.token, type: 'file' });
      expect(resolveShareToken('file', 'friendly_slug')).toBe(auth.token);
      expect(resolveShareToken('file', auth.token)).toBe(auth.token);
      expect(getDb().query('SELECT token FROM authorizations WHERE token = ?').get(auth.token)).toEqual({ token: auth.token });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('enforces global slug uniqueness across share types', () => {
    const root = withTempDb();
    try {
      createShareAlias('same-slug', 'file', 'file-token');
      expect(() => createShareAlias('SAME-SLUG', 'dir', 'dir-token')).toThrow('already exists');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects slugs that equal existing tokens so token URLs keep precedence', () => {
    const root = withTempDb();
    try {
      const fileA = join(root, 'a.txt');
      const fileB = join(root, 'b.txt');
      writeFileSync(fileA, 'a');
      writeFileSync(fileB, 'b');
      const a = addAuthorization(fileA, 60);
      const b = addAuthorization(fileB, 60);

      expect(() => createShareAlias(a.token, 'file', b.token)).toThrow('existing token');
      expect(resolveShareToken('file', a.token)).toBe(a.token);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('revoke by token removes its aliases and revoke by slug removes authorization', () => {
    const root = withTempDb();
    try {
      const fileA = join(root, 'a.txt');
      const fileB = join(root, 'b.txt');
      writeFileSync(fileA, 'a');
      writeFileSync(fileB, 'b');
      const a = addAuthorization(fileA, 60);
      const b = addAuthorization(fileB, 60);
      createShareAlias('slug-a', 'file', a.token);
      createShareAlias('slug-b', 'file', b.token);

      expect(removeAuthorization(a.token)).toBe(true);
      expect(lookupShareAlias('slug-a')).toBeNull();

      expect(removeAuthorization('slug-b')).toBe(true);
      expect(lookupShareAlias('slug-b')).toBeNull();
      expect(getDb().query('SELECT token FROM authorizations WHERE token = ?').get(b.token)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
