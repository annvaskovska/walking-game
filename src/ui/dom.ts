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
  locate: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor"/><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  walk: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="13" cy="4.5" r="2" fill="currentColor"/><path d="m9 21 2.5-6.5L14 17v4M7 12l2.5-4.5 4 1 2 3.5 3 1M11.5 14.5l1-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
