import { describe, expect, test } from 'bun:test';
import { applyConfigValue, getConfigValue, isValidConfigKey } from '../src/cli/config.js';

describe('CLI config validation', () => {
  test('parses numeric and boolean config values', () => {
    const cfg: Record<string, unknown> = {};
    applyConfigValue(cfg, 'port', '17174');
    applyConfigValue(cfg, 'file_ttl', '3600');
    applyConfigValue(cfg, 'dir_default_ttl', '7200');
    applyConfigValue(cfg, 'auto_stop', 'true');

    expect(getConfigValue(cfg, 'port')).toBe(17174);
    expect(getConfigValue(cfg, 'file_ttl')).toBe(3600);
    expect(getConfigValue(cfg, 'dir_default_ttl')).toBe(7200);
    expect(getConfigValue(cfg, 'auto_stop')).toBe(true);
  });

  test('rejects invalid ports and TTLs', () => {
    expect(() => applyConfigValue({}, 'port', '70000')).toThrow('port');
    expect(() => applyConfigValue({}, 'file_ttl', '0')).toThrow('file_ttl');
    expect(() => applyConfigValue({}, 'dir_default_ttl', 'NaN')).toThrow('dir_default_ttl');
  });

  test('rejects invalid base_url values', () => {
    expect(() => applyConfigValue({}, 'base_url', 'ftp://example.com')).toThrow('base_url');
  });

  test('host is a valid config key and accepts IPv4/IPv6/hostnames', () => {
    expect(isValidConfigKey('host')).toBe(true);

    const cfg: Record<string, unknown> = {};
    applyConfigValue(cfg, 'host', '0.0.0.0');
    expect(getConfigValue(cfg, 'host')).toBe('0.0.0.0');

    applyConfigValue(cfg, 'host', '::1');
    expect(getConfigValue(cfg, 'host')).toBe('::1');

    applyConfigValue(cfg, 'host', 'example.internal');
    expect(getConfigValue(cfg, 'host')).toBe('example.internal');
  });

  test('rejects empty or whitespace host values', () => {
    expect(() => applyConfigValue({}, 'host', '')).toThrow('host');
    expect(() => applyConfigValue({}, 'host', '   ')).toThrow('host');
    expect(() => applyConfigValue({}, 'host', '0.0.0.0 ')).toThrow('host');
  });
});
