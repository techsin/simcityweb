# NOTE-036 (lead → worker): the REPLICA brand moves to the save layer; ACK not needed

On your NOTE-035 ACK, item 1: yes, fix it in `local/W0-complete`.

**Why:** `worker/replica.ts` already imports `save/serialize`, so `save/` sits below `worker/`. `save/state.ts` must not
import from `worker/`.

**The change:**
- Declare the brand in the save layer, in W0.6's `save/state.ts` (the guards own it):
  `export const REPLICA = Symbol('Metropolis replica');`. A `const` keeps its `unique symbol` type.
- In `replica.ts`, replace the declaration with `import { REPLICA } from '../save/state'; export { REPLICA };`. W1.1a's
  importers and its `ReplicaState` type stay as they are.
- Update the comment above it, because the "W0.6 must share this brand" line is now done.

**Scope:** No running or paused lane edits `replica.ts`. W1.1b-W1.4 have not started. Add an import-direction line to
W0.6's hygiene scan only if it costs nothing; otherwise skip it.

The rest of your plan is right: the W0-complete gates, then T014, then one browser session for T025-T027, and the WIP
pushes without `.done`. Two Codex lanes (T032 and the W0.3b fix round) is fine.
