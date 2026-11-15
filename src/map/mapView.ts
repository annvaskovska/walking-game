import { AttributionControl, Map as MlMap, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { Feature } from 'geojson';
import { CONFIG } from '../config';
import type { Block } from '../core/blocks';
import type { LitHouse, LitPiece } from '../core/types';
import type { BBox } from '../geo/geo';
import type { Theme } from '../theme';
import { FogLayer, type FogSources } from './fogLayer';
import { buildStyle, FIRST_LABEL_LAYER, ROAD_LABEL_LAYER } from './style';
import { UserMarker } from './userMarker';

setWorkerUrl(workerUrl);

/** An unlocked block plus the moment it unlocked, so its name can flash cream first. */
export interface LitStreet {
  block: Block;
  litAt: number;
}

/** Everything the map draws as "yours": lit streets, unlocked blocks and lit houses. */
export interface MapLitData {
  pieces: Iterable<LitPiece>;
  houses: Iterable<LitHouse>;
  streets: Iterable<LitStreet>;
}

const EMPTY = { type: 'FeatureCollection' as const, features: [] as Feature[] };
const lineCoords = (flat: number[]): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
};
const ringCoords = (flat: number[]): [number, number][] => {
  const out = lineCoords(flat);
  const first = out[0], last = out[out.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) out.push([first[0], first[1]]);
  return out;
};

/** The map: themed basemap + lit streets and houses + gold street names + fog overlay + you. */
export class MapView {
  readonly map: MlMap;
  readonly fog: FogLayer;
  readonly user: UserMarker;
  readonly ready: Promise<void>;
  private following = false;
  private litGet: (() => MapLitData) | null = null;
  private litTimer: ReturnType<typeof setTimeout> | null = null;
  private freshTimer: ReturnType<typeof setTimeout> | null = null;
  private hiddenNames = '';
  private loaded = false;
  onFollowChange: (following: boolean) => void = () => {};

  constructor(container: HTMLElement, private theme: Theme, center: [number, number], zoom: number, fog: FogSources) {
    this.map = new MlMap({
      container,
      style: buildStyle(theme),
      center,
      zoom,
      minZoom: 3,
      maxZoom: 19,
      maxPitch: 0,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: false,
    });
    // Credits go top-right, beside the brand, so the walk dock can use the whole bottom edge.
    this.map.addControl(new AttributionControl({ compact: true }), 'top-right');
    this.map.touchZoomRotate.disableRotation();
    this.map.keyboard.disableRotation();

    this.fog = new FogLayer(this.map, theme, fog);
    this.user = new UserMarker(this.map);

    this.map.on('dragstart', () => this.setFollow(false));

    this.ready = new Promise((resolve) => {
      this.map.on('load', () => {
        // Map credits start folded behind their ⓘ button (as MapLibre does after the first drag),
        // so on a phone they never sit on top of the brand or banners.
        container.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
        this.addWindowPattern();
        this.addLitLayers();
        this.loaded = true;
        if (this.litGet) this.flushLit();
        resolve();
      });
    });
  }

  /** A tiny warm window tile, repeated over every lit house. */
  private addWindowPattern(): void {
    const px = 2;
    const n = 10 * px;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = n;
    const g = canvas.getContext('2d')!;
    const t = this.theme.lit;
    g.fillStyle = t.windowBase;
    g.fillRect(0, 0, n, n);
    g.fillStyle = t.windowLight;
    for (const [x, y] of [[1, 1], [6, 1], [1, 6], [6, 6]]) g.fillRect(x * px, y * px, 3 * px, 2 * px);
    g.fillStyle = t.windowBright;
    g.fillRect(6 * px, 1 * px, 3 * px, 2 * px);
    this.map.addImage('windows', g.getImageData(0, 0, n, n), { pixelRatio: px });
  }

  private addLitLayers(): void {
    const t = this.theme;
    const freshS = CONFIG.freshMs / 1000;
    // Cream while a block or house is new, gold once it has settled.
    const fresh = (flash: string | number, settled: string | number): unknown => [
      'case', ['<', ['get', 'age'], freshS], flash, settled,
    ];
    const width = (v: unknown) => v as unknown as number;

    // ---- Houses along unlocked blocks ----
    this.map.addSource('houses', { type: 'geojson', data: EMPTY });
    this.map.addLayer(
      {
        id: 'houses-glow', type: 'line', source: 'houses',
        paint: {
          'line-color': t.lit.houseGlow,
          'line-opacity': 0.5,
          'line-width': width(['interpolate', ['exponential', 1.5], ['zoom'], 15, 5, 16, 8, 19, 20]),
          'line-blur': width(['interpolate', ['exponential', 1.5], ['zoom'], 15, 4, 16, 7, 19, 16]),
        },
      },
      FIRST_LABEL_LAYER,
    );
    this.map.addLayer(
      {
        id: 'houses-fill', type: 'fill', source: 'houses',
        paint: {
          'fill-color': fresh(t.lit.houseFresh, t.lit.house) as string,
          'fill-opacity': 0.95,
        },
      },
      FIRST_LABEL_LAYER,
    );
    this.map.addLayer(
      {
        id: 'houses-windows', type: 'fill', source: 'houses',
        filter: ['>=', ['get', 'age'], freshS],
        paint: { 'fill-pattern': 'windows', 'fill-opacity': 0.9 },
      },
      FIRST_LABEL_LAYER,
    );
    this.map.addLayer(
      {
        id: 'houses-edge', type: 'line', source: 'houses',
        paint: { 'line-color': t.lit.houseEdge, 'line-width': 1, 'line-opacity': 0.9 },
      },
      FIRST_LABEL_LAYER,
    );

    // ---- Lit streets ----
    this.map.addSource('lit', { type: 'geojson', data: EMPTY });
    this.map.addLayer(
      {
        id: 'lit-glow', type: 'line', source: 'lit',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': t.lit.glow,
          'line-opacity': t.lit.glowOpacity,
          'line-width': width(['interpolate', ['exponential', 1.5], ['zoom'], 13, 3, 15, 8, 19, 26]),
          'line-blur': width(['interpolate', ['exponential', 1.5], ['zoom'], 13, 3, 15, 6, 19, 16]),
        },
      },
      FIRST_LABEL_LAYER,
    );
    this.map.addLayer(
      {
        id: 'lit-street', type: 'line', source: 'lit',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': fresh(t.lit.streetFresh, t.lit.street) as string,
          'line-opacity': 0.95,
          'line-width': width([
            'interpolate', ['linear'], ['zoom'],
            13, 1.5,
            15, ['match', ['get', 'kind'], 'path', 2, fresh(7, 4.5)],
            16, ['match', ['get', 'kind'], 'path', 3, fresh(9, 6.5)],
            19, ['match', ['get', 'kind'], 'path', 7, 20],
          ]),
        },
      },
      FIRST_LABEL_LAYER,
    );
    this.map.addLayer(
      {
        id: 'lit-shine', type: 'line', source: 'lit',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': t.lit.shine,
          'line-opacity': 0.9,
          'line-width': width(['interpolate', ['exponential', 1.5], ['zoom'], 15, 1, 16, 1.6, 19, 4]),
        },
      },
      FIRST_LABEL_LAYER,
    );

    // ---- Gold street names on top of the base labels ----
    this.map.addSource('streets', { type: 'geojson', data: EMPTY });
    this.map.addLayer({
      id: 'street-names', type: 'symbol', source: 'streets',
      filter: ['all', ['has', 'n'], ['==', ['get', 'kind'], 'road']],
      layout: {
        'symbol-placement': 'line',
        'text-field': ['get', 'n'],
        'text-font': t.font.mapBold,
        'text-size': ['interpolate', ['linear'], ['zoom'], 14, 11, 16, 13.5, 18, 16],
        'text-max-angle': 30,
        'symbol-spacing': 220,
        'text-letter-spacing': 0.03,
      },
      paint: { 'text-color': t.lit.name, 'text-halo-color': t.lit.nameHalo, 'text-halo-width': 2.2 },
    });
  }

  /** Replace what the map shows as yours. Throttled: during a walk this is called a lot. */
  setLit(get: () => MapLitData): void {
    this.litGet = get;
    if (!this.loaded || this.litTimer) return;
    this.litTimer = setTimeout(() => this.flushLit(), 500);
  }

  private flushLit(): void {
    if (this.litTimer) clearTimeout(this.litTimer);
    this.litTimer = null;
    if (!this.loaded || !this.litGet) return;
    const data = this.litGet();
    const now = Date.now();
    const freshS = CONFIG.freshMs / 1000;
    const ageOf = (t: number) => Math.max(0, (now - t) / 1000);
    let minAge = Infinity;

    const pieces: Feature[] = [];
    for (const p of data.pieces) {
      const age = ageOf(p.litAt);
      if (age < minAge) minAge = age;
      pieces.push({
        type: 'Feature',
        properties: { kind: p.kind, age },
        geometry: { type: 'LineString', coordinates: lineCoords(p.coords) },
      });
    }

    const houses: Feature[] = [];
    for (const h of data.houses) {
      const age = ageOf(h.litAt);
      if (age < minAge) minAge = age;
      houses.push({
        type: 'Feature',
        properties: { age },
        geometry: { type: 'Polygon', coordinates: [ringCoords(h.coords)] },
      });
    }

    const streets: Feature[] = [];
    const names = new Set<string>();
    for (const { block, litAt } of data.streets) {
      const age = ageOf(litAt);
      if (age < minAge) minAge = age;
      const properties: Record<string, unknown> = { kind: block.kind, age };
      if (block.name) {
        properties.n = block.name;
        names.add(block.name);
      }
      streets.push({
        type: 'Feature',
        properties,
        geometry: { type: 'LineString', coordinates: lineCoords(block.coords) },
      });
    }

    (this.map.getSource('lit') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: pieces });
    (this.map.getSource('houses') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: houses });
    (this.map.getSource('streets') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: streets });
    this.setHiddenNames([...names]);

    // The fresh->gold flash is a paint expression on `age`, so refresh once the newest item settles.
    if (minAge < freshS && !this.freshTimer) {
      this.freshTimer = setTimeout(() => {
        this.freshTimer = null;
        this.flushLit();
      }, (freshS - minAge) * 1000 + 100);
    }
  }

  /** Hide the basemap's own labels for streets we now write in gold ourselves. */
  private setHiddenNames(names: string[]): void {
    const key = names.sort().join('\u0001');
    if (key === this.hiddenNames) return;
    this.hiddenNames = key;
    if (!this.map.getLayer(ROAD_LABEL_LAYER)) return;
    this.map.setFilter(
      ROAD_LABEL_LAYER,
      names.length
        ? ['!', ['in', ['coalesce', ['get', 'name:latin'], ['get', 'name']], ['literal', names]]]
        : null,
    );
  }

  get isFollowing(): boolean {
    return this.following;
  }

  setFollow(on: boolean): void {
    if (this.following === on) return;
    this.following = on;
    this.onFollowChange(on);
  }

  /** Keep the camera on you while following. */
  follow(lon: number, lat: number, minZoom = 16): void {
    if (!this.following) return;
    const zoom = Math.max(this.map.getZoom(), minZoom);
    this.map.easeTo({ center: [lon, lat], zoom, duration: 500, essential: true });
  }

  centerOn(lon: number, lat: number, zoom?: number): void {
    this.map.easeTo({ center: [lon, lat], zoom: zoom ?? Math.max(this.map.getZoom(), 16), duration: 700 });
  }

  bounds(): BBox {
    const b = this.map.getBounds();
    return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  }
}
