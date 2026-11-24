import type { ExpressionSpecification, FontFacesSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { CONFIG } from '../config';
import type { Theme } from '../theme';
import { KC, KIND_OF, PATTERN_ZOOMS, PEN_FLOOR, PRINTED, TOWER, TOWER_RISE, patternId, picId, unitPx } from './ink';

/** Tiles come through this protocol, so the map and the street graph share one download each. */
export const TILE_PROTOCOL = 'wlt';

/** Names of walked streets, each in its crayon. */
export const NAMES_SOURCE = 'lit-names';
export const NAMES_LAYER = 'lit-names';
/** The places you have seen, colored in. */
export const SEEN_PLACES_SOURCE = 'seen-places';
export const SEEN_PLACES_LAYER = 'seen-places';
/**
 * The crayon layer goes in under this one: it multiplies over the printed page and the places
 * colored in, as crayon does, and the names of your streets are written over it.
 */
export const ABOVE_FOG_LAYER = NAMES_LAYER;

export const ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
  '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> ' +
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>';

// The ranges of Google Fonts' latin and latin-ext subsets, as in the @font-face rules of index.html.
const LATIN = 'U+0000-00FF U+0131 U+0152-0153 U+02BB-02BC U+02C6 U+02DA U+02DC U+0304 U+0308 U+0329 U+2000-206F U+20AC U+2122 U+2191 U+2193 U+2212 U+2215 U+FEFF U+FFFD'.split(' ');
const LATIN_EXT = 'U+0100-02BA U+02BD-02C5 U+02C7-02CC U+02CE-02D7 U+02DD-02FF U+0304 U+0308 U+0329 U+1D00-1DBF U+1E00-1E9F U+1EF2-1EFF U+2020 U+20A0-20AB U+20AD-20C4 U+2113 U+2C60-2C7F U+A720-A7FF'.split(' ');

/**
 * The font shipped in public/fonts for the street names (by the name `text-font` asks for), on a
 * device without the hand's first font. MapLibre draws each letter only once its file has loaded,
 * so a label never sticks in a stand-in font; the latin-ext file (ő, š…) loads only when a name
 * needs it. Other scripts fall back to the phone's fonts further down the stack.
 */
function fontFaces(): FontFacesSpecification {
  const url = (file: string) => new URL(`${import.meta.env.BASE_URL}fonts/${file}.woff2`, location.href).href;
  return {
    Kalam: [
      { url: url('kalam-bold-latin'), 'unicode-range': LATIN },
      { url: url('kalam-bold-latin-ext'), 'unicode-range': LATIN_EXT },
    ],
  };
}

/**
 * Whether this device has a font by this name, Marker Felt on Apple's: text in it measures other
 * than in the fallback. A declared font face would win over it, so the names would not be written
 * in the hand the rest of the app writes in.
 */
function onDevice(family: string): boolean {
  const ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  if (!ctx) return false;
  const width = (font: string) => {
    ctx.font = `700 40px ${font}`;
    return ctx.measureText('Westerstraat').width;
  };
  return width(`"${family}", monospace`) !== width('monospace');
}

type Expr = ExpressionSpecification;

/**
 * Widths follow the design's units (src/map/ink.ts): CSS px at each of these zooms, grown
 * exponentially in between like the map. The second last is where a pen line stops thinning.
 */
const ZOOMS = [11, 12, 13, 14, 15, CONFIG.walkZoom + Math.log2(PEN_FLOOR / KC), 20];
const atZooms = (at: (z: number) => number | Expr) =>
  ['interpolate', ['exponential', 2], ['zoom'], ...ZOOMS.flatMap((z) => [z, at(z)])] as unknown as number;
/** A pen line `u` units wide: on the ground at the walk, never thinner than PEN_FLOOR px per unit. */
const penPx = (z: number) => Math.max(unitPx(z), PEN_FLOOR);
const pen = (u: number) => atZooms((z) => u * penPx(z));
/** Grows with the map from the walk zoom, where it is `x`. */
const withMap = (x: number) =>
  ['interpolate', ['exponential', 2], ['zoom'], 15, x * 2 ** (15 - CONFIG.walkZoom), 20, x * 2 ** (20 - CONFIG.walkZoom)] as unknown as number;

/**
 * A street's width in units by its class (the design's WCLS, `pencil.width`, which the crayon
 * shares); pedestrian streets are paths in the tiles.
 */
const byClass = ({ width: w, road }: Theme['pencil'], f: (u: number) => number): Expr => [
  'case', ['==', ['get', 'subclass'], 'pedestrian'], f(w.pedestrian),
  ['match', ['get', 'class'], ...Object.entries(w).filter(([k]) => k !== 'pedestrian').flatMap(([k, u]) => [k, f(u)]), f(road)] as unknown as Expr,
];
/** A street: its width on the ground, and `edge` units of pen line on top (its two casing lines). */
const street = (p: Theme['pencil'], edge: number) => atZooms((z) => byClass(p, (u) => u * unitPx(z) + edge * penPx(z)));

const LINES: Expr = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];
const STREETS: Expr = [
  'all', LINES, ['!=', ['get', 'brunnel'], 'tunnel'],
  ['any',
    ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'track', 'busway']]],
    ['==', ['get', 'subclass'], 'pedestrian']],
];
const PATHS: Expr = [
  'all', LINES, ['!=', ['get', 'brunnel'], 'tunnel'], ['==', ['get', 'class'], 'path'],
  ['in', ['get', 'subclass'], ['literal', ['footway', 'cycleway', 'path', 'steps', 'bridleway']]],
];
const GREEN: Expr = ['in', ['get', 'class'], ['literal', ['wood', 'grass']]];
const WATER: Expr = ['!=', ['get', 'brunnel'], 'tunnel'];

/** A pattern by zoom: each drawn for its whole zoom (see ink.ts patterns). */
const pattern = (name: 'waves' | 'trees') =>
  ['step', ['zoom'], patternId(name, PATTERN_ZOOMS[0]), ...PATTERN_ZOOMS.slice(1).flatMap((z) => [z, patternId(name, z)])] as unknown as string;

/** The pictogram of a poi: the tower for the Westertoren, else by its class. */
const kinds = new Map<string, string[]>();
for (const [cls, kind] of Object.entries(KIND_OF)) kinds.set(kind, [...(kinds.get(kind) ?? []), cls]);
const POI_ICON = [
  'case', ['==', ['get', 'name'], TOWER], picId('tower'),
  ['match', ['get', 'class'], ...[...kinds].flatMap(([kind, classes]) => [classes, picId(kind)]), picId('dot')],
] as unknown as string;
/** The tower stands on its point; the other pictograms are centred on theirs. */
const iconOffset = (isTower: Expr) => ['case', isTower, ['literal', [0, -TOWER_RISE]], ['literal', [0, 0]]] as unknown as [number, number];

/** The names of your streets: 7.2 units at the walk. */
const NAME_PX = 7.2 * KC;

/**
 * The basemap as the design's coloring page (drawInk), from OpenFreeMap's OpenMapTiles: black ink
 * on white paper. Parks and water in outline, with cloud trees and little waves inside; houses in
 * outline; streets as a black casing with the inside cut back to paper, all casings under all
 * insides, so crossings stay open; footpaths dashed; places as ink pictograms. Over it the places
 * you have seen colored in, then the crayon (the fog layer), then the names of your streets in
 * their crayons. No sprite, no glyph downloads: the images are drawn at style load (ink.ts), and
 * MapLibre draws the names with the app's own font.
 */
export function buildStyle(t: Theme): StyleSpecification {
  const m = t.map;
  const iconSize = withMap(1);
  const layers: LayerSpecification[] = [
    { id: 'background', type: 'background', paint: { 'background-color': m.paper } },
    {
      id: 'park-edge', type: 'line', source: 'omt', 'source-layer': 'landcover', filter: GREEN,
      layout: { 'line-join': 'round' },
      paint: { 'line-color': m.ink, 'line-width': pen(0.5) },
    },
    {
      id: 'park-trees', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: GREEN, minzoom: PATTERN_ZOOMS[0],
      paint: { 'fill-pattern': pattern('trees') },
    },
    {
      id: 'water-edge', type: 'line', source: 'omt', 'source-layer': 'water', filter: WATER,
      layout: { 'line-join': 'round' },
      paint: { 'line-color': m.ink, 'line-width': pen(0.9) },
    },
    {
      id: 'water-waves', type: 'fill', source: 'omt', 'source-layer': 'water', filter: WATER, minzoom: PATTERN_ZOOMS[0],
      paint: { 'fill-pattern': pattern('waves') },
    },
    {
      // Houses: paper over what lies under them, in a pen outline.
      id: 'building', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 13,
      paint: { 'fill-color': m.paper },
    },
    {
      id: 'building-edge', type: 'line', source: 'omt', 'source-layer': 'building', minzoom: 13,
      layout: { 'line-join': 'round' },
      paint: { 'line-color': m.ink, 'line-width': pen(0.46) },
    },
    {
      // Every street's casing first, then every street's paper inside: crossings stay open.
      id: 'road-casing', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12, filter: STREETS,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': m.ink, 'line-width': street(t.pencil, 1.24) },
    },
    {
      id: 'road', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12, filter: STREETS,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': m.paper, 'line-width': street(t.pencil, 0) },
    },
    {
      // Footpaths: black dashes, 1.5 units on and 1.4 off (in line widths here).
      id: 'road-path', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 13, filter: PATHS,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': m.ink, 'line-width': pen(0.42), 'line-dasharray': [1.5 / 0.42, 1.4 / 0.42] },
    },
    {
      // Places printed on the page, the important ones first; one never crowds another.
      id: 'poi', type: 'symbol', source: 'omt', 'source-layer': 'poi', minzoom: 15,
      filter: ['in', ['get', 'class'], ['literal', PRINTED]],
      layout: {
        'symbol-sort-key': ['get', 'rank'],
        'icon-image': POI_ICON,
        'icon-size': iconSize,
        'icon-offset': iconOffset(['==', ['get', 'name'], TOWER]),
        'icon-padding': 0.75 * KC,
      },
    },
    {
      // Places you have seen, colored in, over their printed pictogram (which they push aside).
      id: SEEN_PLACES_LAYER, type: 'symbol', source: SEEN_PLACES_SOURCE, minzoom: 15,
      layout: {
        'symbol-sort-key': ['get', 'rank'],
        'icon-image': ['get', 'icon'],
        'icon-size': iconSize,
        'icon-offset': iconOffset(['==', ['get', 'kind'], 'tower']),
        'icon-allow-overlap': true,
      },
    },

    // ---- The crayon (fog) custom layer goes here (inserted before ABOVE_FOG_LAYER). ----

    {
      // One name per walked stretch, written on it, straight along its longest straight run (names.ts).
      id: NAMES_LAYER, type: 'symbol', source: NAMES_SOURCE, minzoom: 15,
      layout: {
        'text-field': ['get', 'n'],
        // The first entry only carries the weight of the phone's fallback (MapLibre reads it from
        // the first name); the shipped file carries its own.
        'text-font': ['Bold', ...t.font.hand],
        'text-size': withMap(NAME_PX),
        'text-rotate': ['get', 'r'],
        'text-rotation-alignment': 'map',
        'text-max-width': 100,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: {
        // Each name in its street's crayon, pressed hard (names.ts).
        'text-color': ['coalesce', ['get', 'c'], m.ink],
        // The paper rubbed back around the letters: 0.32 times the size across, half of it outside.
        'text-halo-color': 'rgba(255, 254, 251, 0.9)',
        'text-halo-width': withMap(NAME_PX * 0.16),
      },
    },
  ];

  return {
    version: 8,
    ...(onDevice(t.font.hand[0]) ? {} : { 'font-faces': fontFaces() }),
    sources: {
      omt: {
        type: 'vector',
        tiles: [`${TILE_PROTOCOL}://{z}/{x}/{y}`],
        minzoom: 0,
        maxzoom: 14,
        attribution: ATTRIBUTION,
      },
      [NAMES_SOURCE]: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      [SEEN_PLACES_SOURCE]: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers,
  };
}
