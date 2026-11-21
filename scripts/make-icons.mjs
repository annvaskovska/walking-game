// Generates the PWA icons in public/icons and the iPhone app icon with no dependencies:
// `node scripts/make-icons.mjs`.
// The Mr Sparkles mark, as on the start screen (index.html): a street lit gold through the
// night, a dim one crossing it, and you, with your beam of light ahead.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [11, 13, 18];
const DIM = [43, 50, 66];
const GOLD = [240, 201, 135];
const GOLD_HI = [255, 217, 160];
const AMBER = [255, 180, 107];
const CORE = [255, 246, 230];
const GLOW = [255, 201, 138];
const BEAM = [255, 227, 184];

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

/** An opaque RGB PNG. Rows are Paeth-filtered, so the soft gradients compress well. */
function png(size, pixel) {
  const bpp = 3;
  const stride = size * bpp;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) raw.set(pixel(x, y, size), y * stride + x * bpp);
  }
  const data = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (stride + 1);
    data[row] = 4;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? raw[y * stride + i - bpp] : 0;
      const b = y > 0 ? raw[(y - 1) * stride + i] : 0;
      const c = i >= bpp && y > 0 ? raw[(y - 1) * stride + i - bpp] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      data[row + 1 + i] = (raw[y * stride + i] - pred) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(data, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const lerp = (a, b, t) => a + (b - a) * t;
const over = (dst, src, a) => dst.map((v, i) => lerp(v, src[i], Math.max(0, Math.min(1, a))));

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return [Math.hypot(ax + t * dx - px, ay + t * dy - py), t];
}

// The logo in its 96-unit box (see the <svg class="wl-logo"> in index.html).
const WALKER = [41, 57];
const CONE_L = [34.7 - 41, 13.1 - 57];
const CONE_R = [70.2 - 41, 23.9 - 57];
const CONE_TIP = [50 - 41, 12 - 57];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];

/** The colour at a point of the logo box, before anti-aliasing. */
function logo(x, y) {
  let c = BG;
  // Warm glow around you.
  const g = Math.hypot(x - WALKER[0], y - WALKER[1]) / 38;
  c = over(c, GLOW, g < 0.45 ? lerp(0.45, 0.12, g / 0.45) : g < 1 ? lerp(0.12, 0, (g - 0.45) / 0.55) : 0);
  // The dim street crossing.
  if (segDist(x, y, 6, 70, 90, 38)[0] <= 2.5) c = DIM;
  // The lit street: gold, brightest near you, fading out ahead.
  const [d, t] = segDist(x, y, 30, 92, 56, 6);
  if (d <= 2.25) {
    const col = t < 0.45 ? over(GOLD, GOLD_HI, t / 0.45) : over(GOLD_HI, GOLD, (t - 0.45) / 0.55);
    c = over(c, col, t < 0.45 ? 1 : lerp(1, 0.15, (t - 0.45) / 0.55));
  }
  // Your beam.
  const v = [x - WALKER[0], y - WALKER[1]];
  if (Math.hypot(v[0], v[1]) <= 44 && cross(CONE_L, v) >= 0 && cross(v, CONE_R) >= 0) {
    const k = (v[0] * CONE_TIP[0] + v[1] * CONE_TIP[1]) / (CONE_TIP[0] ** 2 + CONE_TIP[1] ** 2);
    c = over(c, BEAM, 0.6 * (1 - Math.max(0, Math.min(1, k))));
  }
  // You.
  const r = Math.hypot(v[0], v[1]);
  if (r <= 8) c = AMBER;
  if (r <= 5) c = CORE;
  return c;
}

/** `zoom` > 1 crops in on you; < 1 leaves room for a maskable icon's safe zone. */
function art(zoom) {
  const SS = 4;
  return (px, py, size) => {
    const acc = [0, 0, 0];
    for (let j = 0; j < SS; j++) {
      for (let i = 0; i < SS; i++) {
        const u = (px + (i + 0.5) / SS) / size - 0.5;
        const v = (py + (j + 0.5) / SS) / size - 0.5;
        const c = logo(WALKER[0] + 2 + (u * 96) / zoom, WALKER[1] - 8 + (v * 96) / zoom);
        acc[0] += c[0];
        acc[1] += c[1];
        acc[2] += c[2];
      }
    }
    return acc.map((s) => Math.round(s / (SS * SS)));
  };
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', png(192, art(1.1)));
writeFileSync('public/icons/icon-512.png', png(512, art(1.1)));
writeFileSync('public/icons/icon-maskable-512.png', png(512, art(0.85)));
writeFileSync('public/icons/apple-touch-icon.png', png(180, art(1.05)));
// The iPhone app (ios/): the same art as the home-screen icon, at the one size Xcode needs.
writeFileSync('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', png(1024, art(1.05)));
console.log('icons written to public/icons');
