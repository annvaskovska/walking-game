# 0012 - Mr Sparkles is a firefly you meet on the first screen

Status: accepted

## Context

This changes two details of earlier records: the start screen's logo and preloaded fonts (ADR 0007), and the wordmark `Mr <i>Sparkles</i>` (ADR 0011).
The rest of both still holds.
The start screen showed a logo of a street and a cone over the name in Instrument Serif, and a solid gold Start button.
Feedback on it: the name read like the title of a corporate slide, the button was the obvious choice, and the type felt like a presentation.
The name belongs to the mascot, a small light that lights the city, so the first screen should introduce him and show the game rather than name it.
Of five animated designs, the pick was one round light that flickers like a candle: no rays, no face, no second star, with the shine around him and his flashlight kept.
A first-time walker has no map behind the start screen, because location is asked for only on Start (ADR 0007), and nothing may light from a touch (ADR 0004).

## Decision

- Mr Sparkles is one round light: a cream orb that turns gold at its edge, in a tight bright shine and a wide warm one, flickering out of step.
  - On the map he is the walker, drawn by `PUCK_FS` in `src/map/fog/shaders.ts` with the colours in `theme.puck`.
    The chevron that pointed where you walk is gone: his flashlight, the fog layer's beam, shows the way.
  - On the start screen he is inline SVG in `index.html`, animated by CSS alone, so he moves before any script has run.
    He pulses, two soft rings leaving him, while nobody touches him.
- With no map behind it (`html:not(.wl-has-map)`), the start screen is the game in small.
  - Mr Sparkles wanders over a fogged picture of the demo city, `public/welcome.jpg` (a capture of the app's own map in Amsterdam, 62 KB).
    A drag moves him, his beam thins the fog ahead, and the fog never returns where he has been.
  - An inline script in `index.html` draws it on two canvases at half resolution, while the screen shows.
    It never touches the map, the walk or storage: the lit trail is a picture and is gone on reload.
  - With your own map behind it, the start screen shows that map, as before, and not the scene.
- The start screen says "How much of your city have you really walked?" and "Take Mr Sparkles out and see. He lights every street you walk."
  The name is a word in that line, the page title and the home screen name, not a wordmark.
- The interface's type is Nunito (OFL, `public/fonts/nunito-latin.woff2`, latin only, 39 KB), declared and preloaded in `index.html`.
  It replaces Instrument Sans in the interface, and the start screen no longer preloads Instrument Serif.
  Instrument Serif stays for the summary's numbers and the street names on the map, and Instrument Sans for the map's place names.
- Start is a pill of dark glass with a gold edge, lit from inside.

## Consequences

- A first-time walker sees what walking does before the app asks for location.
- ADR 0004 holds: the scene lights a picture, never a street, and stores nothing.
- The first paint still needs no script; the preloaded fonts drop from about 60 KB to 39 KB.
  The picture loads after the first paint and only shows where he has been.
- The scene redraws two small canvases every frame while it shows, and stops when the start screen goes or a map is behind it.
  With `prefers-reduced-motion`, he stays in place and does not flicker, and a drag still moves him.
- A walker sees the scene until their first walk; from then on the start screen shows their own map.
- The picture is a capture of the map's look: a change to that look needs a new capture.
- Nothing checks the look or that the scene stays apart from the walk; review holds both.
