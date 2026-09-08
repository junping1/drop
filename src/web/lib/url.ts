// Pure helpers for building and parsing directory-share deep-link URLs.
// Extracted from DirBrowser.svelte so they can be unit-tested without a
// DOM/browser test harness (this repo has none).

/**
 * Build the pushState URL for a file inside a directory share, encoding each
 * path segment so that characters like `%`, `#`, `?` and non-ASCII names
 * round-trip correctly instead of corrupting the URL or being swallowed as a
 * fragment/query string.
 */
export function buildDirFileUrl(basePath: string, token: string, relPath: string): string {
  const encodedPath = relPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${basePath}/d/${token}/${encodedPath}`;
}

/**
 * Decode a percent-encoded relative path taken from `location.pathname`.
 * Returns `null` if the encoding is malformed (e.g. a stray `%zz`) instead of
 * throwing, so callers can fall back to a safe default (leaving the path
 * unselected) rather than crashing the popstate handler.
 */
export function decodeDirFilePath(encodedPath: string): string | null {
  try {
    return decodeURIComponent(encodedPath);
  } catch {
    return null;
  }
}
