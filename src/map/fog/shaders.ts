/**
 * GLSL for the crayon (ADR 0015), as the coloring book design draws it, in its units (1 unit is
 * KC CSS px at the walk zoom, about 1.5 m). Two passes:
 *
 * 1. Paint (offscreen, the canvas' size): what the crayons absorb on each spot, RGB, and how
 *    covered it is, A. Each crayon multiplies what is under it (screen blending of what they
 *    absorb): the canal (a zigzag clipped by the stencil to the water), then every walked street
 *    (a soft band under a scribble) with MAX blending instead, so its segments never color their
 *    joints twice, then the houses (a hatch), their outlines and stray strokes, and his trail.
 * 2. On screen: the crayon multiplied over the paper and the ink, so lines stay black under it,
 *    skipping the pits of the paper's tooth.
 */

/** The crayons as a uniform array: the box's lay colors, then their press colors, then the water. */
export const CRAYONS_GLSL = (n: number) => `uniform vec3 u_crayons[${2 * n + 1}];
vec3 crayon(float i) {
  return u_crayons[int(clamp(i, 0.0, ${2 * n}.0))];
}`;

/** A walked street segment: a quad round it, wide enough for the scribble past its lines. */
export const STREET_VS = `#version 300 es
in vec2 a_corner;
in vec4 i_ab;
in vec2 i_along;
in vec4 i_sweep;
in vec2 i_wt;
uniform mat4 u_matrix;
uniform float u_m2u;
// Metres per unit, and per device pixel.
uniform float u_um;
uniform float u_aa;
out vec2 v_p;
flat out vec4 v_ab;
flat out vec2 v_along;
flat out vec4 v_sweep;
flat out vec2 v_wt;
void main() {
  vec2 a = i_ab.xy, b = i_ab.zw, d = b - a;
  float len = length(d);
  vec2 dir = len > 1e-6 ? d / len : vec2(1.0, 0.0);
  // The scribble's widest turn, half a stroke and its jitter, and an edge pixel (local units).
  float g = ((0.76 * i_wt.x + 0.75) * u_um + u_aa) * u_m2u;
  vec2 p = (a + b) * 0.5 + dir * a_corner.x * (len * 0.5 + g) + vec2(-dir.y, dir.x) * a_corner.y * g;
  v_p = p;
  v_ab = i_ab;
  v_along = i_along;
  v_sweep = i_sweep;
  v_wt = i_wt;
  gl_Position = u_matrix * vec4(p, 0.0, 1.0);
}`;

/**
 * A walked street, as the design's drawStreet: a soft band at 30%, 0.95 times the street's width,
 * under a scribble at 78% that goes back and forth across it, a stroke 0.95 units wide every 0.85
 * units, turning 0.6 widths out either side (give or take 0.16 widths, and a quarter unit along),
 * a little past its lines. It colors in from the end you walked in from: fast up to you, then at
 * your pace, a stroke at a time.
 */
export const STREET_FS = (n: number) => `#version 300 es
precision highp float;
in vec2 v_p;
flat in vec4 v_ab;
flat in vec2 v_along;
flat in vec4 v_sweep;
flat in vec2 v_wt;
uniform float u_time;
uniform float u_m2u;
uniform float u_um;
uniform float u_aa;
// How fast the crayon catches up with you (m/s), and how far it runs ahead of you (m).
uniform float u_catch;
uniform float u_lead;
${CRAYONS_GLSL(n)}
out vec4 o;
// A stable 0..1 per turn of this crayon (a fract hash: sin loses its precision far along a street).
float hash(float k) {
  float p = fract((k + v_wt.y * 97.0) * 0.1031);
  p *= p + 33.33;
  return fract(p * (p + p));
}
// Turn k of the scribble (m along the street, m across it).
vec2 turnAt(float k, float w) {
  float side = mod(k, 2.0) < 0.5 ? -1.0 : 1.0;
  return vec2(k * 0.85 + (hash(k + 5000.0) - 0.5) * 0.5, side * (0.6 + (hash(k) - 0.5) * 0.32) * w) * u_um;
}
float segDist(vec2 q, vec2 a, vec2 b) {
  vec2 ab = b - a;
  return length(q - a - ab * clamp(dot(q - a, ab) / max(dot(ab, ab), 1e-9), 0.0, 1.0));
}
void main() {
  vec2 a = v_ab.xy, ab = v_ab.zw - a;
  float l2 = max(dot(ab, ab), 1e-12);
  float tu = dot(v_p - a, ab) / l2;
  float t = clamp(tu, 0.0, 1.0);
  vec2 dir = ab / sqrt(l2);
  float w = v_wt.x;
  // Metres: from the street's line, and where this spot is along and across the street.
  float d = length(v_p - (a + ab * t)) / u_m2u;
  vec2 q = vec2(mix(v_along.x, v_along.y, tu), dot(v_p - a, vec2(-dir.y, dir.x)) / u_m2u);
  // How far from where it starts the crayon has colored.
  float dt = u_time - v_sweep.y;
  float front = min(u_catch * dt, v_sweep.z + v_sweep.w * dt) + u_lead;
  float hw = 0.5 * u_aa;
  float band = (1.0 - smoothstep(0.475 * w * u_um - hw, 0.475 * w * u_um + hw, d))
    * clamp((front - abs(q.x - v_sweep.x)) / u_aa + 0.5, 0.0, 1.0);
  float k = floor(q.x / (0.85 * u_um));
  float sd = 1e9;
  for (float i = -1.0; i <= 1.0; i += 1.0) {
    vec2 p0 = turnAt(k + i, w), p1 = turnAt(k + i + 1.0, w);
    // A stroke shows once the crayon has passed both its ends.
    if (max(abs(p0.x - v_sweep.x), abs(p1.x - v_sweep.x)) > front) continue;
    sd = min(sd, segDist(q, p0, p1));
  }
  float scribble = 1.0 - smoothstep(0.475 * u_um - hw, 0.475 * u_um + hw, sd);
  // Past the segment's ends the next one goes on; a little overshoot rounds off a bend or a dead end.
  float s = tu * sqrt(l2) / u_m2u;
  scribble *= 1.0 - smoothstep(0.25 * w * u_um, 0.5 * w * u_um, max(-s, s - sqrt(l2) / u_m2u));
  // Strokes under two pixels apart (zoomed far out) blur into an even 70%.
  float sharp = smoothstep(1.0, 2.0, 0.85 * u_um / u_aa);
  scribble = mix(0.7 * (1.0 - smoothstep(0.6 * w * u_um - hw, 0.6 * w * u_um + hw, d)) * step(abs(q.x - v_sweep.x), front), scribble, sharp);
  float cover = 1.0 - (1.0 - 0.3 * band) * (1.0 - 0.78 * scribble);
  if (cover <= 0.004) discard;
  // The band and the scribble multiply each other, as two crayon layers do.
  vec3 absorb = 1.0 - crayon(v_wt.y);
  o = vec4(1.0 - (1.0 - 0.3 * band * absorb) * (1.0 - 0.78 * scribble * absorb), cover);
}`;

/** A walked house: its footprint, off register, with where each spot is in its hatch. */
export const HOUSE_VS = `#version 300 es
in vec2 a_pos;
in vec2 a_hatch;
in vec3 a_house;
uniform mat4 u_matrix;
out vec2 v_hatch;
flat out vec3 v_house;
void main() {
  v_hatch = a_hatch;
  v_house = a_house;
  gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
}`;

/**
 * A walked house hatched in, as the design's drawHouse: strokes 0.92 units wide every 0.8 units at
 * 64%, back and forth, each 0.4 units further along at its far end, clipped to the footprint. The
 * strokes come one after the other over 300 ms.
 */
export const HOUSE_FS = (n: number) => `#version 300 es
precision highp float;
// Across the hatch (0..1), and along it in strokes (stroke k runs from k to k + 0.5).
in vec2 v_hatch;
// Time on (s), strokes, crayon.
flat in vec3 v_house;
uniform float u_time;
// Units per device pixel.
uniform float u_aa;
${CRAYONS_GLSL(n)}
out vec4 o;
void main() {
  float shown = ceil(v_house.y * clamp((u_time - v_house.x) / 0.3, 0.0, 1.0));
  float k0 = floor(v_hatch.y);
  float d = 1e9;
  for (float i = -1.0; i <= 1.0; i += 1.0) {
    float k = k0 + i;
    if (k < 0.0 || k >= shown) continue;
    float f = mod(k, 2.0) < 0.5 ? v_hatch.x : 1.0 - v_hatch.x;
    d = min(d, abs(v_hatch.y - k - 0.5 * f) * 0.8);
  }
  float c = 1.0 - smoothstep(0.46 - 0.5 * u_aa, 0.46 + 0.5 * u_aa, d);
  // Strokes under two pixels apart (zoomed far out) blur into an even fill.
  c = mix(step(v_hatch.y, shown), c, smoothstep(1.0, 2.0, 0.8 / u_aa));
  float a = 0.64 * c;
  if (a <= 0.004) discard;
  o = vec4((1.0 - crayon(v_house.z)) * a, a);
}`;

/**
 * A crayon line of even width: a house's outline, a stroke that got away, his trail. Mitred quads
 * along it, so it never colors itself twice.
 */
export const RIBBON_VS = `#version 300 es
in vec2 a_pos;
in vec2 a_miter;
in vec4 a_rib;
in float a_crayon;
uniform mat4 u_matrix;
// Local units per unit, and per device pixel; how much wider the line is drawn.
uniform float u_unit;
uniform float u_aa;
uniform float u_grow;
out float v_across;
flat out vec4 v_rib;
void main() {
  float hw = a_rib.y * u_unit * u_grow;
  float r = a_rib.x * (hw + u_aa);
  v_across = r;
  v_rib = vec4(hw, a_rib.z, a_rib.w, a_crayon);
  gl_Position = u_matrix * vec4(a_pos + a_miter * r, 0.0, 1.0);
}`;

export const RIBBON_FS = (n: number) => `#version 300 es
precision highp float;
in float v_across;
// Half-width (local units), alpha, time on (s), crayon.
flat in vec4 v_rib;
uniform float u_time;
uniform float u_aa;
${CRAYONS_GLSL(n)}
out vec4 o;
void main() {
  if (u_time < v_rib.z) discard;
  float a = v_rib.y * clamp((v_rib.x - abs(v_across)) / u_aa + 0.5, 0.0, 1.0);
  if (a <= 0.004) discard;
  o = vec4((1.0 - crayon(v_rib.w)) * a, a);
}`;

/**
 * The canal's zigzag, as the design's drawWater (1.25 units wide, 55%): three strokes a quad, as
 * the design draws them a few at a time, so they color their overlaps once within a quad and twice
 * where two quads meet. The quad is a box along the zigzag round its four turns.
 */
export const ZIGZAG_VS = `#version 300 es
in vec2 a_corner;
in vec4 i_a;
in vec4 i_b;
uniform mat4 u_matrix;
uniform float u_hw;
uniform float u_aa;
out vec2 v_p;
flat out vec4 v_a;
flat out vec4 v_b;
void main() {
  vec2 d = i_b.xy - i_a.xy;
  vec2 e = length(d) > 1e-6 ? normalize(d) : vec2(1.0, 0.0), n = vec2(-e.y, e.x);
  vec2 p0 = i_a.xy, p1 = i_a.zw, p2 = i_b.xy, p3 = i_b.zw;
  vec4 s = vec4(dot(p0, e), dot(p1, e), dot(p2, e), dot(p3, e));
  vec4 t = vec4(dot(p0, n), dot(p1, n), dot(p2, n), dot(p3, n));
  float g = u_hw + u_aa;
  vec2 lo = vec2(min(min(s.x, s.y), min(s.z, s.w)), min(min(t.x, t.y), min(t.z, t.w))) - g;
  vec2 hi = vec2(max(max(s.x, s.y), max(s.z, s.w)), max(max(t.x, t.y), max(t.z, t.w))) + g;
  vec2 q = mix(lo, hi, a_corner * 0.5 + 0.5);
  v_p = e * q.x + n * q.y;
  v_a = i_a;
  v_b = i_b;
  gl_Position = u_matrix * vec4(v_p, 0.0, 1.0);
}`;

export const ZIGZAG_FS = `#version 300 es
precision highp float;
in vec2 v_p;
flat in vec4 v_a;
flat in vec4 v_b;
// Half-width and a device pixel (local units); what the water crayon absorbs.
uniform float u_hw;
uniform float u_aa;
uniform vec3 u_absorb;
out vec4 o;
float segDist(vec2 q, vec2 a, vec2 b) {
  vec2 ab = b - a;
  return length(q - a - ab * clamp(dot(q - a, ab) / max(dot(ab, ab), 1e-12), 0.0, 1.0));
}
void main() {
  float d = min(min(segDist(v_p, v_a.xy, v_a.zw), segDist(v_p, v_a.zw, v_b.xy)), segDist(v_p, v_b.xy, v_b.zw));
  float c = 0.55 * clamp((u_hw - d) / u_aa + 0.5, 0.0, 1.0);
  if (c <= 0.004) discard;
  o = vec4(u_absorb * c, c);
}`;

/** The water, into the stencil only: the canal's crayon stays inside it, off register as the design's. */
export const WATER_VS = `#version 300 es
in vec2 a_pos;
uniform mat4 u_matrix;
uniform vec2 u_shift;
void main() {
  gl_Position = u_matrix * vec4(a_pos + u_shift, 0.0, 1.0);
}`;

export const WATER_FS = `#version 300 es
precision highp float;
out vec4 o;
void main() {
  o = vec4(0.0);
}`;

/** Fullscreen triangle with the world position (local units) of each pixel, for the anchored tooth. */
export const COMP_VS = `#version 300 es
in vec2 a_corner;
uniform mat4 u_inv;
uniform float u_ndcZ;
out vec2 v_uv;
out vec2 v_world;
void main() {
  v_uv = a_corner * 0.5 + 0.5;
  vec4 w = u_inv * vec4(a_corner, u_ndcZ, 1.0);
  v_world = w.xy / w.w;
  gl_Position = vec4(a_corner, 0.0, 1.0);
}`;

/**
 * The crayon, multiplied over everything under it (blend DST_COLOR, ZERO): what the paint pass
 * says it absorbs, where the paper's tooth lets it (makeTooth: about a quarter of the paper shows
 * through). The tooth is one texel a device pixel, tied to the map, so it never crawls as the map
 * moves.
 */
export const PENCIL_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec2 v_world;
uniform sampler2D u_paint;
uniform sampler2D u_tooth;
// Map units per device pixel.
uniform float u_pxUnits;
out vec4 o;
void main() {
  vec4 p = texture(u_paint, v_uv);
  if (p.a <= 0.004) discard;
  float keep = texture(u_tooth, v_world / u_pxUnits / 256.0).r;
  o = vec4(1.0 - p.rgb * keep, 1.0);
}`;
