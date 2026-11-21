import { describe, expect, it } from 'vitest';
import { EARTH_CIRCUMFERENCE_M } from '../gl';
import {
  EDGE_FLOATS, MAX_HALF_ANGLE, ShadowCaster, WALL_DARK_M, WALL_LIT_M, inQuad, m2uAtWmY, packEdges, shadowAt,
  wedgeOf, type Wedge,
} from './shadows';

/** Walls of flat rings (x, y, ...), outer first, turned as core/occluders does: inside where cross(b - a, p - a) > 0. */
function ringEdges(rings: number[][]): Float64Array {
  const out: number[] = [];
  rings.forEach((r, ri) => {
    const m = r.length / 2;
    let area = 0;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      area += r[i * 2] * r[j * 2 + 1] - r[j * 2] * r[i * 2 + 1];
    }
    const want = ri === 0 ? area > 0 : area < 0;
    const pts: number[][] = [];
    for (let i = 0; i < m; i++) pts.push([r[i * 2], r[i * 2 + 1]]);
    if (!want) pts.reverse();
    for (let i = 0; i < m; i++) {
      const p = pts[(i + m - 1) % m], a = pts[i], b = pts[(i + 1) % m], n = pts[(i + 2) % m];
      out.push(a[0], a[1], b[0], b[1], p[0], p[1], n[0], n[1]);
    }
  });
  return Float64Array.from(out);
}

const concat = (...e: Float64Array[]) => {
  const out = new Float64Array(e.reduce((s, x) => s + x.length, 0));
  let o = 0;
  for (const x of e) {
    out.set(x, o);
    o += x.length;
  }
  return out;
};

const rect = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y1, x0, y1];

interface Scene {
  edges: Float64Array;
  lx: number;
  ly: number;
  reach: number;
  soft: number;
  m2u: number;
}

function wedges(s: Scene): Wedge[] {
  const out: Wedge[] = [];
  for (let k = 0; k < s.edges.length / EDGE_FLOATS; k++) {
    const w = wedgeOf(s.edges, k, s.lx, s.ly, s.reach, s.soft, s.m2u);
    if (w) out.push(w);
  }
  return out;
}

/** Light left at a point, as the GPU computes it: each wedge darkens only the pixels its quad covers. */
function lightAt(s: Scene, ws: Wedge[], x: number, y: number): number {
  let l = 1;
  for (const w of ws) if (inQuad(w, x - s.lx, y - s.ly)) l *= 1 - shadowAt(w, x - s.lx, y - s.ly, s.m2u);
  return l;
}

/** Small deterministic PRNG. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

describe('packEdges', () => {
  it('moves every corner to local units around the origin', () => {
    const ox = 23_389_000.25, oy = 13_712_000.5;
    const e = Float64Array.of(ox + 1, oy + 2, ox + 3, oy + 4, ox - 5, oy - 6, ox + 7.5, oy - 8.25);
    expect(Array.from(packEdges(e, 1, ox, oy))).toEqual([1, 2, 3, 4, -5, -6, 7.5, -8.25]);
  });

  it('stays millimetre-exact for real WM coordinates near the origin', () => {
    const ox = 23_389_123.456789, oy = 13_712_987.654321;
    const e = new Float64Array(8).map((_, i) => (i % 2 ? oy : ox) + 1234.5678 * (i + 1) * (i % 3 ? 1 : -1));
    const p = packEdges(e, 1, ox, oy);
    for (let i = 0; i < 8; i++) expect(Math.abs(p[i] - (e[i] - (i % 2 ? oy : ox)))).toBeLessThan(1e-3);
  });

  it('rebases: the same walls packed around two origins differ by exactly the shift', () => {
    const e = Float64Array.of(1e7 + 10, 2e7 + 20, 1e7 + 30, 2e7 + 40, 1e7, 2e7, 1e7 + 50, 2e7 + 60);
    const a = packEdges(e, 1, 1e7, 2e7), b = packEdges(e, 1, 1e7 + 100, 2e7 - 50);
    for (let i = 0; i < 8; i += 2) {
      expect(a[i] - b[i]).toBeCloseTo(100, 4);
      expect(a[i + 1] - b[i + 1]).toBeCloseTo(-50, 4);
    }
  });

  it('writes into a big enough array and only n walls of it', () => {
    const out = new Float32Array(32).fill(9);
    const e = new Float64Array(24).fill(5);
    const r = packEdges(e, 2, 1, 2, out);
    expect(r).toBe(out);
    expect(Array.from(r.subarray(0, 16))).toEqual(new Array(16).fill(0).map((_, i) => (i % 2 ? 3 : 4)));
    expect(r[16]).toBe(9);
    expect(packEdges(e, 3, 0, 0, new Float32Array(8)).length).toBe(24);
  });
});

describe('m2uAtWmY', () => {
  it('is 1 at the equator and 1 / cos(lat) elsewhere', () => {
    expect(m2uAtWmY(EARTH_CIRCUMFERENCE_M / 2)).toBeCloseTo(1, 12);
    const lat = 52.37, s = Math.sin((lat * Math.PI) / 180);
    const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * EARTH_CIRCUMFERENCE_M;
    expect(m2uAtWmY(y)).toBeCloseTo(1 / Math.cos((lat * Math.PI) / 180), 9);
  });
});

describe('the wedge of one wall', () => {
  // A 10 x 10 house, its front wall y = 0 from x = -5 to 5, the light 10 m in front of it.
  const house = ringEdges([rect(-5, 0, 5, 10)]);
  const scene: Scene = { edges: house, lx: 0, ly: -10, reach: 110, soft: 1.5, m2u: 1 };
  const ws = wedges(scene);

  it('only walls facing the light cast a shadow', () => {
    expect(ws.length).toBe(1);
    expect(ws[0].h).toBeCloseTo(10, 9);
    // From behind, only the back wall faces the light.
    const away = wedges({ ...scene, ly: 20 });
    expect(away.length).toBe(1);
    expect(away[0].h).toBeCloseTo(10, 9);
  });

  it('walls beyond the reach cast nothing', () => {
    expect(wedges({ ...scene, ly: -200 }).length).toBe(0);
    expect(wedges({ ...scene, ly: -109.9 }).length).toBe(1);
  });

  it('keeps the wall itself lit and is dark a step behind it', () => {
    for (const x of [-4, 0, 3]) {
      expect(lightAt(scene, ws, x, -0.5)).toBe(1); // in front
      expect(lightAt(scene, ws, x, 0)).toBe(1); // on the wall line
      expect(lightAt(scene, ws, x, 0.2)).toBe(1); // the lit strip
      expect(lightAt(scene, ws, x, 1)).toBe(0); // a step behind it
      expect(lightAt(scene, ws, x, 2)).toBe(0); // inside the house
      expect(lightAt(scene, ws, x * 3, 40)).toBe(0); // far behind it
    }
    const mid = lightAt(scene, ws, 0, (WALL_LIT_M + WALL_DARK_M) / 2);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.8);
  });

  it('leaves the street beside the house in the light', () => {
    for (const [x, y] of [[-20, 5], [20, 5], [-30, 30], [8, -2], [0, -9]]) expect(lightAt(scene, ws, x, y)).toBe(1);
  });

  it('opens soft sides outwards at silhouette corners, sharp near the corner and wider behind', () => {
    // Corner (5, 0); the hard ray from the light runs through it in direction (5, 10).
    const len = Math.hypot(5, 10), ux = 5 / len, uy = 10 / len, nx = uy, ny = -ux; // nx, ny: out of the shadow
    const half = Math.asin(1.5 / len); // a lamp of radius 1.5 m seen from the corner
    const band = (t: number) => {
      const cx = 5 + ux * t, cy = uy * t;
      const at = (e: number) => lightAt(scene, ws, cx + nx * e, cy + ny * e);
      // The wedge is dark right up to the ray, and the light is back in full where the lamp
      // clears the corner.
      expect(at(0)).toBe(0);
      expect(at(-0.01)).toBe(0);
      expect(at(t * Math.tan(half) + 0.11)).toBe(1);
      // Where across the ray the light crosses 10 % and 90 %.
      let lo = 0, hi = 0;
      for (let e = -6; e <= 12; e += 0.005) {
        const l = at(e);
        if (l < 0.1) lo = e;
        if (l < 0.9) hi = e;
      }
      expect(lo).toBeGreaterThan(0);
      return hi - lo;
    };
    const near = band(4), far = band(40);
    expect(far).toBeGreaterThan(near * 3);
    expect(far).toBeGreaterThan(40 * Math.tan(half) * 0.5);
    expect(far).toBeLessThan(40 * Math.tan(half));
  });

  it('never opens a penumbra wider than the maximum half-angle', () => {
    const w = wedges({ ...scene, ly: -0.3, soft: 50 })[0];
    expect(Math.atan(w.ka)).toBeCloseTo(MAX_HALF_ANGLE, 6);
  });

  it('with no softness every side is hard', () => {
    const w = wedges({ ...scene, soft: 0 })[0];
    expect(w.ka).toBe(0);
    expect(w.kb).toBe(0);
  });
});

describe('wedges together', () => {
  it('join without a seam where two lit walls meet', () => {
    // Seen from the corner's diagonal, two walls face the light and share the corner (5, 0).
    const s: Scene = { edges: ringEdges([rect(-5, 0, 5, 10)]), lx: 25, ly: -20, reach: 110, soft: 1.5, m2u: 1.62 };
    const ws = wedges(s);
    expect(ws.length).toBe(2);
    const ux = (5 - 25) / Math.hypot(20, 20), uy = 20 / Math.hypot(20, 20);
    for (let t = WALL_DARK_M * s.m2u + 0.01; t < 80; t += 0.37) {
      for (const e of [0, 1e-9, -1e-9, 1e-4, -1e-4, 0.01, -0.01]) {
        const x = 5 + ux * t - uy * e, y = uy * t + ux * e;
        expect(lightAt(s, ws, x, y)).toBe(0);
      }
    }
  });

  it('leaves no streak behind terraced houses whose party walls are each house’s own', () => {
    const terrace = concat(...[0, 1, 2, 3].map((i) => ringEdges([rect(i * 8, 0, i * 8 + 8, 12)])));
    for (const lx of [-6, 4, 8, 12, 15.9, 16, 16.1, 30, 40]) {
      const s: Scene = { edges: terrace, lx, ly: -9, reach: 110, soft: 1.5, m2u: 1 };
      const ws = wedges(s);
      for (const cx of [8, 16, 24]) {
        const len = Math.hypot(cx - lx, 9), ux = (cx - lx) / len, uy = 9 / len;
        for (let t = 2; t < 60; t += 0.5) {
          for (const e of [-0.3, -0.05, 0, 0.05, 0.3]) {
            const x = cx + ux * t - uy * e, y = uy * t + ux * e;
            if (y < 13) continue; // behind the terrace only
            expect(lightAt(s, ws, x, y)).toBeLessThan(0.02);
          }
        }
      }
    }
  });

  it('a wall seen edge-on still darkens what lies behind its far end', () => {
    // The light 0.6 m off the line of the house's left wall (x = -5), 30 m before it.
    const s: Scene = { edges: ringEdges([rect(-5, 0, 5, 20)]), lx: -5.6, ly: -30, reach: 110, soft: 1.5, m2u: 1 };
    const ws = wedges(s);
    // Past the back-left corner, inside the ray from the light through it.
    const kx = -5, ky = 20, len = Math.hypot(kx - s.lx, ky - s.ly);
    const ux = (kx - s.lx) / len, uy = (ky - s.ly) / len;
    for (const t of [3, 6, 12]) {
      const x = kx + ux * t + uy * 0.6, y = ky + uy * t - ux * 0.6;
      expect(lightAt(s, ws, x, y)).toBeLessThan(0.05);
    }
  });

  it('a wall seen edge-on darkens nothing between the light and its near end', () => {
    // The light 5 cm off the line of the left wall (x = -5), 30 m before its near corner (-5, 0).
    for (const off of [0.001, 0.05, 0.3]) {
      const s: Scene = { edges: ringEdges([rect(-5, 0, 5, 20)]), lx: -5 - off, ly: -30, reach: 110, soft: 1.5, m2u: 1.62 };
      const ws = wedges(s);
      const len = Math.hypot(off, 30), ux = off / len, uy = 30 / len;
      for (let t = 0.5; t < 29.9; t += 0.25) {
        for (const e of [-0.05, -0.02, -0.005, 0, 0.005, 0.02]) {
          expect(lightAt(s, ws, s.lx + ux * t - uy * e, s.ly + uy * t + ux * e)).toBe(1);
        }
      }
    }
  });

  it('a courtyard keeps its light in', () => {
    const s: Scene = {
      edges: ringEdges([rect(-20, -20, 20, 20), rect(-6, -6, 6, 6)]), lx: 0, ly: 0, reach: 110, soft: 1.5, m2u: 1,
    };
    const ws = wedges(s);
    expect(ws.length).toBe(4);
    expect(lightAt(s, ws, 3, 3)).toBe(1);
    for (const [x, y] of [[0, 10], [10, 0], [-15, -15], [0, 40], [50, 50]]) expect(lightAt(s, ws, x, y)).toBeLessThan(0.01);
  });
});

describe('the quad covers every pixel the wedge darkens', () => {
  const poly = (r: () => number, cx: number, cy: number, star: boolean) => {
    const m = 3 + Math.floor(r() * 9);
    const angs = Array.from({ length: m }, () => r() * Math.PI * 2).sort((a, b) => a - b);
    const size = 0.5 + r() * 25;
    const out: number[] = [];
    angs.forEach((a, i) => {
      const rr = size * (star && i % 2 ? 0.3 + r() * 0.5 : 0.8 + r() * 0.4);
      out.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    });
    return out;
  };

  it('for random houses and lights, close to walls, edge-on and far away', () => {
    const r = rng(7);
    let checked = 0;
    for (let trial = 0; trial < 400; trial++) {
      const m2u = r() < 0.5 ? 1 : 1.62;
      const edges = ringEdges([poly(r, (r() - 0.5) * 60, (r() - 0.5) * 60, r() < 0.4)]);
      const n = edges.length / EDGE_FLOATS;
      // A light somewhere, or right by a wall, or on a wall's line beyond its end.
      let lx = (r() - 0.5) * 160, ly = (r() - 0.5) * 160;
      const k = Math.floor(r() * n) * EDGE_FLOATS, mode = r();
      const ax = edges[k], ay = edges[k + 1], bx = edges[k + 2], by = edges[k + 3];
      const l = Math.hypot(bx - ax, by - ay) || 1, tx = (bx - ax) / l, ty = (by - ay) / l;
      if (mode < 0.3) {
        // Just outside the wall (its outside is where cross(b - a, p - a) < 0: the right of a→b).
        const f = r(), off = [0.001, 0.05, 0.3, 1, 3][Math.floor(r() * 5)];
        lx = ax + (bx - ax) * f + ty * off;
        ly = ay + (by - ay) * f - tx * off;
      } else if (mode < 0.5) {
        const along = (r() < 0.5 ? -1 : 1) * (0.5 + r() * 40), off = (r() - 0.3) * 0.6;
        const base = along < 0 ? [ax, ay] : [bx, by];
        lx = base[0] + tx * along + ty * off;
        ly = base[1] + ty * along - tx * off;
      }
      const s: Scene = { edges, lx, ly, reach: 40 + r() * 140, soft: r() * 4 * m2u, m2u };
      for (let e = 0; e < n; e++) {
        const w = wedgeOf(edges, e, lx, ly, s.reach, s.soft, m2u);
        if (!w) continue;
        for (const v of w.quad) expect(Number.isFinite(v)).toBe(true);
        const probe = (x: number, y: number) => {
          if (Math.hypot(x, y) > s.reach) return;
          const sh = shadowAt(w, x, y, m2u);
          // A plain check, not expect(): this runs over a million times, and expect() alone took seconds.
          if (Number.isNaN(sh)) throw new Error(`NaN shadow at (${x}, ${y}) trial ${trial} edge ${e}`);
          if (sh > 1e-6) {
            checked++;
            if (!inQuad(w, x, y, 1e-7 * s.reach)) {
              throw new Error(`uncovered (${x}, ${y}) shadow ${sh} trial ${trial} edge ${e} DEBUG ${JSON.stringify({ lx, ly, reach: s.reach, soft: s.soft, m2u, edge: Array.from(edges.subarray(e * 8, e * 8 + 8)), w })}`);
            }
          }
        };
        for (let i = 0; i < 300; i++) {
          const a = r() * Math.PI * 2, d = Math.sqrt(r()) * s.reach;
          probe(Math.cos(a) * d, Math.sin(a) * d);
        }
        // Close to the corners and along the rays past them, where covering is tight.
        for (const [cx, cy, ux, uy] of [[w.ua[0] * w.la, w.ua[1] * w.la, ...w.ua], [w.ub[0] * w.lb, w.ub[1] * w.lb, ...w.ub]]) {
          for (let i = 0; i < 200; i++) {
            const t = (r() - 0.2) * s.reach, e = (r() - 0.5) * (0.5 + Math.abs(t) * 0.6);
            probe(cx + ux * t - uy * e, cy + uy * t + ux * e);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(20_000);
  });

  it('a light exactly on a corner or a wall casts no garbage', () => {
    const edges = ringEdges([rect(-5, 0, 5, 10), rect(20, 0, 30, 10)]);
    for (const [lx, ly] of [[-5, 0], [5, 0], [0, 0], [5, 4], [20, 0]]) {
      for (let e = 0; e < edges.length / EDGE_FLOATS; e++) {
        const w = wedgeOf(edges, e, lx, ly, 110, 1.5, 1);
        if (!w) continue;
        for (const v of w.quad) expect(Number.isFinite(v)).toBe(true);
        for (const [x, y] of [[0, 0], [1, 1], [-3, 7], [40, 40]]) expect(Number.isFinite(shadowAt(w, x, y, 1))).toBe(true);
      }
    }
  });
});

describe('fill', () => {
  it('a light in a dense city draws a bounded area of quads', () => {
    // ~3000 walls: terraced rows of 8 m houses on a 56 m street grid, the light in a street.
    const houses: Float64Array[] = [];
    for (let gx = -5; gx <= 5; gx++) {
      for (let gy = -5; gy <= 5; gy++) {
        const x0 = gx * 56 + 7, y0 = gy * 56 + 7;
        for (let i = 0; i < 5; i++) houses.push(ringEdges([rect(x0 + i * 8.4, y0, x0 + (i + 1) * 8.4, y0 + 12)]));
        houses.push(ringEdges([rect(x0, y0 + 20, x0 + 42, y0 + 42)]));
      }
    }
    const edges = concat(...houses), n = edges.length / EDGE_FLOATS;
    expect(n).toBeGreaterThan(2800);
    expect(n).toBeLessThan(3200);
    const m2u = 1.62, reach = 115.5 * m2u;
    let area = 0, drawn = 0;
    const area4 = (q: number[]) => {
      const p = [q[0], q[1], q[2], q[3], q[6], q[7], q[4], q[5]];
      let a = 0;
      for (let i = 0; i < 4; i++) a += p[i * 2] * p[((i + 1) % 4) * 2 + 1] - p[((i + 1) % 4) * 2] * p[i * 2 + 1];
      return Math.abs(a) / 2;
    };
    for (let k = 0; k < n; k++) {
      const w = wedgeOf(edges, k, 3.5 * m2u, 30 * m2u, reach, 1.5 * m2u, m2u);
      if (!w) continue;
      drawn++;
      area += area4(w.quad);
    }
    const disc = Math.PI * reach * reach;
    // Each wall facing the light within reach paints its wedge out to the reach: a few discs' worth.
    // Measured: 448 walls, 5.3 discs.
    expect(drawn).toBeLessThan(600);
    expect(area / disc).toBeLessThan(8);
  });
});

// ---- The caster against a recording stand-in for WebGL2 ----------------------------------------

interface Call {
  name: string;
  args: unknown[];
}

function fakeGl() {
  const calls: Call[] = [];
  const objects = (name: string) => ({ name });
  const gl = new Proxy({} as Record<string, unknown>, {
    get(_, prop: string) {
      if (/^[A-Z_0-9]+$/.test(prop)) return prop; // enums: their own name
      return (...args: unknown[]) => {
        calls.push({ name: prop, args });
        if (prop.startsWith('create')) return objects(prop);
        if (prop === 'getShaderParameter') return true;
        if (prop === 'getProgramParameter') return args[1] === 'ACTIVE_UNIFORMS' ? 0 : true;
        if (prop === 'isContextLost') return false;
        return undefined;
      };
    },
  });
  return { gl: gl as unknown as WebGL2RenderingContext, calls };
}

const last = (calls: Call[], name: string) => [...calls].reverse().find((c) => c.name === name);

describe('ShadowCaster', () => {
  const ox = 23_389_000, oy = 13_712_000;
  const walls = (version: number) => {
    const e = ringEdges([rect(-5, 0, 5, 10)]);
    for (let i = 0; i < e.length; i += 2) {
      e[i] += ox;
      e[i + 1] += oy;
    }
    return { edges: e, n: e.length / EDGE_FLOATS, version };
  };
  const matrix = Float32Array.from({ length: 16 }, (_, i) => i + 1);

  it('draws nothing before init or without walls', () => {
    const { gl, calls } = fakeGl();
    const c = new ShadowCaster();
    c.setOccluders(walls(1));
    c.draw(gl, matrix, ox, oy, [0, -10], 100, 1.5);
    expect(calls.length).toBe(0);
    c.init(gl);
    c.setOccluders(null);
    const before = calls.length;
    c.draw(gl, matrix, ox, oy, [0, -10], 100, 1.5);
    expect(calls.length).toBe(before);
    expect(c.stats.instances).toBe(0);
  });

  it('uploads once per change of walls or origin, and instances every wall', () => {
    const { gl, calls } = fakeGl();
    const c = new ShadowCaster();
    c.init(gl);
    const w = walls(1);
    c.setOccluders(w);
    c.draw(gl, matrix, ox, oy, [0, -10], 100, 1.5);
    expect(c.stats).toEqual({ instances: 4, uploads: 1 });
    expect(last(calls, 'drawArraysInstanced')!.args).toEqual(['TRIANGLE_STRIP', 0, 4, 4]);
    c.draw(gl, matrix, ox, oy, [0, -10], 100, 1.5);
    expect(c.stats.uploads).toBe(1);
    w.version = 2;
    c.draw(gl, matrix, ox, oy, [0, -10], 100, 1.5);
    expect(c.stats.uploads).toBe(2);
    expect(last(calls, 'bufferSubData')).toBeTruthy();
    c.draw(gl, matrix, ox + 100, oy, [0, -10], 100, 1.5);
    expect(c.stats.uploads).toBe(3);
    const sub = last(calls, 'bufferSubData')!.args[2] as Float32Array;
    // Packed around the new origin: 100 units further west.
    expect(sub[0]).toBeCloseTo(w.edges[0] - ox - 100, 3);
  });

  it('packs walls in local units around the origin', () => {
    const { gl, calls } = fakeGl();
    const c = new ShadowCaster();
    c.init(gl);
    const w = walls(1);
    c.setOccluders(w);
    c.draw(gl, matrix, ox, oy, [0, -10], 100, 1.5);
    const data = last(calls, 'bufferData')!.args[1] as Float32Array;
    for (let i = 0; i < w.n * EDGE_FLOATS; i++) expect(data[i]).toBeCloseTo(w.edges[i] - (i % 2 ? oy : ox), 4);
  });

  it('moves the matrix to the light and leaves the mask pass state as it found it', () => {
    const { gl, calls } = fakeGl();
    const c = new ShadowCaster();
    c.init(gl);
    c.setOccluders(walls(1));
    c.draw(gl, matrix, ox, oy, [3, -10], 100, 1.5);
    const m = last(calls, 'uniformMatrix4fv')!.args[2] as Float32Array;
    expect(Array.from(m.subarray(0, 12))).toEqual(Array.from(matrix.subarray(0, 12)));
    for (let r = 0; r < 4; r++) expect(m[12 + r]).toBeCloseTo(matrix[r] * 3 + matrix[4 + r] * -10 + matrix[12 + r], 4);
    const i = calls.findIndex((x) => x.name === 'drawArraysInstanced');
    const before = calls.slice(0, i), after = calls.slice(i);
    expect(last(before, 'colorMask')!.args).toEqual([false, false, true, true]);
    expect(last(before, 'blendEquation')!.args).toEqual(['FUNC_ADD']);
    expect(last(before, 'blendFuncSeparate')!.args).toEqual(['ZERO', 'ONE_MINUS_SRC_ALPHA', 'ZERO', 'ONE_MINUS_SRC_ALPHA']);
    expect(last(after, 'colorMask')!.args).toEqual([true, true, true, true]);
    expect(last(after, 'blendEquation')!.args).toEqual(['MAX']);
    expect(last(after, 'blendFunc')!.args).toEqual(['ONE', 'ONE']);
    expect(last(after, 'bindVertexArray')!.args).toEqual([null]);
  });

  it('comes back after a lost context', () => {
    const { gl, calls } = fakeGl();
    const c = new ShadowCaster();
    c.init(gl);
    c.setOccluders(walls(1));
    c.draw(gl, matrix, ox, oy, [0, -10], 100, 1.5);
    c.release();
    c.draw(gl, matrix, ox, oy, [0, -10], 100, 1.5);
    expect(c.stats.instances).toBe(0);
    // Nothing of the lost context is deleted; everything is made anew and uploaded again.
    const ours = () => calls.filter((x) => /^delete(Program|Buffer|VertexArray)$/.test(x.name)).length;
    const deletes = ours();
    c.init(gl);
    expect(ours()).toBe(deletes);
    c.draw(gl, matrix, ox, oy, [0, -10], 100, 1.5);
    expect(c.stats).toEqual({ instances: 4, uploads: 2 });
  });
});
