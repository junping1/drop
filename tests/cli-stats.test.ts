import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { closeDb } from '../src/db/index.js';
import { recordAccessEvent } from '../src/db/access-events.js';
import { addAuthorization } from '../src/db/authorizations.js';
import { createShareAlias } from '../src/db/share-aliases.js';

function withTempDb(): string {
  closeDb();
  const root = mkdtempSync(join(tmpdir(), 'drop-cli-stats-'));
  process.env.DROP_DB = join(root, 'drop.db');
  return root;
}

async function runDrop(args: string[], env: Record<string, string | undefined>) {
  const proc = Bun.spawn([process.execPath, 'src/cli/index.ts', ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

afterEach(() => {
  closeDb();
  delete process.env.DROP_DB;
});

describe('drop stats CLI', () => {
  test('prints JSON stats for one token and respects --include-live', async () => {
    const root = withTempDb();
    try {
      recordAccessEvent({ token: 'tok-a', shareType: 'file', eventType: 'page_view', success: true, ip: '1.1.1.1' });
      recordAccessEvent({ token: 'tok-a', shareType: 'file', eventType: 'live_poll', success: true, ip: '1.1.1.1' });

      const plain = await runDrop(['stats', 'tok-a', '--json'], { DROP_DB: process.env.DROP_DB });
      expect(plain.exitCode).toBe(0);
      expect(JSON.parse(plain.stdout)).toMatchObject({ token: 'tok-a', views: 1, unique: 1 });

      const withLive = await runDrop(['stats', 'tok-a', '--json', '--include-live'], { DROP_DB: process.env.DROP_DB });
      expect(JSON.parse(withLive.stdout).views).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('supports aggregate JSON stats since windows', async () => {
    const root = withTempDb();
    try {
      recordAccessEvent({ token: 'tok-a', shareType: 'file', eventType: 'page_view', success: true, ip: '1.1.1.1' });
      recordAccessEvent({ token: 'tok-b', shareType: 'dir', eventType: 'raw_view', success: true, ip: '2.2.2.2' });

      const result = await runDrop(['stats', '--json', '--since', '24h'], { DROP_DB: process.env.DROP_DB });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.totals.views).toBe(2);
      expect(json.tokens.map((t: any) => t.token).sort()).toEqual(['tok-a', 'tok-b']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('accepts a share slug when showing single-share stats', async () => {
    const root = withTempDb();
    try {
      const file = join(root, 'note.txt');
      writeFileSync(file, 'hello');
      const { token } = addAuthorization(file, 3600);
      createShareAlias('note-stats', 'file', token);
      recordAccessEvent({ token, shareType: 'file', eventType: 'page_view', success: true, ip: '1.1.1.1' });

      const result = await runDrop(['stats', 'note-stats', '--json'], { DROP_DB: process.env.DROP_DB });
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ token, views: 1, unique: 1 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
