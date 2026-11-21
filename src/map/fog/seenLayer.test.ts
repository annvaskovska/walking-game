import { describe, expect, it } from 'vitest';
import { SEEN_TILE } from '../../core/seen';
import { EARTH_CIRCUMFERENCE_M as C } from '../gl';
import {
  MOON_CHUNK_WM, MOON_CULL_PX, MOON_EDGE_FLOATS, MOON_EDGE_VS, MOON_VERT_FLOATS, MoonPack, SEEN_TEX,
  SEEN_TILE_VS, SEEN_TILE_WM, changedNeighbours, composeTileTexture, moonEdgePx, moonFade, moonShape,
  packEdges, packFill, pickEvictions, ringArea2, tileBorder, tileQuad, tileRange, viewFromMatrix,
  type MoonRec,
} from './seenLayer';

const N = SEEN_TILE, W = SEEN_TEX;

/** A tile whose texel (i, j) holds f(i, j). */
const tile = (f: (i: number, j: number) => number) => {
  const d = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) d[j * N + i] = f(i, j);
  return d;
};

/** Bilinear lookup with CLAMP_TO_EDGE, as the GPU does at mip level 0. */
function sample(tex: Uint8Array, size: number, u: number, v: number): number {
  const x = u * size - 0.5, y = v * size - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const at = (i: number, j: number) =>
    tex[Math.min(size - 1, Math.max(0, j)) * size + Math.min(size - 1, Math.max(0, i))];
  const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
  const bot = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bot * fy;
}

/** The tile vertex shader's texture coordinate for a spot s (0..1) across the tile. */
const uvOf = (s: number) => (1 + N * s) / W;

describe('seen tiles', () => {
  it('places a tile in local units, sharing exact edges with its neighbours', () => {
    const ox = 0.5583 * C, oy = 0.3352 * C;
    const x = 73_100, y = 43_920;
    const a = tileQuad(x, y, ox, oy);
    expect(a[0]).toBeCloseTo(x * SEEN_TILE_WM - ox, 2);
    expect(a[3] - a[1]).toBeCloseTo(SEEN_TILE_WM, 2);
    const east = tileQuad(x + 1, y, ox, oy), south = tileQuad(x, y + 1, ox, oy);
    expect(east[0]).toBe(a[2]);
    expect(south[1]).toBe(a[3]);
  });

  it('lists the tiles under a view, clamped to the world', () => {
    const t = SEEN_TILE_WM;
    expect([...tileRange([10.5 * t, 3.2 * t, 12.1 * t, 3.9 * t])]).toEqual([10, 3, 12, 3]);
    expect([...tileRange([-5 * t, -1, 1e12, 0.5 * t])]).toEqual([0, 0, 2 ** 17 - 1, 0]);
  });

  it('borders a texture with its neighbours’ edge texels, or 0 where there is none', () => {
    const self = tile((i, j) => (i + j) % 200);
    const n = tile((i) => i % 97), e = tile((_, j) => 100 + (j % 50)), se = tile(() => 77);
    const nb = [null, n, null, null, self, e, null, null, se];
    const out = composeTileTexture(new Uint8Array(W * W), nb);
    expect(out[(5 + 1) * W + 9 + 1]).toBe(self[5 * N + 9]);
    // North border: the northern tile's last row; east border: the eastern tile's first column.
    for (const i of [0, 17, 255]) expect(out[1 + i]).toBe(n[(N - 1) * N + i]);
    for (const j of [0, 40, 255]) expect(out[(j + 1) * W + W - 1]).toBe(e[j * N]);
    // No western or southern tile: nothing seen there.
    for (const j of [0, 128, 255]) expect(out[(j + 1) * W]).toBe(0);
    expect(out[(W - 1) * W + 5]).toBe(0);
    // Corners from the diagonal neighbours.
    expect(out[W * W - 1]).toBe(77);
    expect(out[0]).toBe(0);
  });

  it('samples each texel at its own WM centre and runs on smoothly across a seam', () => {
    // A ramp running east across two tiles, so the right answer is known everywhere.
    const ramp = (gi: number) => Math.min(255, gi * 0.45);
    const a = tile((i) => ramp(i)), b = tile((i) => ramp(N + i));
    const ta = composeTileTexture(new Uint8Array(W * W), [null, null, null, null, a, b, null, null, null]);
    const tb = composeTileTexture(new Uint8Array(W * W), [null, null, null, a, b, null, null, null, null]);
    const v = uvOf(0.5);
    for (const i of [0, 100, 255]) expect(sample(ta, W, uvOf((i + 0.5) / N), v)).toBeCloseTo(a[128 * N + i], 6);
    // Both sides of the seam agree, and match the ramp there (between texel 255 of a and 0 of b).
    const left = sample(ta, W, uvOf(1), v), right = sample(tb, W, uvOf(0), v);
    expect(left).toBeCloseTo(right, 6);
    expect(left).toBeCloseTo((a[128 * N + 255] + b[128 * N]) / 2, 6);
    // And the shader uses the same mapping.
    expect(SEEN_TILE_VS).toContain(`(1.0 + ${N}.0 * a_corner) / ${W}.0`);
  });

  it('tells which neighbours copy a changed edge texel', () => {
    const before = tile(() => 0), after = tile(() => 0);
    const pb = tileBorder(before, new Uint8Array(4 * N));
    const border = () => tileBorder(after, new Uint8Array(4 * N));
    after[100 * N + 100] = 255;
    expect(changedNeighbours(pb, border())).toBe(0);
    after[0 * N + 50] = 9; // north row
    expect(changedNeighbours(pb, border())).toBe(1 << 1);
    after[0] = 9; // north-west corner: north, west and north-west neighbours
    expect(changedNeighbours(pb, border())).toBe((1 << 0) | (1 << 1) | (1 << 3));
    const c2 = tile(() => 0);
    c2[N * N - 1] = 1; // south-east corner
    expect(changedNeighbours(pb, tileBorder(c2, new Uint8Array(4 * N)))).toBe((1 << 5) | (1 << 7) | (1 << 8));
  });

  it('frees idle textures, then the least recently drawn over budget, never this frame’s', () => {
    const now = 100_000;
    expect(pickEvictions([now, now - 70_000, now - 10, now - 5], now, 10, 60_000)).toEqual([1]);
    expect(pickEvictions([now - 3, now, now - 9, now - 1], now, 2, 60_000).sort()).toEqual([0, 2]);
    expect(pickEvictions([now, now, now], now, 1, 60_000)).toEqual([]);
  });
});

// ---- Houses ----

const LAT = 52.37, LON = 4.88;
const R = Math.PI / 180;
const m2u = 1 / Math.cos(LAT * R);
const x0 = ((LON + 180) / 360) * C;
const y0 = (0.5 - Math.log((1 + Math.sin(LAT * R)) / (1 - Math.sin(LAT * R))) / (4 * Math.PI)) * C;
/** A ring in metres east / south of (LON, LAT) as closed flat lon/lat. */
const ring = (pts: [number, number][]) => {
  const out: number[] = [];
  for (const [e, s] of [...pts, pts[0]]) {
    const x = (x0 + e * m2u) / C, y = (y0 + s * m2u) / C;
    out.push(x * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI);
  }
  return out;
};
const square = (e: number, s: number, w: number): [number, number][] => [[e, s], [e + w, s], [e + w, s + w], [e, s + w]];

describe('moon houses', () => {
  it('turns a lon/lat house into WM rings with the building on one known side', () => {
    for (const pts of [square(0, 0, 10), square(0, 0, 10).reverse()]) {
      const s = moonShape({ coords: ring(pts) })!;
      expect(s.xy.length).toBe(8); // closing corner dropped
      expect([...s.rings]).toEqual([0, 4]);
      expect(ringArea2(s.xy)).toBeGreaterThan(0);
      expect(s.tri.length).toBe(6);
      // (dy, -dx) of every wall points away from the middle of the house.
      const cx = x0 + 5 * m2u, cy = y0 + 5 * m2u;
      for (let k = 0; k < 4; k++) {
        const ax = s.xy[2 * k], ay = s.xy[2 * k + 1];
        const bx = s.xy[(2 * k + 2) % 8], by = s.xy[(2 * k + 3) % 8];
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        expect((by - ay) * (mx - cx) + -(bx - ax) * (my - cy)).toBeGreaterThan(0);
      }
    }
  });

  it('runs holes the other way, so their walls face into the courtyard', () => {
    const s = moonShape({ coords: ring(square(0, 0, 30)), holes: [ring(square(10, 10, 10))] })!;
    expect([...s.rings]).toEqual([0, 4, 8]);
    expect(ringArea2(s.xy, 0, 8)).toBeGreaterThan(0);
    expect(ringArea2(s.xy, 8, 16)).toBeLessThan(0);
    expect(s.tri.length / 3).toBe(8);
    // The hole's first wall: its outward side is the courtyard's middle.
    const ax = s.xy[8], ay = s.xy[9], bx = s.xy[10], by = s.xy[11];
    const cx = x0 + 15 * m2u, cy = y0 + 15 * m2u;
    expect((by - ay) * ((ax + bx) / 2 - cx) - (bx - ax) * ((ay + by) / 2 - cy)).toBeLessThan(0);
  });

  it('drops repeated corners and houses with no area', () => {
    const pts: [number, number][] = [[0, 0], [0, 0], [8, 0], [8, 6], [0, 6]];
    expect(moonShape({ coords: ring(pts) })!.xy.length).toBe(8);
    expect(moonShape({ coords: ring([[0, 0], [5, 0]]) })).toBeNull();
    expect(moonShape({ coords: ring([[0, 0], [5, 0], [10, 0]]) })).toBeNull();
  });

  it('packs roofs and walls relative to the origin', () => {
    const s = moonShape({ coords: ring(square(0, 0, 10)), holes: [ring(square(3, 3, 4))] })!;
    const ox = x0 - 100, oy = y0 + 50;
    const verts = new Float32Array(8 * MOON_VERT_FLOATS), idx = new Uint32Array(s.tri.length);
    packFill(s, ox, oy, 4.2, 7, verts, idx, 1000);
    expect(verts[0]).toBeCloseTo(s.xy[0] - ox, 3);
    expect(verts[1]).toBeCloseTo(s.xy[1] - oy, 3);
    expect([verts[2], verts[3]]).toEqual([Math.fround(4.2), 7]);
    expect(Math.min(...idx)).toBe(1000);
    expect(Math.max(...idx)).toBe(1007);

    const out = new Float32Array(8 * MOON_EDGE_FLOATS);
    expect(packEdges(s, ox, oy, 4.2, 7, out)).toBe(8);
    const at = (c: number) => [Math.fround(s.xy[2 * c] - ox), Math.fround(s.xy[2 * c + 1] - oy)];
    // First wall of the outer ring: corner before is its last corner; corners wrap within a ring.
    expect([...out.subarray(0, 8)]).toEqual([...at(3), ...at(0), ...at(1), ...at(2)]);
    // Last wall of the hole: a = 7, b = 4, after = 5, before = 6.
    const last = out.subarray(7 * MOON_EDGE_FLOATS, 8 * MOON_EDGE_FLOATS);
    expect([...last.subarray(0, 8)]).toEqual([...at(6), ...at(7), ...at(4), ...at(5)]);
    expect([last[8], last[9]]).toEqual([Math.fround(4.2), 7]);
  });

  it('widens the outline with the zoom and fades in with an ease-out', () => {
    expect(moonEdgePx(12)).toBeCloseTo(0.6);
    expect(moonEdgePx(15)).toBeCloseTo(0.6);
    expect(moonEdgePx(16.5)).toBeCloseTo(1.1);
    expect(moonEdgePx(18)).toBeCloseTo(1.6);
    expect(moonEdgePx(20)).toBeCloseTo(1.6);
    expect(moonFade(10, 9)).toBe(0);
    expect(moonFade(10, 10.45)).toBeCloseTo(0.75);
    expect(moonFade(10, 10.9)).toBe(1);
    expect(moonFade(-1e6, 5)).toBe(1);
  });
});

// ---- Houses in chunks ----

const F = MOON_EDGE_FLOATS;
/** An L-shaped house w metres across (6 corners, 6 walls, 4 triangles), its corner e m east, s m south of (LON, LAT). */
const lHouse = (id: string, e: number, s: number, w = 12) => ({
  id,
  coords: ring([[e, s], [e + w, s], [e + w, s + w / 2], [e + w / 2, s + w / 2], [e + w / 2, s + w], [e, s + w]]),
});
/** Metres east / south of (LON, LAT) of the point e, s metres into chunk (i, j), counted from the chunk holding (LON, LAT). */
const gx = Math.floor(x0 / MOON_CHUNK_WM) * MOON_CHUNK_WM, gy = Math.floor(y0 / MOON_CHUNK_WM) * MOON_CHUNK_WM;
const cell = (i: number, j: number, e: number, s: number): [number, number] => [
  (gx + i * MOON_CHUNK_WM - x0) / m2u + e, (gy + j * MOON_CHUNK_WM - y0) / m2u + s,
];
const OX = x0 - 200, OY = y0 - 300;

const flush = (p: MoonPack) => {
  p.verts.flushed();
  p.index.flushed();
  p.edges.flushed();
};
/** Elements the next upload sends, all three buffers. */
const toUpload = (p: MoonPack) => p.verts.toUpload + p.index.toUpload + p.edges.toUpload;
function recOf(p: MoonPack, id: string): MoonRec {
  for (const c of p.chunks) for (const r of c.recs) if (r.id === id) return r;
  throw new Error(`no house ${id}`);
}
/** Whether select()'s runs draw all of a house's roof and walls. */
function drawn(p: MoonPack, r: MoonRec): boolean {
  const c = r.chunk!, i = c.idx.start + r.iOff, iN = r.shape!.tri.length;
  const w = (c.edge.start + r.eOff) / F, wN = r.shape!.xy.length / 2;
  let roof = false, walls = false;
  for (let k = 0; k < p.nFill; k += 2) if (p.fillRuns[k] <= i && i + iN <= p.fillRuns[k] + p.fillRuns[k + 1]) roof = true;
  for (let k = 0; k < p.nEdge; k += 2) if (p.edgeRuns[k] <= w && w + wN <= p.edgeRuns[k] + p.edgeRuns[k + 1]) walls = true;
  return roof && walls;
}

/** After a sync: every house packed as packFill / packEdges would, where its chunk says; zero everywhere else. */
function check(p: MoonPack, houses: number): void {
  const V = p.verts.data, I = p.index.data, E = p.edges.data;
  const iLive = new Uint8Array(I.length), eLive = new Uint8Array(E.length);
  const wv = new Float32Array(4096), wi = new Uint32Array(4096), we = new Float32Array(1024 * F);
  const regions = { idx: [] as number[][], edge: [] as number[][] };
  let n = 0, walls = 0, wrong = 0;
  for (const c of p.chunks) {
    expect(c.pending).toEqual([]);
    expect(c.queued).toBe(false);
    // Whole walls and whole triangles, so a run across regions stays in step.
    expect(c.edge.start % F).toBe(0);
    expect(c.edge.cap % F).toBe(0);
    expect(c.idx.start % 3).toBe(0);
    expect(c.idx.cap % 3).toBe(0);
    expect(c.idx.start + c.idx.cap).toBeLessThanOrEqual(p.index.end);
    expect(c.edge.start + c.edge.cap).toBeLessThanOrEqual(p.edges.end);
    regions.idx.push([c.idx.start, c.idx.cap]);
    regions.edge.push([c.edge.start, c.edge.cap]);
    let lastI = -1, used = 0;
    for (const r of c.recs) {
      n++;
      const s = r.shape!, corners = s.xy.length / 2;
      walls += corners;
      expect(r.chunk).toBe(c);
      expect(r.x0 >= c.x0 && r.x1 <= c.x1 && r.y0 >= c.y0 && r.y1 <= c.y1).toBe(true);
      // Packed in order, within the used part of the regions.
      expect(r.iOff).toBeGreaterThan(lastI);
      lastI = r.iOff;
      expect(r.iOff + s.tri.length).toBeLessThanOrEqual(c.idx.len);
      expect(r.eOff + corners * F).toBeLessThanOrEqual(c.edge.len);
      used += corners * F;
      packFill(s, p.oxWM, p.oyWM, r.seed, r.tOn, wv, wi, r.v0);
      packEdges(s, p.oxWM, p.oyWM, r.seed, r.tOn, we);
      const i = c.idx.start + r.iOff, e = c.edge.start + r.eOff;
      for (let k = 0; k < corners * MOON_VERT_FLOATS; k++) if (V[r.v0 * MOON_VERT_FLOATS + k] !== wv[k]) wrong++;
      for (let k = 0; k < s.tri.length; k++, iLive[i + k - 1] = 1) if (I[i + k] !== wi[k]) wrong++;
      for (let k = 0; k < corners * F; k++, eLive[e + k - 1] = 1) if (E[e + k] !== we[k]) wrong++;
    }
    expect(c.edge.len - c.edge.dead).toBe(used);
  }
  expect(wrong).toBe(0);
  expect(n).toBe(houses);
  expect(p.stats.walls).toBe(walls);
  // Removed houses, room, holes and the tail: all zero, so a run across them draws nothing.
  let stray = 0;
  for (let k = 0; k < I.length; k++) if (!iLive[k] && I[k] !== 0) stray++;
  for (let k = 0; k < E.length; k++) if (!eLive[k] && E[k] !== 0) stray++;
  expect(stray).toBe(0);
  p.select(null, 0);
  for (let k = 0; k < p.nFill; k++) expect(p.fillRuns[k] % 3).toBe(0);
  for (const list of [regions.idx, regions.edge]) {
    list.sort((a, b) => a[0] - b[0]);
    for (let k = 1; k < list.length; k++) expect(list[k][0]).toBeGreaterThanOrEqual(list[k - 1][0] + list[k - 1][1]);
  }
}

/** A grid of nx × ny L-houses `pitch` metres apart, ids h<i>_<j>. */
function city(p: MoonPack, nx: number, ny: number, pitch: number, tOn = 0): void {
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) p.add(lHouse(`h${i}_${j}`, i * pitch, j * pitch), tOn);
}

describe('seen houses in chunks', () => {
  it('buckets houses by the middle of their box; a chunk boxes all of its houses', () => {
    const p = new MoonPack();
    p.add(lHouse('a', ...cell(0, 0, 20, 20)), 0);
    p.add(lHouse('b', ...cell(0, 0, 60, 20)), 0);
    p.add(lHouse('c', ...cell(2, 0, 20, 20)), 0);
    // Its middle is in chunk (0, 1); it reaches 4 m into chunk (0, 2).
    p.add(lHouse('d', ...cell(0, 2, 10, -12), 16), 0);
    p.add({ id: 'flat', coords: ring([[0, 0], [5, 0]]) }, 0);
    p.sync(OX, OY);
    expect(p.stats.houses).toBe(5);
    expect(p.has('flat')).toBe(true);
    expect(p.chunks.length).toBe(3);
    expect(recOf(p, 'a').chunk).toBe(recOf(p, 'b').chunk);
    expect(recOf(p, 'c').chunk).not.toBe(recOf(p, 'a').chunk);
    const d = recOf(p, 'd');
    expect(d.chunk!.key % 2 ** 17).toBe(Math.floor(y0 / MOON_CHUNK_WM) + 1);
    expect(d.chunk!.y1).toBeGreaterThan(gy + 2 * MOON_CHUNK_WM);
    check(p, 4);
  });

  it('draws only the chunks in view, every house there, in few runs', () => {
    const p = new MoonPack();
    // 30 × 30 houses 40 m apart: 1.2 km square, about 4 × 4 chunks.
    city(p, 30, 30, 40);
    p.sync(OX, OY);
    check(p, 900);
    const vx = x0 + 600 * m2u, vy = y0 + 600 * m2u, half = 50 * m2u;
    const view = [vx - half, vy - half, vx + half, vy + half];
    p.select(view, 0);
    expect(p.stats.visible).toBeGreaterThan(0);
    expect(p.stats.visible).toBeLessThanOrEqual(4);
    expect(p.stats.drawn).toBeLessThan(p.stats.walls / 2);
    let inView = 0;
    for (const c of p.chunks) {
      for (const r of c.recs) {
        if (r.x1 < view[0] || r.x0 > view[2] || r.y1 < view[1] || r.y0 > view[3]) continue;
        inView++;
        expect(drawn(p, r)).toBe(true);
      }
    }
    expect(inView).toBeGreaterThan(4);
    // No view: all of it. Chunks lie in order after a repack, so one run per buffer draws it.
    p.select(null, 0);
    expect(p.stats.visible).toBe(p.chunks.length);
    expect([p.nFill, p.nEdge]).toEqual([2, 2]);
    for (const c of p.chunks) for (const r of c.recs) expect(drawn(p, r)).toBe(true);
    // Far away: nothing; just past the edge: only within the margin.
    p.select([vx + 1e5, vy, vx + 1e5 + 10, vy + 10], 0);
    expect(p.nEdge + p.nFill).toBe(0);
    // 20 WM east of the last houses' east walls (at 29 * 40 + 12 m).
    const east = x0 + 1172 * m2u + 20;
    p.select([east, vy, east + 100, vy + 100], 0);
    expect(p.nEdge).toBe(0);
    p.select([east, vy, east + 100, vy + 100], 30);
    expect(p.nEdge).toBe(2);
  });

  it('reads the view off the matrix, turned or tilted, and gives up past the horizon', () => {
    const out = new Float64Array(4);
    const close = (a: ArrayLike<number>, b: number[]) => b.forEach((v, k) => expect(a[k]).toBeCloseTo(v, 3));
    // Flat, as the demo: centred on local (100, -50), 2 px per unit, 400 × 800 px.
    const ortho = (cx: number, cy: number, k: number, w: number, h: number, turn = 0) => {
      const sx = (2 * k) / w, sy = (-2 * k) / h, c = Math.cos(turn), s = Math.sin(turn);
      const m = [sx * c, sy * s, 0, 0, -sx * s, sy * c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      m[12] = -(m[0] * cx + m[4] * cy);
      m[13] = -(m[1] * cx + m[5] * cy);
      return new Float32Array(m);
    };
    expect(viewFromMatrix(ortho(100, -50, 2, 400, 800), 1000, 2000, out)).toBe(true);
    close(out, [1000, 1750, 1200, 2150]);
    // Turned 30°: the box holds the turned screen.
    const t = Math.PI / 6, ex = 100 * Math.cos(t) + 200 * Math.sin(t), ey = 100 * Math.sin(t) + 200 * Math.cos(t);
    expect(viewFromMatrix(ortho(100, -50, 2, 400, 800, t), 0, 0, out)).toBe(true);
    close(out, [100 - ex, -50 - ey, 100 + ex, -50 + ey]);
    // Tilted: w = 1 + 0.005 y, so the screen's far edge (clip y = +1) reaches out to y = 200.
    const tilt = (k: number) => new Float32Array([0.01, 0, 0, 0, 0, 0.01, 0, k, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect(viewFromMatrix(tilt(0.005), 0, 0, out)).toBe(true);
    close(out, [-200, -1 / 0.015, 200, 200]);
    expect(viewFromMatrix(tilt(0.02), 0, 0, out)).toBe(false);
    expect(viewFromMatrix(new Float32Array(16), 0, 0, out)).toBe(false);
  });

  it('zeroes a removed house where it lies, and uploads just that', () => {
    const p = new MoonPack();
    city(p, 30, 30, 40);
    p.sync(OX, OY);
    flush(p);
    const r = recOf(p, 'h10_10'), c = r.chunk!;
    const i = c.idx.start + r.iOff, e = c.edge.start + r.eOff, iN = r.shape!.tri.length, eN = 6 * F;
    const { rebuilds, walls } = p.stats;
    p.remove('h10_10');
    expect(p.has('h10_10')).toBe(false);
    expect(p.stats.walls).toBe(walls - 6);
    expect(p.index.data.subarray(i, i + iN).every((v) => v === 0)).toBe(true);
    expect(p.edges.data.subarray(e, e + eN).every((v) => v === 0)).toBe(true);
    expect([p.verts.toUpload, p.index.toUpload, p.edges.toUpload]).toEqual([0, iN, eN]);
    p.sync(OX, OY);
    expect(p.stats.rebuilds).toBe(rebuilds);
    expect(p.stats.compactions).toBe(0);
    expect(c.edge.dead).toBe(eN);
    check(p, 899);
    // Its zeroed walls still sit in its chunk's run: the shader collapses them.
    expect(MOON_EDGE_VS).toContain('if (a == b)');
  });

  it('compacts a chunk once more than a third of it is dead, keeping its houses in order', () => {
    const p = new MoonPack();
    for (let k = 0; k < 9; k++) p.add(lHouse(`a${k}`, ...cell(0, 0, 20 + (k % 3) * 30, 20 + Math.floor(k / 3) * 30)), 0);
    p.add(lHouse('b', ...cell(3, 0, 20, 20)), 0);
    p.sync(OX, OY);
    const c = recOf(p, 'a0').chunk!, b = recOf(p, 'b').chunk!, len = c.edge.len;
    for (const k of [1, 4, 7]) p.remove(`a${k}`);
    p.sync(OX, OY);
    // A third exactly: not yet.
    expect(p.stats.compactions).toBe(0);
    expect(c.edge.len).toBe(len);
    flush(p);
    p.remove('a2');
    p.sync(OX, OY);
    expect(p.stats.compactions).toBe(1);
    expect(c.edge.len).toBe((len * 5) / 9);
    expect(c.edge.dead).toBe(0);
    expect([...c.recs].map((r) => r.id)).toEqual(['a0', 'a3', 'a5', 'a6', 'a8']);
    check(p, 6);
    // Only that chunk goes up again; the vertices stay put.
    expect(p.verts.toUpload).toBe(0);
    for (let k = 0; k < p.edges.nDirty; k += 2) {
      expect(p.edges.dirty[k]).toBeGreaterThanOrEqual(c.edge.start);
      expect(p.edges.dirty[k + 1]).toBeLessThanOrEqual(c.edge.start + c.edge.cap);
    }
    expect(b.edge.dead).toBe(0);
  });

  it('moves a full chunk to the end of the arenas, leaving zeros, and uploads only it', () => {
    const p = new MoonPack();
    p.add(lHouse('a', ...cell(0, 0, 10, 10)), 0);
    p.add(lHouse('b', ...cell(1, 0, 10, 10)), 0);
    p.sync(OX, OY);
    flush(p);
    const a = recOf(p, 'a').chunk!, b = recOf(p, 'b').chunk!;
    const start = a.edge.start, cap = a.edge.cap;
    expect(start).toBeLessThan(b.edge.start);
    // 120 more walls than its room holds.
    for (let k = 0; k < 20; k++) p.add(lHouse(`a${k}`, ...cell(0, 0, 30 + (k % 5) * 20, 30 + Math.floor(k / 5) * 20)), 0);
    p.sync(OX, OY);
    expect(p.stats.rebuilds).toBe(1);
    expect(a.edge.start).toBeGreaterThan(b.edge.start);
    expect(a.edge.cap).toBeGreaterThan(cap);
    expect(p.edges.holes).toBe(cap);
    check(p, 22);
    expect(p.edges.toUpload).toBe(6 * F + a.edge.len);
    for (let k = 0; k < p.edges.nDirty; k += 2) {
      const lo = p.edges.dirty[k], hi = p.edges.dirty[k + 1];
      expect(hi <= b.edge.start || lo >= b.edge.start + b.edge.cap).toBe(true);
    }
  });

  it('drops a chunk once its houses are gone; a house removed before its frame is never packed', () => {
    const p = new MoonPack();
    p.add(lHouse('a0', ...cell(0, 0, 10, 10)), 0);
    p.add(lHouse('a1', ...cell(0, 0, 40, 10)), 0);
    p.add(lHouse('b', ...cell(1, 0, 10, 10)), 0);
    p.sync(OX, OY);
    p.remove('a0');
    p.remove('a1');
    p.sync(OX, OY);
    expect(p.chunks.length).toBe(1);
    expect(p.stats.chunks).toBe(1);
    check(p, 1);
    p.add(lHouse('c', ...cell(4, 4, 10, 10)), 0);
    p.remove('c');
    p.sync(OX, OY);
    expect(p.chunks.length).toBe(1);
    check(p, 1);
    // Seen again later: back in a chunk of its own.
    p.add(lHouse('a0', ...cell(0, 0, 10, 10)), 0);
    p.sync(OX, OY);
    expect(p.chunks.length).toBe(2);
    check(p, 2);
    p.clear();
    p.sync(OX, OY);
    expect(p.chunks.length + p.stats.houses + p.stats.walls).toBe(0);
    check(p, 0);
  });

  it('repacks everything for a new origin, or once garbage outweighs the houses', () => {
    const p = new MoonPack();
    city(p, 10, 10, 30);
    p.sync(OX, OY);
    p.sync(OX + 5000, OY - 300);
    expect(p.stats.rebuilds).toBe(2);
    expect(p.oxWM).toBe(OX + 5000);
    check(p, 100);

    const q = new MoonPack(0);
    city(q, 10, 10, 30);
    q.sync(OX, OY);
    for (let k = 0; k < 50; k++) q.remove(`h${k % 10}_${Math.floor(k / 10)}`);
    q.sync(OX, OY);
    // Half the vertices dead: not more than half yet.
    expect(q.stats.rebuilds).toBe(1);
    q.remove('h0_5');
    q.sync(OX, OY);
    expect(q.stats.rebuilds).toBe(2);
    expect(q.verts.end).toBe(49 * 6 * MOON_VERT_FLOATS);
    check(q, 49);
  });

  it('stays consistent through a random walk of adds, bursts of removals, frames and rebases', () => {
    let seed = 0x9e3779b9;
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
    };
    const p = new MoonPack(4000);
    const ids: string[] = [];
    let next = 0, ox = OX;
    const drop = (k: number) => {
      p.remove(ids[k]);
      ids[k] = ids[ids.length - 1];
      ids.pop();
    };
    for (let step = 0; step < 4000; step++) {
      const x = rnd();
      if (x < 0.5 || ids.length < 30) {
        const id = `f${next++}`;
        p.add(lHouse(id, rnd() * 1500, rnd() * 1500, 6 + rnd() * 20), step * 0.01);
        ids.push(id);
      } else if (x < 0.8) drop(Math.floor(rnd() * ids.length));
      else if (x < 0.83) {
        // A block lights up: up to 15 houses of one chunk go at once.
        const block = [...recOf(p, ids[Math.floor(rnd() * ids.length)]).chunk!.recs].slice(0, 15);
        for (const r of block) drop(ids.indexOf(r.id));
      } else if (x < 0.835) ox += 1000;
      else {
        p.sync(ox, OY);
        if (rnd() < 0.5) flush(p);
      }
      if (step % 400 === 399) {
        p.sync(ox, OY);
        check(p, ids.length);
      }
    }
    expect(p.stats.compactions).toBeGreaterThan(3);
    expect(p.stats.rebuilds).toBeGreaterThan(3);
  });
});

describe('seen houses at scale', () => {
  it('a burst of 40 removals costs a chunk, not the city; a phone view draws a few chunks (10 000 houses)', () => {
    const p = new MoonPack();
    // 100 × 100 houses 25 m apart: 2.5 km square, 60 000 walls.
    city(p, 100, 100, 25, -1e6);
    let ox = x0 - 300;
    const t0 = performance.now();
    p.sync(ox, OY);
    const firstMs = performance.now() - t0;
    flush(p);
    const ms = (f: () => void, n = 5) => {
      f();
      const t = performance.now();
      for (let k = 0; k < n; k++) f();
      return (performance.now() - t) / n;
    };
    // Before: any removal repacked everything at the next draw, and uploaded all of it (as live
    // data: 6 walls, 6 vertices and 12 indices a house). Nudging the origin repacks here.
    const repackMs = ms(() => p.sync((ox += 0.001), OY));
    const repackBytes = 10_000 * (6 * F + 6 * MOON_VERT_FLOATS + 12) * 4;
    const toUploadAfterRepack = toUpload(p);
    expect(toUploadAfterRepack * 4).toBeLessThan(1.5 * repackBytes);
    flush(p);
    const { rebuilds } = p.stats;
    // After: a block of 40 houses (5 × 8) lights up, then a frame syncs. A first burst warms up.
    const burst = (i0: number, j0: number) => {
      const t = performance.now();
      for (let j = j0; j < j0 + 8; j++) for (let i = i0; i < i0 + 5; i++) p.remove(`h${i}_${j}`);
      p.sync(ox, OY);
      return performance.now() - t;
    };
    burst(10, 10);
    flush(p);
    const burstMs = burst(40, 60);
    const burstBytes = toUpload(p) * 4;
    expect(p.stats.rebuilds).toBe(rebuilds);
    expect(p.stats.houses).toBe(10_000 - 80);
    expect(burstBytes).toBeLessThan(repackBytes / 50);
    check(p, 10_000 - 80);
    // A phone at z17 (390 × 844 CSS px) over the middle of it.
    const u = C / (512 * 2 ** 17), mx = x0 + 1250 * m2u, my = y0 + 1250 * m2u;
    const view = [mx - 195 * u, my - 422 * u, mx + 195 * u, my + 422 * u];
    const selectMs = ms(() => p.select(view, MOON_CULL_PX * u), 50);
    expect(p.stats.drawn).toBeLessThan(p.stats.walls / 10);
    // Zoomed out to z13 over the middle: more chunks, still a few draws.
    p.select([mx - 195 * 16 * u, my - 422 * 16 * u, mx + 195 * 16 * u, my + 422 * 16 * u], MOON_CULL_PX * 16 * u);
    const z13 = { visible: p.stats.visible, draws: (p.nFill + p.nEdge) / 2, drawn: p.stats.drawn };
    p.select(view, MOON_CULL_PX * u);
    console.log(
      `moon houses, 10 000 (${p.stats.chunks} chunks, ${p.stats.walls} walls): first pack ${firstMs.toFixed(1)} ms; ` +
      `old removal (full repack) ${repackMs.toFixed(1)} ms + ${(repackBytes / 1e6).toFixed(2)} MB upload ` +
      `(a repack now uploads ${((toUploadAfterRepack * 4) / 1e6).toFixed(2)} MB); ` +
      `burst of 40 now ${burstMs.toFixed(2)} ms + ${(burstBytes / 1e3).toFixed(1)} KB upload; ` +
      `z17 view: ${p.stats.visible} chunks, ${p.stats.drawn} walls, ${(p.nFill + p.nEdge) / 2} draws, select ${(selectMs * 1e3).toFixed(1)} µs; ` +
      `z13 view: ${z13.visible} chunks, ${z13.drawn} walls, ${z13.draws} draws`,
    );
  });
});
