import { BASE_DEFAULT_EXCLUDES, DEFAULT_HIDDEN_EXCLUDES } from './constants.js';

function isHiddenExcludePattern(pattern: string): boolean {
  const normalized = pattern.trim().replace(/\/+$/, '');
  return normalized === '.*' || normalized.startsWith('.');
}

function isBuiltInHiddenExclude(pattern: string): boolean {
  const normalized = pattern.trim();
  return DEFAULT_HIDDEN_EXCLUDES.includes(normalized);
}

export function directoryDefaultExcludes(includeHidden = false, configuredExcludes?: string[]): string[] {
  const base = configuredExcludes || BASE_DEFAULT_EXCLUDES;
  const visibleBase = includeHidden
    ? base.filter((pattern) => configuredExcludes ? !isBuiltInHiddenExclude(pattern) : !isHiddenExcludePattern(pattern))
    : base;
  const hidden = includeHidden ? [] : DEFAULT_HIDDEN_EXCLUDES;
  return [...visibleBase, ...hidden];
}
