// Draws the app icons with no dependencies: `node scripts/make-icons.mjs` (Node 22.18 or later,
// which runs src/ui/art.ts as it is).
// The icon is a corner of the cover's scene (docs/design/coloring-book/prototype.html, sceneSVG):
// Mr Sparkles in his cerulean crayon on the yellow cover, coloring in the street behind him. It is
// one SVG: written as is for the favicon, and rasterized here for the home screen and the iPhone.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { mrInner } from '../src/ui/art.ts';

const COVER = '#ffd23f', PAPER = '#fffefb', WAX = '#1fa2e8', PRESS = '#0b6eaa';

/** The design's seeded random numbers (rng in the prototype). */
function rng(seed) {
  let s = Math.imul((seed | 0) + 1, 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

// The cover's street, scribbled in wax up to where his tip is.
const zr = rng(5);
let zig = '';
for (let x = 1, y = 196; x <= 194; x += 3.1) {
  y = y < 203 ? 210.5 - zr() * 1.5 : 195.6 + zr() * 1.5;
  zig += `${x.toFixed(1)},${y.toFixed(1)} `;
}
// The square of the scene the icon shows, in the scene's units.
const X = 150, Y = 110, S = 112;
// An ink edge of the street, wobbling a little, as the cover's #wobble filter makes it. It
// stays within the stroke's half width (1.1), so it always covers the edge of the paper.
const edge = (y, k) => Array.from({ length: S + 1 }, (_, j) => `${X + j},${(y + 0.3 * Math.sin((X + j) / 5.3 + k) + 0.15 * Math.sin((X + j) / 2.6 + 2 * k)).toFixed(2)}`).join(' ');
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${X} ${Y} ${S} ${S}">
<defs>
<filter id="wax" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="7" result="n"/>
<feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -7 0 0 0 4.9" result="m"/>
<feComposite in="SourceGraphic" in2="m" operator="in"/>
</filter>
<clipPath id="r"><rect x="${X}" y="${Y}" width="${S}" height="${S}" rx="${S * 0.23}"/></clipPath>
</defs>
<g clip-path="url(#r)">
<rect x="${X}" y="${Y}" width="${S}" height="${S}" fill="${COVER}"/>
<rect x="${X}" y="194" width="${S}" height="18" fill="${PAPER}"/>
<g filter="url(#wax)"><rect x="0" y="196" width="194" height="14" fill="${WAX}" fill-opacity=".4"/><polyline points="${zig.trim()}" fill="none" stroke="${WAX}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/></g>
<g fill="none" stroke="#000" stroke-width="2.2" stroke-linejoin="round"><polyline points="${edge(194, 0)}"/><polyline points="${edge(212, 2)}"/></g>
<ellipse cx="201" cy="205" rx="13" ry="3.2" fill="#000" opacity=".14"/>
<g transform="rotate(8 200 204) translate(168 ${101 + 1 / 6}) scale(${64 / 60})">${mrInner(1, false, false).replaceAll('var(--wax)', WAX).replaceAll('var(--press)', PRESS)}</g>
</g>
</svg>
`;

// ---------------------------------------------------------------- a small SVG rasterizer
// It paints the icon above the way a browser does, and knows only what the icon uses: <rect>,
// <circle>, <ellipse>, <polyline> and <path> (M L H V Q Z), <g> with fill, stroke, stroke-width,
// fill-opacity and transform, `opacity` on a shape, and filter="url(#wax)" as the paper's tooth.
// Strokes have round joins and caps. It ignores <defs> and clip-path: iOS rounds the icon itself.
// ponytail: only that subset; a new element, path command or attribute in the icon is drawn wrong
// or not at all until it is added here. Check a change against Chrome's render of icon.svg.

/** The paper's tooth, as makeTooth in src/map/fog/fogLayer.ts: how much wax each texel takes. */
function makeTooth(n) {
  const r = rng(7);
  const lattice = (p) => Float32Array.from({ length: p * p }, r);
  const l1 = lattice(64), l2 = lattice(128), l3 = lattice(32);
  const at = (l, p, x, y) => {
    const fx = (x * p) / n, fy = (y * p) / n, ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const x0 = ix % p, y0 = iy % p, x1 = (x0 + 1) % p, y1 = (y0 + 1) % p;
    const a = l[y0 * p + x0] + (l[y0 * p + x1] - l[y0 * p + x0]) * sx;
    const b = l[y1 * p + x0] + (l[y1 * p + x1] - l[y1 * p + x0]) * sx;
    return a + (b - a) * sy;
  };
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = 0.5 * at(l1, 64, x, y) + 0.32 * at(l2, 128, x, y) + 0.18 * r();
      const wax = v > 0.64 ? 0 : v > 0.58 ? (0.64 - v) / 0.06 : 1;
      out[y * n + x] = wax * (0.8 + 0.2 * at(l3, 32, x, y));
    }
  }
  return out;
}
const TN = 256, TOOTH = makeTooth(TN);
/** The tooth at a pixel, bilinear, `texel` pixels per texel. */
function tooth(x, y, texel) {
  const fx = x / texel - 0.5, fy = y / texel - 0.5, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
  const t = (i, j) => TOOTH[(((iy + j) % TN) + TN) % TN * TN + ((((ix + i) % TN) + TN) % TN)];
  return (t(0, 0) * (1 - tx) + t(1, 0) * tx) * (1 - ty) + (t(0, 1) * (1 - tx) + t(1, 1) * tx) * ty;
}

const nums = (s) => (s.match(/-?(?:\d*\.\d+|\d+\.?)/g) ?? []).map(Number);
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
function transform(m, s) {
  for (const [, f, args] of s.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const [a, b, c] = nums(args);
    if (f === 'translate') m = mul(m, [1, 0, 0, 1, a, b ?? 0]);
    else if (f === 'scale') m = mul(m, [a, 0, 0, b ?? a, 0, 0]);
    else if (f === 'rotate') {
      const co = Math.cos((a * Math.PI) / 180), si = Math.sin((a * Math.PI) / 180);
      m = mul(mul(mul(m, [1, 0, 0, 1, b ?? 0, c ?? 0]), [co, si, -si, co, 0, 0]), [1, 0, 0, 1, -(b ?? 0), -(c ?? 0)]);
    }
  }
  return m;
}

/** A path's subpaths as points, with its curves cut into lines. */
function pathPoints(d) {
  const tok = d.match(/[MLHVQZ]|-?(?:\d*\.\d+|\d+\.?)/gi);
  const subs = [];
  let cur, cmd, x = 0, y = 0, i = 0;
  const n = () => +tok[i++];
  while (i < tok.length) {
    if (/[a-z]/i.test(tok[i])) cmd = tok[i++];
    const C = cmd.toUpperCase(), ox = cmd === C ? 0 : x, oy = cmd === C ? 0 : y;
    if (C === 'M') {
      x = ox + n(); y = oy + n();
      subs.push((cur = { pts: [[x, y]], closed: false }));
      cmd = cmd === C ? 'L' : 'l';
    } else if (C === 'L') { x = ox + n(); y = oy + n(); cur.pts.push([x, y]); }
    else if (C === 'H') { x = ox + n(); cur.pts.push([x, y]); }
    else if (C === 'V') { y = oy + n(); cur.pts.push([x, y]); }
    else if (C === 'Q') {
      const cx = ox + n(), cy = oy + n(), ex = ox + n(), ey = oy + n();
      for (let k = 1; k <= 24; k++) {
        const t = k / 24, u = 1 - t;
        cur.pts.push([u * u * x + 2 * u * t * cx + t * t * ex, u * u * y + 2 * u * t * cy + t * t * ey]);
      }
      x = ex; y = ey;
    } else if (C === 'Z') { cur.closed = true; [x, y] = cur.pts[0]; }
  }
  return subs;
}
const ring = (cx, cy, rx, ry, k = 96) => Array.from({ length: k }, (_, j) => [cx + rx * Math.cos((2 * Math.PI * j) / k), cy + ry * Math.sin((2 * Math.PI * j) / k)]);
function shapePoints(tag, a) {
  const v = (k) => +(a[k] ?? 0);
  if (tag === 'rect') return [{ pts: [[v('x'), v('y')], [v('x') + v('width'), v('y')], [v('x') + v('width'), v('y') + v('height')], [v('x'), v('y') + v('height')]], closed: true }];
  if (tag === 'circle') return [{ pts: ring(v('cx'), v('cy'), v('r'), v('r')), closed: true }];
  if (tag === 'ellipse') return [{ pts: ring(v('cx'), v('cy'), v('rx'), v('ry')), closed: true }];
  if (tag === 'polyline') {
    const p = nums(a.points);
    return [{ pts: Array.from({ length: p.length / 2 }, (_, j) => [p[2 * j], p[2 * j + 1]]), closed: false }];
  }
  return pathPoints(a.d);
}

/** A stroke with round joins and caps: a disc at every point and a band along every segment. */
function strokePolys(subs, h) {
  const polys = [];
  for (const { pts, closed } of subs) {
    const k = Math.max(16, Math.ceil(h * 3));
    for (const [x, y] of pts) polys.push(ring(x, y, h, h, k));
    for (let j = 0; j < pts.length - (closed ? 0 : 1); j++) {
      const [x0, y0] = pts[j], [x1, y1] = pts[(j + 1) % pts.length], len = Math.hypot(x1 - x0, y1 - y0);
      if (!len) continue;
      const nx = (-(y1 - y0) / len) * h, ny = ((x1 - x0) / len) * h;
      polys.push([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]]);
    }
  }
  // All the same way round, so that the nonzero rule fills their union.
  for (const p of polys) if (p.reduce((s, [x, y], j) => s + x * p[(j + 1) % p.length][1] - p[(j + 1) % p.length][0] * y, 0) < 0) p.reverse();
  return polys;
}

/** Fills polygons by the nonzero rule into a premultiplied RGBA buffer: 5 rows of samples per pixel, exact across. */
function fill(buf, size, polys, rgb, alpha) {
  const SS = 5, rows = new Array(size * SS);
  for (const p of polys) {
    for (let j = 0; j < p.length; j++) {
      const [x0, y0] = p[j], [x1, y1] = p[(j + 1) % p.length];
      if (y0 === y1) continue;
      const lo = Math.max(0, Math.ceil(Math.min(y0, y1) * SS - 0.5)), hi = Math.min(size * SS, Math.ceil(Math.max(y0, y1) * SS - 0.5));
      for (let s = lo; s < hi; s++) (rows[s] ??= []).push([x0 + ((x1 - x0) * ((s + 0.5) / SS - y0)) / (y1 - y0), y1 > y0 ? 1 : -1]);
    }
  }
  const cov = new Float32Array(size + 1);
  for (let py = 0; py < size; py++) {
    cov.fill(0);
    let any = false;
    for (let s = py * SS; s < (py + 1) * SS; s++) {
      const xs = rows[s];
      if (!xs) continue;
      any = true;
      xs.sort((a, b) => a[0] - b[0]);
      for (let k = 0, w = 0; k < xs.length - 1; k++) {
        if (!(w += xs[k][1])) continue;
        const a = Math.max(0, xs[k][0]), b = Math.min(size, xs[k + 1][0]);
        if (b <= a) continue;
        const ia = Math.floor(a), ib = Math.floor(b);
        if (ia === ib) cov[ia] += (b - a) / SS;
        else {
          cov[ia] += (ia + 1 - a) / SS;
          for (let x = ia + 1; x < ib; x++) cov[x] += 1 / SS;
          cov[ib] += (b - ib) / SS;
        }
      }
    }
    if (!any) continue;
    for (let x = 0; x < size; x++) {
      const c = Math.min(1, cov[x]) * alpha;
      if (c <= 0) continue;
      const i = (py * size + x) * 4;
      for (let ch = 0; ch < 3; ch++) buf[i + ch] = rgb[ch] * c + buf[i + ch] * (1 - c);
      buf[i + 3] = c + buf[i + 3] * (1 - c);
    }
  }
}

const color = (s) => (s.length === 4 ? [...s.slice(1)].map((h) => parseInt(h + h, 16)) : [1, 3, 5].map((j) => parseInt(s.slice(j, j + 2), 16)));
const INHERITED = ['fill', 'stroke', 'stroke-width', 'fill-opacity'];

/** The icon as opaque RGB, `size` pixels square. */
function raster(svg, size) {
  const [vx, vy, vw] = nums(svg.match(/viewBox="([^"]*)"/)[1]);
  const top = { fill: '#000', stroke: 'none', 'stroke-width': '1', 'fill-opacity': '1', m: [size / vw, 0, 0, size / vw, (-vx * size) / vw, (-vy * size) / vw] };
  const stack = [top], layers = [new Float32Array(size * size * 4)];
  let skip = 0;
  for (const [, close, tag, attrs, self] of svg.matchAll(/<(\/?)(\w+)([^>]*?)(\/?)>/g)) {
    if (close) {
      if (skip) skip -= tag === 'defs';
      else if (tag === 'g' && stack.pop().wax) {
        // The wax takes where the paper's tooth lets it, as fine as the cover's #wax filter.
        const layer = layers.pop(), under = layers.at(-1);
        for (let p = 0; p < size * size; p++) {
          const t = tooth(p % size, Math.floor(p / size), size / vw / 4), i = p * 4, a = layer[i + 3] * t;
          for (let ch = 0; ch < 3; ch++) under[i + ch] = layer[i + ch] * t + under[i + ch] * (1 - a);
          under[i + 3] = a + under[i + 3] * (1 - a);
        }
      }
      continue;
    }
    if (skip || tag === 'defs') { skip += tag === 'defs' && !self; continue; }
    if (tag === 'svg') continue;
    const a = Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]));
    for (const decl of (a.style ?? '').split(';')) {
      const [k, v] = decl.split(':').map((t) => t.trim());
      if (k) a[k] = v;
    }
    const st = { ...stack.at(-1) };
    for (const k of INHERITED) if (a[k] !== undefined) st[k] = a[k];
    if (a.transform) st.m = transform(st.m, a.transform);
    if (tag === 'g') {
      st.wax = a.filter === 'url(#wax)';
      if (st.wax) layers.push(new Float32Array(size * size * 4));
      stack.push(st);
      continue;
    }
    const m = st.m, scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
    const subs = shapePoints(tag, a).map(({ pts, closed }) => ({ pts: pts.map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]), closed }));
    const op = +(a.opacity ?? 1), buf = layers.at(-1);
    if (st.fill !== 'none') fill(buf, size, subs.map((s) => s.pts), color(st.fill), op * +st['fill-opacity']);
    if (st.stroke !== 'none') fill(buf, size, strokePolys(subs, (+st['stroke-width'] * scale) / 2), color(st.stroke), op);
  }
  const rgb = Buffer.alloc(size * size * 3);
  for (let p = 0; p < size * size; p++) for (let ch = 0; ch < 3; ch++) rgb[p * 3 + ch] = Math.round(layers[0][p * 4 + ch]);
  return rgb;
}

// ---------------------------------------------------------------- PNG
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

/** An opaque RGB PNG. Rows are Paeth-filtered, so the flat colors compress well. */
function png(size, raw) {
  const bpp = 3;
  const stride = size * bpp;
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

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon.svg', icon);
writeFileSync('public/icons/apple-touch-icon.png', png(180, raster(icon, 180)));
// The iPhone app (ios/): the same icon at the one size Xcode needs, with no transparency.
writeFileSync('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', png(1024, raster(icon, 1024)));
console.log('icons written to public/icons and ios/App/App/Assets.xcassets');
