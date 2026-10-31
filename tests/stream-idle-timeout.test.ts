import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { connect } from 'net';
import { join } from 'path';
import { tmpdir } from 'os';
import { closeDb } from '../src/db/index.js';
import { addAuthorization } from '../src/db/authorizations.js';
import { app } from '../src/server/index.js';
import { createFetchHandler, STREAM_IDLE_TIMEOUT_SECONDS } from '../src/server/serve.js';

// Video players stop reading once they have buffered enough. Bun.serve closes
// a connection after `idleTimeout` seconds without writes (default 10 s), which
// truncated paused media downloads and broke playback.

function withTempDb(): string {
  closeDb();
  const root = mkdtempSync(join(tmpdir(), 'drop-idle-'));
  process.env.DROP_DB = join(root, 'drop.db');
  return root;
}

afterEach(() => {
  closeDb();
  delete process.env.DROP_DB;
});

function pausedDownload(port: number, path: string, pauseMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let got = 0;
    let paused = false;
    const sock = connect(port, '127.0.0.1', () => {
      sock.write(`GET ${path} HTTP/1.1\r\nHost: drop.test\r\nConnection: close\r\n\r\n`);
    });
    sock.on('data', (d) => {
      got += d.length;
      if (!paused && got > 256 * 1024) {
        paused = true;
        sock.pause();
        setTimeout(() => sock.resume(), pauseMs);
      }
    });
    sock.on('end', () => resolve(got));
    sock.on('error', reject);
  });
}

describe('file streams survive a paused reader', () => {
  test('a /f/ download paused longer than idleTimeout still completes', async () => {
    const root = withTempDb();
    const size = 24 * 1024 * 1024;
    const file = join(root, 'blob.bin');            // no renderer: served as raw bytes on every branch
    writeFileSync(file, Buffer.alloc(size, 7));
    const token = addAuthorization(file, 60).token;
    const server = Bun.serve({ port: 0, hostname: '127.0.0.1', idleTimeout: 1, fetch: createFetchHandler(app) });
    try {
      // uWS checks idle connections roughly every 4 s, so pause well past idleTimeout.
      const got = await pausedDownload(server.port, `/f/${token}`, 10000);
      expect(got).toBeGreaterThan(size);            // body plus response headers
    } finally {
      server.stop(true);
      rmSync(root, { recursive: true, force: true });
    }
  }, 30000);

  test('only raw byte routes get the extended timeout, and it is finite', () => {
    const calls: unknown[][] = [];
    const fakeServer = { timeout: (...a: unknown[]) => calls.push(a) } as any;
    const handler = createFetchHandler({ fetch: () => new Response('ok') } as any);
    const byteRoutes = [
      'http://drop.test/f/abc',
      'http://drop.test/f/abc/raw',
      'http://drop.test/f/abc/clip.mp4',
      'http://drop.test/d/abc/raw?path=x.mp4',
    ];
    const otherRoutes = [
      'http://drop.test/dashboard',
      'http://drop.test/api/stats',
      'http://drop.test/d/abc',
      'http://drop.test/d/abc/api/tree',
      'http://drop.test/d/abc/api/file?path=x.mp4',
      'http://drop.test/d/abc/api/git/unlock',
      'http://drop.test/d/abc/sub/x.mp4',
      'http://drop.test/d/abc/raw/x.mp4',
      'http://drop.test/f/abc/raw/extra',
      'http://drop.test/git/abc',
    ];
    for (const url of otherRoutes) handler(new Request(url), fakeServer);
    expect(calls).toEqual([]);
    for (const url of byteRoutes) handler(new Request(url), fakeServer);
    expect(calls.length).toBe(byteRoutes.length);
    for (const [, seconds] of calls) {
      expect(seconds).toBe(STREAM_IDLE_TIMEOUT_SECONDS);
      expect(seconds as number).toBeGreaterThan(0);
    }
  });
});
