import { CONFIG } from '../config';
import { newlyEarned, type StampContext } from '../core/achievements';
import { newFilterState, stepFilter, type FilterState } from '../core/gpsFilter';
import { piecesNearSegment, piecesNearTrack } from '../core/lighting';
import { Progress, toStoredLit } from '../core/progress';
import { nearbyUnlitStreets, streaks, weekBars } from '../core/stats';
import type { Fix, LitPiece, Piece, StampRecord, WalkRecord } from '../core/types';
import { StreetLoader, type LoaderStatus } from '../data/streetLoader';
import { bearingDeg } from '../geo/geo';
import { GridIndex } from '../geo/spatialIndex';
import type { FogSources } from '../map/fogLayer';
import { MapView } from '../map/mapView';
import { createBrowserLocation, type LocationError, type LocationProvider } from '../platform/location';
import { createSimLocation, simFactor } from '../platform/simLocation';
import { SIM_ROUTE } from '../platform/simRoute';
import { openStorage } from '../platform/storage';
import { WakeLockKeeper } from '../platform/wakeLock';
import { applyTheme, nightTheme } from '../theme';
import { buildShell, openSheet, selectTab, setBanner, toast, type Tab } from '../ui/shell';
import {
  renderIdleDock, renderLiveDock, renderStamps, renderYou, summaryHtml, updateLiveDock, type LiveView,
} from '../ui/views';

/** The walk in progress. Persisted on every change so a reload mid-walk picks it up again. */
interface ActiveSession {
  id: string;
  startedAt: number;
  distanceM: number;
  newPieces: number;
  newLenM: number;
  newStreets: string[];
  stamps: string[];
  /** Raw walked segments [aLon, aLat, bLon, bLat, radius, ...], replayed when streets load late. */
  segs: number[];
  filter: FilterState;
  visitedPark: boolean;
  lastFix: Fix | null;
  fixes: number;
}

function sessionAsWalk(s: ActiveSession, now: number): WalkRecord {
  return {
    id: s.id,
    startedAt: s.startedAt,
    endedAt: now,
    distanceM: s.distanceM,
    durationMs: Math.max(0, now - s.startedAt),
    newPieces: s.newPieces,
    newLenM: s.newLenM,
    newStreets: [...s.newStreets],
    visitedPark: s.visitedPark,
    stamps: [...s.stamps],
  };
}

export async function startApp(root: HTMLElement): Promise<void> {
  applyTheme(nightTheme);
  const params = new URLSearchParams(location.search);
  const sim = params.has('sim');
  const provider: LocationProvider = sim ? createSimLocation(simFactor(params.get('sim'))) : createBrowserLocation();

  const ui = buildShell(root);
  if (provider.badge) {
    ui.badge.textContent = provider.badge;
    ui.badge.hidden = false;
  }

  const storage = await openStorage();
  const [litRecords, walkRecords, stampRecords, lastPos, savedSession] = await Promise.all([
    storage.getAll<LitPiece>('lit'),
    storage.getAll<WalkRecord>('walks'),
    storage.getAll<StampRecord>('stamps'),
    storage.get<Fix>('meta', 'lastPos'),
    storage.get<ActiveSession>('meta', 'activeSession'),
  ]);
  const progress = new Progress();
  progress.load(litRecords);
  const walks = walkRecords.sort((a, b) => a.startedAt - b.startedAt);
  const earned = new Map(stampRecords.map((s) => [s.id, s]));
  let session: ActiveSession | null = savedSession ?? null;
  let here: Fix | null = session?.lastFix ?? lastPos ?? null;
  let tab: Tab = 'map';
  let dataVersion = 0;
  let stopWatch: (() => void) | null = null;
  let locError: LocationError | null = null;
  let weakSince: number | null = null;
  let weakAcc = 0;
  let vehicleUntil = 0;
  let lastBearing: number | null = null;
  let segCount = 0;

  // ---- Map ----
  const fogSources: FogSources = {
    ghost: (b) => loader.index.query(b).filter((p) => !progress.isLit(p.id)),
    lit: (b) => progress.lit.query(b),
    lantern: () => (session && here ? here : null),
    version: () => dataVersion,
  };
  const start: [number, number] = here ? [here.lon, here.lat] : sim ? [SIM_ROUTE[0], SIM_ROUTE[1]] : [10, 35];
  const mapView = new MapView(ui.map, nightTheme, start, here || sim ? 16 : 2, fogSources);
  mapView.setLit(() => progress.lit.values());
  mapView.onFollowChange = () => renderRecenter();
  mapView.map.on('moveend', () => {
    if (mapView.map.getZoom() >= 13) void loader.loadCachedIn(mapView.bounds());
  });

  const loader = new StreetLoader(storage, { onPieces: onStreetPieces, onStatus: onLoaderStatus });
  await loader.init();

  const wake = new WakeLockKeeper((s) => {
    if (!session || s === 'on' || s === 'off') return setBanner(ui, 'wake', null);
    if (s === 'failed') {
      setBanner(ui, 'wake', {
        kind: 'warn',
        text: 'The screen may switch off and pause your walk.',
        action: { label: 'Keep on', run: () => void wake.enable() },
      });
    } else {
      setBanner(ui, 'wake', { kind: 'info', text: 'Keep Wanderlight open while you walk: this browser can’t hold the screen on.' });
    }
  });

  // ---- Saving ----
  let sessionTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Saves the walk in progress at most every 2 s. A throttle, not a debounce: GPS fixes arrive
   * about once a second, so a debounce would keep postponing the write until the page closes,
   * and a phone that kills the tab mid-walk would lose everything since the start.
   */
  function persistSession(immediately = false): void {
    const write = () => {
      if (sessionTimer) clearTimeout(sessionTimer);
      sessionTimer = null;
      if (session) void storage.set('activeSession', session);
    };
    if (immediately) write();
    else if (!sessionTimer) sessionTimer = setTimeout(write, 2000);
  }

  const litQueue = new Map<string, LitPiece>();
  let litTimer: ReturnType<typeof setTimeout> | null = null;
  function queueLit(recs: LitPiece[]): void {
    for (const r of recs) litQueue.set(r.id, r);
    if (!litTimer) litTimer = setTimeout(() => void flushLit(), 1000);
  }
  async function flushLit(): Promise<void> {
    if (litTimer) clearTimeout(litTimer);
    litTimer = null;
    if (!litQueue.size) return;
    const vals = [...litQueue.values()].map(toStoredLit);
    litQueue.clear();
    await storage.putMany('lit', vals);
  }

  let lastPosSavedAt = 0;
  function saveLastPos(f: Fix): void {
    if (Date.now() - lastPosSavedAt < 10_000) return;
    lastPosSavedAt = Date.now();
    void storage.set('lastPos', f);
  }

  const saveNow = () => {
    void flushLit();
    persistSession(true);
  };
  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveNow();
  });

  // ---- Stamps ----
  function stampContext(extra?: WalkRecord): StampContext {
    return {
      streetsMet: progress.streetsMet,
      piecesLit: progress.piecesLit,
      litLenM: progress.litLenM,
      walks: extra ? [...walks, extra] : walks,
      now: provider.now(),
    };
  }

  function awardStamps(ctx: StampContext, walkId: string | null): string[] {
    const fresh = newlyEarned(ctx, new Set(earned.keys()));
    if (!fresh.length) return [];
    const recs: StampRecord[] = fresh.map((s) => ({ id: s.id, earnedAt: provider.now(), walkId }));
    for (const r of recs) earned.set(r.id, r);
    for (const s of fresh) toast(ui, `Stamp earned: ${s.title}`, 'stamp', s.icon);
    void storage.putMany('stamps', recs);
    return fresh.map((s) => s.id);
  }

  // ---- Lighting ----
  function light(pieces: Piece[]): void {
    if (!session || !pieces.length) return;
    const res = progress.apply(pieces, session.id, provider.now());
    if (!res.changed.length) return;
    queueLit(res.changed);
    mapView.setLit(() => progress.lit.values());
    if (res.newPieces.length) {
      session.newPieces += res.newPieces.length;
      session.newLenM += res.newPieces.reduce((s, p) => s + p.len, 0);
      dataVersion++;
      mapView.fog.invalidate();
    }
    for (const name of res.newStreets) {
      session.newStreets.push(name);
      toast(ui, `New street: ${name}`, 'street', '✦');
    }
    if (res.newPieces.length) {
      session.stamps.push(...awardStamps(stampContext(sessionAsWalk(session, provider.now())), session.id));
    }
    persistSession();
  }

  function onStreetPieces(pieces: Piece[]): void {
    dataVersion++;
    mapView.fog.invalidate();
    // Streets that arrive late still light up for the part of the walk already done.
    if (session && session.segs.length) {
      const fresh = new GridIndex<Piece>();
      for (const p of pieces) fresh.insert(p);
      light(piecesNearTrack(fresh, session.segs));
    }
    if (tab === 'you') renderYouTab();
    updateDock();
  }

  // ---- Location ----
  function onFix(fix: Fix): void {
    here = fix;
    if (locError) {
      locError = null;
      setBanner(ui, 'gps', null);
    }
    loader.ensureAround(fix.lon, fix.lat);
    saveLastPos(fix);

    if (session) {
      session.fixes++;
      const { state, verdict } = stepFilter(session.filter, fix);
      session.filter = state;
      session.lastFix = fix;
      if (verdict.kind === 'reject' && verdict.reason === 'accuracy') {
        weakSince ??= Date.now();
        weakAcc = fix.acc;
      } else if (verdict.kind !== 'reject') {
        weakSince = null;
      }
      if (verdict.kind === 'vehicle') vehicleUntil = Date.now() + 15_000;
      if (verdict.kind === 'walk') {
        const { from, to } = verdict;
        session.distanceM += verdict.distM;
        session.segs.push(from.lon, from.lat, to.lon, to.lat, Math.round(verdict.radiusM * 10) / 10);
        lastBearing = bearingDeg(from.lon, from.lat, to.lon, to.lat);
        light(piecesNearSegment(loader.index, from.lon, from.lat, to.lon, to.lat, verdict.radiusM));
        if (!session.visitedPark && ++segCount % 5 === 0 && mapView.inPark(fix.lon, fix.lat)) {
          session.visitedPark = true;
        }
      }
      if (verdict.kind !== 'reject') mapView.follow(fix.lon, fix.lat);
      persistSession();
    }

    const moving = fix.speed != null && fix.speed > 0.3;
    const heading = moving && fix.heading != null && !Number.isNaN(fix.heading) ? fix.heading : session ? lastBearing : null;
    mapView.user.update(fix.lon, fix.lat, fix.acc, heading);
    mapView.fog.invalidate();
    updateDock();
  }

  function onLocError(e: LocationError): void {
    locError = e;
    if (e.kind === 'denied' || e.kind === 'insecure' || e.kind === 'unsupported') {
      if (session && session.fixes === 0) void cancelSession();
      showLocationHelp(e);
    } else if (e.kind === 'unavailable') {
      setBanner(ui, 'gps', { kind: 'warn', text: 'No GPS signal yet. Check that Location is on; open sky helps.' });
    } else if (session) {
      setBanner(ui, 'gps', { kind: 'info', text: 'Still looking for GPS…' });
    }
    updateDock();
  }

  function showLocationHelp(e: LocationError): void {
    const body =
      e.kind === 'denied'
        ? `<p>Wanderlight lights up the streets you walk, so it needs your location. It never leaves this phone.</p>
           <ul class="wl-help">
             <li><b>iPhone:</b> Settings → Privacy &amp; Security → Location Services → Safari Websites → <i>While Using</i>. Then reload.</li>
             <li><b>Android:</b> tap the icon left of the address bar → Permissions → Location → <i>Allow</i>.</li>
           </ul>`
        : e.kind === 'insecure'
          ? '<p>Browsers only share location over a secure <b>https://</b> connection. Open the https address of Wanderlight.</p>'
          : '<p>This browser can’t share your location. Try Safari on iPhone or Chrome on Android.</p>';
    openSheet(ui, `
      <div class="wl-sheet-head"><div class="wl-kicker">Location needed</div><h2>${e.kind === 'denied' ? 'Location is off for Wanderlight' : 'Can’t use location here'}</h2></div>
      ${body}
      <button class="wl-primary" data-close>Got it</button>`);
  }

  // ---- Walk lifecycle ----
  async function startWalk(): Promise<void> {
    if (session) return;
    const t = provider.now();
    session = {
      id: `w${t.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      startedAt: t,
      distanceM: 0,
      newPieces: 0,
      newLenM: 0,
      newStreets: [],
      stamps: [],
      segs: [],
      filter: newFilterState(),
      visitedPark: false,
      lastFix: null,
      fixes: 0,
    };
    persistSession(true);
    beginTracking();
  }

  function beginTracking(): void {
    stopWatch?.();
    stopWatch = provider.watch(onFix, onLocError);
    void wake.enable();
    mapView.user.setWalking(true);
    mapView.setFollow(true);
    if (here) mapView.follow(here.lon, here.lat);
    renderDock();
  }

  function stopTracking(): void {
    stopWatch?.();
    stopWatch = null;
    void wake.disable();
    mapView.user.setWalking(false);
    setBanner(ui, 'gps', null);
    setBanner(ui, 'wake', null);
    weakSince = null;
    vehicleUntil = 0;
  }

  async function cancelSession(): Promise<void> {
    stopTracking();
    session = null;
    await storage.delete('meta', 'activeSession');
    renderDock();
  }

  async function endWalk(): Promise<void> {
    if (!session) return;
    const s = session;
    stopTracking();
    const rec = sessionAsWalk(s, provider.now());
    session = null;
    if (sessionTimer) clearTimeout(sessionTimer);
    const saved = rec.distanceM >= CONFIG.minSavedWalkM || rec.newPieces > 0;
    if (saved) {
      walks.push(rec);
      rec.stamps = [...s.stamps, ...awardStamps(stampContext(), rec.id)];
      await storage.putMany('walks', [rec]);
    }
    await flushLit();
    await storage.delete('meta', 'activeSession');
    provider.reset?.();
    dataVersion++;
    mapView.fog.invalidate();
    renderDock();
    openSheet(ui, summaryHtml(rec, saved));
  }

  // ---- Dock, banners, tabs ----
  function gpsState(): LiveView['gps'] {
    if (locError && locError.kind !== 'timeout') return { kind: 'error', text: 'Location unavailable' };
    if (!session?.lastFix) return { kind: 'searching', text: 'Finding you…' };
    if (weakSince !== null && Date.now() - weakSince > 2000) {
      return { kind: 'weak', text: `Weak GPS (±${Math.round(weakAcc)} m) · lights up when it sharpens` };
    }
    if (Date.now() < vehicleUntil) return { kind: 'vehicle', text: 'Moving fast · riding? Lighting paused' };
    const loading = loader.status.hereLoaded ? '' : ' · loading streets…';
    return { kind: 'ok', text: `GPS ±${Math.round(session.lastFix.acc)} m${loading}` };
  }

  function updateDock(): void {
    if (!session) return;
    updateLiveDock(ui.dock, {
      elapsedMs: provider.now() - session.startedAt,
      distanceM: session.distanceM,
      newStreets: session.newStreets.length,
      newPieces: session.newPieces,
      gps: gpsState(),
    });
  }

  function idleHint(): string {
    if (progress.piecesLit === 0) return 'Your city starts dark. Every street you walk lights up, for good.';
    return `${progress.streetsMet} street${progress.streetsMet === 1 ? '' : 's'} lit so far. Where to next?`;
  }

  function renderDock(): void {
    if (session) {
      renderLiveDock(ui.dock, () => void endWalk());
      updateDock();
    } else {
      renderIdleDock(ui.dock, idleHint(), () => void startWalk());
    }
    renderRecenter();
  }

  function renderRecenter(): void {
    ui.recenter.hidden = !!session && mapView.isFollowing;
  }

  ui.recenter.addEventListener('click', async () => {
    if (session) mapView.setFollow(true);
    if (here) {
      mapView.centerOn(here.lon, here.lat);
      return;
    }
    try {
      const f = await provider.current();
      onFix(f);
      mapView.centerOn(f.lon, f.lat, 16);
    } catch (e) {
      onLocError(e as LocationError);
    }
  });

  function onLoaderStatus(s: LoaderStatus): void {
    if (s.state === 'retrying' || s.state === 'offline') {
      const secs = s.nextRetryAt ? Math.max(1, Math.round((s.nextRetryAt - Date.now()) / 1000)) : null;
      const tail = session ? ' Your walk is still being recorded.' : '';
      setBanner(ui, 'streets', {
        kind: 'warn',
        text:
          s.state === 'offline'
            ? `You’re offline, so new streets can’t load yet.${tail}`
            : `The street map is busy. Retrying${secs ? ` in ${secs}s` : ''}…${tail}`,
        action: { label: 'Retry', run: () => loader.retryNow() },
      });
    } else if (s.state === 'loading' && !s.hereLoaded) {
      setBanner(ui, 'streets', { kind: 'info', text: 'Finding the streets around you…' });
    } else {
      setBanner(ui, 'streets', null);
    }
  }

  function renderStampsTab(): void {
    renderStamps(ui.stamps, stampContext(), earned);
  }

  function renderYouTab(): void {
    const now = provider.now();
    const st = streaks(walks, now);
    renderYou(ui.you, {
      streetsMet: progress.streetsMet,
      litLenM: progress.litLenM,
      walks: walks.length,
      streak: st.current,
      bestStreak: st.best,
      week: weekBars(walks, now),
      nudges: here ? nearbyUnlitStreets(loader.index.values(), (n) => progress.hasStreet(n), here.lon, here.lat) : null,
      storageKind: storage.kind,
    });
  }

  ui.tabs.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
    if (!b) return;
    tab = b.dataset.tab as Tab;
    selectTab(ui, tab);
    if (tab === 'stamps') renderStampsTab();
    if (tab === 'you') renderYouTab();
  });

  setInterval(() => {
    updateDock();
    if (loader.status.state === 'retrying') onLoaderStatus(loader.status);
  }, 1000);

  // ---- Boot ----
  selectTab(ui, 'map');
  renderDock();
  if (here) mapView.user.update(here.lon, here.lat, here.acc, null);

  if (session) {
    toast(ui, 'Walk resumed', 'info', '↺');
    if (here) loader.ensureAround(here.lon, here.lat);
    beginTracking();
  } else {
    if (here) loader.ensureAround(here.lon, here.lat);
    const perm = await provider.permission();
    if (perm === 'granted') {
      provider
        .current()
        .then((f) => {
          onFix(f);
          if (!session) mapView.centerOn(f.lon, f.lat, 16);
        })
        .catch(() => {});
    }
  }

  if (sim) {
    // Hidden test hook for desktop verification (only with ?sim).
    (window as unknown as Record<string, unknown>).__wanderlight = {
      progress, loader, mapView, walks, earned,
      get session() {
        return session;
      },
      summary: () => ({
        piecesLoaded: loader.index.size,
        piecesLit: progress.piecesLit,
        streetsMet: progress.streetsMet,
        streets: progress.streetNames(),
        litLenM: Math.round(progress.litLenM),
        loader: loader.status,
        fog: mapView.fog.stats,
        session: session && {
          distanceM: Math.round(session.distanceM), newPieces: session.newPieces,
          newStreets: session.newStreets, segs: session.segs.length / 5, fixes: session.fixes,
        },
        walks: walks.length,
        stamps: [...earned.keys()],
      }),
    };
  }

}
