# The coloring book look: handoff

This folder carries a picked design direction to the agent that builds it into the app.
It is a reference, not source: nothing in `src/` or `index.html` loads it, and the pull request that ships the look deletes this folder.

- `prototype.html`: the coloring book direction on a phone-sized page, all three screens, walking the demo route through the Jordaan. Plain HTML and canvas 2D, no build step.
- `city.js`: the demo city it draws, `window.CITY`: streets, paths, houses, water, parks, places and the demo route, projected from OpenFreeMap tiles. 1 unit is 1.495 m.
- `kit.js`: the walk player and stats the prototype uses, `window.Kit`. It presses Start for you, so the page opens straight into the walk.

To see it, run `npm run dev` and open `http://localhost:5173/docs/design/coloring-book/prototype.html`.
It walks at 25× speed, about 2.5 minutes for the 4.2 km loop, and ends on the summary.
`#start` opens the cover, `#walk` jumps into the walk at 960 m, `#summary` shows the summary after 1.45 km.

## The brief

You are building this direction into the real Mr Sparkles app.
First read `AGENTS.md`, `docs/adr/README.md` and ADRs 0004, 0006, 0007, 0008, 0011, 0012 and 0013.
Then play the prototype through all three screens and read its script.
Where this brief and the prototype disagree on how something looks, the prototype wins.
Where they disagree on how the app works, this brief and the ADRs win.

**In one line:** the city is no longer a night in fog, it is a coloring page.
Streets you have not walked are blank black outlines on white paper.
Every street you walk is colored in with crayon for good, with its houses and its name.
Mr Sparkles is a stubby crayon who colors as he walks, and wears down as he goes.

### 1. Decide first, in one ADR

Write it with the `adr` skill before you build. It supersedes 0012 (the firefly, the welcome scene, Nunito).
Settle these open points with the user, then record them:

- **Type.** The prototype uses Marker Felt and Chalkboard SE.
  They are Apple system fonts: they cannot ship under ADR 0007, other browsers lack them, and MapLibre needs a font file for its labels.
  Pick an open-licensed handwriting pair and check its license file.
  Recommended: Kalam Bold for headlines, claims and street names (the marker), and Patrick Hand for body text (the kid).
  Subset each to latin and latin-ext WOFF2 like the files already in `public/fonts/`.
  Preload the latin files the cover uses, and declare them in `src/map/style.ts` `fontFaces()`.
  Delete the font files nothing uses any more.
- **The three states of the map.** The prototype prints the whole page in full black ink, because it has no sight.
  The app keeps unknown, seen and walked (ADR 0006). Recommended:
  - **Unknown:** a paper wash over the line art, so the outlines show faintly, like a page not looked at yet.
  - **Seen** (the seen memory, the lantern and the beam): the wash clears and the outlines print in full black.
  - **Walked:** crayon.
  The fog layer keeps its structure (one custom layer, its masks, the shadows, the seen memory). Only its look changes.
- **The walk readout.** The HUD pill now hides and comes up on a tap. The prototype's crayon box stays up for the whole walk.
  Recommended: keep it up. It is the toy you watch fill.
- **The cover for a returning walker.** The cover is designed for a first-time walker.
  ADR 0012 shows your own map behind the start screen once you have one (`.wl-has-map`).
  Recommended: the cover becomes a card at the bottom over your own colored-in page, with the title, the question, your lifetime numbers (`wl-stats`) and Start.

In the same change, update what describes the look: the Product lines in `AGENTS.md`, `docs/guide.md` and `README.md`.

### 2. Paper and ink: the basemap

Change `src/theme.ts` and `src/map/style.ts`, and the palette `index.html` repeats.
The widths below are CSS px at the prototype's scale, which is about MapLibre zoom 16.1 in Amsterdam. Scale them with zoom like the streets.

- **Fills:** paper `#fffefb`. Houses, parks and water are white.
- **House outlines:** black, about 1 px.
- **Streets:** a black casing about 1.4 px wider on each side, with the inside cut back to paper, so crossings stay open.
  Put the casing layers under the inner layers.
  Prototype widths in metres: primary 10.5, secondary 9.6, tertiary 8.4, minor 6.6, busway 6.9, pedestrian 5.7, service 4.8, track 4.5, path 3.3.
- **Paths:** thin black dashes, about 1 px wide with 3.4 px dashes.
- **Water:** black outline, about 2 px. The little wave strokes inside are optional.
  There is no sprite (ADR 0007): `mapView.ts` already draws an image on a canvas for the landmark dot.
- **Parks:** a black outline. The cloud trees are optional.
- **The ghost streets over the fog** are probably redundant once outlines show through the wash.
  Keep `ABOVE_FOG_LAYER` as the place the fog goes in.

### 3. Crayon: what walking leaves behind

**The box.** 13 colors. `wax` is how a crayon colors; `press` is the same crayon pressed hard, dark enough for text (at least 4.5:1 on paper).

| wax | press | | wax | press |
|---|---|---|---|---|
| `#1fa2e8` | `#0b6eaa` | | `#8c5cf0` | `#6c3ed8` |
| `#ff8a1f` | `#ad4e00` | | `#a6d93a` | `#4a720b` |
| `#ee3e9e` | `#c0157a` | | `#13bfb0` | `#06756b` |
| `#ffd02e` | `#836300` | | `#be95ff` | `#7f43e0` |
| `#c0763e` | `#97521e` | | `#ffa27f` | `#b5470f` |
| `#ff5a6e` | `#c81e42` | | `#3557e6` | `#2c4ad1` |
| `#e3256b` | `#c7185a` | | | |

Water is `#55c4f0`.

**Which crayon.** The prototype hands out crayons in the order a walk claims streets.
The app keeps streets across walks, so give each street a stable crayon: a hash of its name, or of its way id when it has no name.
A house takes its street's crayon 45% of the time, and otherwise a hash of its own id.
Leave one small test for the picker: the same name gets the same crayon, and it is always in range.

**The tooth.** Crayon skips over the paper's grain, so about a quarter of the paper shows through.
The prototype builds a seamless 256 px mask: value noise from lattices of 64, 128 and 32 cells, weighted 0.5, 0.32 and 0.18 random.
Noise over 0.64 is a hole, below 0.58 is full, with a ramp between, all times 0.8 to 1.0.
Text is pressed hard, at least 90% cover.
Anchor the tooth to the map, not the screen, so it does not crawl while the camera follows.
Crayon multiplies over the ink and never covers the black lines.

**A street.** Two strokes:

- a soft band at 30% opacity, 0.95× the street's width;
- a back-and-forth scribble at 78%, about 2 px wide.
  It crosses the street every 1.9 px along it, swinging 0.6× the width either side, with a little jitter.

It colors in from the end Mr Sparkles walks in from, keeping pace with his tip.
On the GPU this is the segment shader's along-street distance, which the unlock sweep already has.
The flash wave becomes the crayon's front.
The street needs its color in the fog pass: the mask holds one lit channel today.
Draw lit pieces and houses in their wax color into a color target the composite reads.

**A house.** Diagonal hatching clipped to its footprint:

- strokes at −0.62 rad ±0.25, 1.8 px apart, at 64%;
- the hatch shifted 1–2 px off register;
- a 45% outline;
- one house in five gets one stray stroke that got away outside it.

It scribbles in over 300 ms when it lights.

**Street names.** In the headline face, along the street, in the street's press color, with a paper halo `rgba(255,254,251,.9)` 0.32× the size.
Give the features from `nameLines()` in `src/map/names.ts` a color property for `text-color`.

**Optional, later:**
- the canal beside him colored as he passes;
- his own trail as a thin press-colored line;
- a hatched dot on each place he passes.

These are decoration only: nothing counts as walked unless ADR 0004 lit it.

### 4. Mr Sparkles, the crayon

His drawing is `mrInner(wear)` in the prototype: viewBox `0 0 60 100`, shown at 32×53 CSS px, with his tip at the walker's position.

- **Look:** a white wrapper with a wax band, a wax tip and a press-colored top; black 2.1 strokes, eyes, pink cheeks, an open smile, two little arms.
- **Color:** his wax is the crayon of the street he is coloring now.
- **Wear:** he wears down over a walk. His body is `max(24, 50 × wear)` tall, with `wear = 1 − 0.42 × progress`, quantized to 1/40.
  There is no fixed route in the app, so use `progress = min(1, walk distance / 5 km)`. He is new again on the next walk.
- **While walking:**
  - he bobs: −5° to 5° and up 2.5 px, 0.36 s, alternating;
  - he leans 15° × cos(heading) toward where he goes, eased;
  - on each new street he pops: `scale(1.3, .78)` back to 1 over 0.45 s;
  - his shadow is a 17×5 px ellipse, 13% black.
- **Drawing:** keep him on the GPU, as `src/map/puckLayer.ts` does now (a DOM marker lags a frame, ADR 0012).
  Rasterize his SVG into a texture, again only when his wax or wear changes, and draw it as a textured quad.
  Bob, lean and pop happen in the shader.
- **Standing still:** he holds still, so the frame rate can drop (ADR 0008).
  With reduced motion he never bobs or pops.

### 5. The new-street moment

When a street is colored in (`unlockBlocks` in `src/app/app.ts`, where the gold name is written today):

- **The lettering.** Its name is written big across the top of the map, in a band from 56 px down, 150 px tall.
  - Size: headline face, bold, 52 px, shrunk to fit the width less 64 px, never under 26 px.
  - Letters come one by one, every 55 ms, each with a pop from 0.6 to 1 with overshoot.
    Each is jittered: ±0.1 rad, ±3.5 px up or down, scale 0.93–1.07.
  - The line tilts −2.6°.
  - Under the letters lies a 12 px paper halo. Each letter is a wax copy offset (1.3, 1) px with the press color on top.
  - A wavy crayon underline follows, wax 5 px over a 10 px halo, drawn in 360 ms.
  - It stays 4.3 s, then fades over 0.45 s.
- **Queue:** two names close together each get 1.4 s on their own.
- **Screen readers:** a polite live region says "Colored in Prinsengracht."
- **Mr Sparkles:** he pops, takes the new crayon, and a crayon pops up out of the box (section 7).
- **His line:**
  - the first street: "Here we go! First street.";
  - a bridge (`…sluis`, `…brug`): "A bridge! Colored in.";
  - otherwise, in turn: "Colored in!", "That one's ours for good.", "Another street, colored in!", "Look how bright it is now!", "Ooh, a new color!".

The DOM is the lazy build: one span per letter, with `animation-delay: calc(var(--i) * 55ms)`.

### 6. His speech bubble

**Look:** white, a 2 px black border, hand-drawn corner radii, the body face at 15 px.
It sits above his head with its tail pointing down at him, kept 12 px inside the screen's edges.

**Who speaks when:**
- Claims and landmarks wait their turn, up to 3 waiting.
- Passing places speak only when he is free and 1.6 s after his last line.
- A line holds 1.7 to 2.2 s.

**Lines for places**, by class:

| Class | Line |
|---|---|
| cafe | "{name}. Coffee later?" |
| restaurant | "Ooh, {name}." |
| bar | "{name}. Cheers!" |
| bakery | "Mmm, {name}." |
| gallery or museum | "Art! {name}." |
| attraction | "Look, {name}!" |
| hairdresser | "{name}. Snip snip." |
| library or school | "Books! {name}." |
| anything else | "Spotted: {name}." |

In the app, places come from the landmarks you see (`src/app/sightController.ts`).

### 7. The crayon box: the walk readout

It replaces the HUD pill (`src/ui/hud.ts`, `#wl-hud` in `index.html`) as a tray at the bottom.

- **The box:** 238×132 px. The back is `#e9ad00`, the front `#ffd23f`, with a dashed seam and a 2.8 px black border.
- **The crayons:** each 13×62 px, one per street colored in on this walk, up to 13.
  They sit `min(16.1, 206 / n)` px apart, tilted ±5°.
  Each pops up out of the box as its street is colored: from 66 px down to in place, 0.55 s, springy.
- **The numbers:** time, distance and steps, from `src/core/stats.ts` as now.
  The label is the body face at 12 px; the number is bold, 21 px, tabular.
- **End:** it takes the rest of the row: 62 px tall, the headline face bold at 23 px, rotated 1.4°, in the crayon button style.
  The first tap reads "End walk?" at 19 px over red wax (`#ff5a6e`) and wiggles. A second tap within 3 s ends the walk (keep `CONFIRM_MS`).

### 8. The cover: the start screen

It is in `index.html`, inline SVG and CSS, with no script before the first paint (ADR 0007).
The prototype builds its title and scene with script (`titleSVG()`, `sceneSVG()`).
Open it at `#start` and copy the `#titleArt` and `#scene` SVG out of the DOM into static markup.

- **The page:** yellow `#ffd23f`, with a hand-drawn 2.6 px border inside.
- **The title:**
  - "Mr" in the headline face at 34 px, rotated −8°;
  - "Sparkles" below it in bubble letters, each letter a different crayon and a little off register;
  - the tagline "your city's coloring book".
- **The scene:** a row of canal houses, half colored in, and the street colored up to Mr Sparkles.
  A canal runs below. A tree and a cloud are still blank.
  He waves, saying "Hi! I color in every street you walk."
- **The words:**
  - the question, 23 px bold: "How much of your city have you colored in?";
  - below it, 15.5 px: "Every street stays a blank outline until you walk it. Then it's colored in for good, with its houses and its name. Tapping colors nothing. Walking does.";
  - in the browser demo only, the fine print in `#2b2300`: "A walk through Amsterdam, no location needed."
- **Start:** the crayon button. Its label stays as now: "Start the demo walk" in the browser, "Start walking" in the app (`src/ui/splash.ts`, `index.html`).
  Start turns the cover like a book page onto the map already drawn under it:
  - origin at the left edge;
  - `perspective(1400px) rotateY(-112deg)`;
  - 0.9 s, `cubic-bezier(.55,.06,.3,1)`.
- **The crayon button:**
  - white with the crayon tooth, a 2.8 px black border;
  - radius `22px 30px 20px 28px / 28px 20px 30px 22px`, shadow `0 4px 0 #000`;
  - the body face, bold, 20 px;
  - on hover `rotate(-1.6deg) translateY(-1px)`, when pressed `translateY(3px)` with shadow `0 1px 0`;
  - with keyboard focus, a 3 px dashed black outline 4 px out.
- **What goes:** the welcome scene of ADR 0012 (Mr Sparkles over `public/welcome.jpg`) goes. Delete the picture and its script.
- **What stays out:** the blue gingham desk and loose crayons frame the prototype on a wide screen; they are not part of the app.

### 9. The summary: the page on the fridge

It replaces the summary in `src/ui/splash.ts` and its markup in `index.html`. `src/ui/summaryText.ts` keeps the words.

- **The fridge:** a grey door gradient with a handle.
- **The sheet:** a torn, perforated left edge, rotated −1.8°, held by a blue magnet (`#bdeaff` to `#0a5f94`) that clacks on. It drops in over 0.7 s.
- **The heading:** "Wow, 6 streets!" in the headline face at 44–52 px, each letter in a crayon color and a little jittered. "Wow," sits on its own line.
- **The page:** the walk on your map, `clamp(150px, 26vh, 212px)` tall, labelled "Your page, colored in where you walked."
  The prototype draws it on its own canvas.
  In the app, `frameWalk` already pulls the map back to show the walk: leave a window in the sheet for the live map, and frame the walk into it.
- **The distance:** the headline face, bold, 64 px, with a round dot for the decimal point and a 26 px unit.
  Under it: "{12 min} of walking, {1,652} steps".
- **New on your map:** up to three names, each with a zigzag swatch in its crayon, then "and N more streets and N houses".
  When nothing is new, keep `summaryText.ts`'s lines.
- **The end:** "Walk again" (the crayon button) goes back to the cover.
  Mr Sparkles is stuck on the fridge, worn down by the walk, saying "Fridge-worthy!".

### 10. Motion and access

- **Reduced motion:** no bob, wiggle, pop, letter-by-letter writing, page turn or drop. Everything appears in place.
- **Contrast:** text uses press colors or black, at least 4.5:1, and the new fonts keep it so.
- **Screen readers:**
  - the map has an `aria-label`;
  - claims go to a live region;
  - each screen moves focus to its heading, as the prototype does.
- **Targets:** at least 44 px.

### 11. What must stay true

- **The invariants in `AGENTS.md`.**
  - Walks stay on the phone.
  - Only real walking colors a street; the cover's scene is a picture.
  - One app.
  - The first paint comes from `index.html` alone.
  - The frame budget: standing still costs almost nothing. The tooth is a static texture, the lettering is DOM, the masks stay memoized.
- **This repository is public:** no personal data, the demo city is Amsterdam, and `scripts/check-public.sh` stays green.
- **One palette:** `index.html` repeats the palette of `src/theme.ts`. Keep the two in step.

### 12. Order of work

Each step leaves the app working. Check each in the demo.

1. The ADR and its open points (section 1).
2. The fonts.
3. Paper and ink: `src/theme.ts` and `src/map/style.ts`.
4. Fog to paper wash and crayon: `src/map/fog/shaders.ts`, `fogLayer.ts` and `seenLayer.ts`.
5. Street names.
6. Mr Sparkles: `src/map/puckLayer.ts`.
7. The new-street moment and the bubble.
8. The crayon box: `src/ui/hud.ts`.
9. The cover: `index.html` and `src/ui/splash.ts`.
10. The fridge summary.
11. Delete this folder and update the docs.

### 13. Done when

- `npm test`, `npm run typecheck` and `npm run build` pass.
- In `npm run dev` at `localhost:5173` and with `?sim=fast`, all of these work:
  - Start;
  - streets colored in;
  - a claim;
  - End twice;
  - the summary;
  - Walk again;
  - a reload mid-walk;
  - a second walk as a returning walker.
- At 390×844, side by side with this prototype, it reads as the same direction.
- Standing still drops to the idle frame rate (ADR 0008).
- `npm run ios:sync` builds.
  Real GPS is tested only in the iPhone app, and `xcodebuild` runs outside any other sandbox.
- Commit subjects are plain imperative sentences about the walker, such as "Color in the streets you walk, like a coloring book".
