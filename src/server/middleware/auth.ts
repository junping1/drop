/**
 * Auth middleware and helpers.
 * Ported from Python server.py auth helpers.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { getOwnerKey } from '../../shared/config.js';
import { loadConfig } from '../../shared/config.js';
import { DEFAULT_TTL, DIR_DEFAULT_TTL, STATUS_ACTIVE } from '../../shared/constants.js';
import { getDb } from '../../db/index.js';
import { expiredPageHtml } from '../render/html-templates.js';

const ALLOWED_TABLES = new Set(['authorizations', 'git_authorizations', 'dir_authorizations']);

/**
 * Sign a cookie value with HMAC-SHA256.
 */
function signValue(value: string, secret: string): string {
  const hmac = createHmac('sha256', secret).update(value).digest('hex');
  return `${value}.${hmac}`;
}

/**
 * Verify and extract a signed cookie value.
 */
function verifySignedValue(signed: string, secret: string): string | null {
  const dotIdx = signed.lastIndexOf('.');
  if (dotIdx === -1) return null;
  const value = signed.slice(0, dotIdx);
  const sig = signed.slice(dotIdx + 1);
  const expected = createHmac('sha256', secret).update(value).digest('hex');

  // Timing-safe comparison
  if (sig.length !== expected.length) return null;
  try {
    const sigBuf = Buffer.from(sig, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length) return null;
    if (timingSafeEqual(sigBuf, expBuf)) return value;
  } catch {
    return null;
  }
  return null;
}

/**
 * Sign an opaque authorization value with HMAC-SHA256.
 * This authenticates the value but does not encrypt it.
 */
export function signAuthValue(value: string, secret: string): string {
  return signValue(value, secret);
}

/**
 * Verify an HMAC-signed authorization value and return the unsigned value.
 */
export function verifyAuthValue(signed: string, secret: string): string | null {
  return verifySignedValue(signed, secret);
}

/**
 * Check if request has a valid owner cookie.
 */
export function checkOwnerAuth(c: Context): boolean {
  const ownerKey = getOwnerKey();
  const cookie = getCookie(c, 'drop_owner');
  if (!cookie) return false;
  return verifySignedValue(cookie, ownerKey) === 'owner';
}

/**
 * Set owner cookie (30-day).
 */
export function setOwnerCookie(c: Context): void {
  const ownerKey = getOwnerKey();
  const signed = signValue('owner', ownerKey);
  setCookie(c, 'drop_owner', signed, {
    path: '/',
    maxAge: 30 * 86400,
    httpOnly: true,
    sameSite: 'Lax',
  });
}

/**
 * Check if request has valid auth cookie for password-protected expired shares.
 */
export function checkExpiredAuth(c: Context, password: string): boolean {
  const cookie = getCookie(c, 'drop_auth');
  if (!cookie) return false;
  return verifySignedValue(cookie, password) === 'verified';
}

/**
 * Set auth cookie for password verification (24-hour).
 */
export function setAuthCookie(c: Context, password: string): void {
  const signed = signValue('verified', password);
  setCookie(c, 'drop_auth', signed, {
    path: '/',
    maxAge: 86400,
    httpOnly: true,
    sameSite: 'Lax',
  });
}

/**
 * Extend a token's expiry. Table name must be in the allowlist.
 */
export function extendExpiry(table: string, token: string, ttl: number): void {
  if (!ALLOWED_TABLES.has(table)) {
    throw new Error(`Invalid table: ${table}`);
  }
  const db = getDb();
  db.query(`UPDATE ${table} SET expires_at = ? WHERE token = ?`).run(Date.now() / 1000 + ttl, token);
}

/**
 * Handle expired authorization.
 * Returns HTML response string if expired, or null if owner/password-authed (and extends expiry).
 */
export function handleExpired(
  c: Context,
  row: Record<string, any>,
  nameField: string,
  token: string,
  table: string = 'authorizations',
): string | null {
  const cfg = loadConfig();
  const ttl = table === 'dir_authorizations'
    ? (cfg.dir_default_ttl || DIR_DEFAULT_TTL)
    : (cfg.file_ttl || DEFAULT_TTL);

  // Owner cookie bypasses expiry
  if (checkOwnerAuth(c)) {
    extendExpiry(table, token, ttl);
    return null;
  }

  // Regular auth cookie (for backward compat with password config)
  const password = cfg.password as string | undefined;
  if (password && checkExpiredAuth(c, password)) {
    extendExpiry(table, token, ttl);
    return null;
  }

  const verifyUrl = password ? `/verify?next=${c.req.path}` : '';
  return expiredPageHtml({
    filename: String(row[nameField]),
    verifyUrl,
  });
}

/**
 * Timing-safe string comparison.
 */
export function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  return timingSafeEqual(aBuf, bBuf);
}
