import type { Context, Next } from 'hono';
import { isProxyTrusted } from '../../shared/config.js';

const RATE_LIMIT = 300;
const RATE_WINDOW = 60; // seconds
const RATE_CLEANUP_INTERVAL = 300; // seconds

const rateLimits = new Map<string, number[]>();
let lastCleanup = Date.now() / 1000;

export function getClientIpFromHeaders(headers: Headers, trustProxy = false): string {
  if (!trustProxy) return '127.0.0.1';

  // CF-Connecting-IP (Cloudflare) takes priority
  const cfIp = headers.get('cf-connecting-ip');
  if (cfIp) return cfIp.trim();

  // X-Forwarded-For: first entry is the original client when the proxy is trusted.
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',');
    return parts[0].trim();
  }

  return headers.get('x-real-ip') || '127.0.0.1';
}

function getClientIp(c: Context): string {
  return getClientIpFromHeaders(c.req.raw.headers, isProxyTrusted());
}

export async function rateLimitMiddleware(c: Context, next: Next): Promise<Response | void> {
  const ip = getClientIp(c);
  const now = Date.now() / 1000;

  // Periodic cleanup of stale IPs
  if (now - lastCleanup > RATE_CLEANUP_INTERVAL) {
    for (const [k, v] of rateLimits) {
      if (!v.length || v[v.length - 1] < now - RATE_WINDOW) {
        rateLimits.delete(k);
      }
    }
    lastCleanup = now;
  }

  let entries = rateLimits.get(ip);
  if (entries) {
    entries = entries.filter(t => now - t < RATE_WINDOW);
    rateLimits.set(ip, entries);
  } else {
    entries = [];
    rateLimits.set(ip, entries);
  }

  if (entries.length >= RATE_LIMIT) {
    return c.text('Rate limit exceeded', 429);
  }
  entries.push(now);

  await next();
}
