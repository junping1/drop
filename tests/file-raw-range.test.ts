import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { closeDb } from '../src/db/index.js';
import { addAuthorization } from '../src/db/authorizations.js';
import { addDirAuthorization } from '../src/db/dir-authorizations.js';
import { app } from '../src/server/index.js';

// Browser PDF viewers and media players rely on Content-Length, Accept-Ranges
// and 206 range responses; without them Chrome's PDF viewer can fail to load
// and Safari refuses to play media. File and directory shares serve bytes
// through the same raw response, so every case runs against both.

function withTempDb(): string {
  closeDb();
  const root = mkdtempSync(join(tmpdir(), 'drop-file-range-'));
  process.env.DROP_DB = join(root, 'drop.db');
  // Access logging lazily creates an owner key via saveConfig(); keep it out
  // of the real user config.
  process.env.DROP_CONFIG = join(root, 'config.json');
  return root;
}

afterEach(() => {
  closeDb();
  delete process.env.DROP_DB;
  delete process.env.DROP_CONFIG;
  delete process.env.DROP_TRUST_PROXY;
});

// The rate limiter is process-wide and keyed by client IP; when the whole
// suite runs in one process, earlier files can exhaust the shared bucket.
// Give every request its own documentation-range client IP.
let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `198.51.100.${(ipCounter % 250) + 1}`;
}
function fetchAs(url: string, init: RequestInit = {}): Promise<Response> {
  process.env.DROP_TRUST_PROXY = '1';
  const headers = new Headers(init.headers);
  headers.set('cf-connecting-ip', nextIp());
  return app.fetch(new Request(url, { ...init, headers }));
}

function makeBytes(size: number): Buffer {
  const bytes = Buffer.alloc(size);
  Buffer.from('%PDF-1.4\n').copy(bytes, 0);
  for (let i = 9; i < size; i++) bytes[i] = i % 251;
  return bytes.subarray(0, size);
}

type Target = { name: string; share: (root: string, bytes: Buffer) => string };

/** Each target writes `report.pdf` and returns the path that serves its bytes. */
const TARGETS: Target[] = [
  { name: '/f/:token', share: (root, bytes) => { const f = join(root, 'report.pdf'); writeFileSync(f, bytes); return `/f/${addAuthorization(f, 60).token}`; } },
  { name: '/f/:token/raw', share: (root, bytes) => { const f = join(root, 'report.pdf'); writeFileSync(f, bytes); return `/f/${addAuthorization(f, 60).token}/raw`; } },
  {
    name: '/d/:token/raw?path=',
    share: (root, bytes) => {
      const dir = join(root, 'share');
      mkdirSync(dir);
      writeFileSync(join(dir, 'report.pdf'), bytes);
      return `/d/${addDirAuthorization(dir, 60, []).token}/raw?path=report.pdf`;
    },
  },
];

async function withShare(target: Target, size: number, fn: (url: string, bytes: Buffer) => Promise<void>) {
  const root = withTempDb();
  try {
    const bytes = makeBytes(size);
    await fn(`http://drop.test${target.share(root, bytes)}`, bytes);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// [Range header, expected status, expected [start, end] for 206]
const RANGE_CASES: Array<[string, number, [number, number]?]> = [
  ['bytes=100-199', 206, [100, 199]],
  ['bytes=9900-', 206, [9900, 9999]],
  ['bytes=-50', 206, [9950, 9999]],
  ['bytes=9990-20000', 206, [9990, 9999]],          // end past EOF is truncated
  ['Bytes=100-199', 206, [100, 199]],               // range unit is case-insensitive
  ['bytes=0-0', 206, [0, 0]],
  ['bytes=-0', 416],                                // zero-length suffix
  ['bytes=200-100', 416],                           // start > end
  ['bytes=10000-', 416],                            // start at EOF
  ['bytes=20000-30000', 416],
  ['bytes=0-1,5-6', 200],                           // multi-range: fall back to the whole file
  ['bytes=abc', 200],                               // malformed: ignored
  ['items=0-1', 200],                               // unknown unit: ignored
];

for (const target of TARGETS) {
  describe(`raw responses on ${target.name}`, () => {
    test('GET advertises length and range support', async () => {
      await withShare(target, 10_000, async (url, bytes) => {
        const res = await fetchAs(url);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-length')).toBe(String(bytes.length));
        expect(res.headers.get('accept-ranges')).toBe('bytes');
        expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
      });
    });

    for (const [range, status, bounds] of RANGE_CASES) {
      test(`Range "${range}" -> ${status}`, async () => {
        await withShare(target, 10_000, async (url, bytes) => {
          const res = await fetchAs(url, { headers: { Range: range } });
          expect(res.status).toBe(status);
          const body = Buffer.from(await res.arrayBuffer());
          if (status === 206) {
            const [start, end] = bounds!;
            expect(res.headers.get('content-range')).toBe(`bytes ${start}-${end}/${bytes.length}`);
            expect(res.headers.get('content-length')).toBe(String(end - start + 1));
            expect(body.equals(bytes.subarray(start, end + 1))).toBe(true);
          } else if (status === 416) {
            expect(res.headers.get('content-range')).toBe(`bytes */${bytes.length}`);
          } else {
            expect(res.headers.get('content-range')).toBeNull();
            expect(body.equals(bytes)).toBe(true);
          }
        });
      });
    }

    test('an empty file serves 200 with length 0, and any range on it is unsatisfiable', async () => {
      await withShare(target, 0, async (url) => {
        const res = await fetchAs(url);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-length')).toBe('0');
        // RFC 9110 also allows ignoring the Range here; this server chooses 416.
        const ranged = await fetchAs(url, { headers: { Range: 'bytes=0-' } });
        expect(ranged.status).toBe(416);
        expect(ranged.headers.get('content-range')).toBe('bytes */0');
      });
    });

    test('HEAD reports the real size', async () => {
      await withShare(target, 10_000, async (url, bytes) => {
        const res = await fetchAs(url, { method: 'HEAD' });
        expect(res.status).toBe(200);
        expect(res.headers.get('content-length')).toBe(String(bytes.length));
        expect(res.headers.get('accept-ranges')).toBe('bytes');
      });
    });

    test('HEAD ignores Range (RFC 9110 §14.2): 200, whole length, no Content-Range, no body', async () => {
      await withShare(target, 10_000, async (url, bytes) => {
        for (const range of ['bytes=10-19', 'bytes=20000-30000']) {
          const res = await fetchAs(url, { method: 'HEAD', headers: { Range: range } });
          expect(res.status).toBe(200);
          expect(res.headers.get('content-length')).toBe(String(bytes.length));
          expect(res.headers.get('content-range')).toBeNull();
          expect((await res.arrayBuffer()).byteLength).toBe(0);
        }
      });
    });

    test('If-Range: a matching validator keeps the range, a stale one gets the whole file', async () => {
      await withShare(target, 10_000, async (url, bytes) => {
        const first = await fetchAs(url);
        const etag = first.headers.get('etag');
        const lastModified = first.headers.get('last-modified');
        expect(etag).toMatch(/^"[^"]+"$/);
        expect(lastModified).not.toBeNull();
        await first.arrayBuffer();

        for (const ifRange of [etag!, lastModified!]) {
          const res = await fetchAs(url, { headers: { Range: 'bytes=10-19', 'If-Range': ifRange } });
          expect(res.status).toBe(206);
          expect(res.headers.get('content-range')).toBe(`bytes 10-19/${bytes.length}`);
        }

        for (const ifRange of ['"definitely-not-current"', `W/${etag}`, 'Thu, 01 Jan 1970 00:00:00 GMT', 'garbage']) {
          const res = await fetchAs(url, { headers: { Range: 'bytes=10-19', 'If-Range': ifRange } });
          expect(res.status).toBe(200);
          expect(res.headers.get('content-range')).toBeNull();
          expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
        }
      });
    });
  });
}

describe('ranged responses over a real Bun.serve socket', () => {
  // app.fetch() keeps whatever headers the handler set, but Bun.serve drops
  // Content-Length for streamed bodies and falls back to chunked encoding.
  // Safari refuses to play media whose 206 responses lack Content-Length.
  // The file is larger than the 8 MiB per-response cap so open-ended ranges
  // are shortened to exactly one chunk.
  const CAP = 8 * 1024 * 1024;
  for (const target of TARGETS.filter((t) => t.name !== '/f/:token')) {
    test(`206 responses on ${target.name} carry Content-Length, are not chunked, and are capped at 8 MiB`, async () => {
      const root = withTempDb();
      process.env.DROP_TRUST_PROXY = '1';
      const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: app.fetch });
      try {
        const bytes = makeBytes(9 * 1024 * 1024);
        const path = target.share(root, bytes);
        const cases: Array<[string, number, number]> = [
          ['bytes=0-1', 0, 1],
          ['bytes=0-', 0, CAP - 1],
          [`bytes=${CAP}-`, CAP, bytes.length - 1],
          ['bytes=1000-', 1000, 1000 + CAP - 1],
        ];
        for (const [range, start, end] of cases) {
          const res = await fetch(`http://127.0.0.1:${server.port}${path}`, {
            headers: { Range: range, 'cf-connecting-ip': nextIp() },
          });
          expect(res.status).toBe(206);
          expect(res.headers.get('transfer-encoding')).toBeNull();
          expect(res.headers.get('content-range')).toBe(`bytes ${start}-${end}/${bytes.length}`);
          expect(res.headers.get('content-length')).toBe(String(end - start + 1));
          const body = Buffer.from(await res.arrayBuffer());
          expect(body.equals(bytes.subarray(start, end + 1))).toBe(true);
        }
      } finally {
        server.stop(true);
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});
