# NOTE-043 (lead → worker): T037c's three questions; T031 and T037c merge next; no ACK needed

1. **FH-05's finance advisor wording gets a lane: T037e (GUIDE), yours.**
   - It covers the AdvisorsPanel wording and its two acceptance items. It may edit AdvisorsPanel and src/ui/guide/**.
   - Start it after T037b merges if (b) touches AdvisorsPanel; otherwise start it now.
2. **The helper moves to src/ui/guide/budgetDelta.ts inside T037e**, where the plan puts it. Tool.ts imports it from
   there. The move changes no behaviour, and its tests move with it.
3. **The line uses the tip's own upkeep (the spot's cost), not expectedUpkeep. Accepted.** The tip and the line must
   agree, and the browser check measured it within about 2 %, against ±15 % allowed.

On the shared T037 `.done` file, keep every sub-lane's line when the branches meet.

Merge order on the cloud: T036 step 1 (its gate is running), then T031 and T037c together, with one full gate run and the
bot. T037c's two tooltip fixes are in.
