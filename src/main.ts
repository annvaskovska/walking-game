// MapLibre's stylesheet first, so the app's own rules (e.g. the full-screen .wl-map) win.
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { startApp } from './app/app';

registerSW({ immediate: true });

const root = document.getElementById('app')!;
startApp(root).catch((err) => {
  console.error(err);
  root.innerHTML = `<div class="wl-fatal"><h2>Wanderlight couldn’t start</h2><p>${String(err?.message ?? err)
    .replace(/</g, '&lt;')}</p><button onclick="location.reload()">Try again</button></div>`;
});
