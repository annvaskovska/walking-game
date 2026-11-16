import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import type { Theme } from '../theme';

/** Tiles come through this protocol, so the map and the street graph share one download each. */
export const TILE_PROTOCOL = 'wlt';

/** The fog is drawn right above the basemap; everything from here up stays readable over it. */
export const ABOVE_FOG_LAYER = 'ghost-path';
/** Gold names of lit streets. */
export const NAMES_SOURCE = 'lit-names';
export const NAMES_LAYER = 'lit-names';

export const ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
  '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> ' +
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>';

const MINOR = ['minor', 'service', 'track'];
const MAJOR = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'];
const PATHS = ['path', 'pedestrian'];

/** A width in metres on the ground, as pixels (about right for the latitudes of Europe). */
const metres = (m: number) =>
  ['interpolate', ['exponential', 2], ['zoom'], 12, m / 12.8, 16, m / 0.8, 20, m / 0.05] as unknown as number;

/**
 * The basemap at night (OpenMapTiles schema from OpenFreeMap). Under the fog it is only seen
 * where you have walked; above the fog sit faint hints of every street, district names and the
 * gold names of your streets. No road labels, no icons, no glyph downloads: MapLibre draws the
 * few labels with the phone's own fonts.
 */
export function buildStyle(t: Theme): StyleSpecification {
  const m = t.map;
  const layers: LayerSpecification[] = [
    { id: 'background', type: 'background', paint: { 'background-color': m.background } },
    {
      id: 'residential', type: 'fill', source: 'omt', 'source-layer': 'landuse',
      filter: ['in', ['get', 'class'], ['literal', ['residential', 'suburb', 'neighbourhood']]],
      paint: { 'fill-color': m.residential },
    },
    {
      id: 'wood', type: 'fill', source: 'omt', 'source-layer': 'landcover',
      filter: ['==', ['get', 'class'], 'wood'],
      paint: { 'fill-color': m.wood },
    },
    {
      id: 'grass', type: 'fill', source: 'omt', 'source-layer': 'landcover',
      filter: ['in', ['get', 'class'], ['literal', ['grass', 'wetland', 'farmland']]],
      paint: { 'fill-color': m.park },
    },
    { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': m.park } },
    {
      id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water',
      filter: ['!=', ['get', 'brunnel'], 'tunnel'],
      paint: { 'fill-color': m.water },
    },
    {
      id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway',
      paint: { 'line-color': m.waterway, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 16, 3] },
    },
    {
      id: 'building', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 13,
      paint: { 'fill-color': m.building, 'fill-outline-color': m.buildingEdge },
    },
    {
      id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 13,
      filter: ['in', ['get', 'class'], ['literal', ['rail', 'transit']]],
      paint: { 'line-color': m.rail, 'line-width': 1 },
    },
    {
      id: 'road-path', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 14,
      filter: ['all', ['in', ['get', 'class'], ['literal', PATHS]], ['!=', ['get', 'brunnel'], 'tunnel']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': m.path, 'line-width': metres(2.5) },
    },
    {
      id: 'road-minor', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12,
      filter: ['all', ['in', ['get', 'class'], ['literal', MINOR]], ['!=', ['get', 'brunnel'], 'tunnel']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': m.roadMinor, 'line-width': metres(7) },
    },
    {
      id: 'road-major', type: 'line', source: 'omt', 'source-layer': 'transportation',
      filter: ['all', ['in', ['get', 'class'], ['literal', MAJOR]], ['!=', ['get', 'brunnel'], 'tunnel']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': m.roadMajor, 'line-width': metres(11) },
    },

    // ---- The fog custom layer goes here (inserted before ABOVE_FOG_LAYER). ----

    {
      id: ABOVE_FOG_LAYER, type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 15,
      filter: ['all', ['in', ['get', 'class'], ['literal', PATHS]], ['!=', ['get', 'brunnel'], 'tunnel']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': m.ghost,
        'line-opacity': m.ghostPathOpacity,
        'line-width': ['interpolate', ['linear'], ['zoom'], 15, 0.6, 19, 1.6],
        'line-dasharray': [2, 2.5],
      },
    },
    {
      id: 'ghost-road', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 11,
      filter: ['all', ['in', ['get', 'class'], ['literal', [...MINOR, ...MAJOR]]], ['!=', ['get', 'brunnel'], 'tunnel']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': m.ghost,
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, m.ghostRoadOpacity * 0.6, 15, m.ghostRoadOpacity],
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          11, ['match', ['get', 'class'], MAJOR, 0.8, 0.3],
          15, ['match', ['get', 'class'], MAJOR, 1.6, 0.9],
          19, ['match', ['get', 'class'], MAJOR, 3, 2],
        ],
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
        'text-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.75, 16, 0.45],
        'text-halo-color': m.placeHalo,
        'text-halo-width': 1.2,
      },
    },
    {
      id: NAMES_LAYER, type: 'symbol', source: NAMES_SOURCE, minzoom: 14.5,
      layout: {
        'symbol-placement': 'line',
        'text-field': ['get', 'n'],
        // The first entry only carries the weight: MapLibre reads it from the first name.
        'text-font': ['Semibold', ...t.font.names],
        'text-size': ['interpolate', ['linear'], ['zoom'], 15, 12, 17, 14.5, 19, 17],
        'text-letter-spacing': 0.04,
        'text-max-angle': 28,
        // Beside the street, not on it: the gold line stays whole and you never cover the name.
        'text-offset': [0, -1.25],
        'symbol-spacing': 280,
        'text-padding': 8,
      },
      paint: {
        'text-color': m.name,
        'text-halo-color': m.nameHalo,
        'text-halo-width': 1.6,
        'text-halo-blur': 0.6,
      },
    },
  ];

  return {
    version: 8,
    sources: {
      omt: {
        type: 'vector',
        tiles: [`${TILE_PROTOCOL}://{z}/{x}/{y}`],
        minzoom: 0,
        maxzoom: 14,
        attribution: ATTRIBUTION,
      },
      [NAMES_SOURCE]: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers,
  };
}
