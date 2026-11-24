import { Map as MlMap, addProtocol, prewarm, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { Feature, Point } from 'geojson';
import type { SeenPlace } from '../core/types';
import type { TileSource } from '../data/tiles';
import { pencilOf, type Theme } from '../theme';
import { FollowCamera } from './camera';
import { FogLayer } from './fog/fogLayer';
import { HATCHINGS, iconKind, inkImages, picId } from './ink';
import type { NameFeature } from './names';
import { PuckLayer } from './puckLayer';
import { ABOVE_FOG_LAYER, NAMES_SOURCE, SEEN_PLACES_SOURCE, TILE_PROTOCOL, buildStyle } from './style';

setWorkerUrl(workerUrl);
// Start MapLibre's workers while the start screen is up, not when you tap Start.
prewarm();

const TILE_RE = /^wlt:\/\/(\d+)\/(\d+)\/(\d+)$/;

export interface MapStart {
  lon: number;
  lat: number;
  zoom: number;
}

type PlaceFeature = Feature<Point, { icon: string; kind: string; rank: number }>;

/**
 * The map: the printed coloring page of the city, the crayon of everything you colored in, the
 * names of your streets in their crayons and you, all in one WebGL canvas. Tiles come from the shared TileSource through a custom
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
        for (const { id, data, pixelRatio } of inkImages()) this.map.addImage(id, data, { pixelRatio });
        this.loaded = true;
        if (this.pendingNames) this.setNames(this.pendingNames);
        if (this.pendingPlaces) this.setSeenPlaces(this.pendingPlaces);
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

  /** The names of your walked streets, each in its crayon. */
  setNames(features: NameFeature[]): void {
    if (!this.loaded) {
      this.pendingNames = features;
      return;
    }
    (this.map.getSource(NAMES_SOURCE) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
  }

  /** The places you have seen: their pictograms colored in, each in one of a few hatchings. */
  setSeenPlaces(places: SeenPlace[]): void {
    if (!this.loaded) {
      this.pendingPlaces = places;
      return;
    }
    const features: PlaceFeature[] = places.map((p) => {
      const kind = iconKind(p.cls, p.name);
      return {
        type: 'Feature',
        properties: { icon: picId(kind, kind === 'tower' ? 0 : pencilOf(p.name, HATCHINGS)), kind, rank: p.rank },
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      };
    });
    (this.map.getSource(SEEN_PLACES_SOURCE) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
  }

  repaint(): void {
    this.map.triggerRepaint();
  }
}
