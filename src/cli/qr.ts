import * as qrcodeTerminal from 'qrcode-terminal';

export type TerminalQrGenerator = (
  text: string,
  options: { small: boolean },
  callback: (qr: string) => void,
) => void;

export type WritableStreamLike = {
  write(chunk: string | Uint8Array): unknown;
};

const defaultGenerator: TerminalQrGenerator = (text, options, callback) => {
  qrcodeTerminal.generate(text, options, callback);
};

export function renderTerminalQr(text: string, generator: TerminalQrGenerator = defaultGenerator): string {
  let rendered = '';
  generator(text, { small: true }, (qr) => {
    rendered = qr;
  });
  return rendered;
}

export function printTerminalQr(
  text: string,
  stderr: WritableStreamLike = process.stderr,
  generator: TerminalQrGenerator = defaultGenerator,
): boolean {
  const rendered = renderTerminalQr(text, generator);
  if (!rendered) return false;
  stderr.write(`${rendered.endsWith('\n') ? rendered : `${rendered}\n`}`);
  return true;
}
