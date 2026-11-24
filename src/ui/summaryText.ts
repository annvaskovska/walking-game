/** Street names shown by name after a walk; the rest are counted. */
const MAX_NAMES = 3;
/** Under this distance (m) a walk with nothing new was too short to color anything in. */
const SHORT_WALK_M = 60;

export interface NewOnMap {
  /** The heading on the fridge, its first word on a line of its own: "Wow, 6 streets!". */
  head: string;
  /** Up to three new streets by name, or the stretches of street the walk colored in. */
  names: string[];
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
    const extra = streets.length - MAX_NAMES;
    const rest = [extra > 0 ? plural(extra, 'more street') : '', houses].filter(Boolean);
    return {
      head: `Wow, ${plural(streets.length, 'street')}!`,
      names: streets.slice(0, MAX_NAMES),
      more: rest.length ? `and ${rest.join(' and ')}` : '',
      empty: false,
    };
  }
  if (walk.newPieces > 0) {
    return { head: 'Wow, more color!', names: ['Stretches of street'], more: houses && `and ${houses}`, empty: false };
  }
  if (houses) return { head: `Wow, ${houses}!`, names: [], more: houses, empty: false };
  return {
    head: 'Nice walk!',
    names: [],
    more:
      walk.distanceM < SHORT_WALK_M
        ? 'Walk along a street to color it in.'
        : 'All of it was colored in already. Try a new street next time.',
    empty: true,
  };
}
