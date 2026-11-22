<p align="center">
  <img src="ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png" width="128" height="128" alt="Mr Sparkles app icon: a glowing walker where a lit gold street crosses a dark one, with a beam of light ahead.">
</p>

<h1 align="center">Mr Sparkles</h1>

<p align="center">
  <b>Your city starts in fog. Every street you walk lights up, for good.</b><br>
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
Your city starts in fog, and every street you walk lights up with its houses and its name.
The light stays, so each walk shows you where you have not been yet.

Open it and you get one start screen: a question, your streets so far, and **Start walking**.
The first time, Mr Sparkles waits there in the fog: drag him around and the streets he passes light up.
After that it is just the map: you, a beam of light ahead of you, and the fog.

---

# Core features

## Walk a street, and it lights up

Walk along a street and the whole block lights up in a wave.
Its houses switch their windows on one by one, and its name is written in gold.
A street you walk only part of still shows where you went.

## Your light stops at walls

Your light stops at walls and spills between houses.
Whatever it touches, such as a square at the end of the street or a shop on the corner, stays **moonlit**: blue roofs, a faint name, the landmark's label.
Turn the phone to look around: the beam follows the compass.

## Only real walking counts

There is no tap-to-explore.
Fixes that are too inaccurate, glitchy jumps, and anything faster than a brisk walk, such as a bike, a tram or a car, are ignored.
A step lights only the street it follows, so walking past a side street does not light it.

## Walk with the screen locked

The iPhone app keeps recording with the screen locked.
Put the phone in your pocket, and when you look again, the streets you walked light up at once.

## Your walk in three numbers

Tap the map for the time, the distance, and an estimate of your steps, and to end the walk.
The summary shows the same three numbers and the streets you lit.

---

# Install

**On iPhone**, Mr Sparkles walks for real, with the screen locked too.
[Run it from Xcode](docs/guide.md#run-it-from-xcode) with a free Apple Account.

**In any browser**, **https://annvaskovska.github.io/walking-game/** is a demo: Mr Sparkles walks a route through Amsterdam for you, and never asks for your location.

# Use

1. Tap **Start walking** and allow location.
2. Walk: each street lights as you follow it.
3. Turn the phone to look around.
4. Tap the map for your time, distance and steps, and to end the walk.

---

# Private by design

Your walks, your lit streets and what your light has seen stay on your phone, in the app's own storage.
There is no account, no server and no analytics.
Apart from the app itself, the only downloads are the map tiles from [OpenFreeMap](https://openfreemap.org), which sees the rough area you walk in but not your track.
The iPhone app asks for location only *While Using the App*.

# How it works

- **Real walking only.** GPS fixes pass a filter, and a step lights only the street it runs along.
- **One download per tile.** The vector tiles that draw the map are also parsed into the street graph and the houses.
- **Fog on the GPU.** One MapLibre layer draws the fog, the lit streets, and the shadows every wall casts in your light.

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
`npm install` sets up the hooks that check each commit and each push for them ([ADR 0014](docs/adr/0014-a-push-is-checked-with-every-commit-it-sends.md)).

---

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors · Tiles: [OpenFreeMap](https://openfreemap.org) / [OpenMapTiles](https://www.openmaptiles.org/).
