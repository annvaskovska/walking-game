import { describe, expect, it } from 'vitest';
import { decodeTile, encodeTile } from './mvt';
import type { MvtFeatureInput } from './mvt';

// A hand-written protobuf kit, for what encodeTile never writes (sint and float values, fields in
// another order, unknown fields) and for the geometry examples of the spec.
const varint = (n: number): number[] => {
  const out: number[] = [];
  while (n >= 0x80) {
    out.push((n % 128) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
};
const tag = (field: number, wire: number) => varint(field * 8 + wire);
/** An int64 varint as protobuf writes it: a negative one is ten bytes of two's complement. */
const int64 = (n: number): number[] => {
  let v = BigInt.asUintN(64, BigInt(n));
  const out: number[] = [];
  while (v >= 0x80n) {
    out.push(Number(v & 0x7fn) | 0x80);
    v >>= 7n;
  }
  out.push(Number(v));
  return out;
};
const uint = (field: number, n: number) => [...tag(field, 0), ...varint(n)];
const bytes = (field: number, data: number[]) => [...tag(field, 2), ...varint(data.length), ...data];
const str = (field: number, s: string) => bytes(field, [...new TextEncoder().encode(s)]);
const le = (n: number, size: 4 | 8) => {
  const b = new Uint8Array(size);
  const dv = new DataView(b.buffer);
  if (size === 4) dv.setFloat32(0, n, true);
  else dv.setFloat64(0, n, true);
  return [...b];
};

/** A tile with one layer `l` holding one feature with these geometry commands. */
function geomTile(type: number, geometry: number[]): Uint8Array {
  const feature = [...uint(3, type), ...bytes(4, geometry)];
  return new Uint8Array(bytes(3, [...uint(15, 2), ...str(1, 'l'), ...bytes(2, feature), ...uint(5, 4096)]));
}
const partsOf = (buf: Uint8Array) => decodeTile(buf).get('l')!.features[0].parts;

/** The decoded features of one layer of an encoded tile. */
const roundTrip = (features: MvtFeatureInput[], extent?: number) =>
  decodeTile(encodeTile([{ name: 'l', extent, features }])).get('l')!;

const contains = (hay: Uint8Array, needle: number[]) => {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
};

describe('decodeTile', () => {
  it('decodes the geometry examples of the MVT 2.1 spec', () => {
    expect(partsOf(geomTile(1, [9, 50, 34]))).toEqual([[25, 17]]);
    expect(partsOf(geomTile(1, [17, 10, 14, 3, 9]))).toEqual([[5, 7], [3, 2]]);
    expect(partsOf(geomTile(2, [9, 4, 4, 18, 0, 16, 16, 0]))).toEqual([[2, 2, 2, 10, 10, 10]]);
    // Multi line: the second MoveTo is relative to the end of the first line.
    expect(partsOf(geomTile(2, [9, 4, 4, 18, 0, 16, 16, 0, 9, 17, 17, 10, 4, 8]))).toEqual([
      [2, 2, 2, 10, 10, 10],
      [1, 1, 3, 5],
    ]);
    // ClosePath repeats the first point.
    expect(partsOf(geomTile(3, [9, 6, 12, 18, 10, 12, 24, 44, 15]))).toEqual([[3, 6, 8, 12, 20, 34, 3, 6]]);
  });

  it('reads sint, float, double, int (negative too), uint and bool values', () => {
    const values: [string, number[]][] = [
      ['neg', uint(6, 5)], // zigzag 5 = -3
      ['pos', uint(6, 14)], // zigzag 14 = 7
      ['f32', [...tag(2, 5), ...le(1.5, 4)]],
      ['f64', [...tag(3, 1), ...le(-0.25, 8)]],
      ['int', uint(4, 42)],
      ['minus1', [...tag(4, 0), ...int64(-1)]],
      ['minusBig', [...tag(4, 0), ...int64(-(2 ** 40) - 5)]],
      ['big', uint(5, 2 ** 40 + 3)],
      ['no', uint(7, 0)],
      ['name', str(1, "'s-Gravelandseveer")],
    ];
    const tags = values.flatMap((_, i) => [...varint(i), ...varint(i)]);
    const feature = [...uint(1, 7), ...bytes(2, tags), ...uint(3, 1), ...bytes(4, [9, 2, 2])];
    const layer = [
      ...str(1, 'l'),
      ...bytes(2, feature),
      ...values.flatMap(([k]) => str(3, k)),
      ...values.flatMap(([, v]) => bytes(4, v)),
    ];
    const f = decodeTile(new Uint8Array(bytes(3, layer))).get('l')!.features[0];
    expect(f.props).toEqual({
      neg: -3,
      pos: 7,
      f32: 1.5,
      f64: -0.25,
      int: 42,
      minus1: -1,
      minusBig: -(2 ** 40) - 5,
      big: 2 ** 40 + 3,
      no: false,
      name: "'s-Gravelandseveer",
    });
  });

  it('accepts layer fields in any order, skips unknown fields and defaults the extent to 4096', () => {
    const feature = [
      ...uint(9, 300), // unknown varint
      ...uint(3, 2),
      ...bytes(4, [9, 4, 4, 10, 2, 0]),
      ...[...tag(10, 5), 1, 2, 3, 4], // unknown fixed32
      ...uint(1, 99),
      ...bytes(2, [0, 0, 5, 0, 0, 7]), // key 5 and value 7 do not exist: ignored
    ];
    const layer = [
      ...bytes(2, feature), // features before the name, keys and values they use
      ...[...tag(11, 1), 1, 2, 3, 4, 5, 6, 7, 8], // unknown fixed64
      ...str(1, 'roads'),
      ...str(3, 'class'),
      ...bytes(4, str(1, 'minor')),
      ...bytes(12, [1, 2, 3]), // unknown length-delimited
      ...uint(15, 2),
    ];
    const tile = new Uint8Array([...uint(7, 1), ...bytes(3, layer), ...bytes(9, [8, 8])]);
    const l = decodeTile(tile).get('roads')!;
    expect(l.extent).toBe(4096);
    expect(l.features).toEqual([{ id: 99, type: 2, props: { class: 'minor' }, parts: [[2, 2, 3, 2]] }]);
  });

  it('rejects geometry commands it does not know', () => {
    expect(() => decodeTile(geomTile(2, [9, 4, 4, 13]))).toThrow(/geometry command 5/);
  });
});

describe('encodeTile', () => {
  it('writes the spec example geometries byte for byte', () => {
    const line = encodeTile([{ name: 'l', features: [{ type: 2, parts: [[2, 2, 2, 10, 10, 10]] }] }]);
    expect(contains(line, bytes(4, [9, 4, 4, 18, 0, 16, 16, 0]))).toBe(true);
    const poly = encodeTile([{ name: 'l', features: [{ type: 3, parts: [[3, 6, 8, 12, 20, 34, 3, 6]] }] }]);
    expect(contains(poly, bytes(4, [9, 6, 12, 18, 10, 12, 24, 44, 15]))).toBe(true);
    const pt = encodeTile([{ name: 'l', features: [{ type: 1, parts: [[25, 17]] }] }]);
    expect(contains(pt, bytes(4, [9, 50, 34]))).toBe(true);
  });
});

describe('encodeTile → decodeTile', () => {
  it('round-trips points, lines and polygons with their types', () => {
    const l = roundTrip([
      { type: 1, parts: [[25, 17]] },
      { type: 1, parts: [[5, 7], [3, 2]] },
      { type: 2, parts: [[0, 0, 100, 0, 100, 250, 37, 251]] },
      { type: 3, parts: [[0, 0, 10, 0, 10, 10, 0, 10, 0, 0]] },
    ]);
    expect(l.features.map((f) => f.type)).toEqual([1, 1, 2, 3]);
    expect(l.features.map((f) => f.parts)).toEqual([
      [[25, 17]],
      [[5, 7], [3, 2]],
      [[0, 0, 100, 0, 100, 250, 37, 251]],
      [[0, 0, 10, 0, 10, 10, 0, 10, 0, 0]],
    ]);
  });

  it('round-trips multipart lines, the cursor carried from part to part', () => {
    const parts = [
      [100, 100, 200, 100, 200, 300],
      [150, 50, 150, 60],
      [4000, 4000, 10, 10, 3000, 20, 3001, 21],
    ];
    expect(roundTrip([{ type: 2, parts }]).features[0].parts).toEqual(parts);
  });

  it('closes polygon rings, outer and holes, and keeps a closed line as given', () => {
    const outer = [0, 0, 100, 0, 100, 100, 0, 100, 0, 0];
    const hole = [20, 20, 20, 40, 40, 40, 40, 20, 20, 20];
    const second = [200, 200, 300, 200, 250, 280, 200, 200];
    const roundabout = [500, 500, 520, 510, 510, 530, 490, 520, 500, 500];
    const l = roundTrip([
      { type: 3, parts: [outer, hole, second] },
      { type: 2, parts: [roundabout] },
    ]);
    expect(l.features[0].parts).toEqual([outer, hole, second]);
    expect(l.features[1].parts).toEqual([roundabout]);
  });

  it('round-trips string, integer, float and boolean properties, sharing equal values', () => {
    const a = { class: 'minor', name: 'Café De Prins — Prinsengracht 124', empty: '', layer: 1, big: 2 ** 40 + 7 };
    const b = { neg: -2, ratio: 0.1, pi: Math.PI, tiny: -1e-9, yes: true, no: false, zero: 0, layer: 1 };
    const l = roundTrip([
      { type: 1, props: a, parts: [[1, 1]] },
      { type: 1, props: b, parts: [[2, 2]] },
      { type: 1, parts: [[3, 3]] },
    ]);
    expect(l.features.map((f) => f.props)).toEqual([a, b, {}]);
  });

  it('round-trips feature ids above 2^31, up to 2^53 - 1, and no id as 0', () => {
    const ids = [1, 127, 128, 2 ** 31 + 5, 2 ** 32 + 1, 123_456_789_012, Number.MAX_SAFE_INTEGER];
    const l = roundTrip([...ids.map((id) => ({ id, type: 1 as const, parts: [[0, 0]] })), { type: 1, parts: [[0, 0]] }]);
    expect(l.features.map((f) => f.id)).toEqual([...ids, 0]);
  });

  it('keeps each layer name and extent', () => {
    const tile = decodeTile(
      encodeTile([
        { name: 'a', features: [] },
        { name: 'b', extent: 8192, features: [{ type: 2, parts: [[0, 0, 8192, 8192]] }] },
        { name: 'c', extent: 512, features: [] },
      ]),
    );
    expect([...tile.keys()]).toEqual(['a', 'b', 'c']);
    expect([...tile.values()].map((l) => l.extent)).toEqual([4096, 8192, 512]);
    expect(tile.get('b')!.features[0].parts).toEqual([[0, 0, 8192, 8192]]);
  });

  it('keeps negative coordinates and coordinates past the extent (the tile buffer)', () => {
    const line = [-64, -30, 4160, 4200, -1, 4095, 0, -64];
    const ring = [-80, -80, 50, -80, 50, 50, -80, 50, -80, -80];
    const l = roundTrip([
      { type: 2, parts: [line] },
      { type: 3, parts: [ring] },
      { type: 1, parts: [[-5, 4100]] },
    ]);
    expect(l.features.map((f) => f.parts)).toEqual([[line], [ring], [[-5, 4100]]]);
  });

  it('decodes only the wanted layers, without parsing the others', () => {
    // A layer whose geometry cannot be decoded: reading it would throw.
    const broken = bytes(3, [...str(1, 'poi'), ...bytes(2, [...uint(3, 2), ...bytes(4, [9, 4, 4, 13])])]);
    const tile = new Uint8Array([
      ...encodeTile([
        { name: 'water', features: [{ type: 3, parts: [[0, 0, 9, 0, 9, 9, 0, 0]] }] },
        { name: 'transportation', features: [{ type: 2, props: { class: 'minor' }, parts: [[0, 0, 10, 10]] }] },
        { name: 'building', features: [{ type: 3, parts: [[0, 0, 5, 0, 5, 5, 0, 0]] }] },
      ]),
      ...broken,
    ]);
    expect(() => decodeTile(tile)).toThrow();
    const wanted = decodeTile(tile, new Set(['transportation', 'building', 'transportation_name']));
    expect([...wanted.keys()]).toEqual(['transportation', 'building']);
    expect(wanted.get('transportation')!.features[0].props).toEqual({ class: 'minor' });
  });

  it('reads an ArrayBuffer as well as a Uint8Array view into a larger buffer', () => {
    const tile = encodeTile([{ name: 'l', features: [{ id: 2 ** 33, type: 2, props: { pi: Math.PI }, parts: [[1, 2, 3, 4]] }] }]);
    const padded = new Uint8Array(tile.length + 13);
    padded.set(tile, 5);
    const view = padded.subarray(5, 5 + tile.length);
    const copy = tile.slice().buffer;
    for (const input of [view, copy]) {
      const f = decodeTile(input).get('l')!.features[0];
      expect(f).toEqual({ id: 2 ** 33, type: 2, props: { pi: Math.PI }, parts: [[1, 2, 3, 4]] });
    }
  });
});
