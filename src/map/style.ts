import type { StyleSpecification, LayerSpecification } from 'maplibre-gl';
import type { Theme } from '../theme';

export const TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
export const GLYPHS_URL = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

/** Layer id the lit-street glow is inserted under, so labels stay on top. */
export const FIRST_LABEL_LAYER = 'waterway-label';

const minor = ['minor', 'service', 'track', 'raceway', 'busway'];
const major = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'];

/** The basemap (OpenMapTiles schema from OpenFreeMap), coloured from the theme. */
export function buildStyle(t: Theme): StyleSpecification {
  const m = t.map;
  const roadWidth = (base: number) => [
    'interpolate', ['exponential', 1.6], ['zoom'],
    12, base * 0.5, 15, base * 2, 18, base * 9,
  ] as unknown as number;

  const layers: LayerSpecification[] = [
    { id: 'background', type: 'background', paint: { 'background-color': m.background } },
    {
      id: 'landuse-residential', type: 'fill', source: 'omt', 'source-layer': 'landuse',
      filter: ['in', ['get', 'class'], ['literal', ['residential', 'suburb', 'neighbourhood']]],
      paint: { 'fill-color': m.residential },
    },
    {
      id: 'landcover-wood', type: 'fill', source: 'omt', 'source-layer': 'landcover',
      filter: ['==', ['get', 'class'], 'wood'],
      paint: { 'fill-color': m.wood },
    },
    {
      id: 'landcover-park', type: 'fill', source: 'omt', 'source-layer': 'landcover',
      filter: ['in', ['get', 'class'], ['literal', ['grass', 'wetland', 'farmland']]],
      paint: { 'fill-color': m.park, 'fill-opacity': 0.8 },
    },
    {
      id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park',
      paint: { 'fill-color': m.park },
    },
    {
      id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water',
      filter: ['!=', ['get', 'brunnel'], 'tunnel'],
      paint: { 'fill-color': m.water },
    },
    {
      id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway',
      paint: {
        'line-color': m.waterway,
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 16, 3],
      },
    },
    {
      id: 'building', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 13,
      paint: { 'fill-color': m.building, 'fill-outline-color': m.buildingEdge },
    },
    {
      id: 'road-path', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 13,
      filter: ['in', ['get', 'class'], ['literal', ['path', 'pedestrian']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': m.roadPath,
        'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.5, 18, 3],
        'line-dasharray': [2, 1.5],
      },
    },
    {
      id: 'road-casing', type: 'line', source: 'omt', 'source-layer': 'transportation',
      filter: ['in', ['get', 'class'], ['literal', [...minor, ...major]]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': m.roadCasing, 'line-width': roadWidth(1.4), 'line-gap-width': 0 },
    },
    {
      id: 'road-minor', type: 'line', source: 'omt', 'source-layer': 'transportation',
      filter: ['in', ['get', 'class'], ['literal', minor]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': m.roadMinor, 'line-width': roadWidth(1) },
    },
    {
      id: 'road-major', type: 'line', source: 'omt', 'source-layer': 'transportation',
      filter: ['in', ['get', 'class'], ['literal', major]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': m.roadMajor, 'line-width': roadWidth(1.5) },
    },
    {
      id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation',
      filter: ['in', ['get', 'class'], ['literal', ['rail', 'transit']]],
      paint: { 'line-color': m.rail, 'line-width': 1, 'line-dasharray': [3, 3] },
    },
    {
      id: FIRST_LABEL_LAYER, type: 'symbol', source: 'omt', 'source-layer': 'water_name', minzoom: 13,
      layout: {
        'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
        'text-font': t.font.map,
        'text-size': 11,
        'symbol-placement': 'point',
      },
      paint: { 'text-color': m.waterway, 'text-halo-color': m.labelHalo, 'text-halo-width': 1 },
    },
    {
      id: 'road-label', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 14,
      layout: {
        'symbol-placement': 'line',
        'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
        'text-font': t.font.map,
        'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10, 18, 14],
        'text-max-angle': 30,
      },
      paint: { 'text-color': m.label, 'text-halo-color': m.labelHalo, 'text-halo-width': 1.4 },
    },
    {
      id: 'park-label', type: 'symbol', source: 'omt', 'source-layer': 'park', minzoom: 14,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': t.font.map,
        'text-size': 12,
      },
      paint: { 'text-color': m.label, 'text-halo-color': m.labelHalo, 'text-halo-width': 1.2 },
    },
    {
      id: 'place-label', type: 'symbol', source: 'omt', 'source-layer': 'place',
      filter: ['in', ['get', 'class'], ['literal', ['city', 'town', 'village', 'suburb', 'quarter', 'neighbourhood']]],
      layout: {
        'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
        'text-font': t.font.mapBold,
        'text-size': ['match', ['get', 'class'], 'city', 18, 'town', 15, 13],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.08,
      },
      paint: { 'text-color': m.placeLabel, 'text-halo-color': m.labelHalo, 'text-halo-width': 1.6 },
    },
  ];

  return {
    version: 8,
    glyphs: GLYPHS_URL,
    sources: {
      omt: {
        type: 'vector',
        url: TILEJSON_URL,
        attribution:
          '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> ' +
          '<a href="https://www.openmaptiles.org/" target="_blank">© OpenMapTiles</a> ' +
          '<a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap</a>',
      },
    },
    layers,
  };
}
