import type { Map as MlMap } from 'maplibre-gl';
import { CONFIG } from '../config';
import { distanceM } from '../geo/geo';

/** Time constant of the slide back to you, and of zoom changes (s). */
const ACQUIRE_TAU = 0.25;
const ZOOM_TAU = 0.35;

/**
 * Keeps you in the middle of the map while you walk, every frame, so the map glides with you
 * instead of hopping once per GPS fix (a per-frame jumpTo, like the follow modes of navigation
 * apps). Pan away and it lets go; a few seconds after you let go it slides back. Zooming with
 * fingers or the wheel is around the centre, so you stay put; a double-tap zoom is let run and
 * then the camera slides back.
 */
export class FollowCamera {
  private mode: 'off' | 'follow' | 'free' = 'off';
  private userZooming = false;
  private flying = false;
  private acquiring = false;
  private resumeAt = Infinity;
  private targetZoom: number | null = null;
  private lastT = 0;
  private holdUntil = 0;

  constructor(private map: MlMap) {
    map.on('dragstart', () => {
      if (this.mode === 'off') return;
      this.mode = 'free';
      this.resumeAt = Infinity;
    });
    map.on('dragend', () => {
      if (this.mode === 'free') this.resumeAt = performance.now() + CONFIG.followResumeMs;
    });
    map.on('zoomstart', (e) => {
      if ((e as { originalEvent?: unknown }).originalEvent) this.userZooming = true;
    });
    map.on('zoomend', () => {
      if (!this.userZooming) return;
      this.userZooming = false;
      this.targetZoom = map.getZoom();
      this.acquiring = true;
      if (this.mode === 'free') this.resumeAt = Math.min(this.resumeAt, performance.now() + CONFIG.followResumeMs);
    });
    map.on('moveend', () => {
      this.flying = false;
    });
  }

  get following(): boolean {
    return this.mode === 'follow';
  }

  /** Sliding back to you or easing its zoom: worth drawing every frame. */
  get settling(): boolean {
    if (this.mode !== 'follow') return false;
    return this.acquiring || this.flying || performance.now() < this.holdUntil || (this.targetZoom !== null && Math.abs(this.map.getZoom() - this.targetZoom) > 0.002);
  }

  /** Start following, settling on `zoom`. */
  start(zoom: number): void {
    this.mode = 'follow';
    this.acquiring = true;
    this.targetZoom = zoom;
    this.resumeAt = Infinity;
    this.aroundCenter(true);
  }

  /**
   * Let a camera animation started elsewhere (the slide out from under the start screen) run for
   * `ms`; a per-frame jumpTo would cut it short. Then it slides back to you from wherever it is.
   */
  hold(ms: number): void {
    this.holdUntil = performance.now() + ms;
    this.acquiring = true;
  }

  stop(): void {
    this.mode = 'off';
    this.targetZoom = null;
    this.aroundCenter(false);
  }

  private aroundCenter(on: boolean): void {
    const opts = on ? { around: 'center' as const } : undefined;
    this.map.scrollZoom.disable();
    this.map.scrollZoom.enable(opts);
    this.map.touchZoomRotate.disable();
    this.map.touchZoomRotate.enable(opts);
    this.map.touchZoomRotate.disableRotation();
  }

  /** Call every frame with where you are drawn. Returns true when it moved the camera. */
  update(lon: number, lat: number, now: number): boolean {
    const dt = this.lastT ? Math.min(0.1, Math.max(0, (now - this.lastT) / 1000)) : 1 / 60;
    this.lastT = now;
    if (this.mode === 'off') return false;
    const map = this.map;
    if (this.mode === 'free') {
      if (now < this.resumeAt || map.isMoving()) return false;
      this.mode = 'follow';
      const c = map.getCenter();
      if (distanceM(c.lng, c.lat, lon, lat) > CONFIG.followFlyM) {
        this.flying = true;
        map.flyTo({ center: [lon, lat], zoom: this.targetZoom ?? map.getZoom(), duration: 1200, essential: true });
        return true;
      }
      this.acquiring = true;
    }
    if (this.userZooming || this.flying || now < this.holdUntil) return false;

    const c = map.getCenter();
    let lng = lon, la = lat;
    if (this.acquiring) {
      const k = 1 - Math.exp(-dt / ACQUIRE_TAU);
      lng = c.lng + (lon - c.lng) * k;
      la = c.lat + (lat - c.lat) * k;
      const p = map.project([lon, lat]), q = map.project([lng, la]);
      if (Math.hypot(p.x - q.x, p.y - q.y) < 0.5) {
        this.acquiring = false;
        lng = lon;
        la = lat;
      }
    }
    let zoom = map.getZoom();
    if (this.targetZoom !== null && Math.abs(zoom - this.targetZoom) > 0.002) {
      zoom += (this.targetZoom - zoom) * (1 - Math.exp(-dt / ZOOM_TAU));
    }
    if (lng === c.lng && la === c.lat && zoom === map.getZoom()) return false;
    map.jumpTo({ center: [lng, la], zoom });
    return true;
  }
}
