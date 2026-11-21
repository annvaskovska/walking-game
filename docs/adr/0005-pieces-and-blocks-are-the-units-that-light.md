# 0005 - Pieces of 20 m and blocks of up to 160 m are the units that light

Status: accepted

## Context

The first versions lit a whole block between two junctions once about half of it was walked, so a street walked for less than that stayed dark.
A long street with no junctions would light only after a long walk along it.
GPS steps end anywhere, also across the line where two pieces of a street meet.
The tiles have no OSM ids, and their geometry changes from one map build to the next (ADR 0003), but what was lit must stay lit.

## Decision

- Each way is one street edge between junctions, dead ends or the tile edge (ADR 0003).
  `splitWay` in `src/geo/pieces.ts` cuts it into round(length / 20 m) equal pieces, with ids `wayId:k` that stay the same while the way does.
- `buildBlocks` in `src/core/blocks.ts` groups the pieces of a way into blocks of at most 160 m, cut into about equal parts at piece boundaries, with ids `wayId:first-last`.
- `WalkAlong` keeps the walked intervals of each block, merged so that backtracking never counts twice, and measures them along the whole block.
- A piece lights when its walked length reaches 40% of the piece, and at least 6 m or its whole length if it is shorter.
- A block unlocks when its walked length reaches 50% of the block, and at least 8 m or its whole length.
  Then all its pieces light, as a wave that runs out from where you stand.
- Houses within 20 m of a lit piece or an unlocked block light their windows.
- Each piece counts its visits, once per walk.
- The walk's steps are saved with it as `[aLon, aLat, bLon, bLat, radius]` and replayed when tiles arrive late or the page reloads.
- When a tile loads, a block counts as lit when all its pieces are lit by id.
  Otherwise `Progress.coverage` samples it, and it counts as lit when 70% of it runs within 6 m of lit pieces that go the same way, so streets lit before a map update light again.
- The values live in `src/config.ts`: `pieceLengthM`, `maxBlockLengthM`, `pieceLightFraction`, `pieceMinCoverM`, `blockUnlockFraction`, `blockMinCoverM`, `houseRadiusM` and `relightFraction`.

## Consequences

- A short walk into a street still shows on the map, and long streets fill in by stages.
- Changing `pieceLengthM` or `maxBlockLengthM` changes the ids, and shape matching then has to carry old progress over.
- Shape matching can light a block that was not walked when most of it lies along lit streets.
  `src/core/progress.test.ts` checks that a lit cross street does not count, and that a house is not lit twice under a new id.
- `src/geo/pieces.test.ts`, `src/core/blocks.test.ts`, `src/core/walkAlong.test.ts` and `src/core/progress.test.ts` check the cuts, the thresholds, the replay and the matching.
