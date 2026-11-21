import { describe, expect, it } from 'vitest';
import { distanceParts, estimateSteps, formatDistance, formatDuration, formatDurationWords, formatSteps } from './stats';

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

describe('summary formatting', () => {
  it('splits a distance into its number and unit', () => {
    expect(distanceParts(0)).toEqual({ value: '0', unit: 'm' });
    expect(distanceParts(429.4)).toEqual({ value: '429', unit: 'm' });
    expect(distanceParts(1570)).toEqual({ value: '1.57', unit: 'km' });
    expect(distanceParts(12_345)).toEqual({ value: '12.3', unit: 'km' });
  });

  it('says how long a walk took in words', () => {
    expect(formatDurationWords(0)).toBe('0 s');
    expect(formatDurationWords(45_900)).toBe('45 s');
    expect(formatDurationWords(60_000)).toBe('1 min');
    expect(formatDurationWords(496_000)).toBe('8 min');
    expect(formatDurationWords(3_600_000)).toBe('1 h');
    expect(formatDurationWords(4_688_000)).toBe('1 h 18 min');
  });
});
