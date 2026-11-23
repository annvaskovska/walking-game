# 0014 - The city is a pencil drawing you color in

Status: accepted

## Context

This replaces ADR 0012 (the firefly, the welcome scene, Nunito) and changes the look, not the structure, of ADR 0006.
The coloring book design (`docs/design/coloring-book/`) turned the night in fog into a coloring page, and the city colored in by hand was the part that worked.
Its prototype read as a toy for children: comic system fonts, a crayon with a face, a rainbow title, kid lines on every screen, a fridge and magnets, and saturated primary crayons.
It also stacked a crayon in a box for every street walked, which read as a collection with no purpose.
Its summary drew the walk with fixed-width black lines at the zoom that fits the whole walk, so the map came out as a dark mass that looked like a rendering error.
The app also has to keep its rules: the first paint needs no script and no system-only font (ADR 0007), only real walking colors a street (ADR 0004), and a walker who stands still costs almost nothing (ADR 0008).

## Decision

- The look is an ink drawing on warm paper, colored in with colored pencil: `paperTheme` in `src/theme.ts`, repeated as CSS custom properties in `index.html`.
  - Paper `#f6f2e9`, ink `#24221f`, and one light look: the app does not follow the system's dark mode.
  - The basemap (`src/map/style.ts`) draws houses as hairlines, streets as two ink lines with paper between, and paths as dashes.
    Its ink thins and fades as the map zooms out, so a whole walk on one screen reads as a drawing.
- The map keeps its three states, in the same fog layer:
  - **Unknown:** a paper wash at 80% over the line art.
  - **Seen:** the wash clears to 92%, and seen houses print again in ink that thins out with zoom.
  - **Walked:** colored pencil, for good, with the houses beside it and the name.
- Each street keeps one pencil of ten, muted artists' colors: `pencilOf(pencilKey(piece))`, an FNV-1a hash of its name, or of its way when it has none.
  - Every pencil has a `lay` color, multiplied over paper and ink, and a `press` color for text, at least 4.5:1 on paper.
  - The hash basis is picked so the demo walk's first eight streets each get their own pencil, and no two of like hue follow each other.
  - Every walked house gets the same soft house pencil, `#c98f5a` at 42%, so the streets carry the colors.
  - The names of walked streets print in Instrument Serif Italic, in their pencil's `press` color (`src/map/names.ts`).
- The fog layer draws the pencils into a paint target at the masks' half resolution, with MAX blending, and `PENCIL_FS` multiplies it over the map with paper tooth and diagonal strokes.
  A street is colored 4.2 m to each side of its line (a path 2 m), never under 2.4 CSS px, so the summary shows it.
- Mr Sparkles is a colored pencil whose lead is where you are (`PUCK_FS`), in the pencil of the street you follow.
  `WalkAlong.add` reports that street as `on`, also when it was colored in on an earlier walk.
- Nothing collects as you walk: there is no crayon box.
  The walk keeps the HUD pill (time, distance, steps), which hides and comes back on a tap; the summary names the new streets.
- Type is Instrument Serif for titles, numbers and street names, and Instrument Sans for the interface and place names (OFL, in `public/fonts/`).
  `index.html` preloads both latin files (44 KB) and Nunito is deleted.
- The start screen says "How much of your city have you really walked?" and "Take Mr Sparkles out and see. He colors in every street you walk."
  - A first-time walker sees `public/cover.svg` behind it: a static drawing of the Jordaan with part of the demo walk colored in and the pencil at its end (146 KB, 48 KB gzipped).
  - A walker with a map sees their own map, as before.
  - The welcome scene and `public/welcome.jpg` are deleted.
- The iPhone shell paints the same paper before the web view loads: the launch screen, the web view, `capacitor.config.ts`, and a light status bar.

## Consequences

- Every screen reads as one drawing, and the summary of a long walk stays light.
- ADR 0004 and ADR 0005 hold: what colors is exactly what lit before.
- ADR 0008 holds: the paint target is drawn with the other masks and kept while nothing changes.
- The first paint still needs no script; the cover is an image, so it loads after the first paint.
- The cover is a drawing made once from the demo city: a change to the look needs a new drawing.
- Two streets side by side can still get the same pencil in a real city; only the demo walk is tuned.
- A pencil a street once got must stay its pencil: changing the box, its order or the hash recolors every walk.
- `src/theme.test.ts` checks that a street keeps its pencil and that the hash uses the whole box.
  `src/map/style.test.ts` checks that MapLibre accepts the style, and `src/core/walkAlong.test.ts` checks the street you follow.
  Nothing checks the look itself; review holds it.
