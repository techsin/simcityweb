# T077 report: New Year batching from the host's `liveYear` (desktop; WORKER_DESIGN §3.6, NOTE-065 item 2, NOTE-078)

**Status: implemented and unit-tested in the lane; the full vitest and the real-GPU checks are recorded by the desktop
worker at the end.** tsc is clean, the new and existing tests pass, and the 128x15 s7 bot is unchanged at 192,899.

## Changes per file (46 insertions, 6 deletions in 7 files, plus 2 new test files)

- `src/worker/protocol.ts`: `Clock.live` becomes optional (`live?: boolean`) with a doc comment. It already existed
  as a required boolean.
- `src/worker/replica.ts`: new `Replica.liveYear`. `apply()` sets it from `p.clock.live` just before the log replay
  and clears it in `finally`. A non-boolean reads as `undefined`.
- `src/worker/SimHost.ts`: `SimHost` gains `readonly liveYear: boolean | undefined`. `LocalSimHost.liveYear` is true
  only while `frame()` runs `core.frame(dt)`, restored in `finally`; anything outside its own tick (`sim.runDays`)
  reads false.
- `src/worker/LoopbackSimHost.ts`: one getter on `PacketSimHost`, `liveYear` → `replica.liveYear`. The loopback and
  worker hosts inherit it; `WorkerSimHost.ts` is not edited.
- `src/worker/recorder.ts`: the one hunk beyond plumbing. The recorder notes when a captured `'day'` ran with the
  scheduler's explicit live flag off (`schedulerOf(sim).live === false`), and that packet's clock is then not `live`.
  Without it, a `debug.runDays` run in a live worker session read as live on its last day and on any tail merged
  behind the ack window, because `simWorker.flush()` evaluates `live()` after `finishRun()`. It only reads the
  scheduler flag; no `src/sim/infra/*` file is edited.
- `src/game/NewYear.ts`: a new optional dep `liveYear?: () => boolean | undefined`, and `onYear`'s batch line:
  `const live = this.deps.liveYear?.(); const batch = live === undefined ? this.frames === 0 || st.day -
  this.lastFrameDay > 8 : !live;`
- `src/game/CityScene.ts` (outside the named files): two lines in the NewYear construction,
  `liveYear: () => this.host.liveYear`. NewYear takes `sim`, not the host, so the input is wired here.

## The default for a packet without the flag

It reads as unknown (`undefined`), and NewYear then applies the old frame-gap rule unchanged. That is "reads as the
heuristic did" in both directions: a played year still gets its show, and an old stream's backlog still reads as a
batch. No constant can do that (`true` would make an old deterministic run party; `false` would silence every New Year
of an old stream), and it keeps every `NewYearCelebration` built without a host unchanged, which the existing NewYear
tests and other lanes' fixtures rely on. The flag is the clock's alone: nothing is added to saves or `systemData`.

## Tests

`tests/worker/liveYear.test.ts` (9):
- the same days get the same decision on the local host and through the loopback: 1x, ultra and a hidden tab's backlog
  (224 ticks; all three years read live; the loopback's third year turns 13 days after the last drawn frame);
- the recorded packet stream gives the same decisions on a fresh packet host;
- a packet without the flag is decided by the frame-gap rule, as before;
- a batch of days is a batch on every host, however short;
- LocalSimHost.liveYear is true only in the days of its own tick, and comes back when a listener throws;
- the worker's clock.live: a tick's days are live; every day of a debug.runDays run is not, its last day included;
- run days merged behind the ack window stay a batch when their packet goes out after the run;
- ticks' days merged behind the ack window stay live: a stalled page's backlog is no batch;
- WorkerSimHost.liveYear on the real worker (node worker_threads): a year end reached by frames reads live on the
  page; one reached by a deterministic run reads as a batch.

`tests/game/newYearLiveYear.test.ts` (5): a live year is celebrated with no frame drawn yet and many days after the
last one; a batch year is not, even one day after a drawn frame; the flag is read as each year turns; a host that
cannot tell leaves the frame-gap rule; a brand-new or empty city still gets no party when the year is live.

Mutation checks: without the recorder rule the two `debug.runDays` cases fail; with the old frame-gap rule alone in
NewYear, the loopback's backlog year gets no show and the short local batch does (two tests fail).

Existing tests, all passing through quietrun: `tests/game/newyear.test.ts` and `newYearPacing.test.ts` (30, both
unmodified); every `tests/worker/*.test.ts` file (40 with the new one); `tests/worker/hygiene.test.ts` (18); 33 more
files that use the hosts, the recorder or NewYear (360 passed, 4 skipped).

## Gates run in the lane

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| Hygiene, the new tests, the existing NewYear and replica tests | pass |
| Bot 128x15 s7 | residents [ 61124, 93804, 37971 ] = 192,899 (the bot imports none of the changed files) |

## Plan against code

1. "Nothing implements it yet" is half true: `Clock.live` and its producers have existed since W1.1a
   (`recorder.flush({ live })`, from loopbackCore's cadence and simWorker's `!deterministic && !run`). Nobody read it.
   This lane adds the reading side, the optionality and the per-day exactness.
2. §3.6 says LocalSimHost "clears it in `runDays`". LocalSimHost has no `runDays`; batches go through
   `host.sim.runDays()`. So the flag is true only inside `frame()`.
3. §3.6 says "instead of the day-distance heuristic". The heuristic stays as the fallback for an unknown flag. For
   every host in the tree the decision is exactly `!host.liveYear`.
4. One edge differs from before on the local host: a `sim.runDays(n)` of 8 days or fewer across a year end used to get
   a show and is now a batch. In frame-paced local play nothing changes.
5. If §3.6 should match, it needs three sentences: the default for a missing flag, "outside its own tick" for the
   local host, and the recorder's batch-day rule. The doc is not edited here.

Optional alternative for the cloud: the source-side fix for a run's last day is three lines in
`src/worker/simWorker.ts` (remember that the open packet holds a run day, and pass `live: live() && !batchDays` in
`flush()`); then the recorder's `schedulerOf` read can go.

## Not verified in the lane

Anything in a browser (the show at 1x and ultra on the three hosts, the real worker in Chromium, a real hidden tab);
the full vitest suite; 256-tile runs.

## Browser checklist

Hosts: `?quickstart=1` (local), `&simworker=loopback`, `&simworker=1`. A new city opens on 1 April, so the first New
Year is 135 s away at 1x and 13.5 s at ultra. Probe, on every host:
`const c = __metropolis.city; c.host.events.on('year', (y) => console.log(y, c.host.kind, 'liveYear', c.host.liveYear));`

- **1x, all three hosts.** The first New Year plays the full cinematic show (toast, time-lapse to 23:55, countdown
  with the date held on 1 January, fireworks, camera out and back). The probe logs `true`.
- **Ultra, all three hosts.** The first New Year plays the full show without a countdown; later years get the compact
  toast under "Milestones", or a show each year under "Every year". The probe logs `true` each year.
- **Backlog (the bug), loopback and worker, ultra, "Every year".** Hold the page's packets across 1 January, then
  release them in one burst:
  `const h = c.host, r = h.receive.bind(h), q = []; let hold = false; h.receive = (m) => hold ? q.push(m) : r(m);`
  set `hold = true` a few days before 1 January, wait about a second, then `hold = false; q.splice(0).forEach(r)`.
  The New Year toast and show still play and the probe logs `true`. On dev before T077 that year gets nothing.
- **Hidden tab, `?simworker=1`, ultra, "Pause when hidden" on and off.** Switch away just before 1 January and come
  back: the New Year is neither lost nor doubled, and the date does not stay held.
- **Batch, local.** `c.scene.sim.runDays(400)`: no toast, no show, the probe logs `false`.
- **Batch, worker.** `c.host.runDays(270)` from 1 April ends exactly on 1 January: no show, the probe logs `false`;
  frames afterwards log `true` again.
- **Regressions.** Loading a save never starts a show; raising the speed ends a running show; exit to the region and
  back; an emergency's LIVE slowdown during a show.
