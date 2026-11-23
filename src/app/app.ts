import { CONFIG } from '../config';
import type { Block } from '../core/blocks';
import { newFilterState, stepFilter, type FilterState } from '../core/gpsFilter';
import { Motion } from '../core/motion';
import { Progress, toStoredHouse, toStoredLit } from '../core/progress';
import type { Building, Fix, LitHouse, LitPiece, Piece, WalkRecord } from '../core/types';
import { WalkAlong, type Walked } from '../core/walkAlong';
import { SightController } from './sightController';
import { StreetGraph } from '../data/graph';
import { TileSource, type GraphTile } from '../data/tiles';
import { POS_KEY, STATS_KEY, WALKING_KEY, refreshTemplate } from '../data/tileUrl';
import { distanceM, expandBBox, polylineDistanceM, projectOnPolylineM } from '../geo/geo';
import { pageTime } from '../map/fog/fogLayer';
import { LONG_AGO } from '../map/fog/geometry';
import { EARTH_CIRCUMFERENCE_M } from '../map/gl';
import { MapView } from '../map/mapView';
import { nameLines } from '../map/names';
import type { LocationError, LocationProvider } from '../platform/location';
import { isNativeApp } from '../platform/native';
import { createSimLocation, simFactor } from '../platform/simLocation';
import { SIM_ROUTE } from '../platform/simRoute';
import { openStorage, persistStorage } from '../platform/storage';
import { WakeLockKeeper } from '../platform/wakeLock';
import { paperTheme, pencilKey, pencilOf } from '../theme';
import { Hud } from '../ui/hud';
import { Splash } from '../ui/splash';
import { Toasts } from '../ui/toast';

/** The walk in progress. Saved as it goes, so a reload mid-walk carries on. */
interface ActiveSession {
  id: string;
  startedAt: number;
  distanceM: number;
  newPieces: number;
  newLenM: number;
  newStreets: string[];
  newHouses?: number;
  /** Walked steps [aLon, aLat, bLon, bLat, radius, ...], replayed when streets load late. */
  segs: number[];
  filter: FilterState;
  lastFix: Fix | null;
  fixes: number;
}

/** Left on `window.__wl` by the boot script in index.html. */
interface Boot {
  sim: boolean;
  /** Suffix of the localStorage keys ('-sim' for the demo walk). */
  sfx: string;
  /** When Start was tapped before the app had loaded (0: not). */
  tapped: number;
  /** Motion access asked for in the Start tap (iPhone), for the compass. */
  orient?: 'granted' | 'denied';
  app: unknown;
}

const NO_PADDING = { top: 0, bottom: 0, left: 0, right: 0 };

/** Walks left open longer than this (the phone closed the tab mid-walk) are closed on the next start. */
const STALE_WALK_MS = 3 * 3600_000;
/** How long Start waits for your first position before showing the map anyway. */
const FIRST_FIX_WAIT_MS = 8000;
const DEG = Math.PI / 180;

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
  };
}

function readJson<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  } catch {
    /* private mode: the app still works, it just forgets */
  }
}

function centroid(flat: ArrayLike<number>): [number, number] {
  let x = 0, y = 0;
  const n = flat.length / 2;
  for (let i = 0; i < flat.length; i += 2) {
    x += flat[i];
    y += flat[i + 1];
  }
  return [x / n, y / n];
}

/** Location refused in the iPhone app: the demo walk asks for none. */
const LOCATION_OFF =
  '<b>Location is off for Mr Sparkles.</b> It colors in the streets you walk, so it needs to know where you are; that never leaves this iPhone.<br>' +
  '<a href="app-settings:"><b>Open Settings</b></a> → Location → <b>While Using the App</b>, and keep Precise Location on.';

export async function startApp(): Promise<void> {
  const params = new URLSearchParams(location.search);
  // Only the iPhone app walks for real, with native GPS that goes on with the screen locked; a
  // browser walks the demo (ADR 0013). The boot script in index.html decides it before first paint.
  const boot: Boot = (window as unknown as { __wl?: Boot }).__wl ?? {
    sim: !isNativeApp(), sfx: isNativeApp() ? '' : '-sim', tapped: 0, app: null,
  };
  const sim = boot.sim;
  const key = (k: string) => k + boot.sfx;
  const provider: LocationProvider = sim
    ? createSimLocation(simFactor(params.get('sim')))
    : (await import('../platform/nativeLocation')).createNativeLocation();
  const theme = paperTheme;

  const splash = new Splash(sim);
  const hud = new Hud(() => void endWalk());
  const toasts = new Toasts();

  // ---- State ----
  const progress = new Progress();
  const graph = new StreetGraph();
  const motion = new Motion();
  /** Unlocked blocks of the loaded tiles, with when they were lit. */
  const litBlocks = new Map<string, number>();
  /** Blocks unlocked on this walk: houses beside them that load later still light up. */
  const walkBlocks = new Set<string>();
  let walks: WalkRecord[] = [];
  let session: ActiveSession | null = null;
  let walkAlong: WalkAlong | null = null;
  let here: Fix | null = null;
  let stopWatch: (() => void) | null = null;
  let ready = false;
  let weakSince = 0;
  let revealTimer = 0;
  let sessionTimer = 0;
  let litTimer = 0;
  let namesTimer = 0;
  let seenTimer = 0;
  let posSavedAt = 0;
  /** Mr Sparkles' pencil: the one of the street he walks, colored in now or on an earlier walk. */
  let tone = 0;

  const lastPos = readJson<{ lon: number; lat: number }>(key(POS_KEY));
  const known = lastPos && Number.isFinite(lastPos.lon) && Number.isFinite(lastPos.lat) ? lastPos : null;
  // The demo always starts on its route, so its tiles load behind the start screen.
  const start = known ?? (sim ? { lon: SIM_ROUTE[0], lat: SIM_ROUTE[1] } : null);

  const tiles = new TileSource({
    onTile: (t) => onTile(t),
    onDrop: (k) => graph.removeTile(k),
    onWaiting: (w) => onWaiting(w),
  });
  const view = new MapView(document.getElementById('map')!, theme, tiles, start && { ...start, zoom: 15.5 });
  // Once the streets around are drawn, show them behind the start screen. Before the first walk
  // (the demo's too), Mr Sparkles waits there in the fog instead (ADR 0012).
  if (known) view.map.once('idle', () => splash.overMap(true));
  hud.source(() => ({
    elapsedMs: session ? provider.now() - session.startedAt : 0,
    distanceM: session?.distanceM ?? 0,
  }));

  // The demo keeps the screen on while it walks. The iPhone app records with the screen locked,
  // so it lets the phone lock as usual.
  const wake = sim ? new WakeLockKeeper() : null;

  // ---- What you lit so far ----
  const storage = await openStorage(sim ? 'wanderlight-sim' : undefined);
  const [litRecords, walkRecords, houseRecords, saved] = await Promise.all([
    storage.getAll<LitPiece>('lit'),
    storage.getAll<WalkRecord>('walks'),
    storage.getAll<LitHouse>('houses'),
    storage.get<ActiveSession>('meta', 'activeSession'),
  ]);
  progress.load(litRecords);
  progress.loadHouses(houseRecords);
  walks = walkRecords.sort((a, b) => a.startedAt - b.startedAt);
  // A house takes the pencil of the street whose block colored it in (its id starts with the way's).
  const wayKey = new Map<string, string>();
  for (const p of progress.lit.values()) {
    view.fog.addPiece(p);
    wayKey.set(String(p.way), pencilKey(p));
  }
  for (const h of progress.houses.values()) {
    const b = String(h.block);
    view.fog.addHouse(h, LONG_AGO, wayKey.get(b.slice(0, b.lastIndexOf(':'))));
  }
  // What you have seen from the streets you walked, in ink.
  const sight = new SightController(theme, view, graph, tiles, (id) => progress.houses.has(id));
  await sight.load(storage);
  refreshNames(true);
  writeLifetime();
  ready = true;
  // Tiles that arrived while the records loaded.
  relight([...graph.blocks.values()]);
  if (start) tiles.ensureAround(start.lon, start.lat);

  // ---- Saving ----
  /**
   * Saves the walk in progress at most every 2 s: a throttle, not a debounce, since fixes come
   * every second and a debounce would put the write off until the page closes.
   */
  function persistSession(immediately = false): void {
    const write = () => {
      clearTimeout(sessionTimer);
      sessionTimer = 0;
      if (session) void storage.set('activeSession', session);
    };
    if (immediately) write();
    else if (!sessionTimer) sessionTimer = window.setTimeout(write, 2000);
  }

  const litQueue = new Map<string, LitPiece>();
  const houseQueue = new Map<string, LitHouse>();
  function queue(lit: LitPiece[], houses: LitHouse[]): void {
    for (const r of lit) litQueue.set(r.id, r);
    for (const r of houses) houseQueue.set(r.id, r);
    if (!litTimer && (litQueue.size || houseQueue.size)) litTimer = window.setTimeout(() => void flushLit(), 1000);
  }
  async function flushLit(): Promise<void> {
    clearTimeout(litTimer);
    litTimer = 0;
    const lit = [...litQueue.values()].map(toStoredLit);
    const houses = [...houseQueue.values()].map(toStoredHouse);
    litQueue.clear();
    houseQueue.clear();
    await Promise.all([
      lit.length ? storage.putMany('lit', lit) : null,
      houses.length ? storage.putMany('houses', houses) : null,
    ]);
  }

  /** The seen memory changes with every look: saved every few seconds, not every look. */
  function queueSeen(): void {
    if (!seenTimer && sight.hasSaves) seenTimer = window.setTimeout(() => void flushSeen(), 5000);
  }
  async function flushSeen(): Promise<void> {
    clearTimeout(seenTimer);
    seenTimer = 0;
    const saves = sight.takeSaves();
    const { tiles: t, houses, places } = saves;
    try {
      await Promise.all([
        t.length ? storage.putMany('seen', t) : null,
        houses.length ? storage.putMany('seenHouses', houses) : null,
        places.length ? storage.putMany('places', places) : null,
      ]);
    } catch (e) {
      // Kept for the next save; what you saw is never worth losing the walk over.
      console.warn('Could not save what you saw', e);
      sight.giveBack(saves);
    }
  }

  const saveNow = () => {
    void flushLit();
    void flushSeen();
    persistSession(true);
  };
  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') return saveNow();
    // Back from the background: put the walker where you are, no slide across town.
    motion.snap();
    view.repaint();
  });

  function savePos(f: Fix): void {
    if (Date.now() - posSavedAt < 10_000) return;
    posSavedAt = Date.now();
    writeLocal(key(POS_KEY), { lon: Math.round(f.lon * 1e5) / 1e5, lat: Math.round(f.lat * 1e5) / 1e5 });
  }

  function writeLifetime(): void {
    const km = walks.reduce((s, w) => s + w.distanceM, 0) / 1000;
    const l = { streets: progress.streetsMet, km: km < 10 ? km.toFixed(1) : String(Math.round(km)) };
    writeLocal(key(STATS_KEY), l);
    splash.setLifetime(l);
  }

  /** Street names in their pencils follow the walked streets; rebuilt at most about once a second. */
  function refreshNames(now = false): void {
    if (!now) {
      if (!namesTimer) namesTimer = window.setTimeout(() => refreshNames(true), 700);
      return;
    }
    clearTimeout(namesTimer);
    namesTimer = 0;
    view.setNames(nameLines(progress.lit.values()));
    // Ink names under the wash, except where the pencil one is.
    view.setLitStreetNames(progress.streetNames());
  }

  // ---- Streets and houses arriving ----
  const newWalkAlong = () => new WalkAlong(graph.blocks, (b) => litBlocks.has(b.id));

  function onTile(t: GraphTile): void {
    const added = graph.addTile(t.key, t.blocks, t.houses, t.places);
    if (!ready) return;
    relight(added);
    sight.tileArrived();
    queueSeen();
    if (!session) return;
    // The walk so far, over streets that just arrived.
    walkAlong = newWalkAlong();
    light(walkAlong.replay(session.segs));
    lightLateHouses(t.houses);
  }

  /**
   * Blocks lit before (on an earlier walk, or with older map data under other ids) are known by
   * their geometry: most of their length runs along lit pieces.
   */
  function relight(blocks: Block[]): void {
    for (const b of blocks) {
      if (litBlocks.has(b.id)) continue;
      let litAt = Infinity;
      let all = true;
      for (const p of b.pieces) {
        const r = progress.lit.get(p.id);
        if (!r) {
          all = false;
          break;
        }
        litAt = Math.min(litAt, r.litAt);
      }
      if (all) {
        litBlocks.set(b.id, litAt);
        continue;
      }
      const cov = progress.coverage(b.coords, b.bbox);
      if (cov.fraction >= CONFIG.relightFraction) litBlocks.set(b.id, cov.litAt);
    }
  }

  /** Houses in a tile that loaded after the block beside them unlocked on this walk. */
  function lightLateHouses(houses: Building[]): void {
    if (!walkBlocks.size) return;
    const byBlock = new Map<Block, Building[]>();
    for (const h of houses) {
      if (progress.houses.has(h.id)) continue;
      for (const b of graph.blocks.index.query(expandBBox(h.bbox, CONFIG.houseRadiusM))) {
        if (!walkBlocks.has(b.id) || polylineDistanceM(h.coords, b.coords) > CONFIG.houseRadiusM) continue;
        const list = byBlock.get(b);
        if (list) list.push(h);
        else byBlock.set(b, [h]);
        break;
      }
    }
    const t0 = pageTime();
    for (const [b, hs] of byBlock) {
      const lit = progress.applyHouses(hs, b.id, Date.now());
      for (const h of lit) view.fog.addHouse(h, t0 + Math.random() * 0.8, pencilKey(b));
      sight.housesLit(lit);
      queue([], lit);
      if (session) session.newHouses = (session.newHouses ?? 0) + lit.length;
    }
  }

  function onWaiting(waiting: boolean): void {
    if (!waiting) return toasts.clear('net');
    if (!session) return;
    toasts.show(
      'net',
      navigator.onLine ? 'Can’t load the streets here yet. Your walk is still recorded.' : 'You’re offline. Your walk is still recorded.',
      'warn',
    );
  }

  /** What a walked step (or the walk so far, replayed) lit. */
  function light(walked: Walked): void {
    if (walked.on) tone = pencilOf(pencilKey(walked.on), theme.pencils.length);
    if (walked.pieces.length) lightPieces(walked.pieces);
    if (walked.blocks.length) unlockBlocks(walked.blocks);
  }

  /**
   * Stretches walked in a block that is not complete yet: each ~20 m piece lights where you
   * walked it, with the houses beside it, so nothing you walked stays dark.
   */
  function lightPieces(pieces: Piece[]): void {
    if (!session) return;
    const now = Date.now();
    const t0 = pageTime();
    const pos = motion.position ?? here;
    let changed = false;
    for (const piece of pieces) {
      if (progress.isLit(piece.id)) continue;
      const res = progress.apply([piece], session.id, now);
      const blockId = graph.blocks.blockOf(piece.id)?.id ?? '';
      res.newHouses = progress.applyHouses(
        graph.housesNear(piece.coords, piece.bbox, CONFIG.houseRadiusM), blockId, now,
      );
      queue(res.changed, res.newHouses);
      if (!res.newPieces.length && !res.newHouses.length) continue;
      changed = true;
      const fromM = pos ? projectOnPolylineM(pos.lon, pos.lat, piece.coords).alongM : 0;
      if (res.newPieces.length) view.fog.addPiece(piece, { offsetM: 0, fromM, t0 });
      for (const h of res.newHouses) view.fog.addHouse(h, t0 + 0.15 + Math.random() * 0.4, pencilKey(piece));
      sight.housesLit(res.newHouses);
      session.newPieces += res.newPieces.length;
      session.newLenM += res.newPieces.reduce((s, p) => s + p.len, 0);
      session.newStreets.push(...res.newStreets);
      session.newHouses = (session.newHouses ?? 0) + res.newHouses.length;
    }
    if (!changed) return;
    refreshNames();
    persistSession();
  }

  /**
   * Blocks completed: each colors in from where you are, out along it, in its own pencil; its
   * houses color in as the pencil passes them, and its name is written in that pencil.
   */
  function unlockBlocks(blocks: Block[]): void {
    if (!session) return;
    const now = Date.now();
    const t0 = pageTime();
    const pos = motion.position ?? here;
    const speed = theme.fog.sweepMps;
    let changed = false;
    for (const block of blocks) {
      if (litBlocks.has(block.id)) continue;
      litBlocks.set(block.id, now);
      walkBlocks.add(block.id);
      const houses = graph.housesNear(block.coords, block.bbox, CONFIG.houseRadiusM);
      const res = progress.applyBlock(block, houses, session.id, now);
      queue(res.changed, res.newHouses);
      if (!res.newPieces.length && !res.newHouses.length) continue;
      changed = true;
      const fromM = pos ? projectOnPolylineM(pos.lon, pos.lat, block.coords).alongM : 0;
      const fresh = new Set(res.newPieces.map((p) => p.id));
      let offsetM = 0;
      for (const p of block.pieces) {
        if (fresh.has(p.id)) view.fog.addPiece(p, { offsetM, fromM, t0 });
        offsetM += p.len;
      }
      for (const h of res.newHouses) {
        const [cx, cy] = centroid(h.coords);
        const along = projectOnPolylineM(cx, cy, block.coords).alongM;
        view.fog.addHouse(h, t0 + Math.abs(along - fromM) / speed + 0.15, pencilKey(block));
      }
      sight.housesLit(res.newHouses);
      session.newPieces += res.newPieces.length;
      session.newLenM += res.newPieces.reduce((s, p) => s + p.len, 0);
      session.newStreets.push(...res.newStreets);
      session.newHouses = (session.newHouses ?? 0) + res.newHouses.length;
    }
    if (!changed) return;
    refreshNames();
    persistSession();
  }

  // ---- Location ----
  function onFix(fix: Fix): void {
    here = fix;
    toasts.clear('gps');
    if (!view.isArmed) view.arm();
    tiles.ensureAround(fix.lon, fix.lat);
    savePos(fix);
    if (!session) return;

    const first = !motion.hasFix;
    motion.push(fix, performance.now());
    if (first && motion.hasFix) onFirstFix(fix);

    session.fixes++;
    session.lastFix = fix;
    const { state, verdict } = stepFilter(session.filter, fix);
    session.filter = state;
    if (verdict.kind === 'reject' && verdict.reason === 'accuracy') {
      weakSince ||= Date.now();
      if (Date.now() - weakSince > 8000) {
        toasts.show('weak', `Weak GPS (±${Math.round(fix.acc)} m). Streets color in again once it sharpens.`, 'warn');
      }
    } else if (verdict.kind !== 'reject') {
      weakSince = 0;
      toasts.clear('weak');
    }
    if (verdict.kind === 'vehicle') toasts.show('fast', 'Moving fast. Lighting pauses while you ride.', 'info', 8000);
    if (verdict.kind === 'walk') {
      const { from, to } = verdict;
      session.distanceM += verdict.distM;
      session.segs.push(from.lon, from.lat, to.lon, to.lat, Math.round(verdict.radiusM * 10) / 10);
      walkAlong ??= newWalkAlong();
      light(walkAlong.add(from.lon, from.lat, to.lon, to.lat, verdict.radiusM));
      // Recorded while the screen was off: what you saw meanwhile, looking the way you walked.
      sight.fix(to, from, provider.now());
    }
    queueSeen();
    persistSession();
  }

  function onFirstFix(fix: Fix): void {
    const c = view.map.getCenter();
    // From across town (or the open sea), jump; nearby, the camera slides over by itself.
    if (view.map.getZoom() < 14 || distanceM(c.lng, c.lat, fix.lon, fix.lat) > CONFIG.followFlyM) {
      view.map.jumpTo({ center: [fix.lon, fix.lat], zoom: CONFIG.walkZoom });
    }
    reveal();
  }

  function onLocError(e: LocationError): void {
    if (e.kind === 'denied') {
      void abandonWalk();
      return;
    }
    if (!session) return;
    if (e.kind === 'unavailable') toasts.show('gps', 'No GPS signal yet. Check that Location is on.', 'warn');
    else toasts.show('gps', motion.hasFix ? 'GPS signal lost. Looking for it…' : 'Finding you…');
  }

  /**
   * Fixes recorded while the screen was locked arrive together: the walker jumps to where you are
   * now (no slide across town), the streets lit meanwhile light up in front of you, and the walk's
   * numbers show for a moment.
   */
  function onCatchUp(): void {
    motion.snap();
    view.repaint();
    if (session && !splash.visible) hud.show(3000);
  }

  // ---- Walk ----
  function beginTracking(s: ActiveSession): void {
    stopWatch?.();
    stopWatch = provider.watch(onFix, onLocError, { walk: s.id, since: s.lastFix?.t, onCatchUp });
    void wake?.enable();
    view.camera.start(CONFIG.walkZoom);
    sight.start();
  }

  function stopTracking(): void {
    stopWatch?.();
    stopWatch = null;
    void wake?.disable();
    view.camera.stop();
    clearTimeout(revealTimer);
    toasts.clear();
    weakSince = 0;
    motion.reset();
    view.puck.set(null);
    view.fog.setLantern(null);
    sight.stop();
  }

  function startWalk(): void {
    if (session || !ready) return;
    // Tells the service worker (main.ts) that from now on a new version waits for a quiet moment.
    boot.tapped ||= Date.now();
    splash.message(null);
    splash.busy(true);
    const t = provider.now();
    session = {
      id: `w${t.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      startedAt: t,
      distanceM: 0,
      newPieces: 0,
      newLenM: 0,
      newStreets: [],
      newHouses: 0,
      segs: [],
      filter: newFilterState(),
      lastFix: null,
      fixes: 0,
    };
    walkBlocks.clear();
    walkAlong = newWalkAlong();
    motion.reset();
    persistSession(true);
    writeLocal(key(WALKING_KEY), '1');
    beginTracking(session);
    clearTimeout(revealTimer);
    revealTimer = window.setTimeout(reveal, motion.hasFix ? 0 : FIRST_FIX_WAIT_MS);
  }

  /** While the start screen is up over the map, the map centres in the space above its card. */
  function splashPadding() {
    const h = view.map.getContainer().clientHeight;
    const top = document.querySelector('.wl-card')?.getBoundingClientRect().top ?? h / 2;
    return { top: 24, bottom: Math.max(0, Math.round(h - top + 24)), left: 0, right: 0 };
  }

  /** From the start screen to the map: the screen fades as the map slides you to its middle. */
  function reveal(): void {
    clearTimeout(revealTimer);
    if (!session || !splash.visible) return;
    splash.hide();
    const pos = motion.hasFix ? motion.position : null;
    view.camera.hold(750);
    view.map.easeTo({
      padding: NO_PADDING,
      zoom: CONFIG.walkZoom,
      ...(pos && { center: [pos.lon, pos.lat] as [number, number] }),
      duration: 700,
      essential: true,
    });
    hud.show(4500);
    if (!motion.hasFix) toasts.show('gps', 'Finding you…');
  }

  async function endWalk(showSummary = true): Promise<void> {
    if (!session) return;
    const s = session;
    session = null;
    walkAlong = null;
    stopTracking();
    writeLocal(key(WALKING_KEY), null);
    clearTimeout(sessionTimer);
    sessionTimer = 0;
    s.newStreets = streetsByLength(s);
    const rec = sessionAsWalk(s, provider.now());
    const kept = rec.distanceM >= CONFIG.minSavedWalkM || rec.newPieces > 0;
    if (kept) {
      walks.push(rec);
      await storage.putMany('walks', [rec]);
      persistStorage();
    }
    await Promise.all([flushLit(), flushSeen()]);
    await storage.delete('meta', 'activeSession');
    provider.reset?.();
    writeLifetime();
    hud.hideAll();
    if (showSummary) splash.summary({ walk: rec, newHouses: s.newHouses ?? 0 });
    else splash.intro();
    splash.overMap(view.isArmed);
    splash.show();
    if (showSummary) frameWalk(s);
  }

  /** Longest first: the streets you really walked lead the summary, not a 20 m alley. */
  function streetsByLength(s: ActiveSession): string[] {
    const len = new Map<string, number>();
    for (const p of progress.lit.values()) {
      if (p.name && p.lastWalk === s.id) len.set(p.name, (len.get(p.name) ?? 0) + p.len);
    }
    return [...new Set(s.newStreets)].sort((a, b) => (len.get(b) ?? 0) - (len.get(a) ?? 0));
  }

  /** Not a walk after all (no location): forget it. */
  async function cancelWalk(): Promise<void> {
    if (!session) return;
    session = null;
    walkAlong = null;
    stopTracking();
    writeLocal(key(WALKING_KEY), null);
    clearTimeout(sessionTimer);
    sessionTimer = 0;
    await storage.delete('meta', 'activeSession');
    hud.hideAll();
    splash.intro();
    splash.show();
  }

  async function abandonWalk(): Promise<void> {
    if (session && session.distanceM > 0) await endWalk(false);
    else await cancelWalk();
    splash.busy(false);
    splash.message(LOCATION_OFF);
  }

  /** Behind the summary, pull back to show the streets this walk went along. */
  function frameWalk(s: ActiveSession): void {
    const g = s.segs;
    if (g.length < 5) return;
    let w = Infinity, so = Infinity, e = -Infinity, n = -Infinity;
    for (let i = 0; i < g.length; i += 5) {
      w = Math.min(w, g[i], g[i + 2]);
      e = Math.max(e, g[i], g[i + 2]);
      so = Math.min(so, g[i + 1], g[i + 3]);
      n = Math.max(n, g[i + 1], g[i + 3]);
    }
    // Into the space above the summary card.
    const h = view.map.getContainer().clientHeight;
    const cardTop = document.querySelector('.wl-card')?.getBoundingClientRect().top ?? h * 0.45;
    view.map.fitBounds([[w, so], [e, n]], {
      padding: { top: 56, bottom: Math.max(40, Math.round(h - cardTop + 40)), left: 36, right: 36 },
      maxZoom: 16.5,
      duration: 1400,
      essential: true,
    });
  }

  // ---- Drawing ----
  let lastDraw = 0;
  let fast = true;
  let moving = false;
  let prev: { lon: number; lat: number } | null = null;
  let prevHeading: number | null = null;
  /**
   * One loop draws the walker, the lantern and the camera in step with the map. Fast things (an
   * unlock wave, the camera sliding back) draw every frame; a walk at walking pace at 30 fps,
   * which still moves less than a pixel a frame; standing still at 15 fps, enough for the mist
   * and your glow to breathe.
   */
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const interval = fast ? 0 : moving ? 1000 / 30 : 1000 / 15;
    if (now - lastDraw < interval - 3) return;
    const dt = Math.max(1e-3, (now - lastDraw) / 1000);
    lastDraw = now;
    fast = view.fog.animating(now / 1000);
    moving = false;
    // A map pixel in metres: standing still, the walker (and the camera on it) holds within one.
    const mpp = (EARTH_CIRCUMFERENCE_M * Math.cos((prev?.lat ?? 0) * DEG)) / (512 * 2 ** view.map.getZoom());
    const f = session && motion.hasFix ? motion.frame(now, prev ? mpp : 0) : null;
    if (f) {
      view.camera.update(f.lon, f.lat, now);
      fast ||= view.camera.settling;
      // The light comes from you and points where you look (compass), else where you walk.
      const light = sight.frame(now, f);
      view.puck.set({ lon: f.lon, lat: f.lat, tone });
      view.fog.setLantern(light);
      moving = f.moving || light.settling;
      // Turning to look around: the beam and its shadows follow at full speed.
      if (light.heading !== null && prevHeading !== null) {
        const turn = Math.abs(((light.heading - prevHeading + 540) % 360) - 180);
        if (turn / dt > 20) moving = true;
      }
      prevHeading = light.heading;
      queueSeen();
      if (moving && prev && distanceM(prev.lon, prev.lat, f.lon, f.lat) / mpp / dt > 24) fast = true;
      prev = { lon: f.lon, lat: f.lat };
    } else {
      prev = null;
      prevHeading = null;
      // Nothing to show under a start screen with no map behind it.
      if (splash.visible && !document.documentElement.classList.contains('wl-has-map') && !fast) return;
    }
    view.repaint();
  };
  requestAnimationFrame(frame);

  view.map.on('click', () => {
    if (session && !splash.visible) hud.show();
  });

  // ---- Start ----
  splash.onStart(() => startWalk());
  boot.app = { start: startWalk };

  // The iPhone app may have recorded more of the walk than the page saved (screen locked).
  const lastFixT = saved ? Math.max(saved.lastFix?.t ?? 0, (await provider.lastFixTime?.(saved.id)) ?? 0) : 0;
  if (saved && lastFixT && provider.now() - lastFixT > STALE_WALK_MS) {
    session = saved;
    await endWalk(false);
  } else if (saved) {
    // Carry on with the walk the page was closed in.
    session = saved;
    session.newHouses ??= 0;
    walkAlong = newWalkAlong();
    writeLocal(key(WALKING_KEY), '1');
    splash.hide();
    beginTracking(session);
    sight.askOnNextTap();
    const f = session.lastFix;
    if (f) {
      view.arm();
      view.map.jumpTo({ center: [f.lon, f.lat], zoom: CONFIG.walkZoom });
      motion.push(f, performance.now());
      tiles.ensureAround(f.lon, f.lat);
    } else {
      revealTimer = window.setTimeout(reveal, 0);
    }
    hud.show(3000);
  } else {
    writeLocal(key(WALKING_KEY), null);
    splash.show();
    if (start) view.map.setPadding(splashPadding());
    // Start was tapped while the app loaded: carry on.
    if (boot.tapped) startWalk();
  }
  if (!session) hud.hideAll();

  // A newer map build, if there is one, is used from the next start on.
  window.setTimeout(() => void refreshTemplate(), 5000);

  if (sim) {
    // Test hook for the demo walk only.
    (window as unknown as Record<string, unknown>).__sparkles = {
      view, tiles, graph, progress, motion, walks, sight,
      get session() {
        return session;
      },
      /** Look this way (degrees, null: the way you walk), as a phone with a compass would. */
      look: (deg: number | null) => {
        sight.simLook = deg;
      },
      summary: () => ({
        tiles: graph.tileCount,
        blocks: graph.blocks.size,
        blocksLit: litBlocks.size,
        walkBlocks: walkBlocks.size,
        houses: graph.houses.size,
        housesLit: progress.housesLit,
        piecesLit: progress.piecesLit,
        streets: progress.streetNames(),
        fog: view.fog.stats,
        seen: {
          tiles: sight.memory.grid.tiles.size,
          houses: sight.memory.houses.size,
          places: [...sight.memory.places.values()].map((p) => p.name),
        },
        net: tiles.stats,
        session: session && {
          distanceM: Math.round(session.distanceM),
          newPieces: session.newPieces,
          newStreets: session.newStreets,
          segs: session.segs.length / 5,
          fixes: session.fixes,
        },
      }),
    };
  }
}
