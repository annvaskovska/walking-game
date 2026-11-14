import { CONFIG } from '../config';

/**
 * Steps estimated from distance. Phones' browsers can't read the step counter, so this divides the
 * GPS distance by an average adult step length. Shown as an estimate, never as a count.
 */
export function estimateSteps(distanceM: number): number {
  return Math.max(0, Math.round(distanceM / CONFIG.stepLengthM));
}

export function formatSteps(steps: number): string {
  return steps.toLocaleString('en-US');
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 2 : 1)} km`;
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
