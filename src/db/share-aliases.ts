import { getDb } from './index.js';

export type ShareAliasType = 'file' | 'dir' | 'git';

export interface ShareAlias {
  slug: string;
  type: ShareAliasType;
  token: string;
  created_at: number;
}

export const RESERVED_SHARE_SLUGS = new Set([
  'api', 'raw', 'dashboard', 'verify', 'owner', 'live', 'robots.txt', 'favicon.ico',
  'f', 'd', 'git', 's', 'config', 'list', 'revoke',
]);

export function normalizeShareSlug(slug: string): string {
  return slug.toLowerCase();
}

export function validateShareSlug(slug: string): string {
  const normalized = normalizeShareSlug(slug.trim());
  if (RESERVED_SHARE_SLUGS.has(normalized)) {
    throw new Error(`slug is reserved: ${normalized}`);
  }
  if (!/^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$/.test(normalized)) {
    throw new Error('slug must be 3-64 characters, use only letters, numbers, _ or -, and start/end with a letter or number');
  }
  return normalized;
}

function ensureShareAliasesTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS share_aliases (
      slug TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('file', 'dir', 'git')),
      token TEXT NOT NULL,
      created_at REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_share_aliases_token ON share_aliases(token);
  `);
}


function tokenExistsForType(type: ShareAliasType, token: string): boolean {
  const db = getDb();
  if (type === 'file') return Boolean(db.query('SELECT token FROM authorizations WHERE token = ? LIMIT 1').get(token));
  if (type === 'dir') return Boolean(db.query('SELECT token FROM dir_authorizations WHERE token = ? LIMIT 1').get(token));
  return Boolean(db.query('SELECT token FROM git_authorizations WHERE token = ? LIMIT 1').get(token));
}

function slugMatchesExistingToken(slug: string): boolean {
  const db = getDb();
  const file = db.query('SELECT token FROM authorizations WHERE token = ? LIMIT 1').get(slug);
  if (file) return true;
  const dir = db.query('SELECT token FROM dir_authorizations WHERE token = ? LIMIT 1').get(slug);
  if (dir) return true;
  const git = db.query('SELECT token FROM git_authorizations WHERE token = ? LIMIT 1').get(slug);
  return Boolean(git);
}

export function assertShareSlugAvailable(slug: string): string {
  ensureShareAliasesTable();
  const normalized = validateShareSlug(slug);
  if (lookupShareAlias(normalized)) {
    throw new Error(`slug already exists: ${normalized}`);
  }
  if (slugMatchesExistingToken(normalized)) {
    throw new Error(`slug conflicts with an existing token: ${normalized}`);
  }
  return normalized;
}

export function createShareAlias(slug: string, type: ShareAliasType, token: string): ShareAlias {
  const normalized = assertShareSlugAvailable(slug);
  const db = getDb();
  const now = Date.now() / 1000;
  try {
    db.query('INSERT INTO share_aliases (slug, type, token, created_at) VALUES (?, ?, ?, ?)')
      .run(normalized, type, token, now);
  } catch (e: any) {
    if (String(e?.message || '').toLowerCase().includes('unique')) {
      throw new Error(`slug already exists: ${normalized}`);
    }
    throw e;
  }
  return { slug: normalized, type, token, created_at: now };
}

export function lookupShareAlias(slug: string): ShareAlias | null {
  ensureShareAliasesTable();
  const normalized = normalizeShareSlug(slug.trim());
  return getDb().query('SELECT slug, type, token, created_at FROM share_aliases WHERE slug = ?')
    .get(normalized) as ShareAlias | null;
}

export function lookupShareAliasByToken(token: string): ShareAlias | null {
  ensureShareAliasesTable();
  return getDb().query('SELECT slug, type, token, created_at FROM share_aliases WHERE token = ? ORDER BY created_at DESC LIMIT 1')
    .get(token) as ShareAlias | null;
}

export function resolveShareToken(type: ShareAliasType, publicId: string): string {
  if (tokenExistsForType(type, publicId)) return publicId;
  const alias = lookupShareAlias(publicId);
  if (alias && alias.type === type) return alias.token;
  return publicId;
}

export function deleteShareAliasesForToken(token: string): void {
  ensureShareAliasesTable();
  getDb().query('DELETE FROM share_aliases WHERE token = ?').run(token);
}
