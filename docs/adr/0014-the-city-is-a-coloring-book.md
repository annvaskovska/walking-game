# 0014 - The city is a coloring book

Status: accepted

## Context

This replaces ADR 0012 (the firefly, the welcome scene, Nunito), changes the look but not the structure of ADR 0006, and ends ADR 0007's font preload.
The coloring book design (`docs/design/coloring-book/`, a brief and a prototype) turns the night in fog into a coloring page: streets you have not walked are black outlines on white paper, and every street you walk is colored in with crayon for good.
Two ports drifted from it: first muted pencils and a serif, then the crayon on the map but a pencil for Mr Sparkles, no crayon box and a plain summary.
Both were rejected: the prototype is exactly the look the app must have, and any drift from it is a fault.
The prototype sets its type in Apple system fonts, which other browsers lack and MapLibre cannot draw from a file.
The app keeps its rules: the first paint needs no script (ADR 0007), only real walking colors a street (ADR 0004), and a walker who stands still costs almost nothing (ADR 0008).

## Decision

- The prototype is the specification of the look; the brief and the ADRs say how the app works.
- **Type.** The hand (titles, numbers, claims, street names) is Marker Felt and the kid (everything you read and tap) is Chalkboard SE, as in the prototype, where the system has them: Apple's phones and Macs.
  Elsewhere Kalam Bold and Patrick Hand stand in (OFL, `public/fonts/`, latin and latin-ext WOFF2), and MapLibre always draws its labels from them.
  They are not preloaded, since Apple devices never download them.
  `--hand` and `--kid` in `index.html` and `paperTheme.font` in `src/theme.ts` hold the stacks.
- **One page in full ink.** The map prints in black ink on white paper everywhere, as the prototype does (`src/map/style.ts`): houses, water and parks in outline, waves in the canals, cloud trees in the parks, streets as a casing cut back to paper, paths as dashes, and a pictogram for each place (cup, plate, mug, bread, frame, scissors, book, flag, church, bag).
  The fog layer's paper wash, its light mask, its wall shadows and its seen overprint go (`seenLayer.ts`, `shadows.ts`).
  The seen memory stays, on the CPU: a landmark you have seen gets its pictogram colored in, and Mr Sparkles names it.
- **Crayon.** The box holds the prototype's 13 crayons, each a `lay` (wax) and a `press` color for text, at least 4.5:1 on paper.
  Each street keeps one crayon by a hash of its name (`pencilOf`), and a house takes its street's crayon 45% of the time and otherwise one by its own id.
  The fog layer draws it on the GPU, multiplied over the ink through the paper's tooth: a street as a soft band under a back-and-forth scribble, a house as diagonal hatching off register, the walk's own line in press color, and the canal beside you as you pass.
- **Mr Sparkles** is the stubby crayon of the prototype (`mrInner` in `src/ui/art.ts`), in the crayon of the street he colors.
  The walker layer rasterizes him into a texture only when his crayon or his wear changes, and bobs, leans and pops him on the GPU (`src/map/puckLayer.ts`).
  He wears down over a walk, `1 − 0.42 × min(1, distance / 5 km)`, and is new again on the next one.
- **A new street** is written big across the top in its crayon, letter by letter, Mr Sparkles pops and says a line, and a crayon pops up out of the box.
  He also names the landmarks he sees, in a speech bubble.
- **The crayon box** is the walk readout: time, distance, steps and End, at the bottom for the whole walk, with one crayon per street colored in on this walk.
- **The cover** is the start screen for every walker: the yellow page with the title, the canal scene and Start, static markup and CSS in `index.html`.
  A returning walker also sees their lifetime numbers on it.
  Start turns it like a book page onto the map, already drawn under it.
- **The fridge** is the summary: the page of the walk held by a magnet, with your own map of it copied from the live map, the distance, the new streets, Walk again, and Mr Sparkles worn down.
- The prototype's desk, its loose crayons and its phone frame are not part of the app.
- CSS that the first paint does not need (the walk screen, the fridge) is injected by its module at runtime, so it never blocks the first paint.

## Consequences

- The app reads as the prototype on every screen, and the brief's numbers live in the code.
- Unknown and seen streets now look the same: what ADR 0006's light and seen raster decide no longer shows on the streets, only on the landmarks.
  The seen memory still records the ground and the houses you see, so a later look can show them again without new walks.
- ADR 0004 and ADR 0005 hold: what colors is exactly what lit before; the canal and the walk's own line are decoration along real walked steps.
- ADR 0007 holds: the cover is static markup, and the shipped fonts swap in.
- ADR 0008 holds: the crayon layer keeps its paint while nothing in it changes (`maskMemo.ts`), and Mr Sparkles' texture changes only with his crayon or his wear, and he holds still when you do.
- A crayon a street or a house once got must stay its crayon: changing the box, its order or the hash recolors every walk.
- Two streets side by side can get the same crayon in a real city; only the demo walk is tuned.
- `src/theme.test.ts` checks the crayon picker, `src/map/fog/tooth.test.ts` the tooth, `src/map/fog/geometry.test.ts` the crayon's strokes, `src/map/puckLayer.test.ts` the easing of his pop, `src/map/style.test.ts` that MapLibre accepts the style, `src/map/names.test.ts` one name per street, `src/ui/bubble.test.ts` his lines and `src/ui/summaryText.test.ts` the fridge's words.
  Nothing checks the look itself; side by side with the prototype at 390×844, review holds it.
