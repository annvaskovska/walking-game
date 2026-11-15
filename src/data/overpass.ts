import { bboxOfCoords, distanceM } from '../geo/geo';
import type { BBox } from '../geo/geo';
import type { Building, PieceKind, WayInput } from '../core/types';

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/** Walkable highway types. Motorways, trunks and their links are never fetched. */
export const WALKABLE_HIGHWAYS = [
  'residential', 'living_street', 'pedestrian', 'footway', 'path', 'steps', 'cycleway',
  'service', 'unclassified', 'tertiary', 'tertiary_link', 'secondary', 'secondary_link',
  'primary', 'primary_link', 'track', 'bridleway', 'road',
];

export function buildQuery(b: BBox, timeoutS = 60): string {
  const [w, s, e, n] = b.map((v) => v.toFixed(6));
  const hw = WALKABLE_HIGHWAYS.join('|');
  return (
    `[out:json][timeout:${timeoutS}];` +
    `way["highway"~"^(${hw})$"]` +
    `["area"!="yes"]["access"!~"^(private|no)$"]["foot"!~"^(no|private)$"]` +
    `["service"!~"^(parking_aisle|driveway|drive-through)$"]` +
    `(${s},${w},${n},${e});` +
    // `body` carries node ids, which tell us where ways meet; `geom` carries the coordinates.
    `out body geom qt;`
  );
}

/** Buildings are fetched separately, by a smaller cell, so a walk is not held up by them. */
export function buildBuildingQuery(b: BBox, timeoutS = 60): string {
  const [w, s, e, n] = b.map((v) => v.toFixed(6));
  return `[out:json][timeout:${timeoutS}];way["building"](${s},${w},${n},${e});out tags geom qt;`;
}

interface OverpassWay {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: ({ lat: number; lon: number } | null)[];
  nodes?: number[];
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * A way's part in the lighting rule. Sidewalks and crossings are fetched (they are useful hints
 * on the fog) but never light on their own: the street beside them does.
 */
export function kindFromTags(tags: Record<string, string>): PieceKind {
  const hw = tags.highway;
  if (hw !== 'footway' && hw !== 'path' && hw !== 'cycleway' && hw !== 'steps' && hw !== 'bridleway') {
    return 'road';
  }
  const crossing = tags.footway === 'crossing' || (tags.crossing != null && tags.crossing !== 'no');
  const sidewalk =
    tags.footway === 'sidewalk' ||
    (tags.sidewalk != null && tags.sidewalk !== 'no') ||
    tags.is_sidepath === 'yes';
  return crossing || sidewalk ? 'side' : 'path';
}

interface ParsedWay {
  id: number;
  name: string | null;
  highway: string;
  kind: PieceKind;
  coords: number[];
  /** Node ids aligned with coords, or null when Overpass clipped the geometry. */
  nodes: number[] | null;
}

/** Turn an Overpass JSON response into compact ways. Pure, so it is unit tested. */
export function parseOverpass(json: unknown): WayInput[] {
  const elements = (json as { elements?: OverpassWay[] })?.elements;
  if (!Array.isArray(elements)) throw new Error('Unexpected Overpass response');
  const parsed: ParsedWay[] = [];
  for (const el of elements) {
    if (el.type !== 'way' || !el.geometry || !el.tags?.highway) continue;
    if (!WALKABLE_HIGHWAYS.includes(el.tags.highway)) continue;
    const coords: number[] = [];
    const nodes: number[] = [];
    let aligned = Array.isArray(el.nodes) && el.nodes.length === el.geometry.length;
    for (let i = 0; i < el.geometry.length; i++) {
      const g = el.geometry[i];
      if (!g) {
        // Overpass emits null for nodes outside a clipped bbox; ids no longer line up.
        aligned = false;
        continue;
      }
      coords.push(round6(g.lon), round6(g.lat));
      if (aligned) nodes.push(el.nodes![i]);
    }
    if (coords.length < 4) continue;
    const name = (el.tags.name ?? '').trim();
    parsed.push({
      id: el.id,
      name: name || null,
      highway: el.tags.highway,
      kind: kindFromTags(el.tags),
      coords,
      nodes: aligned ? nodes : null,
    });
  }

  // A node used by two ways is a junction: the boundary between two city blocks.
  const usage = new Map<number, number>();
  for (const w of parsed) {
    if (!w.nodes) continue;
    const seen = new Set<number>();
    for (const node of w.nodes) {
      if (seen.has(node)) continue;
      seen.add(node);
      usage.set(node, (usage.get(node) ?? 0) + 1);
    }
  }

  return parsed.map((w) => {
    const out: WayInput = { id: w.id, name: w.name, highway: w.highway, kind: w.kind, coords: w.coords };
    if (w.nodes) {
      const junctions: number[] = [];
      let acc = 0;
      for (let i = 1; i < w.nodes.length; i++) {
        acc += distanceM(w.coords[2 * i - 2], w.coords[2 * i - 1], w.coords[2 * i], w.coords[2 * i + 1]);
        if ((usage.get(w.nodes[i]) ?? 0) > 1) junctions.push(Math.round(acc * 10) / 10);
      }
      if (junctions.length) out.junctionsM = junctions;
    }
    return out;
  });
}

/** Turn an Overpass building response into closed footprints. */
export function parseBuildings(json: unknown): Building[] {
  const elements = (json as { elements?: OverpassWay[] })?.elements;
  if (!Array.isArray(elements)) throw new Error('Unexpected Overpass response');
  const out: Building[] = [];
  const seen = new Set<number>();
  for (const el of elements) {
    if (el.type !== 'way' || !el.geometry || el.tags?.building == null || el.tags.building === 'no') continue;
    if (seen.has(el.id)) continue;
    const coords: number[] = [];
    for (const g of el.geometry) {
      if (g) coords.push(round6(g.lon), round6(g.lat));
    }
    if (coords.length < 8) continue;
    if (coords[0] !== coords[coords.length - 2] || coords[1] !== coords[coords.length - 1]) {
      coords.push(coords[0], coords[1]);
    }
    seen.add(el.id);
    out.push({ id: `b${el.id}`, coords, bbox: bboxOfCoords(coords) });
  }
  return out;
}

export class OverpassError extends Error {
  constructor(message: string, readonly status: number | null, readonly retryable: boolean) {
    super(message);
  }
}

async function request<T>(
  endpoint: string,
  query: string,
  parse: (json: unknown) => T,
  { signal, timeoutMs = 90_000 }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
  try {
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new OverpassError(`Network error: ${(e as Error).message}`, null, true);
    }
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500 || res.status === 406;
      throw new OverpassError(`Overpass HTTP ${res.status}`, res.status, retryable);
    }
    const json = await res.json().catch(() => {
      throw new OverpassError('Overpass sent invalid JSON', res.status, true);
    });
    const remark = (json as { remark?: string }).remark;
    if (remark && /runtime error|timed out|out of memory/i.test(remark)) {
      throw new OverpassError(`Overpass: ${remark}`, res.status, true);
    }
    return parse(json);
  } finally {
    clearTimeout(timer);
  }
}

/** One request to one endpoint. Retrying and endpoint rotation live in the street loader. */
export function fetchWays(
  bbox: BBox,
  endpoint: string,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<WayInput[]> {
  return request(endpoint, buildQuery(bbox), parseOverpass, opts);
}

/** One building request to one endpoint. Retrying lives in the building loader. */
export function fetchBuildings(
  bbox: BBox,
  endpoint: string,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<Building[]> {
  return request(endpoint, buildBuildingQuery(bbox), parseBuildings, opts);
}
