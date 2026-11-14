import { describe, expect, it } from 'vitest';
import { estimateSteps, formatDistance, formatDuration, formatSteps } from './stats';

describe('estimateSteps', () => {
  it('divides distance by an average step of 0.75 m', () => {
    expect(estimateSteps(0)).toBe(0);
    expect(estimateSteps(750)).toBe(1000);
    expect(estimateSteps(1000)).toBe(1333);
  });

  it('never goes negative', () => {
    expect(estimateSteps(-5)).toBe(0);
  });
});

describe('formatting', () => {
  it('formats distances, durations and steps', () => {
    expect(formatDistance(420)).toBe('420 m');
    expect(formatDistance(2345)).toBe('2.35 km');
    expect(formatDistance(12_345)).toBe('12.3 km');
    expect(formatDuration(65_000)).toBe('01:05');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
    expect(formatSteps(12_480)).toBe('12,480');
  });
});
