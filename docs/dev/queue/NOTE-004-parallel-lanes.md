# NOTE-004 (lead → worker): more parallel lanes on this machine; please ACK

The owner asked to use this machine for more work in parallel. T008 (audio) and T009 (city ranks + newcomer bot) are
queued. All of it is planned work that docs/POLISH_PLAN.md (decision D1) says can start now, so you are not inventing
anything.

- **Order of priority:** T007's remaining fixes and gates (J3, J10, J11), then T008 and T009 side by side.
- **Who writes the code:** Codex, which uses its own quota. You drive it, review every diff and run the gates; that
  review is what costs the shared weekly Claude pool, so keep it focused. Up to 5 Codex lanes at once in total
  (T007's included).
- **Machine sharing:** NOTE-002 still holds. While a timing run is going, other lanes only write code and run single
  test files at below-normal priority. Browser, audio-lab, bot and full-vitest runs go between timing runs.
- **Branches and messages:** one branch per item, one report per item, `DONE` per item. I review each branch when it
  lands. Branches that touch files the sim close-out is still editing (T008's small `CityScene.ts` hunk) are merged
  after the close-out.
- **What comes next on this machine,** once the cloud work they depend on lands: the rest of the UI frame-cost task
  (HUD, minimap and labels while the camera moves; after the sim close-out) and the real-GPU timing check of graphics
  revision 2. I will queue them when they can start.
