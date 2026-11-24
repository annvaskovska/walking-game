/**
 * Mr Sparkles' face and arms for each moment of a walk (ADR 0014), as the emoji-eyes design draws
 * them: big eyes on his tip while he colors, stars for a new street, hearts for a landmark he names,
 * a blink and a look around when you stand still and then sleep, spinning eyes when you tap him.
 * Marks are in his 60 × 100 units; the same marks become SVG (art.ts) and a canvas (puckLayer.ts).
 */

/** One mark: an SVG path, filled and/or stroked in black `line` units wide, turned [degrees, x, y]. */
export interface Mark {
  d: string;
  fill?: string;
  line?: number;
  turn?: [number, number, number];
}

export type MomentKind = 'color' | 'still' | 'claim' | 'spot' | 'tap';

export interface Moment {
  kind: MomentKind;
  /** Seconds since the moment began (for `still`: since he stopped, or was last tapped). */
  t: number;
  /** Seconds on any clock, for what spins. */
  now: number;
  /** His eye line: faceY(wear). */
  fy: number;
  /** Where his tip is in its stroke, −1 (left) to 1 (right). */
  sx: number;
  /** Toward a finger near him, about −1..1, or null. */
  look: { x: number; y: number } | null;
  /** Reduced motion: shapes change, nothing pulses, spins or waves. */
  calm: boolean;
}

export interface Pose {
  /** Drawn behind his body. */
  arms: Mark[];
  /** Drawn over it. */
  face: Mark[];
  /** Asleep: a Zzz floats up from his head (bubble.ts). */
  asleep: boolean;
}

/** How long each moment shows (s); standing still, he falls asleep after SLEEP_S. */
export const CLAIM_S = 1.9;
export const SPOT_S = 2.3;
export const TAP_S = 1.4;
const SLEEP_S = 4.6;

const EL = 25.6, ER = 34.4;
const PINK = '#ff8fb3', TONGUE = '#ff6f91';
const f = (n: number) => +n.toFixed(2);

/** His eye line for a wear (mrInner): his body is max(24, 50 × wear) tall. */
export function faceY(wear: number): number {
  const H = Math.max(24, 50 * wear);
  return 75 - H + H * 0.52 + 1;
}

const ellipse = (cx: number, cy: number, rx: number, ry: number, fill: string, line?: number): Mark => ({
  d: `M${f(cx - rx)} ${f(cy)}a${f(rx)} ${f(ry)} 0 1 0 ${f(2 * rx)} 0a${f(rx)} ${f(ry)} 0 1 0 ${f(-2 * rx)} 0Z`,
  fill,
  line,
});
const stroke = (d: string, line = 1.3): Mark => ({ d, line });

type Look = { x: number; y: number };
const dot = (x: number, y: number, l: Look, rx = 2.1, ry = 3): Mark[] => [
  ellipse(x + l.x, y + l.y, rx, ry, '#000'),
  ...(ry > 1.4 ? [ellipse(x + l.x + rx / 3, y + l.y - ry * 0.37, rx * 0.38, rx * 0.38, '#fff')] : []),
];
const lid = (x: number, y: number, curve = 1.6) => stroke(`M${f(x - 2.3)} ${f(y)}Q${x} ${f(y + curve)} ${f(x + 2.3)} ${f(y)}`);
/** Half-shut: open `h` units below a flat lid. */
const half = (x: number, fy: number, h: number): Mark[] => [
  { d: `M${f(x - 2.2)} ${f(fy + 0.6)}H${f(x + 2.2)}A2.2 ${f(h)} 0 0 1 ${f(x - 2.2)} ${f(fy + 0.6)}Z`, fill: '#000' },
  stroke(`M${f(x - 2.6)} ${f(fy + 0.6)}H${f(x + 2.6)}`),
];
const blush = (fy: number, s = 1) => [ellipse(22.4, fy + 4, 1.9 * s, 1.1 * s, PINK), ellipse(37.6, fy + 4, 1.9 * s, 1.1 * s, PINK)];
const smile = (fy: number): Mark[] => [
  { d: `M26.4 ${f(fy + 4.2)}Q30 ${f(fy + 9.4)} 33.6 ${f(fy + 4.2)}Z`, fill: '#000', line: 1 },
  { d: `M28.2 ${f(fy + 6.6)}Q30 ${f(fy + 5.6)} 31.8 ${f(fy + 6.6)}Q30 ${f(fy + 8.3)} 28.2 ${f(fy + 6.6)}Z`, fill: TONGUE },
];
const grin = (fy: number): Mark[] => [
  { d: `M25.4 ${f(fy + 3.4)}Q30 ${f(fy + 12.8)} 34.6 ${f(fy + 3.4)}Z`, fill: '#000', line: 1 },
  ellipse(30, fy + 6.8, 2.3, 1.2, TONGUE),
];
const oh = (fy: number, r = 1) => ellipse(30, fy + 6.4, 1.4 * r, 1.9 * r, '#000');
const wobble = (fy: number, ph: number) =>
  stroke(`M26.2 ${f(fy + 6)}${[0, 1, 2, 3].map((i) => `q.95 ${f(-1.3 * Math.sin(ph + i))} 1.9 0`).join('')}`);
function star(x: number, y: number, r: number, rot: number): Mark {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const a = rot + (i * Math.PI) / 5 - Math.PI / 2, q = i % 2 ? r * 0.45 : r;
    d += `${i ? 'L' : 'M'}${f(x + q * Math.cos(a))} ${f(y + q * Math.sin(a))}`;
  }
  return { d: d + 'Z', fill: '#ffd02e', line: 1 };
}
const heart = (x: number, y: number, s: number): Mark => ({
  d: `M${x} ${f(y + 2.6 * s)}C${f(x - 4.4 * s)} ${f(y - 0.4 * s)} ${f(x - 2.4 * s)} ${f(y - 3.6 * s)} ${x} ${f(y - 1.4 * s)}` +
    `C${f(x + 2.4 * s)} ${f(y - 3.6 * s)} ${f(x + 4.4 * s)} ${f(y - 0.4 * s)} ${x} ${f(y + 2.6 * s)}Z`,
  fill: '#ff5a6e',
  line: 1,
});
function spiral(x: number, y: number, rot: number): Mark[] {
  let d = '';
  for (let i = 0; i <= 24; i++) {
    const t = i / 24, a = rot + t * Math.PI * 3.6, r = 0.4 + 2.8 * t;
    d += `${i ? 'L' : 'M'}${f(x + r * Math.cos(a))} ${f(y + r * Math.sin(a))}`;
  }
  return [ellipse(x, y, 3.4, 3.4, '#fff', 0.9), stroke(d, 0.85)];
}
/** His arms: the right one turned `wave` degrees about his shoulder, the left one `lift`. */
function arms(fy: number, wave = 0, lift = 0): Mark[] {
  const turn = (a: number, x: number, y: number): [number, number, number] | undefined => (a ? [f(a), x, f(y)] : undefined);
  const l = turn(lift, 21, fy + 6), r = turn(wave, 39, fy + 5);
  return [
    { ...stroke(`M21 ${f(fy + 6)}Q14 ${f(fy + 8)} 11.6 ${f(fy + 2)}`, 2.1), turn: l },
    { ...ellipse(11, fy + 1, 2.5, 2.5, '#fff', 2.1), turn: l },
    { ...stroke(`M39 ${f(fy + 5)}Q46 ${f(fy + 3)} 47.6 ${f(fy - 4)}`, 2.1), turn: r },
    { ...ellipse(48, fy - 5.2, 2.5, 2.5, '#fff', 2.1), turn: r },
  ];
}

/** Blinks now and then: 0 open, 1 shut. */
const blinkAt = (t: number, every = 2.9) => {
  const u = t % every;
  return u > every - 0.16 ? Math.sin(((u - every + 0.16) / 0.16) * Math.PI) : 0;
};
/** Standing still, he looks around: left, right, then back at you. */
const idleLook = (t: number): Look => ({ x: t > 2.2 && t < 3.3 ? -0.9 : t > 3.3 && t < 4.4 ? 0.9 : 0, y: 0 });

/** His face and arms at a moment. */
export function poseAt(m: Moment): Pose {
  const { kind, t, fy, look } = m;
  const sin = (x: number) => (m.calm ? 0 : Math.sin(x));
  const pose = (a: Mark[], face: Mark[], asleep = false): Pose => ({ arms: a, face, asleep });
  if (kind === 'tap') {
    const r = m.calm ? 0 : m.now * 9;
    return pose(arms(fy, -10 * sin(t * 20), 8 * sin(t * 20)), [...spiral(EL, fy, r), ...spiral(ER, fy, r + 1.3), ...blush(fy, 1.2), wobble(fy, m.calm ? 0 : m.now * 14)]);
  }
  if (kind === 'claim') {
    const r = 3.6 * (1 + 0.18 * sin(t * 12)) * Math.min(1, t / 0.2), a = m.calm ? 0 : t * 2;
    return pose(arms(fy, -20 + 14 * sin(t * 16), -6), [star(EL, fy, r, a), star(ER, fy, r, -a), ...blush(fy, 1.3), ...grin(fy)]);
  }
  if (kind === 'spot') {
    const s = (0.92 + 0.16 * Math.abs(sin(t * 7))) * Math.min(1, t / 0.18);
    return pose(arms(fy, -8), [heart(EL, fy, s), heart(ER, fy, s), ...blush(fy, 1.2), oh(fy)]);
  }
  if (kind === 'still') {
    if (!look && t > SLEEP_S) {
      const k = Math.min(1, (t - SLEEP_S) / 0.6);
      const eyes = k < 1 ? [...half(EL, fy, 2.8 * (1 - k) + 0.3), ...half(ER, fy, 2.8 * (1 - k) + 0.3)] : [lid(EL, fy + 0.6, 1.4), lid(ER, fy + 0.6, 1.4)];
      return pose(arms(fy), [...eyes, ...blush(fy), oh(fy, 0.55 + 0.1 * sin(t * 3))], t > SLEEP_S + 0.6);
    }
    const b = blinkAt(t), l = look ?? idleLook(t);
    const eyes = b > 0.5 ? [lid(EL, fy), lid(ER, fy)] : [...dot(EL, fy, l, 2.1, 3 - 2 * b), ...dot(ER, fy, l, 2.1, 3 - 2 * b)];
    return pose(arms(fy), [...eyes, ...blush(fy), ...smile(fy)]);
  }
  // Coloring: wide eyes on his tip, following each stroke.
  const l = look ?? { x: 0.8 * m.sx, y: 0.8 };
  return pose(arms(fy), [...dot(EL, fy, l, 2.3, 3.2), ...dot(ER, fy, l, 2.3, 3.2), ...blush(fy), ...smile(fy)]);
}

/** His face at rest (the cover, the fridge): looking at you, smiling. */
export function restPose(wear: number): Pose {
  return poseAt({ kind: 'still', t: 0, now: 0, fy: faceY(wear), sx: 0, look: null, calm: true });
}

/** Marks as SVG markup. */
export function marksSVG(marks: Mark[]): string {
  return marks
    .map(({ d, fill, line, turn }) =>
      `<path d="${d}" fill="${fill ?? 'none'}"${line ? ` stroke="#000" stroke-width="${line}" stroke-linecap="round" stroke-linejoin="round"` : ''}${turn ? ` transform="rotate(${turn.join(' ')})"` : ''}/>`)
    .join('');
}

/** Marks on a canvas whose transform maps his units. */
export function drawMarks(c: CanvasRenderingContext2D, marks: Mark[]): void {
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.strokeStyle = '#000';
  for (const { d, fill, line, turn } of marks) {
    const p = new Path2D(d);
    c.save();
    if (turn) {
      c.translate(turn[1], turn[2]);
      c.rotate((turn[0] * Math.PI) / 180);
      c.translate(-turn[1], -turn[2]);
    }
    if (fill) {
      c.fillStyle = fill;
      c.fill(p);
    }
    if (line) {
      c.lineWidth = line;
      c.stroke(p);
    }
    c.restore();
  }
}
