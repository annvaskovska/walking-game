/**
 * Mr Sparkles and his crayons as SVG markup (ADR 0014), drawn as in the design. His wax and press
 * colors come from the CSS custom properties `--wax` and `--press` on an ancestor (setWax).
 */
import type { Pencil } from '../theme';

/**
 * Mr Sparkles: a stubby, well-used crayon in a viewBox of 0 0 60 100, his tip at (30, 96). He
 * wears down as you walk: `wear` 1 is new; his body is max(24, 50 × wear) tall.
 */
export function mrInner(wear: number, waving = false, shadow = false): string {
  const H = Math.max(24, 50 * wear), yt = 75 - H, fy = yt + H * 0.52 + 1;
  const zig = H > 31 ? `<path d="M20 ${yt + 11} l2.5 -1.6 2.5 1.6 2.5 -1.6 2.5 1.6 2.5 -1.6 2.5 1.6 2.5 -1.6 2.5 1.6" fill="none" stroke-width="1.2"/>` : '';
  const low = H > 34 ? '<path d="M20 69 H40" stroke-width="1.3"/>' : '';
  return (shadow ? '<ellipse cx="30" cy="97" rx="11" ry="2.6" fill="#000" opacity=".14"/>' : '') +
    `<g stroke="#000" stroke-width="2.1" stroke-linejoin="round" stroke-linecap="round">
      <path d="M21 ${fy + 6} Q14 ${fy + 8} 11.6 ${fy + 2}" fill="none"/>
      <circle cx="11" cy="${fy + 1}" r="2.5" fill="#fff"/>
      <g class="${waving ? 'arm-wave' : ''}"><path d="M39 ${fy + 5} Q46 ${fy + 3} 47.6 ${fy - 4}" fill="none"/><circle cx="48" cy="${fy - 5.2}" r="2.5" fill="#fff"/></g>
      <path d="M20.5 79 L26.8 94.4 Q30.4 96.6 33.8 95.2 L39.5 79 Z" style="fill:var(--wax)"/>
      <rect x="20" y="72" width="20" height="7" style="fill:var(--wax)"/>
      <path d="M20 ${yt} H40 V74.5 l-2.5 2.2 -2.9 -2.1 -2.9 2.3 -2.9 -2.1 -2.9 2.3 -2.9 -2.1 L20 75.6 Z" fill="#fff"/>
      <path d="M20 ${yt + 3.5} H40 V${yt + 8.5} H20 Z" style="fill:var(--wax)" stroke-width="1.5"/>
      ${zig}${low}
      <ellipse cx="30" cy="${yt}" rx="10" ry="3" style="fill:var(--press)"/>
    </g>
    <ellipse cx="25.6" cy="${fy}" rx="2.1" ry="3" fill="#000"/><ellipse cx="34.4" cy="${fy}" rx="2.1" ry="3" fill="#000"/>
    <circle cx="26.3" cy="${fy - 1.1}" r=".8" fill="#fff"/><circle cx="35.1" cy="${fy - 1.1}" r=".8" fill="#fff"/>
    <ellipse cx="22.4" cy="${fy + 4}" rx="1.9" ry="1.1" fill="#ff8fb3"/><ellipse cx="37.6" cy="${fy + 4}" rx="1.9" ry="1.1" fill="#ff8fb3"/>
    <path d="M26.4 ${fy + 4.2} Q30 ${fy + 9.4} 33.6 ${fy + 4.2} Z" fill="#000" stroke="#000" stroke-width="1" stroke-linejoin="round"/>
    <path d="M28.2 ${fy + 6.6} Q30 ${fy + 5.6} 31.8 ${fy + 6.6} Q30 ${fy + 8.3} 28.2 ${fy + 6.6} Z" fill="#ff6f91"/>`;
}

/** Mr Sparkles as a standalone SVG document in his crayon, e.g. to rasterize into a texture. */
export function mrDocument(wear: number, c: Pencil, w: number, h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 100" width="${w}" height="${h}" style="--wax:${c.lay};--press:${c.press}" overflow="visible">${mrInner(wear)}</svg>`;
}

/** A crayon `len` units long (62 is new, shorter is worn down), drawn `w` px wide. */
export function crayonSVG(c: Pencil, w = 13, len = 62): string {
  return `<svg viewBox="0 0 13 ${len}" width="${w}" height="${((w * len) / 13).toFixed(1)}" aria-hidden="true"><g stroke="#000" stroke-width="1.3" stroke-linejoin="round">
    <path d="M2 13 L5.2 2.4 Q6.5 1 7.8 2.4 L11 13 Z" fill="${c.lay}"/><rect x="1" y="12.5" width="11" height="${len - 13.2}" fill="${c.lay}"/>
    <path d="M1 19 H12 M1 22.5 H12${len > 44 ? ` M1 ${len - 9} H12` : ''}" stroke-width="1"/>
    ${len > 34 ? '<path d="M1 28 l2.75 -1.8 2.75 1.8 2.75 -1.8 2.75 1.8" fill="none" stroke-width=".9"/>' : ''}</g></svg>`;
}

/** Gives an element (and the Mr Sparkles inside it) a crayon. */
export function setWax(el: HTMLElement | SVGElement, c: Pencil): void {
  el.style.setProperty('--wax', c.lay);
  el.style.setProperty('--press', c.press);
}

/** How worn he is after `distanceM` of a walk: 1 − 0.42 × progress over 5 km, in steps of 1/40. */
export function wearAfter(distanceM: number): number {
  return Math.round((1 - 0.42 * Math.min(1, distanceM / 5000)) * 40) / 40;
}
