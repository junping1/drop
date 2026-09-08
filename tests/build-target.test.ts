import { describe, expect, test } from 'bun:test';
import { resolveHostTarget } from '../scripts/build-target';

describe('resolveHostTarget', () => {
  test('maps linux/x64 to linux-x64', () => {
    expect(resolveHostTarget('linux', 'x64')).toBe('linux-x64');
  });

  test('maps linux/arm64 to linux-arm64', () => {
    expect(resolveHostTarget('linux', 'arm64')).toBe('linux-arm64');
  });

  test('maps darwin/x64 to darwin-x64', () => {
    expect(resolveHostTarget('darwin', 'x64')).toBe('darwin-x64');
  });

  test('maps darwin/arm64 to darwin-arm64', () => {
    expect(resolveHostTarget('darwin', 'arm64')).toBe('darwin-arm64');
  });

  test('falls back to linux-x64 for an unrecognised host', () => {
    expect(resolveHostTarget('win32', 'x64')).toBe('linux-x64');
  });
});
