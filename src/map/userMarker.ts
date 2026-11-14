import { Marker, type Map as MlMap } from 'maplibre-gl';

const RAD = Math.PI / 180;

/** You on the map: a dot, an accuracy ring sized in metres, and a heading cone. */
export class UserMarker {
  private el: HTMLDivElement;
  private ring: HTMLDivElement;
  private cone: HTMLDivElement;
  private marker: Marker;
  private added = false;
  private acc = 0;
  private lat = 0;

  constructor(private map: MlMap) {
    this.el = document.createElement('div');
    this.el.className = 'wl-user';
    this.el.innerHTML = '<div class="wl-user-ring"></div><div class="wl-user-cone"></div><div class="wl-user-dot"></div>';
    this.ring = this.el.querySelector('.wl-user-ring')!;
    this.cone = this.el.querySelector('.wl-user-cone')!;
    this.marker = new Marker({ element: this.el });
    map.on('zoom', () => this.sizeRing());
  }

  update(lon: number, lat: number, accuracyM: number, headingDeg: number | null): void {
    this.marker.setLngLat([lon, lat]);
    if (!this.added) {
      this.marker.addTo(this.map);
      this.added = true;
    }
    this.acc = accuracyM;
    this.lat = lat;
    this.sizeRing();
    if (headingDeg == null || Number.isNaN(headingDeg)) {
      this.cone.style.display = 'none';
    } else {
      this.cone.style.display = '';
      this.cone.style.transform = `translate(-50%, -100%) rotate(${headingDeg}deg)`;
    }
  }

  setWalking(on: boolean): void {
    this.el.classList.toggle('is-walking', on);
  }

  private sizeRing(): void {
    const mpp = (40_075_016.686 * Math.cos(this.lat * RAD)) / (512 * 2 ** this.map.getZoom());
    const d = Math.max(16, Math.min(600, (2 * this.acc) / mpp));
    this.ring.style.width = this.ring.style.height = `${d}px`;
  }
}
