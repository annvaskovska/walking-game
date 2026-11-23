/** Street names shown by name after a walk; the rest are counted. */
const MAX_NAMES = 3;
/** Under this distance (m) a walk with nothing new was too short to color anything in. */
const SHORT_WALK_M = 60;
/** Names longer than this, all together, are set a size down so they fit in two lines. */
const LONG_NAMES = 28;

export interface NewOnMap {
  /** The names line, or null when the walk colored in no named street. */
  names: string | null;
  /** Set the names a size down. */
  long: boolean;
  /** The quiet line under them, or under nothing when the walk colored in nothing new. */
  more: string;
  /** The walk colored in nothing new. */
  empty: boolean;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What a finished walk added to your map, in the words of the summary screen. */
export function newOnMap(
  walk: { distanceM: number; newPieces: number; newStreets: readonly string[] },
  newHouses: number,
): NewOnMap {
  const streets = walk.newStreets;
  const houses = newHouses > 0 ? plural(newHouses, 'house') : '';
  if (streets.length) {
    const names = streets.slice(0, MAX_NAMES).join(', ');
    const extra = streets.length - MAX_NAMES;
    const rest = [extra > 0 ? plural(extra, 'more street') : '', houses].filter(Boolean);
    return { names, long: names.length > LONG_NAMES, more: rest.length ? `and ${rest.join(' and ')}` : '', empty: false };
  }
  if (walk.newPieces > 0) return { names: 'Stretches of street', long: false, more: houses && `and ${houses}`, empty: false };
  if (houses) return { names: null, long: false, more: houses, empty: false };
  return {
    names: null,
    long: false,
    more:
      walk.distanceM < SHORT_WALK_M
        ? 'Walk along a street to color it in.'
        : 'All of it was colored in already. Try a new street next time.',
    empty: true,
  };
}
