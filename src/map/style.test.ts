import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { paperTheme } from '../theme';
import { buildStyle } from './style';

describe('buildStyle', () => {
  it('builds a style MapLibre takes', () => {
    // The font faces resolve against the page.
    (globalThis as { location?: unknown }).location ??= { href: 'https://example.org/' };
    expect(validateStyleMin(buildStyle(paperTheme)).map((e) => e.message)).toEqual([]);
  });
});
