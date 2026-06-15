import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { scanPath } from '../src/shared/secret-scan.js';

const AWS_KEY = 'AKIA' + 'D'.repeat(16);
const SLACK_TOKEN = 'xoxb-' + '1'.repeat(12) + '-' + '2'.repeat(12) + '-' + '3'.repeat(24);

describe('secret scanner directory traversal', () => {
  test('respects default and caller excludes while scanning included files', () => {
    const root = mkdtempSync(join(tmpdir(), 'drop-secret-dir-'));
    try {
      mkdirSync(join(root, 'node_modules'));
      mkdirSync(join(root, 'ignored'));
      writeFileSync(join(root, 'node_modules', 'leaked.env'), `AWS_ACCESS_KEY_ID=${AWS_KEY}`);
      writeFileSync(join(root, 'ignored', 'slack.txt'), `token=${SLACK_TOKEN}`);
      writeFileSync(join(root, 'app.txt'), `token=${SLACK_TOKEN}`);

      const result = scanPath(root, { excludes: ['ignored/'] });

      expect(result.blocked).toBe(true);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]).toEqual(expect.objectContaining({
        path: join(root, 'app.txt'),
        line: 1,
        rule_id: 'slack-token',
      }));
      expect(JSON.stringify(result.findings)).not.toContain(AWS_KEY);
      expect(JSON.stringify(result.findings)).not.toContain(SLACK_TOKEN);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('does not follow symlinks that escape the shared directory or create cycles', () => {
    const root = mkdtempSync(join(tmpdir(), 'drop-secret-symlink-'));
    const outside = mkdtempSync(join(tmpdir(), 'drop-secret-outside-'));
    try {
      mkdirSync(join(root, 'nested'));
      writeFileSync(join(outside, 'secrets.yaml'), `AWS_ACCESS_KEY_ID=${AWS_KEY}`);
      symlinkSync(outside, join(root, 'outside'));
      symlinkSync(root, join(root, 'nested', 'cycle'));
      writeFileSync(join(root, 'safe.txt'), 'hello');

      const result = scanPath(root, { excludes: [] });

      expect(result.blocked).toBe(false);
      expect(result.findings).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
