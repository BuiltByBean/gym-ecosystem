/* Generates PWA icons without native deps: a minimal PNG encoder drawing a
 * barbell glyph on the default brand color. Run: node scripts/gen-icons.mjs */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, draw) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = draw(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BG = [0xc8, 0x47, 0x2b, 255]; // default brand: oxidized iron
const FG = [0xf7, 0xf5, 0xf2, 255]; // chalk

function barbell(size) {
  const s = size;
  return (x, y) => {
    const cx = x / s, cy = y / s;
    // bar
    if (cy > 0.46 && cy < 0.54 && cx > 0.12 && cx < 0.88) return FG;
    // inner plates
    if (cx > 0.2 && cx < 0.28 && cy > 0.28 && cy < 0.72) return FG;
    if (cx > 0.72 && cx < 0.8 && cy > 0.28 && cy < 0.72) return FG;
    // outer plates
    if (cx > 0.13 && cx < 0.19 && cy > 0.34 && cy < 0.66) return FG;
    if (cx > 0.81 && cx < 0.87 && cy > 0.34 && cy < 0.66) return FG;
    return BG;
  };
}

for (const size of [192, 512]) {
  writeFileSync(join(outDir, `icon-${size}.png`), png(size, barbell(size)));
  console.log(`icon-${size}.png`);
}
