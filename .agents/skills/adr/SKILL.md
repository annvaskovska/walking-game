---
name: adr
description: Record an architecture decision for Wanderlight in `docs/adr/`. Use before building a change that makes or reverses a decision about what lights a street, how location is recorded, what is stored and where, what the app downloads or sends, the map and its tiles, drawing and the frame budget, the iPhone shell, a dependency, or how the app is built and shipped; or when someone asks why Wanderlight is built a certain way and no ADR answers it.
---

# Architecture decision records

`docs/adr/` holds one decision per file, `NNNN-kebab-title.md`, numbered in order and listed in `docs/adr/README.md`.
An ADR says why; `AGENTS.md` and `docs/guide.md` say what is true now.
Features and fixes inside an existing decision need no ADR.

## Write one

1. Read `docs/adr/README.md`.
   An ADR that already covers the area is either still true, and needs nothing, or being reversed, and gets superseded in step 4.
2. Take the next number and write `docs/adr/NNNN-kebab-title.md`:

   ```markdown
   # NNNN - Title in plain words

   Status: accepted

   ## Context

   The forces at play: constraints, goals, what hurt. Three to six sentences.

   ## Decision

   What Wanderlight does, concretely: files, modules, values, thresholds.

   ## Consequences

   What became easier, what became harder, what must now stay true, and the check that enforces it.
   ```

3. Add a row to the table in `docs/adr/README.md`: the number linked to the file, and the decision in one line.
4. Superseding: keep the old ADR's text, set its status to `superseded by NNNN`, and open the new ADR's context with what changed.
5. In the same change, update whatever states the "what": `AGENTS.md`, `docs/guide.md`, `README.md`.

Done when the ADR, its index row and every "what" document agree.

## Rules

- Write the ADR before the code it decides, and ship both in the same pull request.
- Ground every reason in the code, the history or the user's words.
  A reason you cannot find is a question for the user.
- Name the enforcer: the test, `tsc`, or CI workflow that fails when the decision is broken.
  When nothing enforces it, say so.
- Status is `accepted`, `superseded by NNNN` or `deprecated`; an accepted decision is never rewritten.
- One sentence per line.
- The repository is public (ADR 0010): an ADR names no person, account, team ID, home or real route, and no competing product.
