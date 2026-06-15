import { describe, expect, test } from 'bun:test';
import { normalizeShareSlug, validateShareSlug } from '../src/db/share-aliases.js';

describe('share slug validation', () => {
  test('normalizes accepted slugs to lowercase', () => {
    expect(normalizeShareSlug('Demo_Slug-123')).toBe('demo_slug-123');
  });

  test('requires 3-64 chars with alphanumeric boundaries and only alnum underscore hyphen', () => {
    for (const slug of ['ab', 'a'.repeat(65), '-abc', 'abc_', 'a.b', 'a b', '中文slug']) {
      expect(() => validateShareSlug(slug)).toThrow('slug');
    }
  });

  test('rejects reserved route words', () => {
    for (const slug of ['api', 'RAW', 'dashboard', 'robots.txt', 'f', 'd', 'git', 'revoke']) {
      expect(() => validateShareSlug(slug)).toThrow('reserved');
    }
  });
});
