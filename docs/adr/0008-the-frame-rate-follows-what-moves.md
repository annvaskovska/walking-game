# 0008 - The frame rate follows what moves, and still frames skip work

Status: accepted

## Context

A walk keeps the screen on for as long as it lasts in the browser, so every frame drawn costs battery.
Most of a walk is at walking pace or standing still, when nothing on screen moves by more than a pixel a frame.
GPS fixes come about once a second and nudge a walker who stands still by centimetres, and a compass held in the hand trembles.
Drawn as they came, those nudges slid the walker, and the camera that follows it, by a fraction of a pixel every frame, which kept the whole map redrawing at full rate for nothing.

## Decision

- One `requestAnimationFrame` loop in `src/app/app.ts` draws the walker, the light and the camera, and picks its rate each frame:
  - every display frame while the fog animates (an unlock wave, windows coming on), the camera settles, or the walker moves faster than 24 map pixels a second;
  - 30 fps while the walker or its light moves, or the beam turns faster than 20° a second;
  - 15 fps otherwise, which is enough for the mist and the glow to move;
  - nothing at all under a start screen with no map behind it.
- `Motion` in `src/core/motion.ts` filters fixes with a Kalman filter, glides between them over one fix interval, and follows the glide with a critically damped spring.
  Once the walker is slower than 0.5 m/s and within half a map pixel of its target, it holds still until the target is more than a pixel away.
- `MaskMemo` in `src/map/fog/maskMemo.ts` keeps the fog's masks when they would come out the same: no change to their content, nothing animating, the same zoom and size, a pan or a move under 0.25 mask pixels, and a beam turn under 0.2°.
  The composite pass still runs every frame, for the mist.
- `src/map/mapView.ts` caps the pixel ratio at 2, because three device pixels per CSS pixel cost 2.25 times the fill of two and look the same under fog.
- The fog's masks are drawn at half resolution (ADR 0006).
- Heavy work is spread over frames: at most 24 seen textures are uploaded a frame, and fixes replayed after the lock screen are looked from every 5 m, at most 6 a frame.

## Consequences

- A walker who stands still costs a composite pass 15 times a second and no mask passes.
- Fast motion still draws on every display frame, so unlock waves and camera slides stay smooth.
- Anything that animates must say so through `FogLayer.animating`, `FollowCamera.settling` or `MotionFrame.moving`, or it runs at 15 fps.
- Every `FogLayer` method that changes what goes into the masks must bump its `version`, or the old masks stay on screen.
- `FogLayer.stats` counts drawn and kept masks, and the demo walk shows them through `__wanderlight.summary()`.
- `src/core/motion.test.ts` checks the hold, and `src/map/fog/maskMemo.test.ts` checks when the masks are kept.
  No test checks the frame loop in `app.ts`.
