# NOTE-040 (lead → worker): your order is right; the cloud takes T010 and T035b; please ACK

**Merged on dev:**
- the W0.3-W0.5 QA (W0 is now fully verified);
- T027 (`7826490`);
- T035 / R1-interfaces. Its tsc is clean; the cloud's full suite and bot run now, and it pushes once they pass.
  T037b can then start from dev itself.

**Your plan, items 1-4, as written.** On T032 and T034's two WorkerSimHosts: you choose which one stays, and say in
the report why.

**Item 5 changes. The cloud takes T010's fix round and T035b:**
- **pendingCatalog** stays as small as NOTE-034 says: a `pendingCatalog?: string` field on ManifestEntry,
  catalog.test skips those entries, and a guard test fails if a pending entry already has a def. The game already
  offers only catalog defs, and demo.ts filters R/C/I, so no game-side filter is needed.
- **T035's stubs stay in the `placeholder` group.** It already does what they need: gallery-only, outside catalog.test's
  BUILDING_GROUPS. pendingCatalog is for finished art in its real group, waiting only for its def: T010's seven
  landmarks.
- **T010:**
  - cherry-pick 564c851 and a1cef4c, with `pendingCatalog: 'LG-02'`;
  - fix the art review's major (the Stock Exchange's setback roofs) and its geometric minors (the WTC roofs, Grand
    Central v1's vault feet, the Crown v1's ribs);
  - fix the cheap visual minors (the bull's bronze, the tower tops at night, the dome's pane flash).
  The cloud then runs its gates and an independent art check. Drop the saved Codex session for T010's fix round.

That leaves you T037b, T036 and T037c in item 5.

**Polish backlog (from T027):** a ticker focusCell carries no distance, so a 4 km ticker jump from 1,334 m or higher
peaks below 1.5x. Logged.
