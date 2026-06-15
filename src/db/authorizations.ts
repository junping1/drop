import { randomBytes } from 'crypto';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { getDb } from './index.js';
import { deleteShareAliasesForToken, lookupShareAlias } from './share-aliases.js';
import { deleteAccessEventsForToken } from './access-events.js';
import {
  TOKEN_LENGTH,
  STATUS_VALID, STATUS_EXPIRED, STATUS_NOT_FOUND,
} from '../shared/constants.js';
import type { FileAuthorization, AuthorizationStatus } from '../shared/types.js';

export function addAuthorization(
  filepath: string,
  ttl: number,
  live = false,
): { token: string; filename: string; isNew: boolean } {
  const absPath = resolve(filepath);
  if (!existsSync(absPath)) {
    throw new Error(`File not found: ${absPath}`);
  }

  const filename = absPath.split('/').pop()!;
  const now = Date.now() / 1000;
  const db = getDb();

  const existing = db.query(
    'SELECT token FROM authorizations WHERE filepath = ? AND expires_at > ?',
  ).get(absPath, now) as { token: string } | null;

  if (existing) {
    db.query(
      'UPDATE authorizations SET expires_at = ?, live = ? WHERE token = ?',
    ).run(now + ttl, live ? 1 : 0, existing.token);
    return { token: existing.token, filename, isNew: false };
  }

  const token = randomBytes(TOKEN_LENGTH).toString('hex');
  db.query(
    'INSERT INTO authorizations (token, filepath, filename, created_at, expires_at, live) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(token, absPath, filename, now, now + ttl, live ? 1 : 0);
  return { token, filename, isNew: true };
}

export function removeAuthorization(tokenOrSlug: string): boolean {
  const db = getDb();
  const alias = lookupShareAlias(tokenOrSlug);
  const token = alias?.token || tokenOrSlug;
  const fileResult = db.query('DELETE FROM authorizations WHERE token = ?').run(token);
  const dirResult = db.query('DELETE FROM dir_authorizations WHERE token = ?').run(token);
  const gitResult = db.query('DELETE FROM git_authorizations WHERE token = ?').run(token);
  const changed = (fileResult.changes + dirResult.changes + gitResult.changes) > 0;
  if (changed) {
    deleteShareAliasesForToken(token);
    deleteAccessEventsForToken(token);
  }
  return changed;
}

export function listAuthorizations(): FileAuthorization[] {
  const db = getDb();
  return db.query(
    'SELECT token, filepath, filename, created_at, expires_at FROM authorizations ORDER BY created_at DESC',
  ).all() as FileAuthorization[];
}

export function lookupAuthorization(token: string): { row: FileAuthorization | null; status: AuthorizationStatus } {
  const db = getDb();
  const row = db.query(
    'SELECT token, filepath, filename, created_at, expires_at, live FROM authorizations WHERE token = ?',
  ).get(token) as FileAuthorization | null;

  if (!row) return { row: null, status: STATUS_NOT_FOUND };
  if (Date.now() / 1000 > row.expires_at) return { row, status: STATUS_EXPIRED };
  return { row, status: STATUS_VALID };
}

export function hasActiveAuthorizations(): boolean {
  const db = getDb();
  const now = Date.now() / 1000;

  const fileCnt = (db.query(
    'SELECT COUNT(*) as cnt FROM authorizations WHERE expires_at > ?',
  ).get(now) as { cnt: number }).cnt;

  const gitCnt = (db.query(
    'SELECT COUNT(*) as cnt FROM git_authorizations WHERE expires_at > ?',
  ).get(now) as { cnt: number }).cnt;

  const dirCnt = (db.query(
    'SELECT COUNT(*) as cnt FROM dir_authorizations WHERE expires_at > ?',
  ).get(now) as { cnt: number }).cnt;

  return (fileCnt + gitCnt + dirCnt) > 0;
}
