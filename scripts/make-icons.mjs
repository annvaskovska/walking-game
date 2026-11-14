// Generates the PWA icons in public/icons with no dependencies: `node scripts/make-icons.mjs`.
// A dark night tile with two glowing mint streets and a warm peach "you" dot.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [8, 12, 26];
const FOG = [14, 20, 42];
const LIT = [142, 240, 207];
const PEACH = [255, 179, 138];

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x / size, y / size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * Math.max(0, Math.min(1, t))));
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(ax + t * dx - px, ay + t * dy - py);
}

// Coordinates are 0..1; `scale` shrinks the artwork for the maskable safe zone.
function art(scale) {
  const streets = [
    [0.12, 0.70, 0.88, 0.38],
    [0.38, 0.12, 0.58, 0.88],
  ];
  return (u, v) => {
    const x = 0.5 + (u - 0.5) / scale, y = 0.5 + (v - 0.5) / scale;
    const vignette = Math.hypot(u - 0.5, v - 0.5);
    let c = mix(FOG, BG, vignette * 1.6);
    let d = Infinity;
    for (const s of streets) d = Math.min(d, segDist(x, y, ...s));
    c = mix(c, LIT, Math.exp(-((d / 0.09) ** 2)) * 0.45);
    c = mix(c, LIT, d < 0.022 ? 1 : Math.exp(-(((d - 0.022) / 0.012) ** 2)));
    const pd = Math.hypot(x - 0.5, y - 0.535);
    c = mix(c, PEACH, Math.exp(-((pd / 0.13) ** 2)) * 0.35);
    c = mix(c, [255, 255, 255], pd < 0.075 ? 1 : 0);
    c = mix(c, PEACH, pd < 0.06 ? 1 : 0);
    return c;
  };
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', png(192, art(1)));
writeFileSync('public/icons/icon-512.png', png(512, art(1)));
writeFileSync('public/icons/icon-maskable-512.png', png(512, art(0.72)));
writeFileSync('public/icons/apple-touch-icon.png', png(180, art(0.9)));
console.log('icons written to public/icons');
