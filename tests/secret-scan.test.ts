import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { scanPath, scanText } from '../src/shared/secret-scan.js';

const OPENAI_KEY = 'sk-proj-' + 'a'.repeat(52);
const GITHUB_TOKEN = 'ghp_' + 'b'.repeat(36);
const PRIVATE_KEY = '-----BEGIN OPENSSH PRIVATE KEY-----\n' + 'c'.repeat(64) + '\n-----END OPENSSH PRIVATE KEY-----';

describe('secret scanner', () => {
  test('detects high-confidence secrets without exposing raw secret values', () => {
    const result = scanText(`OPENAI_API_KEY=${OPENAI_KEY}\nGITHUB_TOKEN=${GITHUB_TOKEN}\n`, 'config.env');

    expect(result.blocked).toBe(true);
    expect(result.findings.map((finding) => finding.rule_id).sort()).toEqual(['github-token', 'openai-api-key']);
    expect(JSON.stringify(result.findings)).not.toContain(OPENAI_KEY);
    expect(JSON.stringify(result.findings)).not.toContain(GITHUB_TOKEN);
    expect(result.findings[0]).toEqual(expect.objectContaining({
      path: 'config.env',
      line: 1,
      severity: 'high',
    }));
    expect(result.findings[0].fingerprint).toMatch(/^[0-9a-f]{16,64}$/);
  });

  test('detects private keys and service account JSON', () => {
    const serviceAccount = JSON.stringify({
      type: 'service_account',
      private_key_id: 'abc123',
      private_key: PRIVATE_KEY,
      client_email: 'svc@example.iam.gserviceaccount.com',
    }, null, 2);

    const result = scanText(serviceAccount, 'service-account.json');

    expect(result.blocked).toBe(true);
    expect(result.findings.map((finding) => finding.rule_id)).toContain('google-service-account-json');
    expect(result.findings.map((finding) => finding.rule_id)).toContain('private-key');
    expect(JSON.stringify(result.findings)).not.toContain('OPENSSH PRIVATE KEY');
    expect(JSON.stringify(result.findings)).not.toContain('svc@example');
  });

  test('flags sensitive filenames even when content is otherwise harmless', () => {
    const root = mkdtempSync(join(tmpdir(), 'drop-secret-file-'));
    try {
      const file = join(root, 'credentials.json');
      writeFileSync(file, '{"hello":"world"}');

      const result = scanPath(file, { excludes: [] });

      expect(result.blocked).toBe(true);
      expect(result.findings).toEqual([
        expect.objectContaining({
          path: file,
          line: 1,
          rule_id: 'sensitive-filename',
          severity: 'high',
        }),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('flags .env and .env.local but not .env.example', () => {
    const root = mkdtempSync(join(tmpdir(), 'drop-secret-env-'));
    try {
      const envFile = join(root, '.env');
      const envLocalFile = join(root, '.env.local');
      const envExampleFile = join(root, '.env.example');
      writeFileSync(envFile, 'SECRET=1');
      writeFileSync(envLocalFile, 'SECRET=1');
      writeFileSync(envExampleFile, 'SECRET=changeme');

      const envResult = scanPath(envFile, { excludes: [] });
      const envLocalResult = scanPath(envLocalFile, { excludes: [] });
      const envExampleResult = scanPath(envExampleFile, { excludes: [] });

      expect(envResult.findings.map((f) => f.rule_id)).toContain('sensitive-filename');
      expect(envLocalResult.findings.map((f) => f.rule_id)).toContain('sensitive-filename');
      expect(envExampleResult.findings.map((f) => f.rule_id)).not.toContain('sensitive-filename');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('flags SSH private key filenames', () => {
    const root = mkdtempSync(join(tmpdir(), 'drop-secret-sshkey-'));
    try {
      const file = join(root, 'id_ed25519');
      writeFileSync(file, 'not actually a key');

      const result = scanPath(file, { excludes: [] });

      expect(result.findings.map((f) => f.rule_id)).toContain('sensitive-filename');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
