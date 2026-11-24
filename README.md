<p align="center">
  <img src="ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png" width="128" height="128" alt="Mr Sparkles app icon: a smiling blue crayon on a yellow cover, coloring in a street.">
</p>

<h1 align="center">Mr Sparkles</h1>

<p align="center">
  <b>Your city starts as a coloring page. Every street you walk gets colored in with crayon, for good.</b><br>
  A walking motivator for your iPhone, with a demo walk in the browser.<br>
  No account, no server: your walks stay on your phone.
</p>

<p align="center">
  <a href="https://annvaskovska.github.io/walking-game/"><img src="https://img.shields.io/badge/Try_the_demo_walk-000?style=for-the-badge" alt="Try the demo walk" height="40"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/iPhone-records_with_the_screen_locked-1c1c1e?logo=apple" alt="The iPhone app records with the screen locked">
  <img src="https://img.shields.io/badge/web-demo_walk_through_Amsterdam-1c1c1e" alt="The web version is a demo walk through Amsterdam">
  <img src="https://img.shields.io/badge/data-on_your_phone-1c1c1e" alt="Your data stays on your phone">
</p>

---

## What is Mr Sparkles?

Mr Sparkles is a small walking motivator.
Your city starts as a black ink drawing on white paper, and every street you walk is colored in with crayon, with its houses and its name.
The color stays, so each walk shows you where you have not been yet.

Open it and you get the cover: a yellow page with the title, a canal drawing and **Start**, and after your first walk your streets so far.
Start turns the page onto the map.
On the map you are Mr Sparkles, a stubby crayon who colors in the street you walk and wears down a little on every walk.

---

# Core features

## Walk a street, and it gets colored in

Walk along a street and the whole block colors in from where you stand.
Each street keeps one crayon of 13, scribbled in a little past its lines, and its name is written in that crayon; the houses beside it are colored in too, many in the street's crayon and the rest in crayons of their own.
A new street gets its name written big across the page, Mr Sparkles says something about it, and its crayon pops up in your crayon box.
A street you walk only part of still shows where you went.

## Mr Sparkles names what he sees

Your view stops at walls and spills between houses.
A landmark it reaches, such as a church at the end of the street or a café on the corner, gets its little picture colored in, and Mr Sparkles names it.
Turn the phone to look around: the view follows the compass.

## Only real walking counts

There is no tap-to-explore.
Fixes that are too inaccurate, glitchy jumps, and anything faster than a brisk walk, such as a bike, a tram or a car, are ignored.
A step colors only the street it follows, so walking past a side street does not color it.

## Walk with the screen locked

The iPhone app keeps recording with the screen locked.
Put the phone in your pocket, and when you look again, the streets you walked are colored in at once.

## Your walk in a crayon box

The crayon box at the bottom shows the time, the distance and an estimate of your steps, with one crayon for each street you colored in on this walk.
End the walk and its page goes on the fridge: your map of it, the distance and the new streets.

---

# Install

**On iPhone**, Mr Sparkles walks for real, with the screen locked too.
[Run it from Xcode](docs/guide.md#run-it-from-xcode) with a free Apple Account.

**In any browser**, **https://annvaskovska.github.io/walking-game/** is a demo: Mr Sparkles walks a route through Amsterdam for you, and never asks for your location.

# Use

1. Tap **Start walking** and allow location.
2. Walk: each street colors in as you follow it.
3. Turn the phone to look around.
4. Tap **End** in the crayon box, and again to be sure, for the page of your walk.

---

# Private by design

Your walks, your colored streets and what you have seen stay on your phone, in the app's own storage.
There is no account, no server and no analytics.
Apart from the app itself, the only downloads are the map tiles from [OpenFreeMap](https://openfreemap.org), which sees the rough area you walk in but not your track.
The iPhone app asks for location only *While Using the App*.

# How it works

- **Real walking only.** GPS fixes pass a filter, and a step colors only the street it runs along.
- **One download per tile.** The vector tiles that draw the map are also parsed into the street graph and the houses.
- **Crayon on the GPU.** One MapLibre layer draws the crayon over the ink drawing, through the paper's tooth, and Mr Sparkles is drawn on the GPU too.

The stack: TypeScript and Vite, MapLibre GL with custom WebGL layers, OpenFreeMap vector tiles, and a Capacitor shell with Swift GPS for iPhone.
[More under the hood](docs/guide.md#under-the-hood), and why it is built this way in the [decision records](docs/adr/README.md).

# Build from source

You need Node 22 or later.

```sh
git clone https://github.com/annvaskovska/walking-game && cd walking-game
npm ci
npm run dev        # http://localhost:5173
```

In a browser it is the demo walk; **http://localhost:5173/?sim=fast** walks it at 10× speed.
`npm test` runs the unit tests, and `npm run build` type-checks and builds into `dist/`.
The [guide](docs/guide.md) covers the iPhone app and TestFlight.

# Contributing

Read [AGENTS.md](AGENTS.md) for the invariants and the code style.
Read the [decision records](docs/adr/README.md) for the area you change, and add one in the same pull request when your change makes or reverses a decision.
This repository is public: keep secrets, account details and personal data out of every commit, as [ADR 0010](docs/adr/0010-the-repository-is-public.md) lists.

---

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors · Tiles: [OpenFreeMap](https://openfreemap.org) / [OpenMapTiles](https://www.openmaptiles.org/).
