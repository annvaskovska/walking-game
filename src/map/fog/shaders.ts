/**
 * GLSL for the paper wash and the colored pencil (ADR 0014). Three passes:
 *
 * 1. Mask (offscreen, half resolution, MAX blending), one channel per kind of sight:
 *    R = how walked each spot is: 1 on a walked street's centre line, falling to 0 at its corridor
 *        edge (house outlines peak at 0.8);
 *    B = the disc you see around you;
 *    A = your sight ahead of you while you walk.
 *    B and A then go dark behind every wall that faces you (shadows.ts): sight stops at walls.
 *    A second mask of the same size holds what you have seen (seenLayer.ts), in R.
 * 2. Paint (offscreen, the mask's size, MAX blending): what the pencils absorb on each spot, RGB,
 *    from every walked street and house, each in its own pencil; A is how covered it is.
 * 3. On screen: the wash, paper laid over the line art wherever the masks are dark, so what you
 *    have not seen shows as a faint outline; then seen houses (seenLayer.ts); then the pencil,
 *    multiplied over the paper and the ink, with the paper's grain and the strokes of a hand.
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
  vec2 p = (a + b) * 0.5 + dir * a_corner.x * (len * 0.5 + r) + nrm * a_corner.y * r;
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
 * A walked street colored in along the same capsules (SEG_VS, with the pencil's half-widths as
 * radii): what its pencil absorbs, coloring in from where you stood as fast as the wash clears.
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
uniform float u_amount;
${PENCILS_GLSL(n)}
out vec4 o;
void main() {
  if (v_kind > 1.5) discard;
  vec2 a = v_ab.xy, ab = v_ab.zw - v_ab.xy;
  float l2 = dot(ab, ab);
  float t = l2 > 0.0 ? clamp(dot(v_p - a, ab) / l2, 0.0, 1.0) : 0.0;
  float d = length(v_p - (a + ab * t));
  float cover = clamp((v_r - d) / u_edge, 0.0, 1.0);
  float reach = (u_time - v_sweep.y) * u_speed - abs(mix(v_along.x, v_along.y, t) - v_sweep.x);
  cover *= clamp(reach / 3.0 + 0.5, 0.0, 1.0);
  if (cover <= 0.0) discard;
  o = vec4((1.0 - pencil(v_tone)) * cover * u_amount, cover);
}`;

/** A walked house colored in: its footprint, a pixel off register, in a pencil of its own. */
export const PAINT_HOUSE_VS = `#version 300 es
in vec2 a_pos;
in vec2 a_frame;
in vec2 a_house;
uniform mat4 u_matrix;
uniform vec2 u_shift;
flat out vec2 v_house;
void main() {
  v_house = a_house;
  gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
  gl_Position.xy += u_shift * gl_Position.w;
}`;

export const PAINT_HOUSE_FS = `#version 300 es
precision highp float;
flat in vec2 v_house;
uniform float u_time;
uniform float u_amount;
uniform vec3 u_lay;
out vec4 o;
void main() {
  float on = clamp((u_time - v_house.y) / 0.6, 0.0, 1.0);
  if (on <= 0.0) discard;
  o = vec4((1.0 - u_lay) * on * u_amount, on);
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
 * says it absorbs, broken up by the paper's grain, which it skips, and by the strokes of a hand
 * coloring in, always at one slant. Both are tied to the map, so they never crawl as it moves.
 */
export const PENCIL_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec2 v_world;
uniform sampler2D u_paint;
uniform sampler2D u_tooth;
uniform float u_pxUnits;
out vec4 o;
void main() {
  vec4 p = texture(u_paint, v_uv);
  if (p.a <= 0.004) discard;
  // CSS pixels, tied to the map.
  vec2 q = v_world / u_pxUnits;
  float grain = texture(u_tooth, q / 256.0).r;
  float drift = texture(u_tooth, q / 4096.0).r;
  float stroke = 0.5 + 0.5 * sin(6.2831853 * (dot(q, vec2(0.8, -0.6)) / 2.3 + drift * 4.0));
  // The paper's tooth: the pencil catches its peaks and skips its pits, in specks a pixel or two wide.
  float keep = 1.0 - 0.8 * smoothstep(0.6, 0.72, grain);
  vec3 t = 1.0 - p.rgb * keep * mix(0.6, 1.0, stroke);
  o = vec4(t, 1.0);
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
