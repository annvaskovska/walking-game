import { CONFIG } from '../config';

/**
 * Steps estimated from distance. Phones' browsers can't read the step counter, so this divides the
 * GPS distance by an average adult step length: an estimate, not a pedometer count.
 */
export function estimateSteps(distanceM: number): number {
  return Math.max(0, Math.round(distanceM / CONFIG.stepLengthM));
}

export function formatSteps(steps: number): string {
  return steps.toLocaleString('en-US');
}

/** A distance as its number and its unit, so the summary can set them apart. */
export function distanceParts(m: number): { value: string; unit: 'm' | 'km' } {
  if (m < 1000) return { value: String(Math.max(0, Math.round(m))), unit: 'm' };
  return { value: (m / 1000).toFixed(m < 10_000 ? 2 : 1), unit: 'km' };
}

export function formatDistance(m: number): string {
  const { value, unit } = distanceParts(m);
  return `${value} ${unit}`;
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** How long a walk took, in words: "45 s", "8 min", "1 h 18 min". */
export function formatDurationWords(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}
