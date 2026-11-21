/**
 * The night look of the map: the basemap, the fog, lit streets and houses, and you. The splash
 * and HUD read the same palette as CSS custom properties from the inline style in index.html,
 * which has to paint before any script loads; keep the two in step.
 */
export interface Theme {
  font: {
    /** Gold street names: a book serif from the system, so no font is downloaded. */
    names: string[];
    /** Faint district names. */
    places: string[];
  };
  map: {
    background: string;
    residential: string;
    park: string;
    wood: string;
    water: string;
    waterway: string;
    building: string;
    buildingEdge: string;
    roadMinor: string;
    roadMajor: string;
    path: string;
    rail: string;
    /** Every street, drawn faintly over the fog so you can see where you could go. */
    ghost: string;
    ghostRoadOpacity: number;
    ghostPathOpacity: number;
    place: string;
    placeHalo: string;
    name: string;
    nameHalo: string;
    /** Street names you have seen but not walked: under the fog, in moonlight. */
    moonName: string;
    /** Shops, cafés and other landmarks you have seen, labelled over the fog. */
    landmark: string;
    landmarkHalo: string;
  };
  fog: {
    color: string;
    opacity: number;
    /** Slow drifting mist inside the fog. */
    mist: string;
    /** Warm glow along the edge of the cleared corridors. */
    rim: string;
    /** Warm light of your lantern. */
    lamp: string;
    /** Your beam of sight, lighting the mist ahead of you. */
    beam: string;
    /** The wave that runs along a street the moment it unlocks. */
    flash: string;
    /** Thin gold line along the middle of a lit street. */
    street: string;
    /** Half-width of the clear corridor around a lit street / path, ground metres. */
    roadM: number;
    pathM: number;
    /** Soft clear halo around a lit house, metres. */
    houseM: number;
    /** Your lantern: a clear disc around you, and a cone of sight ahead while you move. */
    lanternM: number;
    coneM: number;
    /** Outer half-angle of the cone (where it has faded out) and inner one (full strength). */
    coneHalfDeg: number;
    coneInnerDeg: number;
    /**
     * Light stops at walls. Size of the lantern as a light source (m): the bigger, the softer the
     * edge of a shadow, which widens with distance behind the wall.
     */
    lampRadiusM: number;
    /** Speed of the unlock wave along a street, m/s. */
    sweepMps: number;
  };
  /** What you have seen but not walked: it stays moonlit for good. */
  seen: {
    /** Cool light laid over the seen part of the map. */
    moon: string;
    /** Share of the fog a fully seen spot clears, 0..1 (walked streets clear all of it). */
    clear: number;
    /** Strength of the moonlight added over a seen spot. */
    tint: number;
    /** A house you have seen: dim blue roof and a moonlit outline. */
    fill: string;
    edge: string;
    fillOpacity: number;
    edgeOpacity: number;
    /** Warm light on the walls that face your lantern right now. */
    facade: string;
    /**
     * How far sight is remembered (m): in the beam ahead of you, and all around you. Houses and
     * landmarks hit by your sight within this reach become seen.
     */
    beamM: number;
    aroundM: number;
  };
  house: {
    fill: string;
    edge: string;
    /** Window lights, from warm to pale. */
    windowWarm: string;
    windowPale: string;
  };
  puck: {
    core: string;
    ring: string;
    glow: string;
  };
}

export const nightTheme: Theme = {
  font: {
    names: ['ui-serif', 'New York', 'Iowan Old Style', 'Georgia', 'Noto Serif', 'serif'],
    places: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
  },
  map: {
    background: '#0f1218',
    residential: '#11151c',
    park: '#111a16',
    wood: '#101915',
    water: '#0b1622',
    waterway: '#0e1b29',
    building: '#1a1e27',
    buildingEdge: '#20252f',
    roadMinor: '#262b36',
    roadMajor: '#2f3542',
    path: '#232833',
    rail: '#1f232c',
    ghost: '#c9d3e6',
    // Fainter than before line of sight: what you have seen now shows the streets for real.
    ghostRoadOpacity: 0.08,
    ghostPathOpacity: 0.045,
    place: '#8a94a8',
    placeHalo: '#0b0d12',
    name: '#f0c987',
    nameHalo: '#120d06',
    moonName: '#b4c3e0',
    landmark: '#d9c7a6',
    landmarkHalo: '#0b0d12',
  },
  fog: {
    color: '#0b0d12',
    opacity: 0.94,
    mist: '#161b26',
    rim: '#ffb46b',
    lamp: '#ffe3b8',
    beam: '#ffc98e',
    flash: '#fff3d6',
    street: '#e8b56e',
    roadM: 17,
    pathM: 11,
    houseM: 7,
    lanternM: 40,
    coneM: 110,
    coneHalfDeg: 38,
    coneInnerDeg: 19,
    lampRadiusM: 1.5,
    sweepMps: 50,
  },
  seen: {
    moon: '#9db4e0',
    clear: 0.58,
    tint: 0.09,
    fill: '#1c2230',
    edge: '#4e5b76',
    fillOpacity: 0.92,
    edgeOpacity: 0.85,
    facade: '#ffc98e',
    beamM: 88,
    aroundM: 37,
  },
  house: {
    fill: '#2b2117',
    edge: '#c98d4f',
    windowWarm: '#ffd9a0',
    windowPale: '#ffeacc',
  },
  puck: {
    core: '#fff6e6',
    ring: '#ffb46b',
    glow: '#ffcf8a',
  },
};
