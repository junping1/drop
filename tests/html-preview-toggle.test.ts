import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { closeDb, getDb } from '../src/db/index.js';
import { addAuthorization } from '../src/db/authorizations.js';
import { addDirAuthorization } from '../src/db/dir-authorizations.js';
import { app } from '../src/server/index.js';
import { MAX_RENDER_SIZE } from '../src/shared/constants.js';

// HTML shares get a "Preview / Source" toggle. The preview is a sandboxed
// iframe pointing at /f/:token/render (or /d/:token/render?path=), which
// serves the HTML with a `sandbox allow-scripts` CSP so it runs in an opaque
// origin and cannot read drop's owner cookie or other shares.

const PAGE = '<!doctype html><html><body><h1>Hello preview</h1><script>document.body.dataset.ok=1</script></body></html>';

function withTempDb(): string {
  closeDb();
  const root = mkdtempSync(join(tmpdir(), 'drop-html-preview-'));
  process.env.DROP_DB = join(root, 'drop.db');
  process.env.DROP_CONFIG = join(root, 'config.json');
  return root;
}

afterEach(() => {
  closeDb();
  delete process.env.DROP_DB;
  delete process.env.DROP_CONFIG;
  delete process.env.DROP_TRUST_PROXY;
});

let ipCounter = 0;
function fetchAs(path: string, init: RequestInit = {}): Promise<Response> {
  process.env.DROP_TRUST_PROXY = '1';
  ipCounter += 1;
  const headers = new Headers(init.headers);
  headers.set('cf-connecting-ip', `198.51.100.${(ipCounter % 250) + 1}`);
  return app.fetch(new Request(`http://localhost${path}`, { ...init, headers }));
}

function expectSandboxedHtml(res: Response): void {
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Type')).toContain('text/html');
  const csp = res.headers.get('Content-Security-Policy') || '';
  expect(csp).toContain('sandbox allow-scripts allow-forms');
  expect(csp).not.toContain('allow-same-origin');
  expect(csp).not.toContain('allow-top-navigation');
  expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
}

function sandboxAttrs(html: string): string[] {
  return [...html.matchAll(/<iframe\b[^>]*\bsandbox="([^"]*)"/g)].map((m) => m[1]);
}

describe('file share HTML render route', () => {
  test('/f/:token/render serves the HTML with a sandbox allow-scripts CSP', async () => {
    const root = withTempDb();
    try {
      const file = join(root, 'page.html');
      writeFileSync(file, PAGE);
      const { token } = addAuthorization(file, 60);

      const res = await fetchAs(`/f/${token}/render`);
      expectSandboxedHtml(res);
      expect(await res.text()).toBe(PAGE);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('.htm files are rendered too', async () => {
    const root = withTempDb();
    try {
      const file = join(root, 'page.htm');
      writeFileSync(file, PAGE);
      const { token } = addAuthorization(file, 60);

      expectSandboxedHtml(await fetchAs(`/f/${token}/render`));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('unknown tokens get 404', async () => {
    withTempDb();
    const res = await fetchAs('/f/not-a-real-token/render');
    expect(res.status).toBe(404);
    expect(res.headers.get('Content-Type') || '').not.toContain('text/html');
  });

  test('expired shares do not serve the HTML', async () => {
    const root = withTempDb();
    try {
      const file = join(root, 'page.html');
      writeFileSync(file, PAGE);
      const now = Date.now() / 1000;
      getDb().query('INSERT INTO authorizations (token, filepath, filename, created_at, expires_at, live) VALUES (?, ?, ?, ?, ?, ?)')
        .run('expired-html-token', file, 'page.html', now - 120, now - 60, 0);

      const res = await fetchAs('/f/expired-html-token/render');
      const body = await res.text();
      expect(body).not.toContain('Hello preview');
      expect(res.headers.get('Content-Security-Policy') || '').not.toContain('allow-scripts');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('non-HTML files are not rendered', async () => {
    const root = withTempDb();
    try {
      const file = join(root, 'notes.txt');
      writeFileSync(file, PAGE);
      const { token } = addAuthorization(file, 60);

      const res = await fetchAs(`/f/${token}/render`);
      expect(res.status).toBe(404);
      expect(res.headers.get('Content-Type') || '').not.toContain('text/html');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('oversized HTML files are not rendered', async () => {
    const root = withTempDb();
    try {
      const file = join(root, 'big.html');
      writeFileSync(file, '<p>x</p>' + ' '.repeat(MAX_RENDER_SIZE + 1));
      const { token } = addAuthorization(file, 60);

      const res = await fetchAs(`/f/${token}/render`);
      expect(res.status).toBe(413);
      expect(res.headers.get('Content-Type') || '').not.toContain('text/html');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('file share HTML page toggle', () => {
  test('default view is the highlighted source with a Preview/Source toggle', async () => {
    const root = withTempDb();
    try {
      const file = join(root, 'page.html');
      writeFileSync(file, PAGE);
      const { token } = addAuthorization(file, 60);

      const res = await fetchAs(`/f/${token}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('class="view-toggle"');
      expect(html).toContain(`href="/f/${token}?view=preview"`);
      expect(html).toContain('<pre class="hljs">');
      expect(html).not.toContain('<iframe');
      // Source view stays escaped: the shared script never runs on drop's origin.
      expect(html).not.toContain('<script>document.body.dataset.ok=1</script>');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('?view=preview shows a sandboxed iframe without allow-same-origin', async () => {
    const root = withTempDb();
    try {
      const file = join(root, 'page.html');
      writeFileSync(file, PAGE);
      const { token } = addAuthorization(file, 60);

      const res = await fetchAs(`/f/${token}?view=preview`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('class="view-toggle"');
      expect(html).toContain(`src="/f/${token}/render"`);
      const attrs = sandboxAttrs(html);
      expect(attrs).toEqual(['allow-scripts allow-forms']);
      expect(html).not.toContain('allow-same-origin');
      expect(html).not.toContain('allow-top-navigation');
      expect(html).not.toContain('allow-popups-to-escape-sandbox');
      expect(html).not.toContain('<pre class="hljs">');
      expect(html).not.toContain('<script>document.body.dataset.ok=1</script>');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('non-HTML code pages are unchanged (no toggle)', async () => {
    const root = withTempDb();
    try {
      const file = join(root, 'app.js');
      writeFileSync(file, 'console.log(1)\n');
      const { token } = addAuthorization(file, 60);

      const html = await (await fetchAs(`/f/${token}?view=preview`)).text();
      expect(html).not.toContain('view-toggle');
      expect(html).not.toContain('<iframe');
      expect(html).toContain('<pre class="hljs">');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('oversized HTML gets no preview toggle', async () => {
    const root = withTempDb();
    try {
      const file = join(root, 'big.html');
      writeFileSync(file, '<p>x</p>' + ' '.repeat(MAX_RENDER_SIZE + 1));
      const { token } = addAuthorization(file, 60);

      const res = await fetchAs(`/f/${token}?view=preview`);
      expect(res.headers.get('Content-Type') || '').not.toContain('text/html');
      const body = await res.text();
      expect(body).not.toContain('view-toggle');
      expect(body).not.toContain('<iframe');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('directory share HTML render route', () => {
  function makeShare(root: string): { dir: string; token: string } {
    const dir = join(root, 'share');
    mkdirSync(join(dir, 'sub'), { recursive: true });
    writeFileSync(join(dir, 'page.html'), PAGE);
    writeFileSync(join(dir, 'sub', 'nested.htm'), PAGE);
    writeFileSync(join(dir, 'notes.txt'), 'plain');
    writeFileSync(join(dir, 'secret.html'), PAGE);
    writeFileSync(join(root, 'outside.html'), PAGE);
    const { token } = addDirAuthorization(dir, 60, ['secret.html']);
    return { dir, token };
  }

  test('/d/:token/render?path= serves the HTML with a sandbox allow-scripts CSP', async () => {
    const root = withTempDb();
    try {
      const { token } = makeShare(root);
      const res = await fetchAs(`/d/${token}/render?path=page.html`);
      expectSandboxedHtml(res);
      expect(await res.text()).toBe(PAGE);

      expectSandboxedHtml(await fetchAs(`/d/${token}/render?path=${encodeURIComponent('sub/nested.htm')}`));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('traversal, excluded and missing paths are rejected', async () => {
    const root = withTempDb();
    try {
      const { token } = makeShare(root);
      for (const path of ['../outside.html', 'secret.html', 'missing.html', '/etc/passwd']) {
        const res = await fetchAs(`/d/${token}/render?path=${encodeURIComponent(path)}`);
        expect(res.status).toBe(403);
        expect(res.headers.get('Content-Type') || '').not.toContain('text/html');
      }
      const noPath = await fetchAs(`/d/${token}/render`);
      expect(noPath.status).toBe(400);
      const dirPath = await fetchAs(`/d/${token}/render?path=sub`);
      expect(dirPath.status).toBe(400);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('unknown and expired directory shares are rejected', async () => {
    const root = withTempDb();
    try {
      const { dir } = makeShare(root);
      expect((await fetchAs('/d/not-a-real-token/render?path=page.html')).status).toBe(404);

      const now = Date.now() / 1000;
      getDb().query('INSERT INTO dir_authorizations (token, dirpath, dirname, excludes, created_at, expires_at, live) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run('expired-dir-token', dir, 'share', '[]', now - 120, now - 60, 0);
      const res = await fetchAs('/d/expired-dir-token/render?path=page.html');
      expect(res.status).toBe(403);
      expect(await res.text()).not.toContain('Hello preview');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('non-HTML and oversized files are not rendered', async () => {
    const root = withTempDb();
    try {
      const { dir, token } = makeShare(root);
      expect((await fetchAs(`/d/${token}/render?path=notes.txt`)).status).toBe(404);
      writeFileSync(join(dir, 'big.html'), '<p>x</p>' + ' '.repeat(MAX_RENDER_SIZE + 1));
      expect((await fetchAs(`/d/${token}/render?path=big.html`)).status).toBe(413);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('file preview API exposes render_url only for previewable HTML', async () => {
    const root = withTempDb();
    try {
      const { dir, token } = makeShare(root);
      const html = await (await fetchAs(`/d/${token}/api/file?path=page.html`)).json() as any;
      expect(html.type).toBe('html');
      expect(html.render_url).toBe(`/d/${token}/render?path=page.html`);
      // Source view content is unchanged highlighted code.
      expect(html.content).toContain('<pre class="hljs">');

      const txt = await (await fetchAs(`/d/${token}/api/file?path=notes.txt`)).json() as any;
      expect(txt.render_url).toBeUndefined();

      writeFileSync(join(dir, 'big.html'), '<p>x</p>' + ' '.repeat(MAX_RENDER_SIZE + 1));
      const big = await (await fetchAs(`/d/${token}/api/file?path=big.html`)).json() as any;
      expect(big.render_url).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('raw route keeps serving HTML as a sandboxed plain-text download', async () => {
    const root = withTempDb();
    try {
      const { token } = makeShare(root);
      const res = await fetchAs(`/d/${token}/raw?path=page.html`);
      expect(res.headers.get('Content-Type')).not.toContain('text/html');
      expect(res.headers.get('Content-Disposition')).toContain('attachment');
      expect(res.headers.get('Content-Security-Policy')).toBe('sandbox');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('directory browser HTML preview UI', () => {
  const componentsDir = join(import.meta.dir, '..', 'src/web/components');

  test('preview pane offers a Source/Preview toggle for HTML with render_url', () => {
    const preview = readFileSync(join(componentsDir, 'Preview.svelte'), 'utf-8');
    expect(preview).toContain('HtmlRenderPreview');
    expect(preview).toContain('render_url');
    expect(preview).toContain('view-toggle');
  });

  test('HTML render iframe is sandboxed with allow-scripts and allow-forms only', () => {
    const source = readFileSync(join(componentsDir, 'HtmlRenderPreview.svelte'), 'utf-8');
    expect(sandboxAttrs(source)).toEqual(['allow-scripts allow-forms']);
    expect(source).not.toContain('allow-same-origin');
    expect(source).not.toContain('allow-top-navigation');
    expect(source).not.toContain('allow-popups-to-escape-sandbox');
  });
});
