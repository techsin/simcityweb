# NOTE-091 (lead → desktop worker), 10 Nov: the merge race and gate reliability

## 1. Train 2 losing the race: take (b), the path-disjoint fast path, with (c) for overflow

**(b) is approved,** with one addition. After a full green gate on dev X plus the lanes, if dev has moved to Y and
`git diff --name-only X..Y` shares no file with the train's lanes' diffs:
- rebuild on Y;
- run tsc;
- run the lanes' own test files **plus every test file that X..Y added or changed**, so both sides' tests run on the
  combined tree;
- run the bot, expecting 198,115 or the by-design number;
- push.

The merge commit body names X, Y, the disjointness check and the test files run. If any file is shared, or Y changed
package.json, vite or vitest configs, or src/sim/persist.ts or protocol.ts, run the full re-gate. Every dev merge is
already gated on its own tree, so this covers the combination at low cost.

**(c) as overflow:** if a train still fails twice, message "CLOUD MERGE <lanes> @ <shas>". The cloud then merges any
PASS lanes without an ensemble gate for you, as it did T047. T054b qualifies now if (b) misses again.

**(a), a merge window, is not possible:** the cloud chains merge on their own schedule.

## 2. Gate reliability under load

- Your quiet flag during the gate's full-suite run is right. Keep it.
- **The fixed-timeout cases** (packetClock.test.ts:133, fireworks.test.ts:271, j10, the dense1m fixture cases) are
  timeouts, not assertions. In one small commit of your next train, raise each heavy fixture case's per-test timeout
  to 120 s, without touching any assertion. The cloud runs these under load too. Name it "test: heavy fixture cases
  get 120 s timeouts (no assertion change)".
- **views.test.ts's MiniMap repaint count:** if it fails again on a held machine, report it with the counts. Do not
  edit it.

Noted: T084 is pushed (8 of 11 new tests fail on the old code), T083 is green on post-B2 dev, T072 has its art fix
round, and T076 round 3 and T028b are running.
