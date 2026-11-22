import { describe, expect, test } from 'bun:test';
import { DOWNLOAD_ONLY_TYPES, guessMime, isUnsafeInline } from '../src/shared/mime.js';

describe('guessMime', () => {
  test('maps common preview file extensions', () => {
    expect(guessMime('README.md')).toBe('text/markdown');
    expect(guessMime('image.png')).toBe('image/png');
    expect(guessMime('movie.mp4')).toBe('video/mp4');
    expect(guessMime('archive.unknown')).toBe('application/octet-stream');
  });

  const office: Array<[string, string]> = [
    ['report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    ['old.doc', 'application/msword'],
    ['old.xls', 'application/vnd.ms-excel'],
    ['old.ppt', 'application/vnd.ms-powerpoint'],
  ];
  for (const [name, mime] of office) {
    test(`maps ${name} (and its upper-case form) to an Office type that downloads`, () => {
      expect(guessMime(name)).toBe(mime);
      expect(guessMime(name.toUpperCase())).toBe(mime);
      expect(DOWNLOAD_ONLY_TYPES.has(mime)).toBe(true);
    });
  }

  test('archives and unknown binaries download; previewable types do not', () => {
    for (const t of ['application/zip', 'application/gzip', 'application/x-tar', 'application/octet-stream']) {
      expect(DOWNLOAD_ONLY_TYPES.has(t)).toBe(true);
    }
    for (const t of ['application/pdf', 'image/png', 'video/mp4', 'text/plain']) {
      expect(DOWNLOAD_ONLY_TYPES.has(t)).toBe(false);
    }
  });
});

describe('isUnsafeInline', () => {
  const cases: Array<[string, boolean]> = [
    ['text/html', true],
    ['application/xhtml+xml', true],
    ['application/xml', true],
    ['text/xml', true],
    ['image/svg+xml', true],
    ['application/rss+xml', true],
    ['application/atom+xml', true],
    ['application/mathml+xml', true],
    ['TEXT/HTML', true],
    ['text/html; charset=utf-8', true],
    ['application/pdf', false],
    ['image/png', false],
    ['text/plain', false],
    ['application/json', false],
    ['application/octet-stream', false],
    ['video/mp4', false],
  ];
  for (const [mime, expected] of cases) {
    test(`${mime} -> ${expected}`, () => {
      expect(isUnsafeInline(mime)).toBe(expected);
    });
  }

  test('every extension guessMime maps to an XML or HTML type is unsafe', () => {
    for (const name of ['a.html', 'a.htm', 'a.xml', 'a.svg']) {
      expect(isUnsafeInline(guessMime(name))).toBe(true);
    }
  });
});
