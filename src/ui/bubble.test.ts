import { describe, expect, it } from 'vitest';
import { placeLine, streetLine } from './bubble';

describe('what Mr Sparkles says', () => {
  it('greets the first street, spots bridges, and takes the other lines in turn', () => {
    expect(streetLine('Prinsengracht', 0)).toBe('Here we go! First street.');
    expect(streetLine('Leliesluis', 4)).toBe('A bridge! Colored in.');
    expect(streetLine('Torensbrug', 2)).toBe('A bridge! Colored in.');
    expect(streetLine('Bloemgracht', 1)).toBe("That one's ours for good.");
    expect(streetLine('Bloemgracht', 5)).toBe('Colored in!');
  });

  it('has a line for each kind of place, and one for the rest', () => {
    expect(placeLine({ name: 'Café Kalkhoven', cls: 'cafe' })).toBe('Café Kalkhoven. Coffee later?');
    expect(placeLine({ name: 'Anne Frank Huis', cls: 'museum' })).toBe('Art! Anne Frank Huis.');
    expect(placeLine({ name: 'Westertoren', cls: 'attraction' })).toBe('Look, Westertoren!');
    expect(placeLine({ name: 'Albert Heijn', cls: 'grocery' })).toBe('Spotted: Albert Heijn.');
  });
});
