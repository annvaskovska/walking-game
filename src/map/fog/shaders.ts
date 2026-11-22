/**
 * GLSL for the fog. Two passes:
 *
 * 1. Mask (offscreen, half resolution, MAX blending), one channel per kind of light:
 *    R = how lit each spot is: 1 on a lit street's centre line, falling to 0 at its corridor edge
 *        (house outlines peak at 0.8 so they never get the gold centre line);
 *    G = the flash running along a street the moment it unlocks;
 *    B = the pool of light around you;
 *    A = your beam: the cone of sight ahead of you while you walk.
 *    B and A then go dark behind every wall that faces you (shadows.ts): light stops at walls.
 *    A second mask of the same size holds what you have seen (seenLayer.ts), in R.
 * 2. Composite (on screen): fog with drifting mist everywhere the mask is dark, soft edges, a thin
 *    warm rim, lamplight pooled along lit streets with a gold line down the middle, the flash,
 *    and your beam, which lights up the mist it passes through. Where you have seen, the fog
 *    thins and the mist turns to moonlight.
 *
 * Lit houses are drawn between the two, as warm shapes whose windows switch on one by one; seen
 * houses after the composite, as moonlit roofs over the fog.
 */

/** Capsule around each lit segment: a quad, with the exact distance worked out per fragment. */
export const SEG_VS = `#version 300 es
in vec2 a_corner;
in vec4 i_ab;
in vec2 i_along;
in vec2 i_sweep;
in float i_kind;
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
  float age = u_time - v_sweep.y;
  // How far past this spot the unlock wave has run (m); the light fades in over a few metres.
  float reach = age * u_speed - abs(mix(v_along.x, v_along.y, t) - v_sweep.x);
  float lit = clamp(reach / 8.0 + 0.25, 0.0, 1.0);
  float flash = 0.0;
  if (v_kind < 1.5 && age < 6.0) {
    flash = exp(-max(reach, 0.0) / 14.0) * smoothstep(-10.0, 0.0, reach) * f * f;
  }
  o = vec4(f * (v_kind > 1.5 ? 0.8 : 1.0) * lit, flash, 0.0, 0.0);
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

/** Lit houses on screen: warm fill, windows coming on one by one, fading to a glow when tiny. */
export const HOUSE_VS = `#version 300 es
in vec2 a_pos;
in vec2 a_frame;
in vec2 a_house;
uniform mat4 u_matrix;
out vec2 v_frame;
flat out vec2 v_house;
void main() {
  v_frame = a_frame;
  v_house = a_house;
  gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
}`;

export const HOUSE_FS = `#version 300 es
precision highp float;
in vec2 v_frame;
flat in vec2 v_house;
uniform float u_time;
uniform float u_mpp;
uniform vec3 u_fill;
uniform vec3 u_warm;
uniform vec3 u_pale;
out vec4 o;
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
void main() {
  float on = clamp((u_time - v_house.y) / 0.6, 0.0, 1.0);
  if (on <= 0.0) discard;
  vec2 cellSize = vec2(3.2, 3.6);
  vec2 cell = floor(v_frame / cellSize);
  vec2 q = abs(fract(v_frame / cellSize) - 0.5) * cellSize;
  float h = hash(cell + v_house.x);
  // About half the windows are lit; each switches on a moment after the house does.
  float tOn = v_house.y + 0.25 + fract(h * 7.31) * 1.8;
  float share = mix(0.42, 0.8, fract(v_house.x * 0.6180339));
  float lit = step(share, h) * smoothstep(tOn, tOn + 0.2, u_time);
  float aa = u_mpp;
  vec2 halfSize = vec2(0.7, 0.5);
  vec2 edge = 1.0 - smoothstep(halfSize - aa * 0.5, halfSize + aa * 0.5, q);
  float win = edge.x * edge.y * lit;
  // Sub-pixel windows shimmer; below ~2.5 px they blend into an even glow.
  float detail = 1.0 - smoothstep(0.35, 1.0, u_mpp);
  float glow = mix(0.085 * smoothstep(0.0, 2.0, u_time - v_house.y), win, detail);
  vec3 wc = mix(u_warm, u_pale, fract(h * 13.7));
  // Neighbouring houses differ a little in tone, so a terrace reads as houses, not one slab.
  vec3 fill = u_fill * (0.78 + 0.44 * fract(v_house.x * 0.7548776));
  vec3 c = fill + wc * glow * 0.9;
  float a = 0.94 * on;
  o = vec4(c * a, a);
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

export const COMP_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec2 v_world;
uniform sampler2D u_mask;
uniform sampler2D u_noise;
uniform sampler2D u_seen;
uniform float u_seenClear;
uniform float u_seenTint;
uniform vec3 u_moon;
uniform float u_time;
uniform float u_noiseScale;
uniform float u_mistAmt;
uniform float u_opacity;
uniform float u_core;
uniform vec3 u_fog;
uniform vec3 u_mist;
uniform vec3 u_rim;
uniform vec3 u_lamp;
uniform vec3 u_beam;
uniform vec3 u_flash;
uniform vec3 u_street;
out vec4 o;
void main() {
  vec4 m = texture(u_mask, v_uv);
  vec2 w = v_world * u_noiseScale;
  float n1 = texture(u_noise, w + vec2(u_time * 0.004, u_time * 0.0017)).r;
  float n2 = texture(u_noise, w * 2.3 + vec2(-u_time * 0.006, u_time * 0.0028)).r;
  float n = mix(0.5, n1 * 0.7 + n2 * 0.3, u_mistAmt);

  // The corridor's edge wanders a little with the mist, so it reads as fog thinning, not a cut-out.
  float r = m.r + (n - 0.5) * 0.14;
  float lit = smoothstep(0.05, 0.42, r);
  float lamp = m.b;
  float beam = m.a;
  // What you have seen stays thinned, in moonlight; its edge drifts with the mist too.
  float sv = texture(u_seen, v_uv).r;
  float seen = clamp(sv + (n - 0.5) * 0.16 * sv, 0.0, 1.0);
  float clear = max(max(lit, lamp * 0.9), max(beam * 0.8, seen * u_seenClear));
  float a = u_opacity * (1.0 - clear);
  // Night fog: near black, with slow faint drifts of mist, which catch the moon where you have seen.
  vec3 mist = mix(u_mist, u_moon * 0.32, seen * 0.6);
  vec3 fog = mix(u_fog, mist, smoothstep(0.3, 0.85, n) * 0.75 * u_mistAmt);
  vec3 c = fog * a;
  c += u_moon * seen * u_seenTint * (0.75 + 0.5 * n) * (1.0 - lit);

  // Warm light: a thin glow where the fog thins, lamplight pooled along lit streets, and your
  // lantern, whose beam catches the mist ahead of you.
  float rim = smoothstep(0.02, 0.16, r) * (1.0 - smoothstep(0.16, 0.38, r));
  c += u_rim * rim * 0.06;
  c += u_lamp * m.r * 0.06;
  c += u_lamp * lamp * lamp * 0.05;
  c += u_beam * beam * (0.035 + 0.13 * n) * (0.5 + 0.5 * beam);

  // Thin gold line along the middle of lit streets.
  float fw = max(fwidth(m.r), 1e-4);
  float core = smoothstep(u_core - fw, u_core + fw, m.r) * 0.85;
  c = u_street * core + c * (1.0 - core);
  a = core + a * (1.0 - core);

  c += u_flash * m.g * 0.9;
  o = vec4(c, a);
}`;

/** You: a bright point in a warm glow, with a notch towards where you are heading. */
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
 * Mr Sparkles (ADR 0012): one round light in a tight bright shine and a wide warm one, the same
 * sizes and colours as on the start screen (index.html). He flickers like a candle, from sines out
 * of step so it never quite repeats, and drifts a pixel or two. His flashlight is the fog's beam.
 */
export const PUCK_FS = `#version 300 es
precision highp float;
in vec2 v_px;
uniform float u_time;
uniform float u_scale;
uniform vec3 u_core;
uniform vec3 u_edge;
uniform vec3 u_shine;
uniform vec3 u_glow;
out vec4 o;
// A radial gradient as SVG draws one: a at the centre, b at stop m, nothing at the rim (s = 1).
float ramp(float s, float a, float b, float m) {
  return s < m ? mix(a, b, s / m) : mix(b, 0.0, min(1.0, (s - m) / (1.0 - m)));
}
vec4 over(vec4 top, vec4 under) {
  return top + under * (1.0 - top.a);
}
void main() {
  float t = u_time;
  float f = 0.05 * sin(t * 2.7) + 0.04 * sin(t * 6.3 + 1.3) + 0.03 * sin(t * 10.1 + 0.4);
  vec2 p = v_px - vec2(2.0 * sin(t * 0.69), 2.5 * sin(t * 0.51 + 1.0));
  float d = length(p);
  float aa = 0.8 / u_scale;
  float shine = 0.88 + 1.5 * f;
  float wide = ramp(d / (65.0 * (1.0 + f)), 0.62, 0.3, 0.4) * shine;
  float tight = ramp(d / (22.5 * (1.0 + f)), 0.85, 0.3, 0.5) * shine;
  float r = 8.4 * (1.0 + 0.8 * f);
  float body = 1.0 - smoothstep(r - aa, r + aa, d);
  vec3 orb = mix(u_core, u_edge, smoothstep(0.3, 1.0, d / r));
  vec4 c = vec4(u_glow * wide, wide);
  c = over(vec4(mix(u_shine, u_glow, min(1.0, d / 22.5)) * tight, tight), c);
  o = over(vec4(orb * body, body), c);
}`;
