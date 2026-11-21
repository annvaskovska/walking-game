/**
 * A minimal Mapbox Vector Tile (MVT 2.1) decoder: just enough protobuf to read the layers
 * Mr Sparkles needs from the basemap tiles it already downloads. No dependencies, so it runs in a
 * worker and in unit tests alike. Spec: https://github.com/mapbox/vector-tile-spec/tree/master/2.1
 */

export type MvtValue = string | number | boolean;

export interface MvtFeature {
  /** Feature id (the OSM id in OpenMapTiles layers), 0 when absent. */
  id: number;
  /** 1 point, 2 line, 3 polygon. */
  type: number;
  props: Record<string, MvtValue>;
  /** Geometry parts in tile units, each a flat [x, y, x, y, ...] line or ring (rings are closed). */
  parts: number[][];
}

export interface MvtLayer {
  name: string;
  extent: number;
  features: MvtFeature[];
}

const utf8 = new TextDecoder();

class Reader {
  pos: number;
  constructor(readonly buf: Uint8Array, start = 0, public end = buf.length) {
    this.pos = start;
  }

  /** Unsigned varint up to 64 bits, as a JS number (exact up to 2^53). */
  varint(): number {
    const b = this.buf;
    let byte = b[this.pos++];
    let val = byte & 0x7f;
    if (byte < 0x80) return val;
    byte = b[this.pos++];
    val |= (byte & 0x7f) << 7;
    if (byte < 0x80) return val;
    byte = b[this.pos++];
    val |= (byte & 0x7f) << 14;
    if (byte < 0x80) return val;
    byte = b[this.pos++];
    val |= (byte & 0x7f) << 21;
    if (byte < 0x80) return val;
    // Past 28 bits: switch from bit ops (int32) to multiplication.
    let mul = 0x10000000;
    for (let i = 0; i < 6; i++) {
      byte = b[this.pos++];
      val += (byte & 0x7f) * mul;
      if (byte < 0x80) return val;
      mul *= 128;
    }
    throw new Error('MVT: varint too long');
  }

  /** int64 varint: a negative value comes as ten bytes of two's complement, past what a number holds. */
  int64(): number {
    const start = this.pos;
    const v = this.varint();
    if (this.pos - start < 10) return v;
    let big = 0n;
    for (let i = this.pos - 1; i >= start; i--) big = (big << 7n) | BigInt(this.buf[i] & 0x7f);
    return Number(BigInt.asIntN(64, big));
  }

  skip(wire: number): void {
    if (wire === 0) {
      while (this.buf[this.pos++] > 0x7f) {
        /* skip varint bytes */
      }
    } else if (wire === 1) this.pos += 8;
    else if (wire === 2) {
      // Read the length first: `this.pos += this.varint()` would add it to the position before the length.
      const len = this.varint();
      this.pos += len;
    } else if (wire === 5) this.pos += 4;
    else throw new Error(`MVT: unsupported wire type ${wire}`);
  }

  string(): string {
    const len = this.varint();
    const s = utf8.decode(this.buf.subarray(this.pos, this.pos + len));
    this.pos += len;
    return s;
  }
}

/** zigzag-decoded 32-bit value (geometry parameters). */
const zz = (n: number) => (n >>> 1) ^ -(n & 1);

function readValue(r: Reader, end: number): MvtValue {
  let v: MvtValue = '';
  while (r.pos < end) {
    const tag = r.varint();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 1) v = r.string();
    else if (field === 2) {
      v = new DataView(r.buf.buffer, r.buf.byteOffset + r.pos, 4).getFloat32(0, true);
      r.pos += 4;
    } else if (field === 3) {
      v = new DataView(r.buf.buffer, r.buf.byteOffset + r.pos, 8).getFloat64(0, true);
      r.pos += 8;
    } else if (field === 4) v = r.int64();
    else if (field === 5) v = r.varint();
    else if (field === 6) {
      const n = r.varint();
      v = n % 2 === 1 ? -(n + 1) / 2 : n / 2;
    } else if (field === 7) v = r.varint() !== 0;
    else r.skip(wire);
  }
  return v;
}

function readGeometry(r: Reader, end: number): number[][] {
  const parts: number[][] = [];
  let x = 0;
  let y = 0;
  let cur: number[] | null = null;
  while (r.pos < end) {
    const cmd = r.varint();
    const id = cmd & 7;
    const count = cmd >>> 3;
    if (id === 1) {
      for (let i = 0; i < count; i++) {
        x += zz(r.varint());
        y += zz(r.varint());
        cur = [x, y];
        parts.push(cur);
      }
    } else if (id === 2) {
      for (let i = 0; i < count; i++) {
        x += zz(r.varint());
        y += zz(r.varint());
        cur?.push(x, y);
      }
    } else if (id === 7) {
      if (cur && cur.length >= 2) cur.push(cur[0], cur[1]);
    } else {
      throw new Error(`MVT: bad geometry command ${id}`);
    }
  }
  return parts;
}

function readFeature(r: Reader, end: number, keys: string[], values: MvtValue[]): MvtFeature {
  const f: MvtFeature = { id: 0, type: 0, props: {}, parts: [] };
  while (r.pos < end) {
    const tag = r.varint();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 1) f.id = r.varint();
    else if (field === 2) {
      const tEnd = r.varint() + r.pos;
      while (r.pos < tEnd) {
        const k = keys[r.varint()];
        const v = values[r.varint()];
        if (k !== undefined && v !== undefined) f.props[k] = v;
      }
    } else if (field === 3) f.type = r.varint();
    else if (field === 4) {
      const gEnd = r.varint() + r.pos;
      f.parts = readGeometry(r, gEnd);
      r.pos = gEnd;
    } else r.skip(wire);
  }
  return f;
}

function readLayer(buf: Uint8Array, start: number, end: number, wanted: ReadonlySet<string> | null): MvtLayer | null {
  const r = new Reader(buf, start, end);
  let name = '';
  let extent = 4096;
  const keys: string[] = [];
  const values: MvtValue[] = [];
  const featureSpans: number[] = [];
  // Fields may come in any order, and features need keys/values: remember where features are.
  while (r.pos < end) {
    const tag = r.varint();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 1) {
      name = r.string();
      if (wanted && !wanted.has(name)) return null;
    } else if (field === 2) {
      const len = r.varint();
      featureSpans.push(r.pos, r.pos + len);
      r.pos += len;
    } else if (field === 3) keys.push(r.string());
    else if (field === 4) {
      const vEnd = r.varint() + r.pos;
      values.push(readValue(r, vEnd));
      r.pos = vEnd;
    } else if (field === 5) extent = r.varint();
    else r.skip(wire);
  }
  if (wanted && !wanted.has(name)) return null;
  const features: MvtFeature[] = [];
  for (let i = 0; i < featureSpans.length; i += 2) {
    r.pos = featureSpans[i];
    features.push(readFeature(r, featureSpans[i + 1], keys, values));
  }
  return { name, extent, features };
}

/** Decode the wanted layers of a tile (all layers when `wanted` is omitted). */
export function decodeTile(data: ArrayBuffer | Uint8Array, wanted?: ReadonlySet<string>): Map<string, MvtLayer> {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  const r = new Reader(buf);
  const out = new Map<string, MvtLayer>();
  while (r.pos < r.end) {
    const tag = r.varint();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 3 && wire === 2) {
      const len = r.varint();
      const layer = readLayer(buf, r.pos, r.pos + len, wanted ?? null);
      if (layer) out.set(layer.name, layer);
      r.pos += len;
    } else r.skip(wire);
  }
  return out;
}

// ---- Encoding (tests only build tiny tiles with it, but it is small enough to keep here) ----

class Writer {
  bytes: number[] = [];
  varint(n: number): void {
    while (n >= 0x80) {
      this.bytes.push((n % 128) | 0x80);
      n = Math.floor(n / 128);
    }
    this.bytes.push(n);
  }
  tag(field: number, wire: number): void {
    this.varint(field * 8 + wire);
  }
  bytesField(field: number, data: number[]): void {
    this.tag(field, 2);
    this.varint(data.length);
    for (const b of data) this.bytes.push(b);
  }
  stringField(field: number, s: string): void {
    this.bytesField(field, [...new TextEncoder().encode(s)]);
  }
}

const zzEncode = (n: number) => (n << 1) ^ (n >> 31);

export interface MvtFeatureInput {
  id?: number;
  type: 1 | 2 | 3;
  props?: Record<string, string | number | boolean>;
  /** Lines or rings in tile units; rings are written without their closing point plus ClosePath. */
  parts: number[][];
}

/** Encode layers into an MVT buffer. Used by tests to build fixture tiles. */
export function encodeTile(layers: { name: string; extent?: number; features: MvtFeatureInput[] }[]): Uint8Array {
  const tile = new Writer();
  for (const layer of layers) {
    const lw = new Writer();
    lw.tag(15, 0);
    lw.varint(2);
    lw.stringField(1, layer.name);
    const keys: string[] = [];
    const values: (string | number | boolean)[] = [];
    const keyIdx = (k: string) => {
      let i = keys.indexOf(k);
      if (i < 0) i = keys.push(k) - 1;
      return i;
    };
    const valIdx = (v: string | number | boolean) => {
      let i = values.indexOf(v);
      if (i < 0) i = values.push(v) - 1;
      return i;
    };
    for (const f of layer.features) {
      const fw = new Writer();
      if (f.id) {
        fw.tag(1, 0);
        fw.varint(f.id);
      }
      const tags: number[] = [];
      for (const [k, v] of Object.entries(f.props ?? {})) tags.push(keyIdx(k), valIdx(v));
      if (tags.length) {
        const tw = new Writer();
        for (const t of tags) tw.varint(t);
        fw.bytesField(2, tw.bytes);
      }
      fw.tag(3, 0);
      fw.varint(f.type);
      const gw = new Writer();
      let cx = 0;
      let cy = 0;
      for (const part of f.parts) {
        const ring = f.type === 3;
        const n = part.length / 2 - (ring ? 1 : 0);
        gw.varint((1 & 7) | (1 << 3));
        gw.varint(zzEncode(part[0] - cx));
        gw.varint(zzEncode(part[1] - cy));
        cx = part[0];
        cy = part[1];
        if (n > 1) {
          gw.varint((2 & 7) | ((n - 1) << 3));
          for (let i = 1; i < n; i++) {
            gw.varint(zzEncode(part[2 * i] - cx));
            gw.varint(zzEncode(part[2 * i + 1] - cy));
            cx = part[2 * i];
            cy = part[2 * i + 1];
          }
        }
        if (ring) gw.varint((7 & 7) | (1 << 3));
      }
      fw.bytesField(4, gw.bytes);
      lw.bytesField(2, fw.bytes);
    }
    for (const k of keys) lw.stringField(3, k);
    for (const v of values) {
      const vw = new Writer();
      if (typeof v === 'string') vw.stringField(1, v);
      else if (typeof v === 'boolean') {
        vw.tag(7, 0);
        vw.varint(v ? 1 : 0);
      } else if (Number.isInteger(v) && v >= 0) {
        vw.tag(5, 0);
        vw.varint(v);
      } else {
        vw.tag(3, 1);
        const b = new Uint8Array(8);
        new DataView(b.buffer).setFloat64(0, v, true);
        for (const x of b) vw.bytes.push(x);
      }
      lw.bytesField(4, vw.bytes);
    }
    lw.tag(5, 0);
    lw.varint(layer.extent ?? 4096);
    tile.bytesField(3, lw.bytes);
  }
  return new Uint8Array(tile.bytes);
}
