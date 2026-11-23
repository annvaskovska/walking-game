import type { FilterSpecification, FontFacesSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl';
import type { Theme } from '../theme';

/** Tiles come through this protocol, so the map and the street graph share one download each. */
export const TILE_PROTOCOL = 'wlt';

/** Names of walked streets, each in its pencil. */
export const NAMES_SOURCE = 'lit-names';
export const NAMES_LAYER = 'lit-names';
/** Street names in ink, under the wash: they print in full only where you have seen or walked. */
export const MOON_NAMES_LAYER = 'moon-names';
/** Labels of the landmarks you have seen, over the wash. */
export const SEEN_PLACES_SOURCE = 'seen-places';
export const SEEN_PLACES_LAYER = 'seen-places';
/** The paper wash is drawn right above the basemap, under this layer; everything from here up stays readable over it. */
export const ABOVE_FOG_LAYER = SEEN_PLACES_LAYER;
/** The landmark dot, drawn at style load (no sprite). */
export const LANDMARK_DOT = 'landmark-dot';

export const ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
  '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> ' +
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>';

const MINOR = ['minor', 'service', 'track'];
const MAJOR = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'];
const PATHS = ['path', 'pedestrian'];

// The ranges of Google Fonts' latin and latin-ext subsets, as in the @font-face rules of index.html.
const LATIN = 'U+0000-00FF U+0131 U+0152-0153 U+02BB-02BC U+02C6 U+02DA U+02DC U+0304 U+0308 U+0329 U+2000-206F U+20AC U+2122 U+2191 U+2193 U+2212 U+2215 U+FEFF U+FFFD'.split(' ');
const LATIN_EXT = 'U+0100-02BA U+02BD-02C5 U+02C7-02CC U+02CE-02D7 U+02DD-02FF U+0304 U+0308 U+0329 U+1D00-1DBF U+1E00-1E9F U+1EF2-1EFF U+2020 U+20A0-20AB U+20AD-20C4 U+2113 U+2C60-2C7F U+A720-A7FF'.split(' ');

/**
 * The fonts shipped in public/fonts, for the labels (by the names `text-font` asks for). MapLibre
 * draws each letter only once its file has loaded, so a label never sticks in a stand-in font;
 * the latin-ext file (ő, š…) loads only when a name needs it. Other scripts fall back to the
 * phone's fonts further down the stack.
 */
function fontFaces(): FontFacesSpecification {
  const url = (file: string) => new URL(`${import.meta.env.BASE_URL}fonts/${file}.woff2`, location.href).href;
  const face = (file: string) => [
    { url: url(`${file}-latin`), 'unicode-range': LATIN },
    { url: url(`${file}-latin-ext`), 'unicode-range': LATIN_EXT },
  ];
  return {
    'Instrument Serif': face('instrument-serif'),
    'Instrument Serif Italic': face('instrument-serif-italic'),
    'Instrument Sans': face('instrument-sans'),
  };
}

/**
 * A street's width on the ground as pixels at each zoom (about right for the latitudes of Europe):
 * [zoom, pixels per metre, pen lines added]. Its paper inside, and the ink casing it is cut from.
 */
const INSIDE = [[12, 1 / 12.8, 0], [16, 1 / 0.8, 0], [20, 1 / 0.05, 0]];
const CASED = [[12, 1 / 12.8, 0.5], [14, 1 / 3.2, 1], [16, 1 / 0.8, 1.8], [18, 1 / 0.2, 2.4], [20, 1 / 0.05, 3]];

/**
 * Pen lines thin out as the map zooms out, so a whole walk on one screen (the summary) reads as a
 * drawing, not a block of ink.
 */
const inkOpacity = (far: number) => ['interpolate', ['linear'], ['zoom'], 13, far, 15.5, 1] as unknown as number;

/** Street names in ink on every named street except these (their pencil already names them over the wash). */
export const moonNamesFilter = (lit: readonly string[]): FilterSpecification =>
  (lit.length ? ['match', ['get', 'name'], [...new Set(lit)], false, true] : ['has', 'name']) as FilterSpecification;

const ROAD = ['all', ['in', ['get', 'class'], ['literal', [...MINOR, ...MAJOR]]], ['!=', ['get', 'brunnel'], 'tunnel']] as FilterSpecification;
/**
 * Major streets 11 m wide, service ones 5 m, the rest 7 m. The zoom goes outside: MapLibre takes
 * one zoom curve per expression.
 */
const roadWidth = (stops: number[][]) =>
  [
    'interpolate', ['exponential', 2], ['zoom'],
    ...stops.flatMap(([z, k, pen]) => [z, ['match', ['get', 'class'], MAJOR, 11 * k + pen, ['service', 'track'], 5 * k + pen, 7 * k + pen]]),
  ] as unknown as number;

/**
 * The basemap as a pen drawing on paper (OpenMapTiles schema from OpenFreeMap): houses, water and
 * parks in outline, streets as two pen lines with paper between. Under the wash it shows faintly
 * where you have not been, and in full where you have seen or walked; above it sit the landmarks
 * you have seen, district names and the names of your streets in their pencils. No icon sprite,
 * no glyph downloads: MapLibre draws the few labels itself, with the app's own two fonts (see
 * fontFaces).
 */
export function buildStyle(t: Theme): StyleSpecification {
  const m = t.map;
  const layers: LayerSpecification[] = [
    { id: 'background', type: 'background', paint: { 'background-color': m.paper } },
    {
      id: 'green', type: 'fill', source: 'omt', 'source-layer': 'landcover',
      filter: ['in', ['get', 'class'], ['literal', ['wood', 'grass', 'wetland', 'farmland']]],
      paint: { 'fill-color': m.park },
    },
    { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': m.park } },
    {
      id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water',
      filter: ['!=', ['get', 'brunnel'], 'tunnel'],
      paint: { 'fill-color': m.water },
    },
    {
      // The banks, in pen.
      id: 'water-edge', type: 'line', source: 'omt', 'source-layer': 'water', minzoom: 13,
      filter: ['!=', ['get', 'brunnel'], 'tunnel'],
      paint: {
        'line-color': m.ink,
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0.3, 16, 0.75],
        'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.5, 17, 1.2],
      },
    },
    {
      id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway',
      paint: {
        'line-color': m.ink,
        'line-opacity': 0.5,
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.4, 16, 1],
      },
    },
    {
      // Houses in outline, a hairline that fades in as they get big enough to draw.
      id: 'building', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 14,
      paint: {
        'fill-color': m.paper,
        'fill-outline-color': m.ink,
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, 0.55, 16.5, 1],
      },
    },
    {
      id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 13,
      filter: ['in', ['get', 'class'], ['literal', ['rail', 'transit']]],
      paint: { 'line-color': m.ink, 'line-opacity': inkOpacity(0.3), 'line-width': 0.8, 'line-dasharray': [5, 3] },
    },
    {
      // Every street's casing first, then every street's paper inside: crossings stay open.
      id: 'road-casing', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12,
      filter: ROAD,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': m.ink, 'line-opacity': inkOpacity(0.45), 'line-width': roadWidth(CASED) },
    },
    {
      id: 'road', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12,
      filter: ROAD,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': m.road, 'line-width': roadWidth(INSIDE) },
    },
    {
      // Footpaths and pedestrian streets: a dashed pen line.
      id: 'road-path', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 14,
      filter: ['all', ['in', ['get', 'class'], ['literal', PATHS]], ['!=', ['get', 'brunnel'], 'tunnel']],
      paint: {
        'line-color': m.ink,
        'line-opacity': inkOpacity(0.4),
        'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.6, 18, 1.2],
        'line-dasharray': [3, 2.2],
      },
    },
    {
      // Under the wash: faint where you have not been, in full where you have seen or walked,
      // except on streets your pencil already names (see moonNamesFilter).
      id: MOON_NAMES_LAYER, type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 15,
      filter: moonNamesFilter([]),
      layout: {
        'symbol-placement': 'line',
        // `name`, like the walked names (tileParse names the streets from it).
        'text-field': ['get', 'name'],
        'text-font': ['Medium', ...t.font.names],
        // Instrument Serif runs small for its size: a size up from the phone's serif.
        'text-size': ['interpolate', ['linear'], ['zoom'], 15, 12.5, 17, 14.5, 19, 17],
        'text-letter-spacing': 0.02,
        'text-max-angle': 28,
        // Placed like the walked names, so where both would show the walked one wins the spot.
        'text-offset': [0, -1.2],
        'symbol-spacing': 280,
        'text-padding': 8,
      },
      paint: {
        'text-color': m.name,
        'text-halo-color': m.paper,
        'text-halo-width': 1.6,
      },
    },

    // ---- The paper wash custom layer goes here (inserted before ABOVE_FOG_LAYER). ----

    {
      // Landmarks you have seen: a dot and the name under it. Important ones win the space.
      id: SEEN_PLACES_LAYER, type: 'symbol', source: SEEN_PLACES_SOURCE, minzoom: 15.5,
      layout: {
        'symbol-sort-key': ['get', 'rank'],
        'icon-image': LANDMARK_DOT,
        'text-field': ['get', 'name'],
        'text-font': ['Medium', ...t.font.places],
        'text-size': ['interpolate', ['linear'], ['zoom'], 16, 10.5, 19, 11.5],
        'text-anchor': 'top',
        'text-offset': [0, 0.45],
        'text-max-width': 8,
        'text-padding': 4,
        'icon-padding': 2,
      },
      paint: {
        'text-color': m.landmark,
        'text-halo-color': m.paper,
        'text-halo-width': 1.4,
      },
    },
    {
      id: 'place', type: 'symbol', source: 'omt', 'source-layer': 'place', maxzoom: 17,
      filter: ['in', ['get', 'class'], ['literal', ['city', 'town', 'village', 'suburb', 'quarter', 'neighbourhood']]],
      layout: {
        'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
        'text-font': ['Medium', ...t.font.places],
        'text-size': ['match', ['get', 'class'], 'city', 15, 'town', 13, 11],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.18,
        'text-max-width': 8,
        'text-padding': 12,
      },
      paint: {
        'text-color': m.place,
        'text-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.9, 16, 0.6],
        'text-halo-color': m.paper,
        'text-halo-width': 1.4,
      },
    },
    {
      id: NAMES_LAYER, type: 'symbol', source: NAMES_SOURCE, minzoom: 14.5,
      layout: {
        'symbol-placement': 'line',
        'text-field': ['get', 'n'],
        // The first entry only carries the weight of the phone's fallback serif (MapLibre reads it
        // from the first name); the shipped files carry their own.
        'text-font': ['Semibold', ...t.font.walked],
        'text-size': ['interpolate', ['linear'], ['zoom'], 15, 14, 17, 17, 19, 20],
        'text-letter-spacing': 0.02,
        'text-max-angle': 28,
        // Beside the street, not on it: the colored street stays whole and you never cover the name.
        'text-offset': [0, -1.25],
        'symbol-spacing': 280,
        'text-padding': 8,
      },
      paint: {
        // Each name in its street's pencil, pressed hard (names.ts).
        'text-color': ['coalesce', ['get', 'c'], m.ink],
        'text-halo-color': m.paper,
        'text-halo-width': 1.8,
      },
    },
  ];

  return {
    version: 8,
    'font-faces': fontFaces(),
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
