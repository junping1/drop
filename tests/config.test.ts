import { afterEach, describe, expect, test } from 'bun:test';
import { homedir } from 'os';
import { join } from 'path';
import { applyConfigValue, getConfigValue } from '../src/cli/config.js';
import { getConfigPath, isProxyTrusted } from '../src/shared/config.js';

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
});

describe('isProxyTrusted', () => {
  afterEach(() => {
    delete process.env.DROP_TRUST_PROXY;
  });

  test('is true when only the config flag is set', () => {
    delete process.env.DROP_TRUST_PROXY;
    expect(isProxyTrusted({ trust_proxy: true })).toBe(true);
  });

  test('is true when only the env var is set', () => {
    process.env.DROP_TRUST_PROXY = '1';
    expect(isProxyTrusted({})).toBe(true);
  });

  test('is true when both the config flag and env var are set', () => {
    process.env.DROP_TRUST_PROXY = '1';
    expect(isProxyTrusted({ trust_proxy: true })).toBe(true);
  });

  test('is false when neither the config flag nor env var is set', () => {
    delete process.env.DROP_TRUST_PROXY;
    expect(isProxyTrusted({})).toBe(false);
    expect(isProxyTrusted({ trust_proxy: false })).toBe(false);
  });
});

describe('config path resolution (DROP_CONFIG)', () => {
  afterEach(() => {
    delete process.env.DROP_CONFIG;
  });

  test('DROP_CONFIG overrides the default config path', () => {
    process.env.DROP_CONFIG = '/tmp/some-isolated-dir/config.json';
    expect(getConfigPath()).toBe('/tmp/some-isolated-dir/config.json');
  });

  test('falls back to the default state-dir config path when DROP_CONFIG is unset', () => {
    delete process.env.DROP_CONFIG;
    // Deliberately not importing the config-path constant from
    // src/shared/constants.js here: recompute the well-known default
    // location the same way that module does, so this assertion never
    // references it and never touches the real file.
    expect(getConfigPath()).toBe(join(homedir(), '.drop', 'config.json'));
  });
});
