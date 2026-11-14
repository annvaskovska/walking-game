import { AttributionControl, Map as MlMap, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { Feature } from 'geojson';
import type { LitPiece } from '../core/types';
import type { BBox } from '../geo/geo';
import type { Theme } from '../theme';
import { FogLayer, type FogSources } from './fogLayer';
import { buildStyle, FIRST_LABEL_LAYER } from './style';
import { UserMarker } from './userMarker';

setWorkerUrl(workerUrl);

/** The map: themed basemap + glowing lit streets + fog overlay + you. */
export class MapView {
  readonly map: MlMap;
  readonly fog: FogLayer;
  readonly user: UserMarker;
  readonly ready: Promise<void>;
  private following = false;
  private litPending: (() => Iterable<LitPiece>) | null = null;
  private litTimer: ReturnType<typeof setTimeout> | null = null;
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
        this.addLitLayers();
        this.loaded = true;
        if (this.litPending) this.flushLit();
        resolve();
      });
    });
  }

  private addLitLayers(): void {
    const t = this.theme;
    this.map.addSource('lit', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    this.map.addLayer(
      {
        id: 'lit-glow', type: 'line', source: 'lit',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': t.lit.glow,
          'line-opacity': t.lit.glowOpacity,
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 11, 4, 15, 14, 19, 64],
          'line-blur': ['interpolate', ['exponential', 1.5], ['zoom'], 11, 3, 15, 10, 19, 44],
        },
      },
      FIRST_LABEL_LAYER,
    );
    this.map.addLayer(
      {
        id: 'lit-core', type: 'line', source: 'lit',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': t.lit.core,
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 11, 0.8, 15, 2.2, 19, 7],
          'line-opacity': 0.95,
        },
      },
      FIRST_LABEL_LAYER,
    );
  }

  /** Replace the glowing lit streets. Throttled: during a walk this is called a lot. */
  setLit(get: () => Iterable<LitPiece>): void {
    this.litPending = get;
    if (!this.loaded || this.litTimer) return;
    this.litTimer = setTimeout(() => this.flushLit(), 600);
  }

  private flushLit(): void {
    if (this.litTimer) clearTimeout(this.litTimer);
    this.litTimer = null;
    const get = this.litPending;
    this.litPending = null;
    if (!get) return;
    const features: Feature[] = [];
    for (const p of get()) {
      const coordinates: [number, number][] = [];
      for (let i = 0; i < p.coords.length; i += 2) coordinates.push([p.coords[i], p.coords[i + 1]]);
      features.push({ type: 'Feature', properties: { v: p.visits }, geometry: { type: 'LineString', coordinates } });
    }
    (this.map.getSource('lit') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
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
