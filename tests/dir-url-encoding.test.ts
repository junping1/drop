import { describe, expect, test } from 'bun:test';
import { buildDirFileUrl, decodeDirFilePath } from '../src/web/lib/url.js';

describe('buildDirFileUrl', () => {
  test('encodes a plain relative path', () => {
    expect(buildDirFileUrl('', 'tok', 'notes/readme.md')).toBe('/d/tok/notes/readme.md');
  });

  test('encodes % so a literal percent in a filename round-trips', () => {
    const url = buildDirFileUrl('', 'tok', '100%.txt');
    expect(url).toBe('/d/tok/100%25.txt');
    // round-trip: decoding the encoded segment gives back the original name
    expect(decodeDirFilePath(url.slice('/d/tok/'.length))).toBe('100%.txt');
  });

  test('encodes # so it does not become a URL fragment', () => {
    const url = buildDirFileUrl('', 'tok', 'notes #1.md');
    expect(url).not.toContain('#1.md');
    expect(url).toContain('notes%20%231.md');
  });

  test('encodes each segment but keeps / as a separator', () => {
    const url = buildDirFileUrl('', 'tok', 'a b/c#d/e%f.txt');
    expect(url).toBe('/d/tok/a%20b/c%23d/e%25f.txt');
  });

  test('encodes non-ASCII (Chinese) filenames', () => {
    const url = buildDirFileUrl('', 'tok', '笔记.md');
    expect(url).toBe(`/d/tok/${encodeURIComponent('笔记.md')}`);
    expect(decodeDirFilePath(url.slice('/d/tok/'.length))).toBe('笔记.md');
  });

  test('respects a non-empty basePath prefix', () => {
    expect(buildDirFileUrl('/app', 'tok', 'a.txt')).toBe('/app/d/tok/a.txt');
  });
});

describe('decodeDirFilePath', () => {
  test('decodes a normal percent-encoded path', () => {
    expect(decodeDirFilePath('notes%20%231.md')).toBe('notes #1.md');
  });

  test('returns null instead of throwing on a malformed escape', () => {
    expect(decodeDirFilePath('100%zz.txt')).toBeNull();
  });

  test('decodes Chinese filenames back to the original text', () => {
    expect(decodeDirFilePath(encodeURIComponent('笔记.md'))).toBe('笔记.md');
  });

  test('decodes an empty string as empty (root)', () => {
    expect(decodeDirFilePath('')).toBe('');
  });
});
