import { existsSync, unlinkSync, readdirSync } from 'fs';
import { getDb } from './index.js';
import { deleteShareAliasesForToken } from './share-aliases.js';
import { deleteAccessEventsForToken } from './access-events.js';
import {
  SHARES_DIR,
  STATUS_ACTIVE, STATUS_EXPIRED,
} from '../shared/constants.js';
import { displayPath } from '../shared/utils.js';

export function cleanupExpiredShares(): void {
  if (!existsSync(SHARES_DIR)) return;

  const db = getDb();
  const now = Date.now() / 1000;
  const rows = db.query(
    'SELECT token, filepath FROM authorizations WHERE filepath LIKE ? AND expires_at < ?',
  ).all(SHARES_DIR + '%', now) as { token: string; filepath: string }[];

  for (const row of rows) {
    if (existsSync(row.filepath)) {
      try {
        unlinkSync(row.filepath);
      } catch {
        // ignore
      }
    }
    db.query('DELETE FROM authorizations WHERE token = ?').run(row.token);
    deleteShareAliasesForToken(row.token);
    deleteAccessEventsForToken(row.token);
  }
}

export interface AllAuthorizationItem {
  type: 'file' | 'git' | 'dir';
  token: string;
  path: string;
  name: string;
  created_at: number;
  expires_at: number;
  status: string;
  slug?: string;
}

export function listAllAuthorizations(): AllAuthorizationItem[] {
  const db = getDb();
  const now = Date.now() / 1000;
  const results: AllAuthorizationItem[] = [];

  const fileRows = db.query(
    'SELECT token, filepath, filename, created_at, expires_at FROM authorizations ORDER BY created_at DESC',
  ).all() as { token: string; filepath: string; filename: string; created_at: number; expires_at: number }[];

  for (const row of fileRows) {
    const alias = db.query('SELECT slug FROM share_aliases WHERE token = ? ORDER BY created_at DESC LIMIT 1').get(row.token) as { slug: string } | null;
    results.push({
      type: 'file',
      token: row.token,
      slug: alias?.slug,
      path: row.filepath,
      name: row.filename,
      created_at: row.created_at,
      expires_at: row.expires_at,
      status: row.expires_at > now ? STATUS_ACTIVE : STATUS_EXPIRED,
    });
  }

  const gitRows = db.query(
    'SELECT token, repo_path, commit_hash, created_at, expires_at FROM git_authorizations ORDER BY created_at DESC',
  ).all() as { token: string; repo_path: string; commit_hash: string; created_at: number; expires_at: number }[];

  for (const row of gitRows) {
    const alias = db.query('SELECT slug FROM share_aliases WHERE token = ? ORDER BY created_at DESC LIMIT 1').get(row.token) as { slug: string } | null;
    results.push({
      type: 'git',
      token: row.token,
      slug: alias?.slug,
      path: row.repo_path,
      name: row.commit_hash.slice(0, 12),
      created_at: row.created_at,
      expires_at: row.expires_at,
      status: row.expires_at > now ? STATUS_ACTIVE : STATUS_EXPIRED,
    });
  }

  const dirRows = db.query(
    'SELECT token, dirpath, dirname, created_at, expires_at FROM dir_authorizations ORDER BY created_at DESC',
  ).all() as { token: string; dirpath: string; dirname: string; created_at: number; expires_at: number }[];

  for (const row of dirRows) {
    const alias = db.query('SELECT slug FROM share_aliases WHERE token = ? ORDER BY created_at DESC LIMIT 1').get(row.token) as { slug: string } | null;
    results.push({
      type: 'dir',
      token: row.token,
      slug: alias?.slug,
      path: row.dirpath,
      name: row.dirname,
      created_at: row.created_at,
      expires_at: row.expires_at,
      status: row.expires_at > now ? STATUS_ACTIVE : STATUS_EXPIRED,
    });
  }

  results.sort((a, b) => b.created_at - a.created_at);
  return results;
}
