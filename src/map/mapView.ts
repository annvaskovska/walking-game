import { Map as MlMap, addProtocol, prewarm, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { Feature, LineString, Point } from 'geojson';
import type { SeenPlace } from '../core/types';
import type { TileSource } from '../data/tiles';
import type { Theme } from '../theme';
import { FollowCamera } from './camera';
import { FogLayer } from './fog/fogLayer';
import { PuckLayer } from './puckLayer';
import {
  ABOVE_FOG_LAYER, LANDMARK_DOT, MOON_NAMES_LAYER, NAMES_SOURCE, SEEN_PLACES_SOURCE, TILE_PROTOCOL,
  buildStyle, moonNamesFilter,
} from './style';

setWorkerUrl(workerUrl);
// Start MapLibre's workers while the start screen is up, not when you tap Start.
prewarm();

const TILE_RE = /^wlt:\/\/(\d+)\/(\d+)\/(\d+)$/;

export interface MapStart {
  lon: number;
  lat: number;
  zoom: number;
}

export type NameFeature = Feature<LineString, { n: string; c: string }>;
type PlaceFeature = Feature<Point, { name: string; cls: string; rank: number }>;

/**
 * The landmark dot: an ink dot in a paper ring, so it reads on the wash and on a colored street
 * alike. Drawn here at 2x rather than taken from a sprite, which would be one more download.
 */
function landmarkDot(t: Theme): ImageData {
  const size = 14;
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.canvas.width = ctx.canvas.height = size;
  const c = size / 2;
  ctx.fillStyle = t.map.paper;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(c, c, c, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = t.map.landmark;
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(c, c, 3, 0, Math.PI * 2);
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

/**
 * The map: the pen drawing of the city, the paper wash with everything you colored in, the names
 * of your streets in their pencils and you, all in one WebGL canvas. Tiles come from the shared TileSource through a custom
 * protocol; until a position is known none are downloaded.
 */
export class MapView {
  readonly map: MlMap;
  readonly fog: FogLayer;
  readonly puck: PuckLayer;
  readonly camera: FollowCamera;
  readonly ready: Promise<void>;
  private armed: boolean;
  private loaded = false;
  private pendingNames: NameFeature[] | null = null;
  private pendingPlaces: SeenPlace[] | null = null;
  /** Lit street names the moon names leave out, as a key (sorted, joined) and as given. */
  private litKey = '';
  private litNames: string[] = [];

  constructor(container: HTMLElement, theme: Theme, tiles: TileSource, start: MapStart | null) {
    this.armed = !!start;
    addProtocol(TILE_PROTOCOL, async (params, ctrl) => {
      const m = TILE_RE.exec(params.url);
      // Somewhere in the open sea until we know where you are: nothing to download there.
      if (!m || !this.armed) return { data: new ArrayBuffer(0) };
      return { data: await tiles.load(+m[1], +m[2], +m[3], ctrl.signal) };
    });

    this.map = new MlMap({
      container,
      style: buildStyle(theme),
      center: start ? [start.lon, start.lat] : [0, 0],
      zoom: start?.zoom ?? 11,
      minZoom: 11,
      maxZoom: 19,
      // Three device pixels per CSS pixel cost 2.25x the fill of two and look much the same on paper.
      pixelRatio: Math.min(2, window.devicePixelRatio || 1),
      fadeDuration: 200,
      validateStyle: false,
      attributionControl: false,
      maplibreLogo: false,
      renderWorldCopies: false,
      refreshExpiredTiles: false,
      maxPitch: 0,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      rollEnabled: false,
      boxZoom: false,
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.keyboard.disableRotation();

    this.fog = new FogLayer(theme);
    this.puck = new PuckLayer(theme);
    this.camera = new FollowCamera(this.map);

    this.ready = new Promise((resolve) => {
      // 'style.load', not 'load': that one waits for every tile on screen.
      this.map.once('style.load', () => {
        this.map.addLayer(this.fog, ABOVE_FOG_LAYER);
        this.map.addLayer(this.puck);
        this.map.addImage(LANDMARK_DOT, landmarkDot(theme), { pixelRatio: 2 });
        this.loaded = true;
        if (this.pendingNames) this.setNames(this.pendingNames);
        if (this.pendingPlaces) this.setSeenPlaces(this.pendingPlaces);
        if (this.litNames.length) this.map.setFilter(MOON_NAMES_LAYER, moonNamesFilter(this.litNames));
        this.pendingNames = this.pendingPlaces = null;
        resolve();
      });
    });
  }

  /** Start downloading tiles: we know where you are now. */
  arm(): void {
    this.armed = true;
  }

  get isArmed(): boolean {
    return this.armed;
  }

  /** The names along your walked streets, each in its pencil. */
  setNames(features: NameFeature[]): void {
    if (!this.loaded) {
      this.pendingNames = features;
      return;
    }
    (this.map.getSource(NAMES_SOURCE) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
  }

  /**
   * Streets named in their pencil: their ink names under the wash are left out, so a walked street
   * shows one name. A new filter makes MapLibre lay the map tiles out again, so only when the list changed.
   */
  setLitStreetNames(names: string[]): void {
    const sorted = [...new Set(names)].sort();
    const key = sorted.join('\u0001');
    if (key === this.litKey) return;
    this.litKey = key;
    this.litNames = sorted;
    if (this.loaded) this.map.setFilter(MOON_NAMES_LAYER, moonNamesFilter(sorted));
  }

  /** The landmarks you have seen, labelled over the wash. */
  setSeenPlaces(places: SeenPlace[]): void {
    if (!this.loaded) {
      this.pendingPlaces = places;
      return;
    }
    const features: PlaceFeature[] = places.map((p) => ({
      type: 'Feature',
      properties: { name: p.name, cls: p.cls, rank: p.rank },
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    }));
    (this.map.getSource(SEEN_PLACES_SOURCE) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
  }

  repaint(): void {
    this.map.triggerRepaint();
  }
}
