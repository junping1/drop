import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { app } from '../src/server/index.js';
import { closeDb } from '../src/db/index.js';
import { addAuthorization } from '../src/db/authorizations.js';
import { addDirAuthorization } from '../src/db/dir-authorizations.js';
import { contentDisposition } from '../src/server/content-disposition.js';

function withTempDb(): string {
  closeDb();
  const root = mkdtempSync(join(tmpdir(), 'drop-content-disposition-'));
  process.env.DROP_DB = join(root, 'drop.db');
  return root;
}

afterEach(() => {
  closeDb();
  delete process.env.DROP_DB;
});

describe('contentDisposition helper', () => {
  test('encodes a non-ASCII filename with an ASCII fallback and RFC 5987 extended value', () => {
    const header = contentDisposition('inline', '报告.pdf');
    expect(header).toContain('inline;');
    expect(header).toContain("filename*=UTF-8''%E6%8A%A5%E5%91%8A.pdf");
    // ASCII fallback must be a valid Latin-1 header value with no raw non-ASCII bytes.
    const fallbackMatch = header.match(/filename="([^"]*)"/);
    expect(fallbackMatch).not.toBeNull();
    const fallback = fallbackMatch![1];
    expect(/^[\x20-\x7e]*$/.test(fallback)).toBe(true);
    expect(fallback.endsWith('.pdf')).toBe(true);
  });

  test('escapes quotes and backslashes in the ASCII fallback', () => {
    const header = contentDisposition('inline', 'a"b.txt');
    const fallbackMatch = header.match(/filename="([^"]*)"/);
    expect(fallbackMatch).not.toBeNull();
    const fallback = fallbackMatch![1];
    expect(fallback).not.toContain('"');
    expect(fallback.endsWith('.txt')).toBe(true);
  });

  test('leaves a plain ASCII filename unchanged in the fallback', () => {
    const header = contentDisposition('attachment', 'plain.txt');
    expect(header).toContain('attachment;');
    expect(header).toContain('filename="plain.txt"');
    expect(header).toContain("filename*=UTF-8''plain.txt");
  });

  test('percent-encodes RFC 5987 non-attr-chars in the extended value', () => {
    const header = contentDisposition('inline', "John's (final) report*.pdf");
    const extendedMatch = header.match(/filename\*=UTF-8''([^\s;]+)/);
    expect(extendedMatch).not.toBeNull();
    const extended = extendedMatch![1];
    expect(extended).toContain('%27');
    expect(extended).toContain('%28');
    expect(extended).toContain('%29');
    expect(extended).toContain('%2A');
    expect(extended).not.toMatch(/['()*]/);
    expect(extended).not.toContain('!');
    expect(extended).not.toContain('~');
  });
});

describe('raw responses send Content-Disposition with encoded filenames', () => {
  test('GET /d/:token/raw returns 200 with an encoded filename header for non-ASCII names', async () => {
    const root = withTempDb();
    try {
      const dir = join(root, 'share');
      mkdirSync(dir);
      writeFileSync(join(dir, '报告.pdf'), '%PDF-1.4 fake pdf content');
      const { token } = addDirAuthorization(dir, 60, []);

      const res = await app.request(`/d/${token}/raw?path=${encodeURIComponent('报告.pdf')}`);

      expect(res.status).toBe(200);
      const disposition = res.headers.get('Content-Disposition');
      expect(disposition).not.toBeNull();
      expect(disposition).toContain("filename*=UTF-8''%E6%8A%A5%E5%91%8A.pdf");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('GET /f/:token returns 200 with an encoded filename header for non-ASCII names', async () => {
    const root = withTempDb();
    try {
      const file = join(root, '报告.docx');
      writeFileSync(file, 'fake docx content');
      const { token } = addAuthorization(file, 60);

      const res = await app.request(`/f/${token}`);

      expect(res.status).toBe(200);
      const disposition = res.headers.get('Content-Disposition');
      expect(disposition).not.toBeNull();
      expect(disposition).toContain("filename*=UTF-8''%E6%8A%A5%E5%91%8A.docx");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
