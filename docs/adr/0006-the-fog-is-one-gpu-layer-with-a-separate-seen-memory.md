# 0006 - The fog is one GPU layer, with wall shadows and a separate seen memory

Status: accepted

## Context

The fog covers the whole screen, and unlock waves, the pool of light around the walker and the compass beam change it every frame.
The first versions drew it as a canvas overlay that cut soft corridors along lit streets and around lit houses.
The walker's light must stop at walls and spill between houses, not shine through them.
What that light has touched must stay visible for good, but it must never count as walked.

## Decision

- `FogLayer` in `src/map/fog/fogLayer.ts` (id `wl-fog`) is one MapLibre custom layer.
  It sits just below `ghost-path`, so faint streets, names and landmarks stay above it (`src/map/style.ts`).
- First it draws a mask offscreen at half the size of the drawing buffer, with MAX blending and one channel for each kind of light (`src/map/fog/shaders.ts`):
  - R: lit streets and lit house footprints;
  - G: the flash along a street that just unlocked;
  - B: the pool of light around you;
  - A: the beam ahead of you.
- Then a composite pass draws the fog on screen from the mask: mist, a warm rim, lamplight and a gold line along lit streets.
  Lit houses are drawn between the two passes, and seen houses after them.
- `src/map/fog/shadows.ts` darkens B and A behind every wall that faces the light, with one instanced wedge per wall.
  Lit streets in R are never shadowed.
- `OccluderCache` in `src/core/occluders.ts` gathers the walls within 140 m (the 110 m beam, 5 m more, and 25 m of slack) and gathers again only after you move 25 m.
  The GPU shadows and the CPU sight read this one list.
- The seen memory is separate from the fog's masks and from what you walked:
  - `src/core/sight.ts` sweeps rays from you on the CPU, at most every 220 ms, and each ray stops at the first wall;
  - `src/core/seen.ts` paints the result into z17 tiles of 256 by 256 bytes (about 0.7 m a texel at 52° north), saved in the `seen` store (ADR 0001);
  - `src/map/fog/seenLayer.ts` uploads them as R8 textures and draws them into a second half-resolution mask, which the composite reads as moonlight;
  - below zoom 14 the fog leaves that mask empty.
- The fog keeps a local origin, moved after 200 km, so float32 positions stay exact.
- After a lost GL context it builds everything again.
  When the shadows, the seen memory or the seen houses fail to start, only that part turns off, and when the fog fails, the map still draws without it.

## Consequences

- Everything that lights is in one layer and one coordinate frame, so streets, houses, light and shadows line up.
- The seen memory is exact behind walls, because the CPU computes it from the walls themselves; the GPU shadows only draw the live light.
- Seen and walked never mix: seen is a raster in its own store, and walked is pieces and blocks.
- The seen memory grows by up to 64 KB for each new z17 tile the light reaches.
- The fog needs WebGL2 (`#version 300 es` shaders).
- `src/map/fog/shadows.test.ts`, `seenLayer.test.ts` and `maskMemo.test.ts`, and `src/core/sight.test.ts`, `seen.test.ts` and `occluders.test.ts` check the maths.
  No test draws `fogLayer.ts` or its shaders.
