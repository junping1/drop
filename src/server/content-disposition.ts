/**
 * RFC 6266 / RFC 5987 compliant Content-Disposition header builder.
 *
 * Bun's Response throws "Header ... has invalid value" when a header value
 * contains bytes outside Latin-1 (e.g. non-ASCII filenames), so a bare
 * `filename="${name}"` breaks for any non-ASCII file name. This helper
 * always emits an ASCII-only `filename="..."` fallback plus an RFC 5987
 * `filename*=UTF-8''<percent-encoded>` extended parameter carrying the
 * full Unicode name.
 */

const ASCII_FALLBACK_UNSAFE = /[^\x20-\x7e]|["\\]/g;

function asciiFallback(filename: string): string {
  return filename.replace(ASCII_FALLBACK_UNSAFE, '_');
}

// encodeURIComponent leaves `' ( ) * ! ~` unescaped, but RFC 5987 attr-char
// excludes them. An unquoted `'` inside the ext-value is especially unsafe:
// it collides with the quotes RFC 5987 uses to delimit the charset, so some
// parsers mis-split the value. Percent-encode them explicitly.
const RFC5987_EXTRA_UNSAFE = /['()*!~]/g;

function rfc5987Encode(filename: string): string {
  return encodeURIComponent(filename).replace(
    RFC5987_EXTRA_UNSAFE,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

export function contentDisposition(kind: 'inline' | 'attachment', filename: string): string {
  const fallback = asciiFallback(filename);
  const extended = rfc5987Encode(filename);
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${extended}`;
}
