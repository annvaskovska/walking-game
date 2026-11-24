import { describe, expect, it } from 'vitest';
import { newOnMap } from './summaryText';

const walk = (newStreets: string[], newPieces = newStreets.length * 4, distanceM = 1570) => ({
  distanceM,
  newPieces,
  newStreets,
});

describe('newOnMap', () => {
  it('cheers the new streets, names them, then counts the houses', () => {
    expect(newOnMap(walk(['Damrak', 'Singel']), 11)).toEqual({
      head: 'Wow, 2 streets!',
      names: ['Damrak', 'Singel'],
      more: 'and 11 houses',
      empty: false,
    });
    expect(newOnMap(walk(['Damrak']), 1)).toMatchObject({ head: 'Wow, 1 street!', more: 'and 1 house' });
    expect(newOnMap(walk(['Damrak']), 0).more).toBe('');
  });

  it('names three streets at most and counts the rest', () => {
    const r = newOnMap(walk(['Damrak', 'Singel', 'Muntplein', 'Amstel', 'Rokin']), 4);
    expect(r.head).toBe('Wow, 5 streets!');
    expect(r.names).toEqual(['Damrak', 'Singel', 'Muntplein']);
    expect(r.more).toBe('and 2 more streets and 4 houses');
    expect(newOnMap(walk(['A', 'B', 'C', 'D']), 0).more).toBe('and 1 more street');
  });

  it('speaks of stretches when no new street was colored in whole', () => {
    expect(newOnMap(walk([], 6), 3)).toEqual({ head: 'Wow, more color!', names: ['Stretches of street'], more: 'and 3 houses', empty: false });
  });

  it('counts the houses when only houses were colored in', () => {
    expect(newOnMap(walk([], 0), 2)).toEqual({ head: 'Wow, 2 houses!', names: [], more: '2 houses', empty: false });
  });

  it('says why nothing was colored in', () => {
    expect(newOnMap(walk([], 0, 20), 0)).toMatchObject({ head: 'Nice walk!', names: [], empty: true, more: 'Walk along a street to color it in.' });
    expect(newOnMap(walk([], 0, 900), 0)).toMatchObject({ empty: true, more: 'All of it was colored in already. Try a new street next time.' });
  });
});
