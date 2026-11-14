import type { BBox } from '../geo/geo';
import type { WayInput } from '../core/types';

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
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
    `out tags geom qt;`
  );
}

interface OverpassWay {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: ({ lat: number; lon: number } | null)[];
}

/** Turn an Overpass JSON response into compact ways. Pure, so it is unit tested. */
export function parseOverpass(json: unknown): WayInput[] {
  const elements = (json as { elements?: OverpassWay[] })?.elements;
  if (!Array.isArray(elements)) throw new Error('Unexpected Overpass response');
  const out: WayInput[] = [];
  for (const el of elements) {
    if (el.type !== 'way' || !el.geometry || !el.tags?.highway) continue;
    if (!WALKABLE_HIGHWAYS.includes(el.tags.highway)) continue;
    const coords: number[] = [];
    for (const g of el.geometry) {
      if (!g) continue; // Overpass emits null for nodes outside a clipped bbox
      coords.push(Math.round(g.lon * 1e6) / 1e6, Math.round(g.lat * 1e6) / 1e6);
    }
    if (coords.length < 4) continue;
    const name = (el.tags.name ?? '').trim();
    out.push({ id: el.id, name: name || null, highway: el.tags.highway, coords });
  }
  return out;
}

export class OverpassError extends Error {
  constructor(message: string, readonly status: number | null, readonly retryable: boolean) {
    super(message);
  }
}

/** One request to one endpoint. Retrying and endpoint rotation live in the street loader. */
export async function fetchWays(
  bbox: BBox,
  endpoint: string,
  { signal, timeoutMs = 90_000 }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<WayInput[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
  try {
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(buildQuery(bbox)),
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
    return parseOverpass(json);
  } finally {
    clearTimeout(timer);
  }
}
