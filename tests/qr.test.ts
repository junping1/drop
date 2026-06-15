import { describe, expect, test } from 'bun:test';
import { renderTerminalQr, printTerminalQr } from '../src/cli/qr.js';
import { outputShareResult, outputShareError } from '../src/cli/output.js';

class MemoryStream {
  chunks: string[] = [];
  write(chunk: string | Uint8Array): boolean {
    this.chunks.push(String(chunk));
    return true;
  }
  toString(): string {
    return this.chunks.join('');
  }
}

describe('terminal QR output', () => {
  test('renderTerminalQr generates terminal QR text with the default renderer', () => {
    const qr = renderTerminalQr('http://localhost:17173/f/token');

    expect(qr.length).toBeGreaterThan(0);
    expect(qr).toContain('\n');
  });

  test('renderTerminalQr delegates to terminal QR renderer and returns text', () => {
    const qr = renderTerminalQr('http://localhost:17173/f/token', (text, _opts, cb) => {
      cb(`QR:${text}`);
    });

    expect(qr).toBe('QR:http://localhost:17173/f/token');
  });

  test('printTerminalQr writes QR text to stderr-like stream only', () => {
    const stderr = new MemoryStream();

    const printed = printTerminalQr('http://localhost:17173/f/token', stderr as any, (text, _opts, cb) => {
      cb(`QR:${text}`);
    });

    expect(printed).toBe(true);
    expect(stderr.toString()).toContain('QR:http://localhost:17173/f/token');
  });

  test('outputShareResult keeps JSON stdout parseable when --json and --qr are combined', () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();

    outputShareResult(
      { url: 'http://localhost:17173/f/token', token: 'token', type: 'file' },
      {
        json: true,
        qr: true,
        stdout: stdout as any,
        stderr: stderr as any,
        qrRenderer: () => 'QR-CODE',
      },
    );

    expect(JSON.parse(stdout.toString())).toEqual({
      url: 'http://localhost:17173/f/token',
      token: 'token',
      type: 'file',
    });
    expect(stdout.toString()).not.toContain('QR-CODE');
    expect(stderr.toString()).toContain('QR-CODE');
  });

  test('outputShareResult keeps URL stdout clean when --qr is enabled', () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();

    outputShareResult(
      { url: 'http://localhost:17173/f/token', token: 'token', type: 'file' },
      {
        qr: true,
        stdout: stdout as any,
        stderr: stderr as any,
        qrRenderer: () => 'QR-CODE',
      },
    );

    expect(stdout.toString()).toBe('http://localhost:17173/f/token\n');
    expect(stderr.toString()).toContain('QR-CODE');
  });

  test('QR generation failures warn on stderr without failing share output', () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();

    expect(() => outputShareResult(
      { url: 'http://localhost:17173/f/token', token: 'token', type: 'file' },
      {
        qr: true,
        stdout: stdout as any,
        stderr: stderr as any,
        qrRenderer: () => { throw new Error('renderer unavailable'); },
      },
    )).not.toThrow();

    expect(stdout.toString()).toBe('http://localhost:17173/f/token\n');
    expect(stderr.toString()).toContain('Warning: failed to render QR code: renderer unavailable');
  });

  test('share errors do not print QR output', () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    let qrCalls = 0;

    outputShareError('Path not found: /missing', {
      qr: true,
      stdout: stdout as any,
      stderr: stderr as any,
      qrRenderer: () => { qrCalls += 1; return 'QR-CODE'; },
    });

    expect(stdout.toString()).toBe('');
    expect(stderr.toString()).toBe('Path not found: /missing\n');
    expect(qrCalls).toBe(0);
  });

  test('supported share commands expose --qr in help output', () => {
    for (const command of ['allow', 'share', 'allow-git', 'owner-url']) {
      const proc = Bun.spawnSync({
        cmd: ['bun', 'run', 'src/cli/index.ts', command, '--help'],
        stdout: 'pipe',
        stderr: 'pipe',
      });

      expect(proc.exitCode).toBe(0);
      expect(new TextDecoder().decode(proc.stdout)).toContain('--qr');
      expect(new TextDecoder().decode(proc.stderr)).toBe('');
    }
  });
});
