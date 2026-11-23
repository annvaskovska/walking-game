/**
 * GLSL for the paper wash and the crayon (ADR 0014). Three passes:
 *
 * 1. Mask (offscreen, half resolution, MAX blending), one channel per kind of sight:
 *    R = how walked each spot is: 1 on a walked street's centre line, falling to 0 at its corridor
 *        edge (house outlines peak at 0.8);
 *    B = the disc you see around you;
 *    A = your sight ahead of you while you walk.
 *    B and A then go dark behind every wall that faces you (shadows.ts): sight stops at walls.
 *    A second mask of the same size holds what you have seen (seenLayer.ts), in R.
 * 2. Paint (offscreen, the canvas' size, MAX blending): what the crayons absorb on each spot, RGB,
 *    from every walked street (a soft band under a scribble) and house, each in its crayon; A is
 *    how covered it is.
 * 3. On screen: the wash, paper laid over the line art wherever the masks are dark, so what you
 *    have not seen shows as a faint outline; then seen houses (seenLayer.ts); then the pencil,
 *    multiplied over the paper and the ink, skipping the pits of the paper's tooth.
 */

/** Capsule around each lit segment: a quad, with the exact distance worked out per fragment. */
export const SEG_VS = `#version 300 es
in vec2 a_corner;
in vec4 i_ab;
in vec2 i_along;
in vec2 i_sweep;
in float i_kind;
in float i_tone;
uniform mat4 u_matrix;
uniform vec3 u_radius;
uniform float u_m2u;
uniform float u_minr;
// The quad reaches this many times the radius (the paint pass: the scribble runs past the lines).
uniform float u_grow;
out vec2 v_p;
flat out vec4 v_ab;
flat out vec2 v_along;
flat out vec2 v_sweep;
flat out float v_r;
flat out float v_kind;
flat out float v_tone;
void main() {
  vec2 a = i_ab.xy, b = i_ab.zw;
  float rm = i_kind < 0.5 ? u_radius.x : (i_kind < 1.5 ? u_radius.y : u_radius.z);
  float r = max(rm * u_m2u, u_minr * (i_kind > 1.5 ? 0.6 : 1.0));
  vec2 d = b - a;
  float len = length(d);
  vec2 dir = len > 1e-6 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float g = r * max(u_grow, 1.0);
  vec2 p = (a + b) * 0.5 + dir * a_corner.x * (len * 0.5 + g) + nrm * a_corner.y * g;
  v_p = p;
  v_ab = i_ab;
  v_along = i_along;
  v_sweep = i_sweep;
  v_r = r;
  v_kind = i_kind;
  v_tone = i_tone;
  gl_Position = u_matrix * vec4(p, 0.0, 1.0);
}`;

export const SEG_FS = `#version 300 es
precision highp float;
in vec2 v_p;
flat in vec4 v_ab;
flat in vec2 v_along;
flat in vec2 v_sweep;
flat in float v_r;
flat in float v_kind;
uniform float u_time;
uniform float u_speed;
out vec4 o;
void main() {
  vec2 a = v_ab.xy, ab = v_ab.zw - v_ab.xy;
  float l2 = dot(ab, ab);
  float t = l2 > 0.0 ? clamp(dot(v_p - a, ab) / l2, 0.0, 1.0) : 0.0;
  float f = 1.0 - length(v_p - (a + ab * t)) / v_r;
  if (f <= 0.0) discard;
  // How far past this spot the pencil has run (m); it clears the wash over a few metres.
  float reach = (u_time - v_sweep.y) * u_speed - abs(mix(v_along.x, v_along.y, t) - v_sweep.x);
  float lit = clamp(reach / 8.0 + 0.25, 0.0, 1.0);
  o = vec4(f * (v_kind > 1.5 ? 0.8 : 1.0) * lit, 0.0, 0.0, 0.0);
}`;

/** The pencils, as a uniform array: PENCILS_GLSL declares it, pencil(i) reads it. */
export const PENCILS_GLSL = (n: number) => `uniform vec3 u_pencils[${n}];
vec3 pencil(float i) {
  return u_pencils[int(clamp(i, 0.0, ${n - 1}.0))];
}`;

/**
 * A walked street colored in along the same capsules (SEG_VS, the street's half-width as radius),
 * as a hand colors in: a soft band at 30%, under a scribble at 78% that goes back and forth across
 * the street and a little past its lines. It colors in from where you stood as the wash clears.
 */
export const PAINT_SEG_FS = (n: number) => `#version 300 es
precision highp float;
in vec2 v_p;
flat in vec4 v_ab;
flat in vec2 v_along;
flat in vec2 v_sweep;
flat in float v_r;
flat in float v_kind;
flat in float v_tone;
uniform float u_time;
uniform float u_speed;
uniform float u_edge;
uniform float u_m2u;
uniform float u_pxUnits;
// Metres along the street per stroke across it, and the stroke's width (m).
uniform vec2 u_stroke;
${PENCILS_GLSL(n)}
out vec4 o;
// A stable 0..1 per stroke of this pencil (a fract hash: sin loses its precision far along a street).
float hash(float k) {
  float p = fract((k + v_tone * 97.0) * 0.1031);
  p *= p + 33.33;
  return fract(p * (p + p));
}
// Where stroke k turns: alternately either side, 1.2 half-widths out, give or take.
float turn(float k, float hw) { return (mod(k, 2.0) < 0.5 ? -1.0 : 1.0) * hw * (1.2 + (hash(k) - 0.5) * 0.64); }
// Distance (m) from q (along, across) to the stroke from turn k to turn k + 1.
float strokeDist(vec2 q, float k, float hw) {
  vec2 a = vec2(k * u_stroke.x, turn(k, hw));
  vec2 ab = vec2(u_stroke.x, turn(k + 1.0, hw) - a.y);
  return length(q - a - ab * clamp(dot(q - a, ab) / dot(ab, ab), 0.0, 1.0));
}
void main() {
  if (v_kind > 1.5) discard;
  vec2 a = v_ab.xy, ab = v_ab.zw - v_ab.xy;
  float l2 = dot(ab, ab);
  vec2 dir = l2 > 0.0 ? ab / sqrt(l2) : vec2(1.0, 0.0);
  float t = l2 > 0.0 ? clamp(dot(v_p - a, ab) / l2, 0.0, 1.0) : 0.0;
  // Metres: the half-width, distance to the street's line, and where this spot is along and across it.
  float hw = v_r / u_m2u;
  float d = length(v_p - (a + ab * t)) / u_m2u;
  vec2 q = vec2(v_along.x + dot(v_p - a, dir) / u_m2u, dot(v_p - a, vec2(-dir.y, dir.x)) / u_m2u);
  float aa = u_edge / u_m2u;
  float band = 1.0 - smoothstep(0.95 * hw - aa, 0.95 * hw + aa, d);
  float k = floor(q.x / u_stroke.x);
  float sd = min(strokeDist(q, k - 1.0, hw), min(strokeDist(q, k, hw), strokeDist(q, k + 1.0, hw)));
  float scribble = 1.0 - smoothstep(0.5 * u_stroke.y - aa, 0.5 * u_stroke.y + aa, sd);
  // Past the segment's ends the next one goes on; a little overshoot rounds off a bend or a dead end.
  float s = dot(v_p - a, dir) / u_m2u;
  scribble *= 1.0 - smoothstep(0.5 * hw, 1.0 * hw, max(-s, s - sqrt(l2) / u_m2u));
  // Strokes only a pixel or two apart (zoomed far out) blur into an even 70%.
  float sharp = smoothstep(2.0, 4.0, u_stroke.x * u_m2u / u_pxUnits);
  scribble = mix(0.7 * (1.0 - smoothstep(1.1 * hw - aa, 1.1 * hw + aa, d)), scribble, sharp);
  float cover = 1.0 - (1.0 - 0.3 * band) * (1.0 - 0.78 * scribble);
  float reach = (u_time - v_sweep.y) * u_speed - abs(mix(v_along.x, v_along.y, t) - v_sweep.x);
  cover *= clamp(reach / 3.0 + 0.5, 0.0, 1.0);
  if (cover <= 0.004) discard;
  o = vec4((1.0 - pencil(v_tone)) * cover, cover);
}`;

/**
 * A walked house colored in: its footprint in its pencil, a metre or so off register (mostly down
 * and right, now and then up and left), as a hand colors in. The design hatches it in one stroke
 * whose lines overlap, so it comes out even.
 */
export const PAINT_HOUSE_VS = `#version 300 es
in vec2 a_pos;
in vec2 a_frame;
in vec2 a_house;
in float a_tone;
uniform mat4 u_matrix;
uniform float u_m2u;
flat out vec2 v_house;
flat out float v_tone;
void main() {
  v_house = a_house;
  v_tone = a_tone;
  // 0.6 to 1.35 m off register, down and right (local y runs south), about one in five up and left.
  float off = (0.6 + 0.75 * fract(a_house.x * 7.13)) * (fract(a_house.x * 3.71) < 0.22 ? -1.0 : 1.0);
  gl_Position = u_matrix * vec4(a_pos + vec2(0.7071) * off * u_m2u, 0.0, 1.0);
}`;

export const PAINT_HOUSE_FS = (n: number) => `#version 300 es
precision highp float;
flat in vec2 v_house;
flat in float v_tone;
uniform float u_time;
uniform float u_amount;
${PENCILS_GLSL(n)}
out vec4 o;
void main() {
  float a = u_amount * clamp((u_time - v_house.y) / 0.4, 0.0, 1.0);
  if (a <= 0.0) discard;
  o = vec4((1.0 - pencil(v_tone)) * a, a);
}`;

/** House footprints into the mask (R), so a lit house shows through the fog. */
export const HOUSE_MASK_VS = `#version 300 es
in vec2 a_pos;
in vec2 a_frame;
in vec2 a_house;
uniform mat4 u_matrix;
flat out float v_on;
void main() {
  v_on = a_house.y;
  gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
}`;

export const HOUSE_MASK_FS = `#version 300 es
precision highp float;
flat in float v_on;
uniform float u_time;
out vec4 o;
void main() {
  o = vec4(0.8 * clamp((u_time - v_on) / 0.6, 0.0, 1.0), 0.0, 0.0, 0.0);
}`;

/** Lantern and cone of sight around you, into B. Drawn as one quad around your position. */
export const LAMP_VS = `#version 300 es
in vec2 a_corner;
uniform mat4 u_matrix;
uniform vec2 u_pos;
uniform float u_extent;
out vec2 v_d;
void main() {
  v_d = a_corner * u_extent;
  gl_Position = u_matrix * vec4(u_pos + v_d, 0.0, 1.0);
}`;

export const LAMP_FS = `#version 300 es
precision highp float;
in vec2 v_d;
uniform float u_m2u;
uniform float u_lantern;
uniform float u_coneLen;
uniform float u_coneCos;
uniform float u_coneInnerCos;
uniform vec2 u_dir;
uniform float u_cone;
uniform float u_on;
out vec4 o;
void main() {
  float d = length(v_d) / u_m2u;
  float disc = 1.0 - smoothstep(u_lantern * 0.25, u_lantern, d);
  float c = d > 0.01 ? dot(v_d / (d * u_m2u), u_dir) : 1.0;
  // The beam: soft sides, brightest close to you, fading out towards its reach.
  float side = smoothstep(u_coneCos, u_coneInnerCos, c);
  float reach = 1.0 - smoothstep(u_coneLen * 0.15, u_coneLen, d);
  // It starts a few steps ahead of you, so it reads as light thrown forward, not a blob on you.
  float ahead = mix(0.25, 1.0, smoothstep(1.5, 16.0, d));
  float cone = side * reach * ahead * u_cone;
  o = vec4(0.0, 0.0, disc * 0.95, cone) * u_on;
}`;

/** Fullscreen triangle with the world position (local units) of each pixel, for anchored mist. */
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

/** The wash: paper over the line art, except where you have walked, seen, or look now. */
export const COMP_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec2 v_world;
uniform sampler2D u_mask;
uniform sampler2D u_noise;
uniform sampler2D u_seen;
uniform float u_seenClear;
uniform float u_noiseScale;
uniform float u_opacity;
uniform vec3 u_paper;
out vec4 o;
void main() {
  vec4 m = texture(u_mask, v_uv);
  // The edge of what clears wanders a little with the paper, so it reads as a wash, not a cut-out.
  float n = texture(u_noise, v_world * u_noiseScale).r;
  float lit = smoothstep(0.05, 0.42, m.r + (n - 0.5) * 0.14);
  float sv = texture(u_seen, v_uv).r;
  float seen = clamp(sv + (n - 0.5) * 0.16 * sv, 0.0, 1.0);
  float clear = max(max(lit, m.b * 0.9), max(m.a * 0.8, seen * u_seenClear));
  float a = u_opacity * (1.0 - clear);
  o = vec4(u_paper * a, a);
}`;

/**
 * The pencil, multiplied over everything under it (blend DST_COLOR, ZERO): what the paint pass
 * says it absorbs, where the paper's tooth lets it (makeTooth: about a quarter of the paper shows
 * through). The tooth is in device pixels, tied to the map, so it never crawls as the map moves.
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

/** You: Mr Sparkles, drawn in a quad around your position. */
export const PUCK_VS = `#version 300 es
in vec2 a_corner;
uniform mat4 u_matrix;
uniform float u_size;
out vec2 v_px;
void main() {
  v_px = a_corner * u_size;
  gl_Position = u_matrix * vec4(v_px, 0.0, 1.0);
}`;

/**
 * Mr Sparkles (ADR 0014): a colored pencil held at a slant, its lead on you, in the pencil of the
 * street he colors now. A six-sided body with its facets, shaved wood at the tip, a painted end,
 * a pen outline and a soft shadow on the paper. He holds still: nothing here moves with time.
 */
export const PUCK_FS = `#version 300 es
precision highp float;
in vec2 v_px;
uniform float u_scale;
uniform vec3 u_lay;
uniform vec3 u_press;
uniform vec3 u_wood;
uniform vec3 u_ink;
out vec4 o;
// From the lead up to the end: up and to the right, as a right hand holds it.
const vec2 DIR = vec2(0.6, -0.8);
const vec2 ACROSS = vec2(0.8, 0.6);
const float LEN = 62.0, CONE = 15.0, LEAD = 5.0, HW = 6.0, SLOPE = HW / CONE;
// Signed distance to the pencil's outline (CSS px, negative inside), and where p is along and across it.
float shape(vec2 p, out float s, out float t) {
  s = dot(p, DIR);
  t = dot(p, ACROSS);
  float side = s < CONE ? (abs(t) - SLOPE * max(s, 0.0)) / sqrt(1.0 + SLOPE * SLOPE) : abs(t) - HW;
  return max(side, max(-s, s - LEN));
}
void main() {
  float aa = 0.75 / u_scale;
  float s, t, ss, st;
  float d = shape(v_px, s, t);
  float sd = shape(v_px - vec2(2.5, 3.5), ss, st);
  float shadow = 0.16 * (1.0 - smoothstep(-1.5, 2.5, sd));
  vec3 c;
  if (s < LEAD) c = u_press;
  else if (s < CONE) c = u_wood * (t < 0.0 ? 0.93 : 1.0);
  else if (s > LEN - 3.0) c = u_press;
  else c = u_lay * (t < -HW / 3.0 ? 0.84 : (t > HW / 3.0 ? 0.97 : 1.08));
  // Pen lines: the outline, where the paint meets the wood, and the two facet edges, fainter.
  float line = 1.0 - smoothstep(1.1 - aa, 1.1 + aa, -d);
  float ring = 1.0 - smoothstep(0.5 - aa, 0.5 + aa, abs(s - CONE));
  float facet = s > CONE && s < LEN - 3.0 ? (1.0 - smoothstep(0.35 - aa, 0.35 + aa, abs(abs(t) - HW / 3.0))) * 0.35 : 0.0;
  c = mix(c, u_ink, max(line, max(ring, facet)));
  float body = 1.0 - smoothstep(-aa, aa, d);
  o = vec4(c * body, body) + vec4(0.0, 0.0, 0.0, shadow) * (1.0 - body);
}`;
