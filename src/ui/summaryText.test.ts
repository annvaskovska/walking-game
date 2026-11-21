import { describe, expect, it } from 'vitest';
import { newOnMap } from './summaryText';

const walk = (newStreets: string[], newPieces = newStreets.length * 4, distanceM = 1570) => ({
  distanceM,
  newPieces,
  newStreets,
});

describe('newOnMap', () => {
  it('names the new streets, then counts the houses', () => {
    expect(newOnMap(walk(['Damrak', 'Singel']), 11)).toEqual({
      names: 'Damrak, Singel',
      long: false,
      more: 'and 11 houses',
      empty: false,
    });
    expect(newOnMap(walk(['Damrak']), 1).more).toBe('and 1 house');
    expect(newOnMap(walk(['Damrak']), 0).more).toBe('');
  });

  it('names three streets at most and counts the rest', () => {
    const r = newOnMap(walk(['Damrak', 'Singel', 'Muntplein', 'Amstel', 'Rokin']), 4);
    expect(r.names).toBe('Damrak, Singel, Muntplein');
    expect(r.more).toBe('and 2 more streets and 4 houses');
    expect(newOnMap(walk(['A', 'B', 'C', 'D']), 0).more).toBe('and 1 more street');
  });

  it('sets long names a size down', () => {
    expect(newOnMap(walk(['Nieuwezijds Voorburgwal', 'Oudezijds Achterburgwal']), 0).long).toBe(true);
  });

  it('speaks of stretches when no new street was lit whole', () => {
    expect(newOnMap(walk([], 6), 3)).toEqual({ names: 'Stretches of street', long: false, more: 'and 3 houses', empty: false });
  });

  it('says why nothing lit up', () => {
    expect(newOnMap(walk([], 0, 20), 0)).toMatchObject({ names: null, empty: true, more: 'Walk along a street to light it.' });
    expect(newOnMap(walk([], 0, 900), 0)).toMatchObject({ names: null, empty: true, more: 'All of it was lit already. Try a new street next time.' });
  });
});
