import { describe, expect, it } from 'vitest';
import { GridIndex } from './spatialIndex';
import type { BBox } from './geo';

const item = (id: string, bbox: BBox) => ({ id, bbox });

describe('GridIndex', () => {
  it('returns items intersecting the query exactly once', () => {
    const idx = new GridIndex<{ id: string; bbox: BBox }>(0.001);
    idx.insert(item('a', [4.880, 52.370, 4.8805, 52.3702]));
    idx.insert(item('long', [4.870, 52.370, 4.890, 52.3701])); // spans many cells
    idx.insert(item('far', [5.05, 52.45, 5.051, 52.451]));
    const hits = idx.query([4.8799, 52.3699, 4.8811, 52.3705]).map((i) => i.id).sort();
    expect(hits).toEqual(['a', 'long']);
  });

  it('ignores duplicate ids and supports removal', () => {
    const idx = new GridIndex<{ id: string; bbox: BBox }>();
    expect(idx.insert(item('a', [0, 0, 0.0001, 0.0001]))).toBe(true);
    expect(idx.insert(item('a', [0, 0, 0.0001, 0.0001]))).toBe(false);
    expect(idx.size).toBe(1);
    expect(idx.remove('a')).toBe(true);
    expect(idx.query([-1, -1, 1, 1])).toEqual([]);
  });

  it('stays fast with tens of thousands of pieces', () => {
    const idx = new GridIndex<{ id: string; bbox: BBox }>();
    let n = 0;
    for (let i = 0; i < 250; i++) {
      for (let j = 0; j < 200; j++) {
        const lon = 4.8 + i * 0.0004, lat = 52.3 + j * 0.0003;
        idx.insert(item(`p${n++}`, [lon, lat, lon + 0.0003, lat + 0.0001]));
      }
    }
    expect(idx.size).toBe(50_000);
    const t0 = performance.now();
    let found = 0;
    for (let k = 0; k < 1000; k++) {
      const lon = 4.8 + (k % 250) * 0.0004, lat = 52.3 + (k % 200) * 0.0003;
      found += idx.query([lon - 0.0003, lat - 0.0003, lon + 0.0003, lat + 0.0003]).length;
    }
    const ms = performance.now() - t0;
    expect(found).toBeGreaterThan(1000);
    expect(ms).toBeLessThan(500); // 1000 street-scale lookups well under a frame each
  });

  it('falls back to a scan for huge query boxes', () => {
    const idx = new GridIndex<{ id: string; bbox: BBox }>();
    idx.insert(item('x', [10, 10, 11, 11]));
    expect(idx.query([-180, -85, 180, 85]).map((i) => i.id)).toEqual(['x']);
  });
});
