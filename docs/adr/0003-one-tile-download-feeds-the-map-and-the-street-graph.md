# 0003 - One vector tile download feeds the map, the street graph and the houses

Status: accepted

## Context

The first versions loaded streets from the Overpass API per z15 cell and buildings per z16 cell, apart from the basemap, and cached both in IndexedDB.
That API has rate limits and queues, and a walk stayed dark while its streets waited for it.
The basemap's z14 vector tiles already carry the walkable lines, their names, the building footprints and the points of interest.
Those tiles are shaped for drawing, not for routing: their lines are merged strokes with no names and no node ids, and sidewalks are not tagged.

## Decision

- `src/data/tileUrl.ts` is the one place the tile URL lives: a dated OpenFreeMap planet build in the OpenMapTiles schema, with no key.
  A newer build is read from the TileJSON in the background and used from the next start, so one session never mixes two builds.
- `TileSource` in `src/data/tiles.ts` is the one place tiles are downloaded.
  MapLibre gets them through the `wlt://` protocol (`src/map/style.ts`, `src/map/mapView.ts`), and the street graph asks for the z14 tile you are in and any neighbour within 250 m.
  Both share one download per tile.
- The map source stops at `maxzoom` 14, so MapLibre draws the same tiles up to zoom 19.
- Until a position is known, the protocol returns empty tiles and nothing is downloaded.
- `src/data/tileWorker.ts` parses each graph tile off the main thread.
  `mvt.ts` decodes only `transportation`, `transportation_name`, `building` and `poi`, with no dependency.
- `src/data/tileParse.ts` builds the graph:
  - it leaves out tunnels, indoor and private ways, below-ground levels, piers, parking aisles and driveways;
  - it drops footway stretches that run beside a road, and short ones that cross it;
  - it finds junctions by geometry and cuts every stroke at them;
  - it takes names from `transportation_name`, matched by geometry and checked per edge;
  - it clips lines and houses to the tile square and gives each way an id hashed from its tile and geometry.
- A tile download is tried up to 3 times; after that, the tiles around you are tried again with a backoff from 1 s up to 30 s, or at once when the phone is back online.
- Four spare graph tiles stay loaded behind you, and the service worker keeps tiles cache-first (4000 entries, 30 days).

## Consequences

- There is one request per tile, no second API to wait for, and the street data always matches the drawn map.
- The rules see only what the tiles carry: no OSM way ids, no sidewalk tags and lines simplified for z14, so the parser rebuilds junctions and sidewalks by heuristics.
- Way ids change when the tile geometry changes, so lit streets are matched again by their shape (ADR 0005).
- The app depends on one free tile host; a new URL scheme means changing `VALID` in `tileUrl.ts` and the boot script in `index.html` together.
- `vite.config.ts` fails the build when it cannot read `DEFAULT_TILES` from `tileUrl.ts`; nothing checks that the URL check in `index.html` matches `tileUrl.ts`.
- `src/data/mvt.test.ts`, `src/data/tileParse.test.ts` and `src/data/graph.test.ts` check the decoder, the parser and the graph.
