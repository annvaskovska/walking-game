# 0004 - Only real walking lights streets

Status: accepted

## Context

The game is to walk the city, so a street must light only when the walker really walked along it.
Phone GPS is noisy: a fix can be tens of metres off between tall houses, a single fix can jump, and a walker who stands still drifts.
Buses, trams, bikes and cars move along streets too.
A step near a junction, or on a sidewalk, is close to more than one street at once.

## Decision

- Nothing lights a street except a filtered GPS step.
  A tap on the map only shows the walk numbers, and what the light has seen never lights a street.
- `stepFilter` in `src/core/gpsFilter.ts` is pure, and its state is saved with the walk.
  With the values in `src/config.ts`, it:
  - ignores fixes with an accuracy worse than 35 m, and fixes with a duplicate timestamp;
  - drops a hop faster than 7 m/s that is longer than the two fixes' accuracies added, and after 5 such hops in a row trusts the new place without lighting the gap;
  - treats a move shorter than half the accuracy, clamped to 3-10 m, as standing still;
  - calls it a vehicle when the straight-line speed over 20 s (8 s at least) is above 4 m/s, when 3 s already show more than 5 m/s, or when the Doppler speed is above 6 m/s and the hop is faster than 4 m/s;
  - starts a new chain after 60 s without a fix at a place more than 100 m away.
- `WalkAlong` in `src/core/walkAlong.ts` matches each good step to the street it follows:
  - both ends of the step lie within the search radius: the GPS accuracy clamped to 15-25 m, and never more than 20 m;
  - the step advances along the street by at least 1 m and 60% of its own length, and by at most 1.5 times its length plus 2 m;
  - only the nearest street counts, and any other street within 5 m of that distance;
  - an unnamed footway, path or steps within 10 m of a road that the step also follows is that road's sidewalk.
- The tile parser already drops sidewalks, short crossings and piers (ADR 0003).
- The demo walk (`?sim`) is the only other source of fixes; it goes through the same filter and keeps its own records (ADR 0001).

## Consequences

- A lit street means it was walked.
- Some real walking stays dark: steps while the GPS is worse than 35 m, and anything faster than 4 m/s.
  The app shows a notice after 8 s of weak GPS and when it calls a vehicle, so the walker knows why.
- `stepFilter` and `WalkAlong.add` depend only on their inputs, so a reload or late tiles replay the saved steps into the same result.
- `src/core/gpsFilter.test.ts` and `src/core/walkAlong.test.ts` check these rules.
  No test checks that nothing else calls the lighting code; review holds that rule.
