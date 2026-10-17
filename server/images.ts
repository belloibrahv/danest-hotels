import { bad } from './lib.ts';

const MAGIC: [string, (b: Buffer) => boolean][] = [
  ['image/png', (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))],
  ['image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/webp', (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'],
];

/** Decode a base64 photo and read its type from the file itself, never from what the browser claims. */
export function readPhoto(data: unknown, maxBytes: number): { bytes: Buffer; mime: string } {
  if (typeof data !== 'string' || data.length > Math.ceil((maxBytes * 4) / 3) + 4) throw bad(`The photo is too large. Use one under ${Math.round(maxBytes / 1024)} KB.`);
  const bytes = Buffer.from(data, 'base64');
  const mime = MAGIC.find(([, test]) => bytes.length > 12 && test(bytes))?.[0];
  if (!mime) throw bad('That file is not a PNG, JPEG or WebP photo');
  return { bytes, mime };
}
