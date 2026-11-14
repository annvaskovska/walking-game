export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Find every `data-ref` element under root. */
export function refs<T extends string>(root: HTMLElement, names: readonly T[]): Record<T, HTMLElement> {
  const out = {} as Record<T, HTMLElement>;
  for (const n of names) {
    const el = root.querySelector<HTMLElement>(`[data-ref="${n}"]`);
    if (!el) throw new Error(`Missing ref ${n}`);
    out[n] = el;
  }
  return out;
}

export const ICONS = {
  map: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 4v14M15 6v14" stroke="currentColor" stroke-width="1.8"/></svg>',
  stamp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4l-5.2 2.7 1-5.8L3.5 9.2l5.9-.9L12 3Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  you: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4.5 20c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  locate: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor"/><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  walk: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="13" cy="4.5" r="2" fill="currentColor"/><path d="m9 21 2.5-6.5L14 17v4M7 12l2.5-4.5 4 1 2 3.5 3 1M11.5 14.5l1-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
