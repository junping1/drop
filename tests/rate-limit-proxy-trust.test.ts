import { afterEach, describe, expect, test } from 'bun:test';
import type { Context } from 'hono';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { rateLimitMiddleware } from '../src/server/middleware/rate-limit.js';
import { saveConfig } from '../src/shared/config.js';

// These tests exercise the real module-level rate limiter, so each test uses
// IP addresses unique to itself to avoid cross-test/cross-file bucket sharing.
//
// Config-based cases point DROP_CONFIG at an isolated temp file so they never
// read or write the real user config at ~/.drop/config.json.

function contextWithHeaders(headers: Record<string, string>): Context {
  return {
    req: { raw: { headers: new Headers(headers) } },
    text: (body: string, status: number) => new Response(body, { status }),
  } as unknown as Context;
}

async function hit(headers: Record<string, string>): Promise<Response | void> {
  const ctx = contextWithHeaders(headers);
  return rateLimitMiddleware(ctx, async () => {});
}

async function hitMany(headers: Record<string, string>, count: number): Promise<Response | void> {
  let last: Response | void;
  for (let i = 0; i < count; i++) {
    last = await hit(headers);
  }
  return last;
}

let tempRoot: string | null = null;

afterEach(() => {
  delete process.env.DROP_TRUST_PROXY;
  delete process.env.DROP_CONFIG;
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

describe('rate limiting proxy trust', () => {
  test('env-only trust gives independent buckets per client IP', async () => {
    process.env.DROP_TRUST_PROXY = '1';
    const headersA = { 'cf-connecting-ip': '203.0.113.201' };
    const headersB = { 'cf-connecting-ip': '203.0.113.202' };

    // Drive A well past the limit.
    const blockedA = await hitMany(headersA, 320);
    expect(blockedA).toBeInstanceOf(Response);
    expect((blockedA as Response).status).toBe(429);

    // B is a distinct bucket and must not be affected by A's exhaustion.
    const okB = await hit(headersB);
    expect(okB).toBeUndefined();
  });

  test('config-only trust also gives independent buckets per client IP (no env var)', async () => {
    delete process.env.DROP_TRUST_PROXY;
    tempRoot = mkdtempSync(join(tmpdir(), 'drop-config-trust-'));
    process.env.DROP_CONFIG = join(tempRoot, 'config.json');
    saveConfig({ trust_proxy: true });

    const headersA = { 'cf-connecting-ip': '203.0.113.211' };
    const headersB = { 'cf-connecting-ip': '203.0.113.212' };

    const blockedA = await hitMany(headersA, 320);
    expect(blockedA).toBeInstanceOf(Response);
    expect((blockedA as Response).status).toBe(429);

    const okB = await hit(headersB);
    expect(okB).toBeUndefined();
  });

  test('proxy untrusted collapses every client onto the same bucket', async () => {
    delete process.env.DROP_TRUST_PROXY;
    // Point DROP_CONFIG at a temp dir with no config.json: loadConfig() sees
    // no file and returns {}, so trust_proxy is falsy — same as an explicit
    // "not trusted" config, without ever touching the real config file.
    tempRoot = mkdtempSync(join(tmpdir(), 'drop-config-untrusted-'));
    process.env.DROP_CONFIG = join(tempRoot, 'config.json');

    const headersA = { 'cf-connecting-ip': '203.0.113.221' };
    const headersB = { 'cf-connecting-ip': '203.0.113.222' };

    // Both map to 127.0.0.1 when untrusted, so exhausting via A also blocks B.
    await hitMany(headersA, 300);
    const blockedB = await hit(headersB);
    expect(blockedB).toBeInstanceOf(Response);
    expect((blockedB as Response).status).toBe(429);
  });
});
