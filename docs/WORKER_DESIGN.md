# The simulation in a dedicated Web Worker: design

- **Date:** 2026-10-06. **Revision 2**, the same day. It addresses every required change of the independent critique (R1–R16) and the optional ones that are clearly right (O1–O13; O14 confirmed facts). Section "Review changes" at the end lists each change and why. Tags such as "(R5)" in the text point there.
- **Tree read:** `1f5d254`, the later WIP snapshots up to `b98a2d0`, and other lanes' uncommitted edits (sim balance, render). Line numbers drift; every reference also names the function or field.
- **Status:** proposal for PI-3 (W1 and W1b) of `docs/WASM_PLAN.md`. It folds in the skeptic review's corrections: B1 first; no main → worker transfer; one day or one step per worker task; rAF pacing; W1 becomes the default only after B2 and B3; p99 added to the latency criterion.
- **Inputs:**
  - `docs/WASM_PLAN.md`, including the skeptic review;
  - the main-thread consumer inventory (34 areas, 20 hazards);
  - the code;
  - the headless probes of revision 1 (Appendix B);
  - the critique and its probes, and one new probe for this revision (Appendix B).
- **Scope:** W1 only, meaning one sim worker. W2 helpers and W3 shared memory are mentioned only where W1 has to leave room for them.

## 0. Decisions

1. **The worker owns the simulation.**
   - It holds the authoritative `CityState`, `Simulation`, every system, the `InfraScheduler`, the authoritative `CityActions`, the emergency LIVE speed policy, and region effects.
   - It also does city loads and saves through IndexedDB, builds recovery snapshots, and replays recovery journals.
2. **The main thread owns pixels, input and sound.**
   - It reads a **replica**: a real `CityState` plus an `Emitter<CityEvents>`. Applying an ordered event log re-fires the events, so WorldView, CityObjectsView, MiniMap and most panels stay unchanged.
   - Anything that needs system internals becomes a **query** (one-shot RPC) or a **watch** (a result the worker pushes when its inputs change).
   - **The replica is never saved.** It is branded in its type and at runtime, and `serializeCity`, `saveCity` and `writeRecoverySnapshot` refuse it. Every save, snapshot and recovery path goes through the host (§4.5).
3. **Every action has a synchronous answer on the main thread.**
   - `ctx.actions.X(..., preview=false)` runs the same `CityActions` code in preview mode on the replica, with the player's own pending edits overlaid (funds, unique defs), returns that prediction synchronously, and posts the command.
   - The prediction is **exact** when none of the player's preview-affecting commands is in flight. An exact failure is final and is not posted. Otherwise the prediction is **provisional**: the command is posted whatever the prediction says, and the issuing tool reports the ack's result (§2.2).
   - The authoritative `ActionResult` arrives in a packet. A wrong exact prediction is corrected by the issuing tool, once per gesture.
   - Three operations wait for the worker: `dispatch`, `dispatchBest` and `triggerDisaster` (apart from a fire's refusal). Four write to the replica optimistically: `setTax`, `setFunding`, `setHistoric` (the historic toggle, sent as an idempotent set) and `setSpeed`; `dismissAlert` writes the policy view.
4. **No SharedArrayBuffer in W1. Everything travels as structured-clone copies, with no transfer list in either direction.**
   - The game is not cross-origin isolated: `vite.config.ts` sets no COOP/COEP headers, `src/ui/theme.css` `@import`s Google Fonts, and the build is static with `base: './'`.
   - A transfer from the worker would kill the sim isolate's protector. A transfer from main would kill the main isolate's protector, which J0 restores. So the S4 load-time transfer is dropped: the worker reads the save from IndexedDB itself.
   - Every typed array in a message owns its whole buffer, because a clone copies the entire backing buffer of a view (§1.4).
5. **Pacing is frame-driven.**
   - The page posts one `tick {dt}` per rAF, including while paused.
   - The worker runs one simulated day, or one scheduler step, per task. It drains its inbox FIFO between tasks, re-checks the speed before every day, and flushes a packet after every day and every command.
   - If rAF stops, as in a hidden tab, the simulation stops too, as it does today. Liveness is counted only in visible, unfrozen time (§2.10).
6. **The LIVE emergency policy moves into the worker.**
   - It applies `speed` and `liveSlowdown` synchronously inside the `'uncovered'` event, as today. Because the speed is re-checked before each day, the rest of the frame's days no longer run at ultra.
7. **Saves run entirely in the worker.**
   - `serializeCity(copy)` then an IndexedDB `put`, with no gzip. City saves have never been gzipped; `packFile` is only used for region export.
   - At unload, the main thread writes a **journal** of the commands posted since the last base, bound to that base: the last save, or the last worker snapshot when it is newer. The snapshot's payload is written only while it is newer than the last save (§4.3).
8. **The migration is incremental.**
   - W0 builds a `SimHost` seam with `LocalSimHost`, which is today's behaviour. Then `LoopbackSimHost` runs the full protocol and replica in one thread. Then `WorkerSimHost` adds the thread with main-side persistence (W1.2), and W1.3 moves persistence into the worker.
   - Each step ships playable behind `?simworker=`. The worker becomes the default only after B2, B3 and the render items R1 and R2 (§6).
9. **Measured here** (Appendix B; revision 1 ran at load 14.6 on a 4-core box, so read its times as upper bounds):
   - Replaying a day of the stream on the main thread costs 0.28 ms p50 on dense1m and 0.86 ms p50 on bot256 at design cadence. That fits AC1 at ultra, where there are 3–4× fewer events per day.
   - The replica stayed **exact**: 0 mismatches at 6 checkpoints, and 0 silent changes to exact building fields in 2 × 60 days.
   - The rolling pop/jobs refresh converges only if its shadow follows every record sent: as first specified, 12, 36 and 32 buildings never converged at days 30, 60 and 90 on bot256; with the fix, 0 (critique probe).
   - Chromium main-thread deserialization costs about 0.8–0.9 ms per MB, not 0.4. At the S5 cadence the traffic group alone, sent whole, would be 1.7 MB/s. Sending only road cells, losslessly, cuts a pass from 512 KB to 181 KB (dense1m) or 109 KB (bot256) (§2.10).
   - Three naive alternatives are **rejected by measurement**:
     - a full building shadow diff every day: 6–13 ms/day of worker CPU;
     - a full lagged-field sweep: 2.6–4.1 MB per sweep, 7–43 ms (once 910 ms) to apply on main;
     - changed-cell spans for traffic: 17.3k–22.4k of the 23.1k road cells change per pass on dense1m (6.9k–12.3k of 13.9k on bot256), so a sparse encoding is never smaller than the road-only one.

## 1. Architecture

### 1.1 What lives where

| worker: sim isolate (`src/worker/simWorker.ts`) | main thread |
|---|---|
| `Simulation`, `createSystems()`, `guardSystem` (moved from `CityScene`), `InfraScheduler`, JS kernels. WASM blur stays opt-in behind `?simwasm=blur:wasm`; the page passes its flag in `init` (skeptic finding 5) | `WorldView`, `CityObjectsView` (and the LOD worker), `MiniMap`, all panels, tools, `ToolController`, input, `CameraMemory`, audio (`AudioEngine`, `GameSounds`, `Sirens`), `NewYearCelebration` |
| authoritative `CityActions`, the command queue, `sim.rng` | `PreviewActions`: `CityActions` over the replica, preview only. It drives hover feedback and action predictions, with the pending-edit overlay (§2.2) |
| `LivePolicy`: `speedPolicy`, `AlertQueue`, the pending and urgent logic and the episode state, taken out of `EmergencyBanner` | `EmergencyBanner` DOM, toasts, the `emg-live` class, sounds |
| `applyRegionEffects` and `trackRegionEffects` (`src/region/regionEffects.ts`, already headless) | region screens, `NeighborLabels`, `cityThumbnail` (canvas), new-city terrain generation, region export/import (gzip) |
| city load: IDB `get` + `deserializeCity`. Save: `serializeCity(copy)` + IDB `put` + `summarizeCity` + `cityFingerprint`. Recovery: the base, delta encoding, IDB writes, journal replay at boot | `RecoveryMirror`: the last snapshot payload while it is newer than the last save, and the journal bound to its base, written to localStorage and a small IDB record at unload (§4.3). Dirty tracking (`isDirty`: the fingerprint and `CHANGE_EVENTS` over the replica, read-only) |
| derived rasters that need system internals: tap water (`UtilitiesSystem.waterQualityAt`), raw truck volumes (`TrafficSystem.truckVolume`), the Desirability appeal variants (four input groups), Demographics (lagged building fields) | the remaining rasters, built by today's `overlays.ts` code from mirrored inputs: Emergency (resp layers), NIMBY, every direct layer |
| query and watch handlers: inspector reports, breakdowns, dispatch options and routes, advice, cap hints, budget forecast | caches of query and watch results, keyed by arguments (§2.8) |

### 1.2 Hosts

All game code talks to a `SimHost` (`src/worker/SimHost.ts`). `GameContext` gains `host: SimHost`. During migration, `ctx.state`, `ctx.sim` and `ctx.actions` stay as thin delegates; `ctx.state` is a getter that always returns `host.state`.

```ts
export interface SimHost {
  readonly kind: 'local' | 'loopback' | 'worker';
  readonly ready: Promise<void>;                 // rejects on a boot failure (§4.1)
  readonly state: HostState;                     // live state (local) or the branded replica (§4.5); may be swapped on resync
  readonly events: Emitter<CityEvents>;          // live emitter (local) or the replay emitter, which isolates listener errors (§2.4)
  readonly sim: SimFacade;                       // scene.sim compatibility, see §2.9
  readonly actions: CityActionsApi;              // HostActions: previews on host.state; commits predict + post (§2.2)
  readonly preview: CityActionsApi;              // preview-only CityActions over host.state
  // clock and speed
  readonly speed: number;                        // authoritative mirror, overlaid with a pending setSpeed
  readonly liveSlowdown: number;
  setSpeed(v: number, source: SpeedSource): void;
  resume(source: SpeedSource): void;             // the worker restores its own pre-pause speed (§3.2)
  simTime(): number;                             // extrapolated sim clock (§3.5)
  secondsPerDay(): number;
  frame(dt: number): void;                       // CityScene.loop: local runs sim.update(dt); worker posts a tick
  // writes and reads
  act<K extends CommandOp>(op: K, args: CommandArgs<K>, opts?: ActOptions): Ticket<CommandResult<K>>;
  readonly cause: Cause | null;                  // the command whose effects are being emitted right now (§2.2)
  beginGesture(owner: GestureOwner): Gesture;    // pointer-down … up; corrections go to its owner (§2.2)
  readonly pending: PendingEdits;                // posted preview-affecting commands without an ack (§2.2)
  query<K extends QueryName>(name: K, args: QueryArgs<K>): Promise<QueryResult<K>>;
  watch<K extends QueryName>(name: K, args: QueryArgs<K>, when: WatchPolicy): WatchHandle<QueryResult<K>>;
  setView(v: ViewState): void;                   // shown overlay and variant, open panels, focus buildings (§2.6)
  readonly emergency: EmergencyView;             // incidents(), incident(id), vehicles(), stationList(), stationFleet(id), stationName(id), active, layersReady
  readonly traffic: TrafficView;                 // sampleRoutes(max), truckVolume()
  readonly policy: PolicyView;                   // LIVE alerts and state for EmergencyBanner
  // persistence and lifecycle
  save(reason: SaveReason): Promise<SaveAck>;    // the only way to save a city (§4.5)
  snapshot(why: SnapshotWhy): Promise<SnapshotAck | null>;
  readonly recovery: RecoveryMirror | null;      // loopback and worker hosts (§4.3)
  stats(): HostStats;                            // perf overlay and harness
  dispose(): Promise<void>;
}
export interface Ticket<R> { readonly seq: number; readonly predicted?: R; readonly exact: boolean; readonly done: Promise<R> }
export interface ActOptions { tag?: object; gesture?: Gesture }   // tag: a main-side object, never posted
export interface Cause { seq: number; tag: object | null }
```

- **`SimCore`** (`src/worker/SimCore.ts`, headless) is the one code path that every host runs.
  - `boot(state, rctx, opts)` runs, in today's order:
    - `applyRegionEffects`;
    - the `trackRegionEffects` 'month' listener;
    - `createSystems`, `guardSystem`, push and `init`;
    - `new CityActions(sim)`;
    - `LivePolicy.attach(sim, settings)`;
    - the replay of a recovery journal bound to the loaded record, if one exists (§4.3).
  - The rest of its API:
    - `beginTick(dt)` and `nextUnit()`;
    - `applyCommand(cmd)`;
    - `runQuery(name, args)`;
    - `runDays(n, script)` for deterministic mode;
    - `setLive(on)`: the explicit live-mode flag for the scheduler and disasters (§3.1).
  - Because every host goes through it, D7 holds by construction in deterministic mode: actions are applied at the same point, in the same order, through the same code. Live mode differs (§5.1).
- **`LocalSimHost`** runs `SimCore` in the page.
  - It is today's behaviour and the permanent fallback.
  - `act()` executes synchronously, so `predicted` is the real result, `exact` is true and `done` is already resolved. It sets `cause` around `core.applyCommand`, so synchronous listeners see it.
  - `query()` resolves synchronously into its cache, so panels show no extra latency.
  - In dev builds and tests, acks and query and watch results pass through `structuredClone` from W0.3 on, so a `DataCloneError` or a result that aliases live state shows up before W1 (R16).
  - `CityScene.loadSim()` moves into `LocalSimHost.start()`.
- **`LoopbackSimHost`** runs `SimCore`, the `ChangeRecorder` and the `Replica` in one thread.
  - Every message goes through `structuredClone`, and the UI reads only the replica.
  - It is the whole protocol without threads: single-threaded and deterministic, so replica bugs are easy to debug. It also serves as test infrastructure, with an optional seeded `LagProfile` that delays packets and acks and injects long units (§5.3).
- **`WorkerSimHost`**: `new Worker(new URL('./simWorker.ts', import.meta.url), { type: 'module', name: 'sim' })`, created the same way as `lodWorker`. It is pre-spawned on the region screen (§4.1).
- **Selection** (`createSimHost`):
  - `?simworker=0|1|loopback`, then `localStorage 'metropolis.simworker'`, then `AppSettings.simThread` (`'auto' | 'main'`, in `src/region/settings.ts`). The URL wins.
  - `auto` stays `main` until W1.4.
  - If the worker fails to boot (§4.1), the game falls back to `LocalSimHost`, booted from the stored city (IndexedDB, or main's in-memory store in non-persistent mode), with one toast.
  - `FallbackActions`, the stand-in `CityActions` that mutates the state directly, exists only in `LocalSimHost`.

### 1.3 Read model: replica, streams, watches and queries

| kind of data | mechanism | examples |
|---|---|---|
| primary map layers: `heights`, `water`, `trees`, `zone`, `network`, `netFlags`, `powerLines`, `subway`, `building` | replica, exact: rect patches from the map events, and the building grid from add/remove records | previews, MiniMap, TerrainRenderer, NetInfo, RoadSurface, PowerLines, Underground, Onboarding, zoneStatus |
| exact building fields: `def, x, z, w, d, rot, variant, capacity, wealth, flags, baseY` | replica, exact: a full record with every building event | BuildingRenderer, demolish checks, tool lock checks, `cityFingerprint` |
| lagged building fields `pop, jobs` | replica: event-time records, focus records and a rolling refresh whose shadow follows every record sent (§2.5) | QueryTool tip, demolishRisk text, fireworks weights |
| `built` | replica: event-time, plus daily for the buildings under construction | BuildingRenderer scaffold height, ambience, GameSounds |
| `age, health, unhappy, kids, teens, yad, srs, wf, edu, hire` | focus records (fresh each packet for at most a few ids); otherwise query or a worker-built raster | InfoPanel, the Demographics raster |
| `powered`, `watered`; `traffic`, `congestion` | replica, always mirrored, on `layerUpdated('utilities' / 'traffic')`; traffic as road cells only (§2.6) | VehicleRenderer per vehicle per frame, MiniMap Power, zone chips |
| the other derived layers | replica, only while a view needs them (subscription) | the shown overlay and variant, its hover readout |
| plain data: `day, funds, nextBuildingId, stats, budget, milestones, unlocked, announced, neighborConnections, history` (monthly tail), `news` (via events), selected `systemData` keys | replica, end of packet, applied in place so object identity holds | TopBar, BudgetPanel, GraphsPanel, StatsPanel, toolCatalog locks, `listRewards`, `listOrdinances`, `loanOffer`, `approvalBreakdown` |
| system state that is plain data | stream view; incidents also at event time (§2.4) | `EmergencyView` (incidents, vehicles, stations, `active`, `layersReady`), `TrafficView` (sample routes, raw truck raster), the active disasters, `PolicyView` |
| system internals | `query` (one-shot) or `watch` (pushed) | `inspectBuilding`, `inspectCell`, `dispatchOptions`, `routePreview`, `openAdvice`, `capHints`, `computeMonthlyBudget`, `stopsNear`, … (§2.8) |

**Replica-safe functions.**
- A sim function may run on the replica only if it is a pure function of mirrored state, and any cache it keeps is keyed on mirrored values. Examples:
  - the `ordinances.ts` effect cache compares `budget.ordinances`;
  - `buildingList` compares size, `nextBuildingId` and day;
  - `setOrdinanceEnabled` in preview form reads only `budget.ordinances`, `stats.population` and `standingBlocked` over exact fields (`def`, `Burnt`); `loanOffer` and `maxLoanAmount` read `budget.loans`, `funds` and `stats.population`.
- Functions that read the module-level WeakMaps of system internals run only in the worker, behind a query: advisors' `lastIssues`, tourism's `states`, demand's `contexts`, growth's `cores`, demographics' `simOfState`, and `TRAFFIC_OF_STATE`. So do functions that read lagged fields.
- `src/worker/replicaSafe.ts` holds the list. `tests/worker/replicaSafe.test.ts` (§5.3) runs each listed function on both sides and requires equal results.
- Per-state caches (about 25 module-level `WeakMap<CityState, …>` in `src/sim`) are never invalidated by hand: a resync swaps in a fresh `CityState`, so every cache starts empty (§2.10).

**Views on the replica.**
- `Replica` registers the view objects where overlays.ts expects the systems:
  - `TRAFFIC_OF_STATE.set(replica.state, trafficView)`;
  - `attachOverlays(host.sim)`, whose `getSystem('utilities' | 'emergency')` returns `utilitiesView` and `emergencyView`.
- The views report readiness from mirrored flags: `emergencyView.layersReady` and `.active` come from the stream.
- This removes hazard 3, the systemless shell:
  - The Emergency view stops showing "no data".
  - Tap water reads the shipped raster: `waterQualityAt` inverts `TAP_T0 + (1 − TAP_T0) × q`.
  - `truckVolumeOf` returns the shipped raw raster.
- `PreviewActions` uses its own systemless shell (`PreviewShell`: `rng` and `notify` throw), which is never passed to `attachOverlays`.
- On a resync these registrations are redone for the new `CityState` (§2.10).

### 1.4 Transport: copies, no transfers, no SharedArrayBuffer

- **Checked in the repo:**
  - `vite.config.ts` has no `server.headers` and no `preview.headers`. Only `tools/bench/vite.check.config.ts` adds COOP/COEP, under `COI=1`.
  - There is no deploy config: no `.github`, no `_headers`, no `vercel.json`. `base: './'` targets plain static hosting. The remote is `github.com/techsin/simcityweb`, so GitHub Pages is the likely host, and it cannot send COOP/COEP.
  - `src/ui/theme.css:5` `@import`s fonts.googleapis.com, which `COEP: require-corp` would block.
  - So `crossOriginIsolated` is false wherever the game runs today, and `SharedArrayBuffer` is unavailable. The critique's Chromium probe confirmed it: without the headers, `crossOriginIsolated` is false and `SharedArrayBuffer` is undefined in both the page and the worker; with them, both appear.
- **W1 sends every packet as one structured-clone message.**
  - `postMessage(packet)` never takes a second argument, in either direction. A transfer from the worker detaches buffers in the sim isolate (4–16 % on the whole sim). A transfer from main detaches in the main isolate, which J0 has just made intact (skeptic finding 3).
  - Both cases are tested (§5.3).
- **Every typed array in a message owns its whole buffer:** `byteOffset === 0 && byteLength === buffer.byteLength` (R9).
  - `structuredClone` and `postMessage` copy the entire backing buffer of a view. A 16-element `subarray` of a 64 MB buffer took 100 ms to clone in node and 99 ms in Chromium, and the receiver got a 64 MB buffer. `slice()` of the same 16 elements took 1 ms.
  - The places where `.subarray(0, n)` would creep in are the recorder's growing record buffer, the cell-patch scratch and the sparse `idx`/`val` buffers. They are copied out with `.slice(0, n)`.
  - `post()` asserts the rule with a recursive walk in dev builds; `protocol.test` asserts it for every message type.
  - Byte counts use structured-clone semantics: `Σ buffer.byteLength` over typed arrays plus the rest. Node's `v8.serialize` counts only the view (69 B for that subarray), so it is used only after the assertion has passed. Revision 1's packet sizes (`h/replica.ts` `wire()`) are therefore lower bounds.
- **Cost.** The clone is a memcpy on each side plus a per-message overhead.
  - Chromium main-thread deserialization, measured on an idle box: 0.1 ms p50 for a 25 KB packet (at the 100 µs timer floor) and 0.5 ms p50 (max 1.1) for a 540 KB traffic packet. That is about **0.8–0.9 ms per MB**, twice the 0.4 ms per MB revision 1 used.
  - The budget at the S5 cadence is in §2.10: about 0.8–1.4 MB/s without a data view and 1.0–2.1 MB/s with one, so about 0.6–1.8 ms per real second on main.
- **W3, optional and never in W1.** It would use SharedArrayBuffer display buffers for the read-mostly layers (`traffic`, `congestion` and the shown overlay arrays). The worker would copy into them at the end of a pass, behind an `Atomics` seqlock.
  - The sim's own `CityState` arrays would stay private, so the main thread never sees mid-pass state, and sim code and the determinism tests are untouched.
  - **Preconditions:** COOP `same-origin` plus COEP `require-corp`; self-hosting the Inter font; on GitHub Pages, a COI service worker, which reloads the page once on the first visit; and a runtime fallback to copies when `!crossOriginIsolated`. COEP `credentialless` is not an option for Safari.
  - **Gate:** build it only if the copies cost more than 2 ms per real second on the main thread (WASM_PLAN risk 8), measured with a data view shown (§2.10).

### 1.5 Isolate hygiene (J1)

**The sim worker** (the browser worker, and the node `worker_threads` worker of the tests):
- no `postMessage` transfer lists, no `structuredClone(…, {transfer})`, no `ArrayBuffer.prototype.transfer*`;
- no web streams: `CompressionStream`, `DecompressionStream`, `Blob.stream`, `Response` bodies;
- **never `memory.grow`** (R10). A grow invalidates the protector even when `.buffer` was never read, so the rule is "never grow", not "no grow after init".
  - The opt-in `?simwasm=blur:wasm` path qualifies today: the binary declares 64 MiB of initial memory (`initialPages` 1024) and the loader reserves 4 MiB (`SIM_WASM_INITIAL_RESERVE`), so it never grows.
  - It must stay that way. If PI-6 trims the binary to about 8 MiB, `heapBase` + the reserve + blur's staging must still fit the initial memory. The protector test runs this mode.
- no `Blob`, `Response` or `fetch` bodies in the code that also runs in node: in node, `Blob.arrayBuffer()`, `Blob.text()` and `Response.arrayBuffer()` invalidate too. Only `src/wasm/browser.ts` may use `fetch` and `instantiateStreaming`, which do not detach in a Chromium worker (critique probe);
- the import graph never contains `bundle.ts`, `src/save/index.ts` or `recoveryLs.ts`. The pure codec moves from `bundle.ts` to `src/save/bundleCodec.ts` (re-exported by `bundle.ts`), and the city-record functions move from `index.ts` to `src/save/cities.ts` (W0.6).

**Main:** no transfer lists (J0: `lodBuilder.ts:82`). The region screen keeps `packFile` and `unpackFile`; Chromium's compression streams do not detach (skeptic M6).

**Node tests and harnesses:** load fixtures with `zlib` and `decodeBundle`, never `unpackFile` (undici streams detach); no `Blob` or `Response` bodies. The scan covers `tests/worker/**`, `tests/perf/**` and `tools/bench/worker/**`.

**Also:**
- The LOD worker's own reply transfer (`lodWorker.ts:28`) detaches only in that worker, which is not a sim isolate. Stripping it as well is optional. The critique confirmed that the receiver of a transfer stays intact and only the sender is invalidated.
- **V8 flags are process-wide.** `new Worker(url, {execArgv: ['--allow-natives-syntax']})` throws `ERR_WORKER_INVALID_EXEC_ARGV`. So the protector test spawns a child node process with the flags, and relies on a probe in each isolate, because a `--trace-protector-invalidation` line does not say which isolate fired (§5.3).

## 2. Protocol (`src/worker/protocol.ts`)

### 2.1 Main → worker

```ts
export const PROTOCOL_VERSION = 1;
export type M2W =
  | { t: 'init'; v: number; city: CitySource; rctx: RegionContext | null; initialSpeed: number; settings: SimSettings;
      flags: { simwasm: string | null; dev: boolean }; persistence: 'worker-idb' | 'main'; journal?: Journal }  // journal: §4.3
  | { t: 'tick'; seq: number; dt: number; ack: number }              // one per rAF, also while paused; ack = last packet applied
  | { t: 'cmd'; seq: number; op: CommandOp; args: unknown[]; atDay?: number }  // atDay: deterministic mode only
  | { t: 'query'; id: number; name: QueryName; args: unknown }
  | { t: 'watch'; id: number; name: QueryName; args: unknown; when: WatchPolicy } | { t: 'unwatch'; id: number }
  | { t: 'view'; v: ViewState }                                     // subscriptions; no sim mutation
  | { t: 'save'; id: number; reason: SaveReason } | { t: 'snapshot'; id: number; why: SnapshotWhy }
  | { t: 'ping'; n: number }                                        // liveness, once per visible second (§2.10)
  | { t: 'resync' } | { t: 'dispose' };
type CitySource = { kind: 'idb'; regionId: string; tileKey: string }
                | { kind: 'serialized'; regionId: string; tileKey: string; savedAt: number; city: SerializedCity };  // cloned, never transferred
type SnapshotWhy = 'periodic' | 'hidden' | 'journal';
interface SimSettings { emergencyUncovered: EmergencyPolicy; emergencyLiveSlowmo: number; emergencyAlerts: 'major' | 'all' }
interface ViewState {
  overlay: Overlay; variant: number;                                 // shown data view
  panels: string[];                                                  // open panels with streams ('emergencies', 'advisors', …)
  focus: number[];                                                   // hovered, selected and inspected building ids (≤ 8)
}
```

**The inbox is strictly FIFO.**
- Commands, queries, watches and saves are handled in posting order. A query posted after a command sees that command's effect, and its result reaches main after the packet that holds the command's `Ack` (read-your-writes on both sides: §2.3).
- Ticks only add `dt`. `view` takes effect at once. `ping` is answered in the next packet. None of these four mutates the sim.

### 2.2 Commands: every player action

| op | args | from | main-side answer | optimistic replica write | counts in `pending` | ack |
|---|---|---|---|---|---|---|
| `zone`, `dezone` | rect, zone | ZoneTool | prediction | – | yes | `ActionResult` |
| `bulldoze` | rect | ZoneTool, InfoPanel | prediction | – | yes | `ActionResult` |
| `buildNetwork`, `buildPowerLine`, `buildSubway` | path (+ type) | NetworkTool | prediction | – | yes | `ActionResult` |
| `plop` | defId, x, z, rot | PlopTool | prediction. A unique def is deselected on an exact ok, or on an ok ack | – | yes | `ActionResult` |
| `terraform` | kind, cx, cz, r, strength | BrushTool, held (one per 70 ms, ≤ 14/s) | prediction; the stroke's feedback comes from its acks (gestures, below) | – | yes | `ActionResult` |
| `plantTrees` | rect | BrushTool, held (one per 120 ms, ≤ 8/s) | the same; draws `sim.rng` only in the worker | – | yes | `ActionResult` |
| `setTax` | dev, v | BudgetPanel; the master slider sends 3–5 | sync (void) | `CityActions.setTax` on the replica | no | – |
| `setFunding` | service, v | BudgetPanel | sync | `CityActions.setFunding` on the replica | no | – |
| `setHistoric` | buildingId, on | InfoPanel | sync. The `b.flags ^= Historic` fallback (`InfoPanel.ts:605`) is deleted | the Historic bit set to `on`, then `buildingChanged` on the replica emitter | no | – |
| `setOrdinance` | id, enabled, `{confirm}` | OrdinancesPanel | prediction on the replica, including `needsConfirm`; then `confirmDialog` and the confirmed command. The panel shows the toggle as pending until the ack | – | yes | `ActionResult & {needsConfirm}` |
| `takeLoan` | amount | BudgetPanel | prediction (`loanOffer` is replica-safe); the loan list updates on the ack | – | yes | `ActionResult` |
| `repayLoan` | index, `{principal, monthsLeft}` guard | BudgetPanel | prediction. The guard matters: a loan that ends at a month boundary in between would shift the index | – | yes | `ActionResult` |
| `setSpeed` | speed, source | Space and 1/2/3 keys, TopBar, PauseMenu, ErrorOverlay, visibility pause, exit, Onboarding, harness | sync | speed mirror | no | – |
| `resume` | source | PauseMenu | sync | speed mirror (the mirror's pre-pause speed until the next packet) | no | – |
| `dispatch` | incidentId, stationId, units | DispatchTool | **await** | – | no | `DispatchResult` |
| `dispatchBest` | incidentId | EmergencyBanner "Send nearest" | **await** | – | no | `DispatchResult` |
| `dismissAlert` | incidentId | EmergencyBanner ✕ | sync | `PolicyView` | no | – |
| `triggerDisaster` | kind, x, z | DisasterTool | a fire's refusal (no building within 3 cells) is predicted on the replica; otherwise **await** | – | no | `boolean` |
| `setCamera` | camera | `CityScene.storeCamera` (every 2 s, and right before every save) | – | the replica owns `systemData.camera`, which is never mirrored back | no | – |
| `setSettings` | `SimSettings` | settings changes | – | – | no | – |
| `debug.runDays`, `debug.verify`, `debug.setStepBudget`, `debug.setTrafficMinCycle` | | dev, harnesses, A/B | – | – | no | result |

- `setHistoric` replaces the toggle on the wire. The worker calls `CityActions.toggleHistoric(id)` only when the bit differs from `on`, so the command, its optimistic write and its journal entry are idempotent (R7). No sim file changes.
- **Acks carry no `cells`.** A zone or bulldoze result can carry up to `MAX_PREVIEW_CELLS` = 20,000 `{x, z, ok}` objects, which only previews need. The worker strips them before posting.

**Ordering and acknowledgement.**
- Each command gets exactly one `Ack` entry in the event log. It sits after every entry the command caused; those entries carry `cause = seq`.
- `ticket.done` resolves when the replica applies the `Ack`, so the replica already contains the edit (read-after-write).
- Commands are never reordered. In live mode they are applied at the next unit boundary: after the current day or step. In deterministic mode they are held until `state.day === atDay` at a day boundary.
- If the worker crashes, outstanding tickets reject with `HostCrashed`, and the journal keeps the commands for recovery (§4.3).

**Cause tags** (`host.cause`, R13).
- `host.act(op, args, {tag})` takes an optional main-side tag object, which is never posted. The host keeps a `seq → tag` map until the ack.
- `host.cause` is `{seq, tag}` while the events a command caused are being emitted, and `null` otherwise.
  - `LocalSimHost` sets it around `core.applyCommand`, inside `act()`, so the synchronous listeners see it.
  - The replica sets it while it re-fires entries whose `cause` is set, looking the tag up in the map. Entries the sim caused on its own have no cause.
- DispatchTool's `sending` flag (`DispatchTool.ts` ~62–76, ~306–311) becomes `host.act('dispatch', [...], {tag: this})` and, in its `'emergency'` listener, `if (e.type === 'dispatched' && host.cause?.tag === this) return;`. W0.2 lands this on `LocalSimHost`; W1.1 adds the replay side.

**Pending edits** (`host.pending`, R5).
- `pending` holds the posted commands that change preview inputs and have no ack yet: the column above. Map edits, plops, loans and ordinances count. `setCamera` (posted every 2 s), `setTax`, `setFunding`, `setHistoric`, `setSpeed`, `resume`, `setSettings` and `dismissAlert` do not.
- `pending.overlay(fn)` runs a preview with the player's pending edits overlaid. Inside the synchronous call it lowers `funds` by the pending commands' predicted costs (a pending loan raises it), and counts pending plops of unique defs in `milestones`. It restores both before returning. No listener can run in between: `CityActions` previews never draw `rng`, call `notify` or call `getSystem` (critique, O14), and they return before any write or emit.
- `pending.claims(rect)` tells whether a pending edit touches these cells. A hover preview over cells that a pending plop, road, rail, power line or subway will occupy reads "Blocked by a pending edit"; over cells that a pending bulldoze, dezone, zone or terraform will change, it reads "Waiting for the last edit…". Either replaces a reason computed on cells that are about to change.

**Predictions.** `HostActions` implements `CityActionsApi` for `ctx.actions`:

```ts
zone(rect: CellRect, zone: Zone, preview = false): ActionResult {
  const r = this.pending.overlay(() => this.preview.zone(rect, zone, true));   // same code as the worker
  if (preview) return r;
  const exact = this.pending.count === 0;      // none of the player's own preview-affecting edits in flight
  if (exact && !r.ok) return r;                // final: not posted (WYSIWYG with the red ghost)
  this.host.post('zone', [rect, zone], { predicted: r, exact });
  return exact ? r : { ...r, provisional: true };
}
```

- **Exact** predictions are made on a replica that contains every edit the player has made. They are final when they fail, and they are what the player sees on screen. The replica can still lag sim-originated changes by up to a packet, which is why an exact ok can still be contradicted by the ack.
- **Provisional** predictions are made while a preview-affecting command is in flight. The command is always posted, and the issuing tool reports the ack's result, not the prediction. This covers bulldoze then plop, road or power line on the same lot ("Blocked by…"), terraform then plop ("Too steep"), and zone then dezone ("No empty zoned cells"): they are applied in posting order after the edit they depend on, and succeed as they would on `LocalSimHost`.
  - The alternative, deferring the commit until the acks land and re-predicting, gives the player the same latency with an extra timer and a second prediction. Posting keeps the FIFO order with the edits it depends on, and the worker's answer is authoritative anyway.
- Cost and `affected` may differ by small amounts when sim-originated changes are in flight. Those differences are not surfaced.

**Gestures and corrections** (R4).
- `ToolController` opens a gesture on pointer-down and ends it on pointer-up. Every `act()` made meanwhile joins it. Commits outside a pointer gesture, such as InfoPanel's demolish button or a key, get a one-commit gesture of their own.
- Tools commit through `Tool.commit(op, args, feedback)` (W0.2), which replaces today's pattern of an ok sound or an error sound plus toast at each call site (ZoneTool, NetworkTool, PlopTool and BrushTool; InfoPanel's demolish uses the same helper):
  - exact ok: `feedback.ok(r)` at once. If the ack then fails, the tool **corrects** once per gesture: error sound and a toast with the ack's reason. Later failures in the same gesture are silent;
  - exact failure: `feedback.fail(r)` at once; nothing is posted;
  - provisional: `feedback.ok(ack)` or `feedback.fail(ack)` when the ack lands, with failure feedback once per gesture.
- There is no global `actionCorrected` handler. A correction always reaches the tool or panel that issued the command.
- **BrushTool.** A held brush applies every 70 ms (terraform) or 120 ms (trees). Today it fails silently during the hold and plays one sound on release (`BrushTool.frame()` / `up()`): the brush sound if anything was applied, else `error`. In the worker, application k+1 is often predicted on a replica that does not yet have application k, so a level or smooth brush reaching flat ("Nothing to change"), or trees filling up ("No room for trees here"), would be refused by the worker after an ok prediction. So BrushTool keeps its soft hold sounds on the predictions, takes `spent` and `failed` from the acks, and `up()` waits for `gesture.settled` before it plays the release sound. No toast, as today.
- **Mismatches** are counted per gesture: a gesture is a mismatch when it gave ok feedback from an exact prediction (a sound, a deselect) and none of its acks succeeded. The W1.4 gate is at most 1 % of gestures.

**Pending ghosts** (O1).
- When a tool commits, it hands its last preview geometry (rect, path or footprint) to `world.setPendingPreview(ticket.seq, geometry)`. The world draws it in a neutral pending style until the ticket settles.
- The ack is replayed after the entries the command caused, so the real road or zone appears in the same frame as the ghost disappears: there is no blink between the two. A failed ack removes the ghost, and the tool's failure feedback explains why.
- Hover previews are never suppressed. They run on the replica with the pending overlay, and `tools.refresh()` runs when the last ack lands.

**Optimistic writes** (R1).
- The replica runs the real `CityActions` method on itself. `PreviewShell.events` is the replica emitter, so `setHistoric`'s `buildingChanged` updates the renderer at once.
- The op is recorded with its `seq` as an **idempotent field write**: `budget.taxRates[d] = v`, `budget.funding[s] = v`, the speed, the Historic bit of a building, or a dismissed alert id. Never "toggle again".
- Every packet carries `cmd`, the highest seq the worker had applied when the packet was built. Data captured at that point reflects every command with `seq ≤ cmd` and none after it.
- **Every write that could revert an optimistic value re-applies the pending ops right after it** (§2.4): the plain sections, the policy section, every building record written during the log replay, and the `blds` records. A listener therefore never sees a slider, a historic flag or a dismissed banner flick back, not even inside the burst. An optimistic op is dropped when its `Ack` replays.
- Each slider key coalesces to one command per frame.

### 2.3 Worker → main

```ts
export type W2M =
  | { t: 'hello'; v: number }
  | { t: 'boot'; phase: 'idb' | 'deserialize' | 'wasm' | 'systems' | 'journal' | 'snapshot'; pct: number }  // §4.1
  | { t: 'ready'; snapshot: SerializedCity; streams: Streams; policy: PolicyState; clock: Clock; savedAt: number; cmd: number;
      journal?: Journal }                                          // also on 'resync'; journal: §4.3, only if the post-replay save failed
  | { t: 'pkt'; p: Packet }
  | { t: 'fatal'; message: string; stack?: string };

export type Reply =                  // replies always ride inside packets (R3)
  | { t: 'qres'; id: number; ok: boolean; value?: unknown; error?: string }
  | { t: 'saved'; id: number; ok: boolean; savedAt?: number; cmd?: number; summary?: RegionCitySummary; fp?: string; pktSeq?: number; record?: CityRecord; error?: string }
  | { t: 'snapped'; id: number; marker: RecoveryMarker; payload: Uint8Array; cmd: number }  // payload ≤ LS budget − journal reserve
  | { t: 'error'; key: string; title: string; message: string; stack?: string; sim: boolean; disabled?: boolean };

export interface Packet {
  seq: number;                       // consecutive; a gap triggers 'resync'
  cmd: number;                       // highest command seq applied when this packet was built
  clock: Clock;                      // { day, frac, speed, slow, spd, live }; every packet
  log: Entry[];                      // the ordered event log (§2.4)
  recs?: Float64Array;               // event-time building records, REC = 25 numbers each, referenced by the log
  incs?: IncidentRecord[];           // event-time incident records, referenced by Emergency entries (R8)
  defs?: string[];                   // def ids appended to the session's def table
  cells?: CellPatch[];               // { layer, x0, z0, x1, z1, data } end-of-packet bytes of the rect union per layer
  layers?: LayerPatch[];             // { name, whole } | { name, idx: Uint32Array, val } | { name, road: Float32Array, off?: { idx, val } }
  rasters?: RasterPatch[];           // { overlay, variant, data: Float32Array, scale, day }: worker-built derived rasters
  blds?: Float64Array;               // end-of-packet records: focus ids (all fields) + constructing (built) + rolling (pop, jobs)
  plain?: PlainPatch;                // changed sections only: funds, nextBuildingId, stats, budget, milestones, unlocked, announced,
                                     // neighborConnections, historyTail, sys: { economy, infraVersion, infraLayers, advisors, regionJobs, regionWorkers }
  emergency?: { incidents: Incident[]; vehicles: EmergencyVehicle[]; active: boolean; layersReady: boolean; stVer: number; stations?: StationRow[] };
  traffic?: { routes?: SampleRoute[]; trucks?: { idx: Uint32Array; val: Float32Array } };
  disasters?: ActiveDisaster[];
  policy?: PolicyState;              // { alerts: {id, wasPossible}[], live: boolean, toast?: {text, kind}, warn?: true }
  watch?: { id: number; key: string; value: unknown }[];   // key: the watch's argument key (§2.8)
  replies?: Reply[];                 // applied last (§2.4): never newer than the replica
  acks?: unknown[];                  // results referenced by Ack entries; no `cells`
  pong?: number;                     // the last ping answered (§2.10)
  stats?: WorkerStats;               // busy %, ms per day, units per kind, queue depth (≤ 1 Hz)
  digest?: number;                   // dev builds, monthly: exact-state digest at this packet
}
```

- **Replies ride inside packets.** A query result, a save or snapshot acknowledgement and a forwarded error are added to the open packet and applied after its log. A result can therefore never reach main before the packet that holds the `Ack` of a command posted before the query. Inspector reports, `demolishRisks` and dispatch results always describe edits the replica already has. `fatal` is the only separate message.
- `saved.cmd` is the highest command seq the save contains. The journal (§4.3) and dirty tracking use it.
- `REC_FIELDS = [id, x, z, w, d, rot, variant, pop, jobs, capacity, wealth, built, age, flags, baseY, health, unhappy, kids, teens, yad, srs, wf, edu, hire]` plus a def index.
- `NaN` encodes an undefined optional field. That is the `serialize.ts` convention, so the round trip is exact.
- Unknown extra building keys (`SerializedBuildings.extra`) are a dev assertion. The probes saw none.
- Every typed array in a packet owns its buffer (§1.4).

### 2.4 The event log and the fidelity rules

`type Entry = [type: EntryType, day: number, arg?: number | string | object, cause?: number]`

`EntryType`:
- the building events: `BuildingAdded`, `BuildingRemoved` and `BuildingChanged`, where `arg` is a record index;
- the map edits `NetworkChanged`, `ZoneChanged`, `TerrainChanged`, `PowerLinesChanged`, `SubwayChanged` and `TreesChanged`, where `arg` is `[x0, z0, x1, z1]`;
- `Emergency`, whose `arg` is `[event, incidentRecordIndex]`: the event payload plus the incident as it was when the event fired (R8);
- `Day`, `Month`, `Year`, `News`, `LayerUpdated`, `Disaster`, `Unlocked`, `SpeedChanged` and `Reset`, whose `arg` is the event payload;
- `Ack`, whose `arg` is an index into `acks`.

**The recorder** (`src/worker/recorder.ts`, `ChangeRecorder`):
- It subscribes to every `CityEvents` type after `SimCore.boot`. That is the same position the views take today, after `loadSim`'s `init`.
- **Building events** capture the 25-number record at emit time into a growing `Float64Array`, with no object allocation. The flush copies it out with `.slice(0, n)`.
- **Emergency events** capture the incident's record at emit time: a copy of the `Incident`, which is plain data (`state`, `lost`, `deaths`, `injured`, `saved`, `units`, `fires`, `etaMin`, `answered`, `prompted`, …). `EmergencySystem.finalize()` (`emergency.ts` ~2546) removes the incident from `list` and `byId` before it emits `'failed'` or `'resolved'`, and `lost` and `deaths` are often incremented the same day in `fireStep`, so the end-of-packet stream no longer has the final values. About 8 emergency events per day at 1M, a few hundred bytes each.
- **Map events** append their rect to a per-layer union. The copy of the bytes is taken at flush:

  | event | layers |
  |---|---|
  | `networkChanged` | network, netFlags |
  | `zoneChanged` | zone |
  | `terrainChanged` | heights, using the corner rect `(x1+1) × (z1+1)`, and water |
  | `powerLinesChanged` | powerLines |
  | `subwayChanged` | subway |
  | `treesChanged` | trees |

- `layerUpdated` marks the subscribed and always-mirrored groups dirty (§2.6).
- **Measured cost:** 0.4–0.9 ms per day p50 of worker CPU, under load.

**The replica applies a packet** (`src/worker/replica.ts`, `Replica.apply`, in one synchronous call inside `onmessage`). It keeps `applied`, the highest command seq whose `Ack` it has replayed, which starts at the previous packet's `cmd`.

1. It checks that `seq` follows the last one, and appends `defs`.
2. It applies the **end-of-packet** sections before replaying anything:
   - `cells`, using `.set` into the existing arrays, so identity is kept;
   - `layers`: whole, sparse, or road cells only (§2.6);
   - `rasters`, registered as derived sources in overlays.ts (§2.6);
   - `plain`, applied **in place**: objects are key-merged and arrays copied element by element, so a closure that holds `ctx.state.budget` keeps a live object (O8). Then the pending tax and funding ops with `seq > p.cmd` are re-applied;
   - the `emergency` stream: it updates `Incident` objects in place by id, so the banner's `b.inc` keeps its identity (hazard 10). An incident that ended leaves `incidents()`, but its object stays reachable by id until the log has replayed its terminal entry;
   - `traffic` and `disasters`;
   - `policy`, then the pending dismissals with `seq > p.cmd` are re-applied.
3. It **replays the log in order, in one burst:**
   - For each entry it sets `state.day = entry.day`, and `host.cause` from the entry's `cause`.
   - **Building entries:**
     - It writes the record into the replica's `Building` object, in place. Each object keeps its identity for the whole session, so `BuildingRenderer`'s `bi.b` stays valid (hazard 10).
     - It then re-applies the pending building-field ops for that id with `seq > applied`, because the record may predate them. The ops are idempotent sets, so re-applying one that the record already reflects changes nothing.
     - New objects are created with the same literal shape as `restoredBuilding()` in `serialize.ts`, which keeps V8's fast properties.
     - On add, the object goes into `state.buildings` and its footprint into `state.building`. On remove, they are cleared only where `building[i] === id`, exactly as `placeBuilding` and `removeBuilding` do.
   - **`Emergency`** writes the event-time incident record into the `Incident` object with that id, live or just ended, before the event fires. The banner's "Help came too late — 1 building lost" then shows the loss.
   - **`News`** pushes to `state.news` with the 200-item cap and increments `replica.newsSeq`.
   - **`Ack`** sets `applied`, drops the command from `host.pending` and its optimistic op, if any, resolves the ticket, compares it with its prediction, and reports to the ticket's gesture.
   - Then it emits the event on `host.events`. Main listeners keep today's registration order: `GameSounds` before `EmergencyBanner` (hazard 9).
4. It applies `blds`: focus, constructing and rolling records, at end-of-packet values. Then it re-applies the pending building-field ops with `seq > p.cmd`.
5. It gives the incidents that are still live their end-of-packet values back from the stream, so F4 holds after the packet.
6. It applies `watch` values and fires their callbacks, then applies `replies`: query results resolve, and `saved`, `snapped` and errors are handled. This comes last, so none of them describes state the replica does not have yet.
7. It sets `state.day = clock.day`, resets the clock predictor (§3.5), clears `host.cause`, and records apply ms and bytes. Dev builds assert that every field with a pending op still holds the op's value.

**Robustness** (R12).
- `Emitter.emit` (`src/core/events.ts`) does not catch listener exceptions, so today one throwing listener aborts the rest of an emit, and inside a packet it would abort the remaining entries, `blds` and the clock. Consecutive seqs would not reveal the divergence.
- The replica's emitter therefore calls each listener inside `try`/`catch`. An exception is reported once per event type and listener through `ErrorOverlay` (`key: 'view:<type>'`), and the burst continues. The packet always completes.
- Each step of `apply` is also guarded. An exception in the replica's own code, not in a listener, marks the replica diverged, and main posts `resync` after the packet (§2.10).
- `LocalSimHost` keeps the sim's plain `Emitter`, which is today's behaviour.

| rule | what a listener sees | why |
|---|---|---|
| F1 | primary layers: end of packet, except the `building` grid, which follows the building entries in order (so it always agrees with `state.buildings`) | the map listeners (WorldView `cells()`, NetInfo, MiniMap) only mark dirty or re-read their rect. An event-time copy would be wrong anyway: growth's `create()` clears trees and levels the lot *before* `buildingAdded`, but emits `treesChanged` and `terrainChanged` *after* it |
| F2 | the payload `Building`: its record **at emit time** (exact fields + pop, jobs, built); the payload incident of an `Emergency` entry: its record at emit time | GameSounds' `b.built` on add or change; WorldView's rect of a removed building; added and removed within one packet still produce both events with a readable object (hazard 8); the banner's outcome text reads the final `lost` and `deaths` |
| F3 | `state.day` at each entry: the emitting day | `NewYear`'s batch test, and the 'month' and 'year' payloads |
| F4 | plain data, mirrored layers, the emergency stream: end of packet, apart from F2's incident record during its own entry | the policy logic that needs event-time incident state runs in the worker (§3.3) |
| F5 | lagged fields: pop and jobs converge within about 0.6 s at ultra; `built` is daily while under construction; the others are exact only for focus ids | a gate keeps any other main code from reading them (§5.3) |
| F6 | every event, in emission order, one burst per packet, with `cause` tags | GameSounds' 50, 60 and 100 ms windows; DispatchTool's own dispatch (hazard 9) |
| F7 | watch values and replies only after the whole packet | a result never describes edits the replica does not have yet |
| F8 | an optimistic value never reverts before its ack, not even inside the burst | sliders, the historic toggle and dismissed banners |

### 2.5 Building records

- **Exact fields** travel only with building events.
  - The probes found 0 silent changes in 60 days on each fixture. A daily full shadow diff (6–13 ms/day) is therefore not shipped.
  - Dev builds run `auditExact`: 1/32 of the buildings per day against a shadow, reported as `console.error('silent exact-field write', id, field)`. The replica test fails on any.
  - The critique re-audited the premise: exact fields are set only at creation, and every in-place `flags` write is followed by an emit (batched at `population.ts:608`), apart from emergency.ts's init-time repair and a `leaveCluster` clear whose `buildingChanged` follows.
- **Rolling `pop`/`jobs`.**
  - Each packet, the worker advances a cursor over `buildingList(st)`: 512 buildings, compared with a `Float64Array` shadow indexed by id. It sends only the changed ones: about 260 per day at dense1m, a few per packet.
  - **The shadow mirrors what the replica holds** (R2). It is updated by every record the worker sends that carries `pop` and `jobs`, in the order the replica applies them: event-time records as they are captured, then focus, constructing and rolling records at flush.
  - Why: an event-time record writes pop and jobs into the persistent replica object (F2). If only rolling sends updated the shadow, a building whose value returned to the shadow's value after an event-time record would never be sent again. Measured on bot256 over 90 days at design cadence with 512 per packet, after forcing a full rolling round: 12, 36 and 32 buildings still differed at days 30, 60 and 90, mostly civic staffing (`civ_police_station` replica jobs 30, worker 15; `civ_hospital` 122 against 120). QueryTool's tip shows `b.jobs / b.capacity`. With the shadow following every record: 0 at every checkpoint. Revision 1's probe used full lagged sweeps, so it never exercised this path.
  - Every building is checked every ~34 packets: about 0.6 s at ultra, where a packet carries one day, and longer at 1×, where packets also come from heartbeats.
- **Constructing set.**
  - A building enters it from `buildingAdded` with `built < 1`, and leaves when `buildingChanged` clears `Constructing`.
  - Its `built` is sent once per day: an estimated 20–40 buildings at 1M (about 1.2 adds per day). `BuildingRenderer` reads it every frame (`sy = max(0.03, min(1, b.built))`).
- **Focus ids** (`ViewState.focus`): all fields every packet, for the QueryTool's hovered building, the inspector target and the dispatch site. They also update the shadow.
- **Not mirrored:** `age, health, unhappy, kids … hire`. They change silently on about 6.2k buildings per day at 1M.
  - On main they are read only by `InfoPanel` and `inspectorModel` (through `inspectBuilding`), by the Demographics raster (built in the worker) and by focus readouts.
  - `tests/worker/hygiene.test.ts` holds the allowlist.

### 2.6 Layer groups and subscriptions

| group (`layerUpdated` name) | arrays (bytes at 256²) | sent when | consumers |
|---|---|---|---|
| primary | 9 arrays, 985 KB | bootstrap, then rect patches | everything |
| `utilities` | `powered`, `watered` (64 KB each) | **always**, on its event; sparse when ≤ 25 % of cells changed | MiniMap Power, zone chips, Onboarding, Power and Water views |
| `traffic` | `traffic`, `congestion` (256 KB each) | **always**, on its event, as **road cells only** (below) | VehicleRenderer, Traffic view |
| `pollution` | `airPollution`, `waterPollution`, `garbage`, `noise` (+ `soil`, `landfillFill`) | the shown view's array only | Air, Water, Garbage, Noise and Soil views |
| `services` | `policeCov`, `fireCov`, `healthCov`, `eduCov`, `parkCov`, `transitCov` | the shown view's array | coverage views |
| `catchments` | `eduElemCov`, `eduHighCov`, `eduCollegeCov`, `playCov`, `greenCov`, `shopAccess`, `stigma`, `prestige`, `campus`, `accessCommute` | the shown view's arrays (NIMBY needs `prestige` and `stigma`) | Education tiers, Parks, Shops, NIMBY, Commute |
| `crime`, `landValue`, `tourism`, `parking` | one array each | when shown | their views |
| `desirability` | `desirability[dev]` (one of 12; 256 KB) | the shown variant only | Desirability view |
| `emergency` | `respFire`, `respPolice`, `respMedical` | when the Emergency view is shown | Emergency raster (built on main) and its readout |
| worker rasters | tap water (Water v1), the appeal variants (Desirability v12–14), Demographics v0–5 | when shown; on their deps' events; at most 2 Hz | TerrainRenderer and the hover readout |
| traffic stream | raw truck volumes, sparse (about 2.6k nonzero cells, about 20 KB) | while the Trucks view or the road inspector is shown | Trucks raster (main, `buildTrucks`), road tips |

- **Road-cell-only traffic encoding** (R15).
  - `traffic` and `congestion` are nonzero only on network cells. Both sides enumerate those cells in ascending index from their exact, end-of-packet `network` layer, so no index is sent. The encoding is the values of those cells, as `Float32Array`s, plus an `off` exception list (`idx`, `val`) of any non-network cell whose value is nonzero.
  - The decoder writes the road values, zeroes the other cells, then applies the exceptions. So the encoding is exact by construction, even when a bulldozed road still carries a stale value in the worker.
  - Measured over 20 passes each at design cadence: 23,141 road cells on dense1m (181 KB per pass instead of 512 KB) and 13,909 on bot256 (109 KB); the exception list was empty every time. A changed-cell encoding would not be smaller: 17.3k–22.4k of the 23.1k road cells change per pass on dense1m (271–350 KB as index and value pairs), and 6.9k–12.3k of the 13.9k on bot256 (108–193 KB).
- **Subscribing.**
  - Switching views posts `view`. The worker answers in the next packet with the current arrays, then keeps sending them on their events.
  - The first frame after a switch draws the cached values from the last time that view was shown, if any. They are refreshed within one tick, which is the inventory's ≤ 1-tick budget.
  - **A view with no data yet draws nothing** (O9). The 16 `DERIVED_LAYERS` (`serialize.ts:78`: the catchment tiers, `stigma`, `prestige`, `campus`, `accessCommute`, `treeCover`, `visitors`, the `resp*` layers, `parking`) are not in `ready`, and a resync drops every cache. Until a view's first subscribed data arrives, TerrainRenderer keeps the overlay off and the legend says "Loading…", instead of drawing zeros.
- **Throttle.** No group is sent more than 4 times per real second. A deferred group carries its `LayerUpdated` entry in the packet that delivers the data, so its listeners re-read when the data has arrived.
- **Shadows.** The worker keeps a last-sent copy only of the arrays sent as sparse diffs (at most about 3 MB).
- **Silent band writes** (hazard 13). `landValue` and `desirability` are rewritten by band every day without an event; the group is sent on the sweep's `layerUpdated` (about every 12.5 days). The view refreshes exactly when today's renderer would. The hover readout can be up to one sweep staler than today's (at most 0.6 s at ultra). The inspector reads fresh values through its watch.
- **Derived sources.** overlays.ts gets `registerDerivedSource(st, (o, v) => Entry | null)`. `derived()` asks the source first, and `overlayStale()` reads the source's version. `LocalSimHost` registers nothing, so its behaviour is unchanged.

### 2.7 Streams

- **Emergency.**
  - Sent whole in every packet in which a day passed or an `emergency` event fired.
  - Incidents average 6.2 (max 14), vehicles 18.5 (max 33); about 6.7–7.5 KB, max 13.8 KB.
  - The stations (288 rows, 37 KB) are sent only when `stVer` changes.
  - `EmergencyView.stationName(id)` and `stationFleet(id)` read the station rows.
  - Event-time incident records travel with the log (§2.4).
- **Traffic.** `getSampleRoutes(1024)` is sent on each traffic pass and when the service routes change: 62–88 routes, 6–15 KB. `TrafficView.sampleRoutes(max)` slices the cached list, which feeds `getTrafficRoutes`.
- **Disasters.** The `active` list is sent while it is non-empty. The tornado keeps re-emitting `'disaster'` per cell from `frame()` in the worker.
- **Policy.** Sent on change: the alert ids with `wasPossible`, the `live` flag, an optional toast, and `warn` for the warning sound.
- **History.** On `'month'`, the last value of every `HISTORY_KEYS` series is appended. The replica applies `HISTORY_CAP` (600, `history.ts`) the same way the worker does.

### 2.8 Queries and watches

- **Handlers.** `src/worker/queries.ts` registers headless handlers `(sim, args) => plain data`. The large one, `inspect.ts`, holds InfoPanel's data gathering moved out of the panel (`InfoPanel.ts` lines ~296–760).
- **Caching, keyed by arguments** (O3).
  - Each watch handle caches values per argument key. `.value` returns the value for the current arguments only; stale-while-revalidate applies within one key, never across keys. When InfoPanel switches target, it never shows the previous target's report.
  - InfoPanel renders its header (name, def, footprint, flags, focus-record fields) from the replica at once, and fills the sections when the watch lands, at most one tick later.
  - An in-flight query is never duplicated.
- **Real-time cap** (O2). Every watch is pushed at most 5 times per real second, whatever its policy. At ultra, "daily" would otherwise mean 20 Hz for `capHints`, `garageStates`, `tourismSummary`, `attractivenessBreakdown`, `computeMonthlyBudget` and `dispatchOptions`: three times today's 6 Hz `uiTick`, on worker CPU.
- **Results must clone.** Handlers return plain data only. For example, `advisors.ts` advice carries a lazy `where?: () => {x, z}` (`pendingWhere`), so the handler resolves it with `placed()` before returning. A `DataCloneError` in a handler fails that query and is reported in dev builds. `LocalSimHost` clones results in dev and tests from W0.3 on (§1.2).
- **No side effects.** A handler must not change sim state. `tests/worker/querySideEffects.test.ts` (§5.3) enforces it.

| name | replaces | policy |
|---|---|---|
| `inspectBuilding {id, sections}` | `facilityReport`, `facilityLoad`, `needsOf`, `conditionBreakdown`, `desirabilityBreakdown`, `landValueBreakdown`, `growthLimits`, `traffic.routeInfo / workerAccess / jobFill / customers / freightAccess`, `crime.termsOf`, `pollution.garbageInfo`, `tapWaterAt`, `emergencyReachAt`, `utilities.gridInfo / waterInfo`, `needsExpectation`, `waterRequired`, the full record | **watch.** Recomputed when InfoPanel's signature changes (`b.pop, jobs, flags, built×20, monthIndex, day/5`), at most 1 Hz. This is today's `REBUILD_MS` policy, moved into the worker |
| `inspectCell {x, z, sections}` | `roadCellReport` (truck volume, bus riders, ramp load), `pollution.landfillInfo`, the empty-lot desirability and land-value breakdowns, `growthLimits`, `emptyZoneStatus` inputs | watch, same policy |
| `dispatchOptions {incidentId}` | `EmergencySystem.dispatchOptions` (54 options; 7.4 ms cold, 0.05 ms warm in the worker) | watch while DispatchTool or a banner is open, at most once per sim day |
| `routePreview {incidentId, stationId}` | `routePreview` | query per hovered station, cached per station |
| `emergencyReport {x, z}` | `em.report` (DispatchTool switching incidents) | query on click |
| `demolishRisks {rect, cost}`, `sideDemolishRisks {ids, fee}` | `demolishRisk.ts` (it walks every building and reads lagged pop and jobs; 1.6 ms) | query on mouse-up, before `confirmDialog` (at most 1 tick) |
| `stopsNear`, `ferryPartnersFor` | PlopTool's garage and ferry lines | query per placement key (already cached per key) |
| `openAdvice`, `advisorIssues` | `AdvisorsPanel` (40 ms cold, 3.3 ms warm) | `advisorIssues`: watch, monthly. `openAdvice`: query, throttled by `OPEN_REFRESH_MS` (3 s) as today |
| `capHints`, `tourismSummary`, `attractivenessBreakdown` | TopBar popover, DemographicsPanel | watch while open, daily |
| `unservedClusters {tier}` | DemographicsPanel "Show me" | query on click |
| `computeMonthlyBudget` | BudgetPanel forecast (1.7 ms warm, 12.5 ms cold on main at 1M; `transportUseFactor` needs `TRAFFIC_OF_STATE`) | watch while open, re-run after each budget command. The forecast lags the slider by about 1 tick |
| `garageStates` | StatsPanel's `rt.ensureLists()` + `traffic.garageInfo` (`StatsPanel.ts:43`). This was a UI write into the econ runtime | watch while open, daily |
| `verify` | – | dev: `exactDigest` of the exact state on both sides (primary layers, exact building fields, plain data; not `serializeCity`, which refuses the replica) |

**Replica-safe**, so these stay synchronous on main: `listRewards`, `listOrdinances`, the `setOrdinance` preview (including `needsConfirm`), `loanOffer`, `maxLoanAmount`, `approvalBreakdown`, `econData(st).regionTerms`, `serviceEffectiveness`, `onStrike`, `demandInfo`, `emptyZoneStatus`, `utilityReaches`, `infraFlags`, `windVector`, `overlayLayer` and `overlayReadout` for direct layers, `cityFingerprint`, and every `CityActions` preview.

### 2.9 `scene.sim` and the harness hooks

`SimFacade` is `host.sim`:
- `state` (a getter, so it follows a resync), `events`, `simTime()`, `secondsPerDay()`, `dayFraction`;
- `speed`: get reads the mirror; set calls `host.setSpeed(v, 'facade')`;
- `liveSlowdown`, read-only;
- `getSystem(name)`, which returns only the views (`'emergency'`, `'traffic'`, `'utilities'`, `'disasters'`); anything else returns `undefined`, with a dev warning;
- `runDays(n)`: synchronous in `LocalSimHost`, a `debug.runDays` promise in the worker.

The facade wraps the real `Simulation` in `LocalSimHost` too, so the boundary is checked by the compiler in both modes.

| user | what it uses | result |
|---|---|---|
| `uiprof.mjs` | `scene.sim.speed = 3` | works unchanged |
| `qa-deadzones.mjs` | `scene.sim.state.*` | reads the replica: exact for map layers and exact fields; lagged fields as in F5 |
| `ui/demo.ts` | `runDays` | needs the synchronous `runDays`, so the page sets `?simworker=0` |
| `window.__metropolis.city.scene` | the scene | also gains `.host` |

### 2.10 Versioning, sequencing, backpressure, liveness, volume, errors

- **Versioning.**
  - `init.v` and `hello.v` must equal `PROTOCOL_VERSION`; a mismatch is fatal and falls back to the local host.
  - The worker chunk is content-hashed by Vite and referenced by the page, so a stale worker cannot meet a new page. Vite reloads the page when the worker changes in dev.
  - `CITY_SAVE_FORMAT`, `CITY_SAVE_VERSION` and `DELTA_VERSION` do not change. The journal is a separate record next to the recovery snapshot (§4.3).
- **Sequencing and resync.**
  - Packet `seq` is consecutive. A gap, a failed dev `digest`, or a replica marked diverged (§2.4) makes main post `resync`.
  - The worker answers `ready` with a full snapshot and its current `cmd`.
  - **`Replica.adopt()` builds a fresh `CityState`** from the snapshot (`deserializeCity`), brands it, and swaps it in as `host.state`. Then it redoes the view registrations (`TRAFFIC_OF_STATE`, `attachOverlays`, derived sources, the `PreviewShell`'s state), re-applies the pending optimistic ops with `seq > ready.cmd`, and emits `'reset'`.
  - A fresh object empties all the per-state `WeakMap` caches by construction. Adopting into the old object would keep, for example, `buildingList`'s `listCache` (`infra/common.ts:319`, keyed by size, `nextBuildingId` and day) or overlays' `homesCache` (~`:253`) returning removed `Building` objects when those keys happen to match.
  - The views already rebuild on `'reset'`. Those that hold the state re-read it: CityObjectsView through `opts.getState`, and WorldView's handler changes from `setState(this.state)` to `setState(ctx.state)`. Everything else reads `ctx.state`, a getter.
  - The worker resets its shadows to what it sent in `ready`: the rolling pop/jobs shadow, the last-sent copies of sparse layers and the constructing set. Diffs after a resync are then relative to the replica's new contents.
- **Flushing.** The worker flushes after every day unit, after every batch of drained commands or replies, after the last unit of a tick, and when it owes a `pong`. When nothing changed it sends nothing, except a 250 ms heartbeat.
- **Backpressure.**
  - Ticks carry `ack`. If `seq − ack > 4`, the worker stops flushing; the recorder keeps merging into one packet (rect unions, latest arrays, concatenated log). Replies wait in that packet: main is the side that is behind.
  - Because the worker is paced by ticks and ticks come from rAF, a stalled page stops the simulation instead of queuing work.
  - Per-group throttle: §2.6. Main coalesces slider and focus messages to one per frame.
- **Liveness** (R11).
  - A frozen page (Page Lifecycle freeze, the back/forward cache, energy saver) freezes its worker too. A wall-clock timer would then report a crash on resume.
  - So main counts only **visible, unfrozen** time since the last packet. The count is reset on `visibilitychange` to visible, on `resume` and on `pageshow`.
  - While visible, main posts `ping {n}` once per second; the worker answers with `pong: n` in its next packet, at the next unit boundary.
  - Ten seconds of such time without any packet lead to the crash path (§4.4).
  - `worker.onerror`, including a script load error, and `messageerror` fail fast: before `ready` they fall back to `LocalSimHost` at once, and after it they take the crash path at once.
  - Boot has its own timeouts (§4.1).
- **Volume** at the S5 cadence (R15). This is dense1m at ultra, 20 sim days per second. AC4 and S5 require at least 10 traffic cycles per 60 sim days (3 s at ultra), so up to 3.3 traffic passes per second with `TRAFFIC_MIN_CYCLE_MS` = 300 ms.

  | part | per sim day | MB per real second |
  |---|---|---|
  | event log + building records | 7–19 KB | 0.14–0.38 |
  | plain data | 6–9 KB | 0.12–0.18 |
  | emergency stream + event-time incident records | 7–9.5 KB | 0.14–0.19 |
  | utilities (sparse) | < 0.5 KB | < 0.01 |
  | traffic group, whole: 2 × 256 KB per pass | – | 1.71 |
  | traffic group, road cells only: 181 KB per pass (bot256: 109 KB) | – | 0.60 (bot256: 0.36) |
  | sample routes: 6–15 KB per pass | – | 0.02–0.05 |
  | one shown data view: a 256 KB array at its group's cadence after B1 and S5 (1–2.5 per second, ≤ 4 Hz) | – | 0.26–0.64 |

  - **Totals.** With traffic sent whole and no data view: 2.1–2.5 MB/s. Revision 1's 1–1.6 MB/s assumed about 0.5 traffic cycles per second. With road cells only: 0.8–1.4 MB/s without a data view, and 1.0–2.1 MB/s with one.
  - **Main-thread cost** at the measured 0.8–0.9 ms per MB: whole, 1.7–2.3 ms per real second, at or above the 2 ms/s W3 gate; road cells only, 0.6–1.3 ms/s without a data view and 0.8–1.8 ms/s with one.
  - Per-message overhead is not resolved: small packets measured 0.1 ms p50, which is the 100 µs timer floor, and there are 20–25 packets per second at ultra. It is measured by aggregation in W1.1 (§5.4).
  - **Decision:** the road-cell-only encoding ships in W1.1, well before W1.4. W1.4's browser A/B measures bytes/s and main-thread deserialization with a data view shown. If that exceeds 2 ms/s, the shown view's group is first capped at 2 Hz, and then W3 is reconsidered.
  - The worker pays a similar serialization cost: 0.7–1.9 ms per real second, under 0.1 ms per sim day.
- **Errors.**
  - `guardSystem` runs inside `SimCore` and keeps its "disable after 20 errors" rule.
  - The worker adds an `error` reply, throttled per key; main calls `ErrorOverlay.report(…, {sim: true})`.
  - Uncaught errors in the worker (`self.onerror`, `onunhandledrejection`) post `fatal`, which leads to the crash path (§4.4).

## 3. Pacing

### 3.1 The worker loop

```ts
// src/worker/simWorker.ts
const inbox: M2W[] = [];
const loop = new MessageChannel();                    // self-post between units; never spins: idle when there is no work
self.onmessage = (e) => { inbox.push(e.data); kick(); };
loop.port1.onmessage = unit;
function kick() { if (!scheduled) { scheduled = true; loop.port2.postMessage(0); } }

function unit() {
  scheduled = false;
  core.drain(inbox);            // FIFO: cmd / query / watch / save / view / ping; tick → core.beginTick(dt).
                                // Query results, acks and pongs go into the open packet.
  const u = core.nextUnit();    // 'step' | 'day' | 'save:copy' | 'save:put' | 'snapshot' | 'watch' | null
  if (u) core.run(u);           // exactly one scheduler step, one advanceDay(), or one persistence stage
  if (core.needsFlush()) post({ t: 'pkt', p: recorder.flush() });
  if (core.hasWork() || inbox.length) kick();
}
function post(m: W2M) {
  if (DEV) assertOwnedBuffers(m);   // §1.4
  self.postMessage(m);              // never a transfer list
}
```

`core.beginTick(dt)` reproduces `Simulation.update(dt)` as separate units:

1. **Frame hooks.**
   - `sim.frameHooks(dt)` is a new method that `update()` itself calls, so `LocalSimHost` is unchanged. It runs every system's `frame()`, including at speed 0, so infra passes keep running after paused edits.
   - Coalesced ticks run the hooks once, with the summed `dt` capped at 0.25 s.
   - The scheduler is **host-driven**: `tickFrame()` only stamps `lastFrameMs`.
2. **Steps.**
   - `scheduler.beginFrame()`, then one `scheduler.stepOnce(sim, budgetLeft)` per unit, then `scheduler.endFrame()`.
   - These three new methods split today's `run(sim, INFRA_FRAME_BUDGET_MS, true)` without changing the urgent-first and least-served rules or the credit renormalisation.
   - Time spent on commands between steps is not charged to the budget.
3. **Days.**
   - `sim.accumulate(dt)` is the accumulator of today's `update()`: `acc += min(dt, 0.25)`, at most `maxDaysPerFrame = 4` days, and the cap `acc = min(acc, spd)`. Each day is one unit.
   - **Before every day unit the core re-checks `secondsPerDay()`.** If it changed, the remaining days go back into `acc` and are recomputed. This is how a policy slowdown takes effect at once (§3.3).

**Live mode is an explicit host flag** (O7). Today the scheduler infers it: `framesActive` is `nowMs() − lastFrameMs < 750` (`scheduler.ts`), and `disasters.ts:74` has its own 750 ms check. A worker unit or a main-thread stall over 750 ms (a month day at 1.4M before B3, a debugger) would flip `tickDay` to the headless budget in the middle of a live day. So `SimCore.setLive(on)` sets the flag on the scheduler and on disasters: true while a frame-paced session runs, false in `runDays` and deterministic mode. The 750 ms inference stays only as the default when no host sets the flag (tests, the bot).

Two budgets:
- **W1** keeps today's semantics, 3 ms of steps per tick, for the same freshness as today without the main-thread cost.
- **W1b** adds `InfraScheduler.setFrameBudget(ms)`. The worker host sets an adaptive budget of `clamp(0.7 × dt − dayTimeThisTick, 0, 12 ms)`, keeping today's rule of at least one step per tick when something is due.
  - Because it follows `dt`, a 144 Hz display does not get 2.4× the infra share.
  - Days always win. When days fall behind, steps drop to that 1-step minimum.
  - This covers skeptic finding 9.3: 12 ms per tick plus the daily systems exceeded AC5's 0.9 core.

### 3.2 Speed, pause and hidden tabs

- **Writers.** Every speed writer calls `host.setSpeed(v, source)`:
  - TopBar (`TopBar.ts:155`), the keys in `CityScene.onKey`, PauseMenu (`Modals.ts:21`, `:67`), ErrorOverlay's pause button;
  - `onVisibility`, `exitToRegion`, Onboarding (`:127`), `initialSpeed` and `newCity` (`init.initialSpeed`).
- **Effect.** The mirror updates at once, so TopBar is right. The worker applies the command at the next unit boundary, which is ≤ one step or one day, and only then can the next day start.
- **Pause and resume** (O13). Today PauseMenu stores `prevSpeed = sim.speed` and restores it. With a mirror, the worker's LIVE policy may already have set speed 1 in a packet main has not applied yet: restoring the mirror's 3 would end LIVE. So pausing posts `setSpeed(0, 'pause')`, the worker remembers its own speed at that moment, and PauseMenu's resume posts `resume`, which restores the worker's remembered speed. The mirror shows its own pre-pause speed until the next packet corrects it.
- **Who may write.** `liveSlowdown` is written only by the worker's `LivePolicy`. The main thread never writes it, so `EmergencyBanner.reset()`'s `liveSlowdown = 1` moves into the worker.
- **Pause.** At speed 0 ticks keep coming, so frame hooks and urgent steps keep running. Power still reaches new lots while the game is paused.
- **Hidden tabs.** When rAF stops, there are no ticks and the simulation stops. This keeps today's semantics, including `pauseWhenHidden = false`, which a self-paced worker would break (skeptic 9.5). Commands still drain without ticks, so the `setSpeed(0)` posted from `visibilitychange` is applied. Liveness does not count hidden time (§2.10).
- **Returning.** The first rAF after the tab comes back is clamped to `dt ≤ 0.1`, so the simulation does not jump.

### 3.3 LIVE speed during uncovered emergencies

- **Where the code goes.**
  - The pure parts of `EmergencyBanner.ts` move to `src/game/emergencyPolicy.ts`, which has no DOM. `EmergencyBanner.ts` re-exports them, so `tests/game/emergencyPolicy.test.ts` keeps its imports. The parts are `speedPolicy`, `LiveState`, `AlertQueue`, `followingDispatch`, `FOLLOW_*`, `LIVE_PAUSE_SEC`, and the `pendingCount` / `urgentSeconds` logic.
  - `LivePolicy` in `SimCore` subscribes to the sim's `'emergency'` event in the worker.
- **What happens on `'uncovered'`** with `manualPossible || canSend`:
  - It calls `AlertQueue.offer(e, day, population, settings.emergencyAlerts)`.
  - It calls `speedPolicy(...)` **synchronously inside the event**, as `onEvent` does today (`EmergencyBanner.ts` ~:331). It sets `sim.speed` and `sim.liveSlowdown`.
  - It marks `policy` dirty for the packet.
- **Every tick** it re-evaluates `pending` and `urgentSeconds` with `sim.simTime()` and the settings. That replaces the 6 Hz `uiTick` and runs at least as often.
- **Settings.** The policy reads `emergencyUncovered`, `emergencyLiveSlowmo` and `emergencyAlerts`, mirrored through `setSettings`.
- **What is gained.**
  - Today the rest of the frame's days still run at ultra, because `update()` computes `spd` once per frame.
  - Here the next day does not start until real time has caught up at the slowed live speed.
  - At ultra a fire's 6 days are 0.3 s. Not losing one or two days to a main-thread round trip is the point (hazard 7).
- **Load.** After a load, `LivePolicy.boot()` re-raises banners for incidents that are still waiting, which was `EmergencyBanner.reset()`.
- **Main thread.**
  - `EmergencyBanner` renders `host.policy.alerts`.
  - It plays `warning` when `policy.warn` is set, shows `policy.toast`, and toggles `emg-live` from `policy.live`.
  - Its 6 Hz `refresh(b, inc)` keeps reading `host.emergency` and `host.simTime()`.
  - Its outcome text ("Help came too late — …", `lossText(b.inc)`) reads the incident object, which the `Emergency` entry has just updated to its emit-time record (§2.4).
  - Dismiss posts `dismissAlert`; "Send nearest" awaits `dispatchBest`.

### 3.4 Month and year boundaries

- **In the worker.** A month day is one unit: 73–105 ms today at 1M, under 20 ms extra after B3. It delays only the commands that arrive during it, so it counts against action-latency p99, not against main-thread frames.
- **On the main thread**, the month and year events re-fired from the log trigger:
  - WorldView's season update;
  - BudgetPanel's `taxRates` and `funding` snapshot;
  - GameSounds' coin sound (it reads `budget.lastIncome` from the replica: F4);
  - `CityScene.onMonth`, which counts towards autosave and calls `host.save('auto')`;
  - on `'year'`, NewYear's fireworks.
- **The remaining spike** is render-side: `collectLaunchSites` walking every building. That is item R2.

### 3.5 The sim clock on the main thread

`EmergencyVehicles` needs a smooth `simTime()` every frame. `Replica.clock` predicts it from the last packet:

```
t(now) = max(t_last, clock.day + min(0.999, clock.frac + (speed > 0 ? (now − recvTime) / 1000 / spd : 0)))
```

- The clock never goes backwards. It is reset on `'reset'` or when the day decreases.
- It never passes the next day boundary the worker has not simulated, so vehicles never run ahead of their incident state.
- At ultra a packet arrives every 1–3 frames, one per simulated day. At 1× a day is 0.5 s and idle heartbeats come every 250 ms, so the predictor extrapolates over up to 0.25–0.5 s; the 0.999 cap keeps that harmless (O13).

### 3.6 New Year fireworks

- **The problem.** `NewYearCelebration` treats more than 8 days since `lastFrameDay` as a batch with no party. With the worker, a main-thread stall followed by a backlog of packets would suppress the show (hazard 19).
- **The fix.** The `Clock` carries `live`, true when the day came from a frame-paced tick. `NewYear.onYear` uses `batch = !host.liveYear` instead of the day-distance heuristic.
  - The replica sets `liveYear` from the `live` flag of the packet being replayed.
  - `LocalSimHost` sets it in `update()`, whose days are always frame-paced, and clears it in `runDays`.

## 4. Saves, loads, autosave, recovery and region switching

### 4.1 Load and boot

1. **The worker is pre-spawned** on the region screen, after the chunk has been prefetched (O12).
   - Startup is about 100–300 ms, hidden behind the region screen.
   - First visits download the sim code twice: the main bundle still carries it for previews and replica-safe helpers, and the worker chunk holds the whole sim. The prefetch runs while the region screen shows, so it does not delay the city load. The size is measured in W1.2.
   - The 10 s `hello` timeout starts only when the prefetch has completed, or when the player enters a city, whichever is later. It never runs while the script may still be downloading.
2. **Main does not deserialize the city** in worker mode (O6). `enterCity` posts `init`:
   - W1.3 and later: `city = {kind: 'idb', regionId, tileKey}`, `persistence = 'worker-idb'`. Nothing is transferred, and the city is not sent at all.
   - W1.2, and non-persistent mode (`MemoryKV`): main reads the record with `loadSerializedCity`, without deserializing it, and posts `{kind: 'serialized', …, savedAt, city}` cloned, with `persistence = 'main'`.
   - Also `rctx` (plain data), `initialSpeed`, `settings` and `flags`.
   - Main runs neither `applyRegionEffects` nor `trackRegionEffects` (`main.ts` `enterCity`) on the replica: `SimCore.boot` does both in the worker.
3. **The worker:**
   - in `idb` mode, opens its own IDB connection with the same `openKV()` code. If that falls back to `MemoryKV` while main's store is persistent (a timeout or a blocked open), the worker must not save silently into memory: it reports a boot error, and the host restarts it in `serialized` mode with `persistence = 'main'`;
   - gets the `CityRecord` and runs `deserializeCity(rec.city)`, keeping `rec.city` and `rec.savedAt` as its recovery base. Only the worker realm calls `setRecoveryBase`; main keeps no 11 MB copy;
   - if `flags.simwasm` asks for it, awaits `initSimWasmBrowser({flag})`;
   - runs `SimCore.boot(st, rctx)`, including the replay of a journal bound to `rec.savedAt` (§4.3), and attaches the recorder;
   - posts `boot {phase, pct}` at each of these phases;
   - posts `ready` with `serializeCity(st)` (not copied, because `postMessage` clones), the streams, `savedAt` and `cmd`.
4. **Boot timeouts** (R11). Between `hello` and `ready`, 20 s of visible time without a `boot` message is a boot failure. A boot failure, a `worker.onerror` or a script load error falls back at once to `LocalSimHost`, booted from IndexedDB, with one toast. The App's loading screen shows the current phase, so a slow load is visible rather than a frozen veil.
5. **Main:**
   - `Replica.adopt(snapshot)` deserializes the snapshot into a fresh, branded `CityState`. Then `host.ready` resolves. At boot there is no `'reset'`, because no views exist yet.
   - The App constructs `CityScene` with the host, after `ready`, so the scene, its subscribers and `initViews()` see the replica from the start. That keeps today's order, where views are built after the systems' `init`.
   - The loading screen stays up until then.
   - Measured under load (dense1m / bot256): serialize 121 / 68 ms in the worker, clone 36 / 20 ms, deserialize on main 151 / 62 ms. Main no longer pays sim init (936 / 693 ms of CPU), and no longer runs its own `loadCity` and deserialize (another 151 / 62 ms and an 11 MB transient).
6. **Non-persistent mode** (`MemoryKV`, where IndexedDB is unavailable): main's and the worker's in-memory stores are separate. So the city is sent `serialized`, and `persistence = 'main'`: the worker returns the `CityRecord` in `saved`, and main writes it to its `MemoryKV`.

### 4.2 Save and autosave

- **Triggers:** `CityScene.onMonth` (every `autosaveMonths`), Ctrl+S, the SavePill, the pause menu, a hidden tab when dirty, and exit. All call `host.save(reason)`, which `CityScene` calls after `setCamera`. The FIFO order puts the camera into the save. The App's own save paths are rerouted too (§4.5).
- **Worker, as two units after the current day:**
  1. **`save:copy`:**
     - `serializeCity(st, {copy: true})` (40–53 ms at 1M), a consistent day-boundary snapshot including `systemData`;
     - `cityFingerprint(st)`, moved from `main.ts` to `src/save/fingerprint.ts` so the worker can run it;
     - `summarizeCity(st)` (0.8 ms warm);
     - `pktSeq`, the last packet flushed before the copy, and `cmd`, the highest command seq the copy contains.
  2. **`save:put`:**
     - `kv.put('cities', rec, key)` (the IDB clone, about 10 ms), or in `persistence: 'main'` the record goes into the reply;
     - `setRecoveryBase(...)` in the worker realm;
     - the IDB part of `clearRecoveryAfterSave`: it deletes the city's snapshot record, a delta of the save just replaced. Stale journals are harmless, because a journal is bound to its base (§4.3);
     - on `oncomplete`, it adds `saved {savedAt, cmd, summary, fp, pktSeq}` to the open packet.
- **Main**, when the `saved` reply is applied:
  - SavePill and its sound;
  - `App` bookkeeping: `cleanFp = fp`, and `cleanChanges` from the change counter at the end of packet `pktSeq` (the host keeps the counter per packet for the last 64 packets);
  - the localStorage part of `clearRecoveryAfterSave`: the slot is cleared if it is older than the save;
  - `recovery.onSaved(savedAt, cmd)` (§4.3);
  - the region tile summary from `saved.summary`, and `cityThumbnail(replica, 256)` only when there is no thumbnail yet. Exit uses `world.capture`.
- **Ordering.** Saves never overlap: the worker handles them FIFO, and `App.saveChain` awaits acks. The CityRecord format is unchanged (S1), so saves move freely between hosts (S2).
- **No gzip.** City records stay structured-clone objects in IDB, as they are today.
  - Adding gzip would cost 114–209 ms of CPU per save at 1M, and would change the record format.
  - This corrects the premise of WASM_PLAN S3 and skeptic finding 10: there is no main-thread gzip to migrate.
  - Region export and import keep `packFile` and `unpackFile` on the region screen, where no simulation runs.
  - If compressed records are ever wanted, for storage quota, that is a separate decision. The worker would compress with `CompressionStream` after a protector probe on all three engines.
- **The cost of saving often at ultra.** With the default of 3 months, ultra autosaves every 4.5 s. Each save blocks the worker for about 50–60 ms, about 1.3 % of its time, which shows in action-latency p99.
  - **Mitigation, if the A/B shows it:** a minimum interval of 30 s of wall time between autosaves. Recovery snapshots and the journal cover the gap.

### 4.3 Recovery: snapshots and the journal

**The constraint.**
- Today's unload snapshot (`writeRecoverySnapshot`, 50–59 ms, cold 97–113 ms) runs synchronously on main from the live state.
- With the worker, main cannot ask the worker at unload, and an IDB write of a few MB started during unload usually dies (see the `recovery.ts` header: 0–4 of 4 survived). A synchronous localStorage write and a small IDB write with an explicit `commit()` do survive (48 of 48).
- A recovery snapshot is restorable only onto the save it is a delta of: `findRecoverySnapshot` drops a snapshot unless `record.savedAt === marker.baseSavedAt` and the record is older than the snapshot. So every completed save makes the previous snapshot unusable, and at ultra, with the default autosave every 4.5 s, a snapshot taken every 30 s would almost always be stale (R7).

**`src/save/recovery.ts` is split** (W0.6):
- `recoveryCodec.ts`: `buildRecoverySnapshot(regionId, tileKey, state, base, info, budget) → {marker, payload, dropped}`, a pure encoding (serialize, `encodeCityDelta`, `encodeBundle` from `bundleCodec.ts`), plus `packBytes` and `unpackBytes`.
- `recoveryIdb.ts`: `storeRecoveryIdb(kv, marker, payload)`, `storeJournalIdb(kv, journal)` with `commit()`, the IDB parts of `clearRecoveryAfterSave` and `discardRecoverySnapshot`, and `findRecoverySnapshot` (which reads both stores).
- `recoveryLs.ts`: `storeRecoveryLs(marker, payload | null, journal)`, `peekRecoveryMarker`, `readLsSnapshot` and the localStorage part of `clearRecoveryAfterSave`. Workers have no `localStorage`, so this file never enters the worker graph.
- `writeRecoverySnapshot` stays as their composition for `LocalSimHost`, and refuses the replica (§4.5).

**The journal.**

```ts
interface Journal {
  v: 1; regionId: string; tileKey: string; at: number;
  base: { kind: 'save'; savedAt: number } | { kind: 'snapshot'; at: number; baseSavedAt: number };
  fromCmd: number;                                 // the base contains every command with seq ≤ fromCmd
  ops: { seq: number; op: JournalOp; args: unknown[] }[];
}
type JournalOp = 'zone' | 'dezone' | 'bulldoze' | 'buildNetwork' | 'buildPowerLine' | 'buildSubway' | 'plop'
  | 'terraform' | 'plantTrees' | 'setTax' | 'setFunding' | 'setHistoric' | 'setOrdinance' | 'takeLoan' | 'repayLoan';
```

- **What it holds.** Every whitelisted command with `seq > fromCmd`, in order, minus those whose ack failed. Commands still in flight at unload stay in; the base was cut at a unit boundary at `fromCmd`, so no command is both in the base and in the journal.
- **Idempotent sets.** Toggles are stored as sets: `setHistoric(id, on)` and `setOrdinance(id, enabled, {confirm: true})`; taxes and funding are sets already.
- **Excluded ops:**
  - `setSpeed` and `resume`: speed is not city state, and a restored city starts as any loaded city does;
  - `setCamera`: the base carries a camera;
  - `dispatch` and `dispatchBest`: they name incidents of a later sim day, which do not exist in the base;
  - `dismissAlert`, `setSettings` and `debug.*`: they are not city state;
  - `triggerDisaster`: decided **excluded**. Its outcome draws `rng` and is destructive; replayed onto an earlier day it would wreck different buildings. The player can trigger it again.
- **Bound to its base.** The base is either the last save (`kind: 'save'`, its `savedAt`) or the last worker snapshot (`kind: 'snapshot'`, which is itself bound to a save). On restore, a journal whose base does not match is discarded: a record whose `savedAt` changed, including after a `LocalSimHost` session saved the city, or a snapshot that is not the one being restored.
- **Replay.** `SimCore.boot` replays a matching journal with `applyCommand`, right after `init` and before the first tick, in either host. Each command runs at the base's day; one that now fails is dropped. The journal is deleted by the next completed save, and it could not apply twice anyway, because that save changes the record's `savedAt`. The worker reads `recovery/<key>#journal` itself; only when it runs with `persistence: 'main'` does main pass the journal in `init.journal`.
- **After a replay** the worker saves before it posts `ready` (boot phase `'journal'`), so the replayed edits are durable, `ready.savedAt` is the new save, and the old journal no longer matches and is deleted. If that save fails, the worker keeps the journal record, which still matches the old save, and `ready` carries the replayed ops renumbered with seqs ≤ 0. The mirror starts from them and appends the session's commands, and the session's first save, which contains them, trims them. Either way a second crash loses nothing.

**Worker.**
- A `snapshot` request triggers a snapshot, which runs as a unit at the next day boundary against the worker's base.
- Requests come from `App.tickSaveState` while dirty, every **min(30 s, 90 sim days)**; on `visibilitychange: hidden`; and from main when the journal passes half its reserve (`why: 'journal'`). A periodic request is skipped when a save completed within the same window, because the save is a better base.
- The payload is encoded with the budget `LS_BUDGET_BYTES − JOURNAL_RESERVE_BYTES` (2.15 MB − 128 KB). `encodeCityDelta` drops the largest recomputed layers first, as today, so a full snapshot of up to 2.47 MB fits.
- It calls `storeRecoveryIdb` (a normal write, not one during unload), and adds `snapped {marker, payload, cmd}` to the open packet: about 1.3–2.0 MB, cloned in about 1–2 ms.

**Main: the `RecoveryMirror`** (`src/worker/journal.ts`).
- It keeps the base, the payload while it is newer than the last save, and the journal.
- On `saved {savedAt, cmd}`: it drops the payload, sets the base to `{kind: 'save', savedAt}`, and trims the journal to `seq > cmd`.
- On `snapped {marker, payload, cmd}`: it accepts the snapshot only if `marker.baseSavedAt` equals its current save base, then sets the base to that snapshot and trims the journal to `seq > cmd`. A snapshot built against an older save is dropped.
- Every posted whitelisted command is appended to the journal; a failed ack removes it.
- On `pagehide`, `beforeunload` and `hidden`, `recovery.writeNow(why)` writes synchronously:
  - localStorage: the marker; the payload (`packBytes` of an already encoded payload, so no serialization at unload) when the base is a snapshot; and the journal as JSON under `metropolis.recovery.journal`. With no payload the marker has `kind: 'journal'` and `bytes: 0`;
  - IndexedDB: the journal as a small record `recovery/<key>#journal`, with `commit()`;
  - if the journal does not fit its 128 KB reserve, it goes to IndexedDB only and the marker says so. That would take more than two minutes of continuous brushing (about 60 characters per application, up to 14 per second), and main asks for a snapshot at half the reserve.
- `snapshotNow`'s skip logic (fingerprint and `changes`) runs on the replica, as today.

**Restoring.**
- `findRecoverySnapshot` runs on main at title time. It moves the localStorage copies (snapshot and journal) into IndexedDB as today, then offers either a snapshot, with its journal if one matches, or a journal alone, bound to the stored save.
- `restoreRecoverySnapshot`: for a snapshot, it rebuilds the city from base + delta, saves it, and re-binds the journal to the new record's `savedAt` in the same transaction. For a journal alone, nothing is rebuilt.
- The next boot replays the journal (above).

**What can be lost**, compared with the last moment of play:
- at most the simulated time since the base: ≤ 30 s of wall time and ≤ 90 sim days. Without the day bound, 30 s at ultra with autosave off would be 600 sim days. At ultra with autosave off, a snapshot every 4.5 s costs the worker about 50–110 ms, 1.1–2.4 % of its time, the same order as autosaves;
- never a journaled edit;
- nothing at all when the tab is only hidden, because the hidden-tab save and snapshot complete.

### 4.4 Region switching, exit and crashes

- **`exitToRegion`:**
  - `setSpeed(0, 'exit')`, then await `host.save('exit')`;
  - `world.capture(512, 512, true)` on main;
  - `host.dispose()`: the worker closes IDB and calls `self.close()`, and main terminates it after 2 s at most;
  - then `App.exitCity(thumb, {saved})` runs its worker-mode branch (§4.5): it trusts the `saved` reply, refreshes the tile thumbnail and the region summary, and calls `recovery.writeNow('exit')` if the save failed. It never re-saves.
- **A new worker per city session.** Each gets a fresh isolate and an intact protector. The next one is pre-spawned on the region screen (§4.1).
- **A crash during play** (`fatal`, `worker.onerror`, or 10 s of visible time without a packet):
  - `recovery.writeNow('crash')` runs at once, so the journal is safe before anything else.
  - `ErrorOverlay` offers "Restart from autosave", "Recover unsaved progress" (the last snapshot plus the journal) and "Continue on the main thread".
  - A restart creates a new worker from IDB, after `restoreRecoverySnapshot` if the player chose recovery. The replica `adopt()`s it and emits `'reset'`.
  - "Continue on the main thread" boots `LocalSimHost` the same way: from IndexedDB, or from the restored snapshot plus the journal. **Never from the replica**, which lacks the lagged fields and most `systemData` (§4.5).

### 4.5 The replica is never saved

- **The problem** (R6). Today `App.doSaveCity`, `saveCurrentCity` (the visibility handler) and `exitCity`'s re-save when `isDirty()` all call `saveCity(…, st)` on `currentState()`, and `snapshotNow('exit' | 'hidden' | 'beforeunload' | 'pagehide' | 'periodic')` calls `writeRecoverySnapshot(…, st)` (`src/main.ts` ~210–730). In worker mode `st` would be the replica. It lacks the lagged fields and most `systemData`: on bot256 the emergency state (25 KB), `infraTransport` (80 KB), `popGrids` (20 KB), growth, justice and demographics. Saving it would silently corrupt the city.
- **Brand.** `host.state` has the type `HostState = CityState & { readonly [REPLICA]?: true }`, and the replica object carries a non-enumerable runtime flag.
- **Refusal.** `serializeCity`, `saveCity` and `writeRecoverySnapshot` take `CityState & { readonly [REPLICA]?: never }`, so passing `host.state` does not compile, and they throw `ReplicaSaveError` at runtime when the flag is set, which catches a cast. Their tests cover both.
- **Every App path goes through the host:**

  | today (`src/main.ts`) | worker and loopback mode |
  |---|---|
  | `doSaveCity(st)` → `saveCity(…, st)` (CityScene's `onSave`, `saveCurrentCity`) | `host.save(reason)`; bookkeeping from the `saved` reply (`fp`, `cmd`, `pktSeq`, `summary`) |
  | `visibilitychange` hidden → `snapshotNow('hidden')`, plus `saveCurrentCity()` when dirty | `recovery.writeNow('hidden')` at once, `host.snapshot('hidden')`, and `host.save('hidden')` when dirty |
  | `beforeunload`, `pagehide` → `snapshotNow(…)` → `writeRecoverySnapshot(…, st)` | `recovery.writeNow(why)`: synchronous localStorage plus a small IDB journal record with `commit()` |
  | `tickSaveState` → `snapshotNow('periodic')` | `host.snapshot('periodic')`, every min(30 s, 90 sim days) while dirty |
  | `exitCity` → `saveCurrentCity()` when dirty, then `snapshotNow('exit')` when still dirty | `host.save('exit')` already ran in `exitToRegion`; on failure, `recovery.writeNow('exit')` |
  | `enterCity` → `loadCity`, `applyRegionEffects(st)`, `trackRegionEffects(scene.sim)` | none on main: the worker loads, and `SimCore.boot` applies the region effects |
  | `startNewCity` → `saveCity(…, st)` of the freshly generated state | unchanged: that state is not a replica, and the worker then loads it from IDB |
  | the crash fallback | `LocalSimHost` from IDB, or from the restored snapshot plus journal (§4.4) |

- `isDirty()` and `cityFingerprint` keep reading the replica: they only read exact fields and plain data.

## 5. Determinism and tests

### 5.1 The contract

- **D1 extends to hosts** (WASM_PLAN §7.6). In deterministic mode, `LocalSimHost`, `LoopbackSimHost` and `WorkerSimHost` (browser, or node `worker_threads`) give the same `sha256(serializeCity({copy: true}))` and the same per-system digests. "Deterministic mode" means `runDays(n, script)`: headless `advanceDay`, the headless scheduler (live flag off), and commands applied with `atDay`.
- **D7.** `atDay` commands run right after `advanceDay` of that day in every host, through `SimCore.applyCommand`.
- **Nothing flows back from the replica.** Main sends only commands, `setCamera` and settings. `rng` exists only in the worker, and previews never draw from it.
- **Live mode is not reproducible (D2).** The worker interleaves commands between steps; `LocalSimHost` applies them inside the input event. Both are allowed.

### 5.2 Headless tests, the bot and benches keep running without a worker

- `tools/simbot.ts`, every test under `tests/sim`, `tests/infra`, `tests/save` and `tests/game`, and `tools/bench/**` keep using `new Simulation(state, createSystems())`, `advanceDay()` and `CityActions` directly. No host is involved.
- `SimCore` is optional for them. The bot's JSON records `host: 'none'`.
- Only the game and the new tests use hosts.

### 5.3 New vitest suites (node)

Revision 1's suites all ran at design cadence with immediate delivery, so none of R1, R3, R4 or R5 could fail in them. The suites marked **new** close that gap (R16).

| suite | what it proves |
|---|---|
| `tests/worker/protocol.test.ts` | every `M2W`, `W2M` and `Reply` survives `structuredClone`; every typed array in every message owns its buffer; the record, incident, cell, sparse-layer, road-only traffic and log codecs round-trip, including `NaN` optional fields, `defs` appends and the `off` exception list; byte counts use clone semantics |
| `tests/worker/replica.test.ts` | `LoopbackSimHost` on a generated 128² city (`tests/infra/cityGen.ts`) and a grown fixture, at design cadence for 120 days. It scripts every command op. **After every packet** it checks primary layers, building exact fields, mirrored layers and plain data for exact equality. **At checkpoints**, after forcing a full rolling round, it checks pop and jobs for every building (the R2 case). Every event the authoritative emitter fired must re-fire in the same order with the same event-time building or incident record; a fire that ends with a loss must show the loss in the re-fired `'failed'`. 0 silent exact writes from `auditExact`. It also injects a throwing view listener (the packet must complete and the error must be reported) and forces a resync after a planted divergence (`buildingList(host.state)` must hold no removed object) |
| **new** `tests/worker/replicaLive.test.ts` | the same checks at **live cadence**: synthetic ticks with `dt` jitter (8–33 ms), commands posted between scheduler steps, at ultra and at 1×, with a tornado and fires active so that the `frame()`-driven events are covered |
| **new** `tests/worker/lag.test.ts` | a `LoopbackSimHost` with a seeded `LagProfile`: packets delivered 0–6 ticks late, acks held, 50–150 ms worker units injected. A seeded command fuzzer drives every op, including held brushes, plop after bulldoze on the same lot, terraform then plop, zone then dezone, slider drags, historic toggles, dismissals and loans. It asserts: (1) HostActions never refuses a command that `LocalSimHost` would accept on the state the player saw, that is a clone of the replica at commit time with the player's pending commands applied in order; (2) no optimistic value reverts before its ack, checked inside every listener call and after every packet; (3) no reply describes state newer than the replica: each carries the worker's `cmd` when it was computed, which must be ≤ the replica's `applied` when it is delivered; (4) at most one correction per gesture; (5) after a final drain, the replica equals the worker |
| `tests/worker/replicaSafe.test.ts` | each function in `REPLICA_SAFE` gives the same result on the replica and on the live state at 10 checkpoints. That includes a battery of previews over random rects, paths and plops, and the `setOrdinance` and loan previews |
| `tests/worker/hosts.test.ts` | Local vs Loopback vs Worker (node `worker_threads`), 120 deterministic days with a scripted command list: equal hashes at days 30, 60 and 120. Saving in one host, loading in another and running 60 more days gives equal hashes. The worker entry is bundled for the test with rolldown (as the scratch harnesses do) into `node_modules/.cache/sim-worker-test/`, behind a `parentPort` adapter, with `MemoryKV` (`persistence: 'main'`) |
| **new** `tests/worker/querySideEffects.test.ts` | 120 deterministic days, twice: once running every query and watch handler daily, over a sample of buildings and cells and every section, and once running none. The hashes must be equal. Without it, `hosts.test` runs the same `SimCore` in the same engine and proves little about handlers such as `garageStates`, whose predecessor wrote into the econ runtime |
| `tests/worker/policy.test.ts` | an uncovered major fire at speed 3 sets speed 1 and `liveSlowdown` 3 **before the next `advanceDay`** of the worker core; the remaining days of the tick are dropped. Also: dismiss, a settings change mid-episode, a ticket for `dispatchBest`, banner re-raise after load, and pause then `resume` during LIVE restoring the worker's speed |
| `tests/worker/recovery.test.ts` | a worker snapshot plus journal, restored and replayed, gives the expected city; a save followed by unload restores from the journal alone onto that save; a snapshot taken before a save is dropped by the mirror; a journal is discarded when its record changed, including after a `LocalSimHost` save; toggles replay idempotently; excluded ops are never journaled; the payload plus journal fit `LS_BUDGET_BYTES`; the IDB journal copy is used when the localStorage one is missing; `writeRecoverySnapshot`, `saveCity` and `serializeCity` throw on the replica |
| `tests/worker/hygiene.test.ts` | a static scan of the worker's import graph (rolldown metafile) and of `src/worker/**`, `tests/worker/**`, `tests/perf/**` and `tools/bench/worker/**`: no transfer lists, no `.transfer(`, no `CompressionStream` or `DecompressionStream`, no `.stream()`, no `new Response(`, no `Blob`, no `.arrayBuffer()` or `.text()` on bodies, no `memory.grow` or `reserve(` after the loader's own; `bundle.ts`, `src/save/index.ts` and `recoveryLs.ts` absent from the worker graph (`bundleCodec.ts` is allowed). Only the allowlisted files read lagged fields (§2.5). No `.speed =` or `.liveSlowdown =` outside `src/worker` and `src/sim`. No `emergencyOf(` or `getSystem(` in `src/ui` or `src/game`. **No writes into the replica outside `src/worker`**: assignments through `ctx.state.`, `host.state.`, `.budget.`, `.flags ^=` and the like in `src/ui`, `src/game` (except `src/game/fallback`) and `src/render` (O8) |
| `tests/perf/protector.test.ts` (J1) | V8 flags are process-wide, so the test spawns a child `node --allow-natives-syntax --trace-protector-invalidation`. The child runs 60 days of `SimCore` + recorder + `postMessage` in a `worker_threads` worker, once with JS kernels and once with `SIM_WASM=wasm` (blur), and each isolate runs its own `makeProtectorProbe` and reports. Both must be intact, and wasm `memory.buffer.byteLength` must not change. A trace line also fails the test, but attribution comes from the per-isolate probes. Negative controls: one transfer in the worker, and one `memory.grow`, must each fail |
| `tests/infra/servicesTrigger.test.ts` (B1) | §6, step S2 |

### 5.4 Browser tests, measurement and the acceptance harness

- **`tools/qa-worker.mjs`.** Playwright Chromium from `/opt/pw-browsers` with `--use-angle=swiftshader --enable-unsafe-swiftshader --js-flags=--allow-natives-syntax`, against the production build (`vite build`, `vite preview`). One browser at a time.
  - It opens `?quickstart=1&size=256&simworker=1` and waits for `__ready`. It asserts `scene.host.kind === 'worker'` and that the protector probe is intact in both isolates.
  - It drives each command through the real tools (synthetic pointer events) and checks their acks, including a held brush that reaches flat (one release sound, no toast).
  - It checks `host.query('verify')` against the replica's digest.
  - It saves with Ctrl+S, reloads and continues.
  - From W1.3: it closes the page in the middle of an edit and checks that recovery offers the journal and restores the edit.
  - **New** (R16): CDP `Page.setWebLifecycleState({state: 'frozen'})` for 15 s, then `'active'`. No crash overlay may appear, the simulation must resume within 1 s, and the protector must still be intact.
  - It requires 0 console errors.
- **Extended `tools/bench/browser-check.mjs`.** The prod and worker modes (WASM_PLAN §7.8): it checks that wasm loads in the worker when it is enabled, that actions round-trip, and that save and load work.
- **`tools/bench/worker/host.bench.ts`** (node, `worker_threads`, a synthetic 6 ms render per 16.67 ms tick). This is the AC1, AC3, AC4 and AC5 A/B of WASM_PLAN §5.4, with the skeptic's statistics: at least 2 isolates per arm, A/A pairs, means for budgets, and process CPU reported next to thread CPU.
- **Measurement rules** (O10).
  - Without cross-origin isolation, `performance.now()` is coarsened: 100 µs in Chromium, about 1 ms in Firefox and Safari. In-game apply and latency counters are therefore aggregated over many packets (sums over ≥ 1 s windows), never read per packet.
  - `performance.measureUserAgentSpecificMemory` needs cross-origin isolation, so the 150 MB memory rule is measured with CDP per target, the page and the worker.
  - Protocol cost (apply and re-fire with no-op listeners) is reported separately from listener cost. SwiftShader inflates the render listeners.
- **In-game counters (`?fps=1`):**
  - host kind, days/s, worker ms per day and busy %;
  - apply and re-fire ms per sim day;
  - bytes/s and deserialization ms per real second;
  - action latency p50, p95 and p99, measured from post to ack applied;
  - prediction mismatches per gesture;
  - inbox depth.

## 6. Migration plan

**Rules for every step:**
- Every step is a small PR that keeps the game playable and all tests green. `LocalSimHost` stays the default until W1.4.
- Sim files are touched only in S2, W0.5 (the `overlays.ts` hook), W1.2 (a small API split and the live flag) and S3–S5, each with that file's part-B owner (WASM_PLAN §7.3).
- **Preconditions:** part B is merged, and PI-1 has re-grown the fixtures and recorded baselines with A/A controls.
- Effort is in developer-days for one person familiar with the code.

| # | step | files | acceptance | effort |
|---|---|---|---|---|
| **S0** (PI-2) | **J0**: `lodBuilder.ts:82` becomes `w.postMessage(msg)`, with no transfer list. The arrays are already `slice()` / `Float32Array.from` copies | `src/render/city/buildings/lodBuilder.ts` | `tests/render/lod.test.ts` green. Protector probe intact on the Chromium main thread after 10 min of `demo-ui.html` play (the M6 procedure). LOD proxies per second within ±5 % | 0.5 |
| **S1** (PI-2) | **J1**: `tests/perf/protector.test.ts` (child process, per-isolate probes, both kernel modes) + `tests/worker/hygiene.test.ts`, at first scanning `src/sim/**` and `src/save/{serialize,db,recovery}.ts`. The import-graph rules (no `bundle.ts`, `save/index.ts` or `recoveryLs.ts`) apply to `SimCore.ts`'s graph from W0.6 and to `simWorker.ts`'s from W1.2 | tests | green on the tree; both negative controls fail | 1.5 |
| **S2** (PI-5a, first, in parallel with W0) | **B1, the services dirty trigger, with the full trigger list** (below) | `src/sim/infra/services.ts`, including a new `SERVICES_MIN_CYCLE_MS` next to `SERVICES_PERIOD` | the balance procedure; `servicesTrigger.test.ts`; whole design-cadence day ≥ 1.2×, replicated with A/A; dense1m services passes per 60 days 30 → ≤ 10 | 3–4 + balance run |
| **W0.1** | `SimCore` + `SimHost` + `LocalSimHost`. `CityScene.loadSim` moves into `LocalSimHost.start()`, `guardSystem` into `SimCore`, `trackRegionEffects` into `SimCore.boot`. `ctx.host` is added; `ctx.sim`, `ctx.state` and `ctx.actions` delegate to it | `src/worker/{SimCore,SimHost}.ts`, `src/game/{CityScene,context}.ts`, `src/main.ts` | all suites green; the error overlay disables a throwing system after 20 errors; an ultra A/A of the emulation within noise | 2–3 |
| **W0.2** | **Commands.** Every mutation goes through `host.act` or `host.setSpeed`: the speed writers, including PauseMenu's `resume`; `setCamera` (`CameraMemory.store`); `dispatch` and `dispatchBest`; `triggerDisaster`; `setOrdinance`, `takeLoan` and `repayLoan`, with their results handled asynchronously; `setHistoric` replaces the toggle and its fallback; `repayLoan` gets its guard. **The cause-tag API** (`act(…, {tag})`, `host.cause`) lands on `LocalSimHost`, and DispatchTool's `sending` guard is replaced by it (R13). **`Tool.commit` and gestures** land too, so that every commit site already has its feedback in one place; on `LocalSimHost` every prediction is exact | `CityScene`, `TopBar`, `Modals`, `Onboarding`, tools, `EmergencyBanner`, `BudgetPanel`, `ListPanels`, `InfoPanel`, `cameraStart` | the hygiene grep gates pass; a manual QA script that uses every op once; DispatchTool's own dispatch is recognised through `host.cause` | 4 |
| **W0.3** | **Queries and watches.** `src/worker/{queries,inspect}.ts`. InfoPanel and inspectorModel read `inspectBuilding` / `inspectCell` watches, with the header from the state and caches keyed by arguments; also the StatsPanel garages, AdvisorsPanel, DemographicsPanel, TopBar `capHints`, BudgetPanel forecast, PlopTool stops and ferries, DispatchTool options, routes and report, and `demolishRisks`. The 5 Hz watch cap. `LocalSimHost` answers synchronously and, in dev and tests, passes acks and results through `structuredClone` | the UI files of §2.8 | `tests/game/inspectorModel.test.ts` and `inspectorNotes.test.ts` green; the inspector looks identical on fixed seeds (screenshot diff); no `getSystem(` in the UI; `querySideEffects.test.ts` green; no `DataCloneError` in the suites | 6–8 |
| **W0.4** | **`LivePolicy`**: `src/game/emergencyPolicy.ts` runs in `SimCore`; `EmergencyBanner` renders `host.policy`; `setSettings` | `EmergencyBanner`, `emergencyPolicy.ts`, `SimCore` | `emergencyPolicy.test.ts` green; the new same-day policy test; an uncovered fire at ultra in a manual QA run | 2 |
| **W0.5** | **Views and seams.** `EmergencyView`, `TrafficView`, `UtilitiesView`; `attachOverlays(host.sim)`; `registerDerivedSource` in overlays.ts; `getEmergency`, `getTrafficRoutes` and `simTime` read through the host. A view with no data yet draws nothing (O9). Two existing staleness bugs are fixed: NewsTicker and AdvisorsPanel `seenNews` use a news sequence number instead of `news.length` (frozen at the 200 cap); MiniMap is marked dirty on `layerUpdated('utilities')` | `overlays.ts`, `CityScene`, `Notifications.ts`, `AdvisorsPanel.ts`, `MiniMap.ts`, `TerrainRenderer.ts` | `tests/infra/overlays.test.ts` green; every data view and variant renders identically (screenshot diff); the ticker updates past 200 news items on `bot256_y60` | 2 |
| **W0.6** | **Saves through the host.** `host.save` and `host.snapshot`; every App path of §4.5 routed through them; the replica brand and the refusals in `serializeCity`, `saveCity` and `writeRecoverySnapshot`. The `recovery.ts` split into `recoveryCodec`, `recoveryIdb` and `recoveryLs`, including the IDB and localStorage halves of `clearRecoveryAfterSave` and `peekRecoveryMarker`. **`src/save/index.ts` is split**: `CityRecord`, `cityKey` and the record get/put move to `src/save/cities.ts`, because `index.ts` imports `./bundle` for `packFile` and `unpackFile`. `src/save/fingerprint.ts`; the pure codec moved from `bundle.ts` to `src/save/bundleCodec.ts` (R14). BudgetPanel's catch fallbacks that write the state directly (`BudgetPanel.ts:129` `taxRates`, `:184` `funding`) are deleted | `src/save/*`, `main.ts`, `CityScene`, `BudgetPanel.ts` | `tests/save/*` green; the brand tests; the graph rules of the hygiene test are switched on; a manual recovery test (kill the tab) | 3 |
| **W1.1** | **The protocol and the replica, in one thread.** `protocol.ts`, `recorder.ts`, `replica.ts` and `LoopbackSimHost`, behind `?simworker=loopback`: per-write re-application of optimistic ops (R1); the rolling shadow (R2); replies in packets (R3); event-time incident records (R8); owned buffers (R9); the isolating emitter and the fresh-state adopt (R12); the replay side of cause tags; the road-cell-only traffic encoding (R15). On main: `HostActions` with exact and provisional predictions, `host.pending` and its overlay (R5), gesture-routed corrections (R4) and pending ghosts (O1). The `RecoveryMirror` against the loopback core | `src/worker/**`, `ToolController.ts`, `Tool.ts`, `WorldView` (pending ghosts) | `protocol`, `replica`, `replicaLive`, `lag` and `replicaSafe` suites green on 2 cities × 120 days. The whole game is playable in loopback: the QA checklist of Appendix A. **Protocol cost ≤ 0.5 ms per sim day** at ultra on dense1m and bot256-1.4M (node bench, A/A-normalised, no-op listeners). **Protocol + listeners ≤ 1 ms per sim day (AC1)**, measured from a CDP trace of the loopback page in Chromium with the real views. Per-message overhead measured by aggregation | 9–12 |
| **W1.2** | **The real worker, with main-side persistence.** `simWorker.ts` + `WorkerSimHost`: rAF ticks, the per-unit loop, flush and backpressure, error forwarding, liveness (ping and pong, visible time only), boot progress and timeouts, fail-fast `onerror`, the crash path, fallback to local, pre-spawn and prefetch. `CitySource 'serialized'` with `persistence: 'main'`: main reads the record without deserializing and writes the `saved` record; the CityScene is built from `ready`. **Recovery in W1.2:** the worker builds snapshots on request against the city it received; main stores each `snapped` payload in IndexedDB at once (`storeRecoveryIdb`), writes the last one to localStorage at unload (`storeRecoveryLs`), and drops it on `saved`; there is no journal yet, so edits since the last snapshot or save (≤ 30 s) can be lost behind this dev flag. Small sim changes: `Simulation.frameHooks` and `accumulate`, which `update()` keeps calling; `InfraScheduler` host-driven mode (`beginFrame` / `stepOnce` / `endFrame`); the explicit live flag on the scheduler and disasters (O7). `vite.config.ts` needs `worker: { format: 'es' }` only if the worker code-splits; Vite's default IIFE worker runs as a `{type: 'module'}` worker. Behind `?simworker=1` | `src/worker/**`, `src/sim/Simulation.ts`, `src/sim/infra/scheduler.ts`, `src/sim/infra/disasters.ts`, `main.ts`, possibly `vite.config.ts` | `hosts.test.ts` bit-identical; `qa-worker.mjs` green without the journal check, including the freeze test; the worker's protector intact after 10 min; latency measured (not gated yet) | 6–8 |
| **W1.3** | **Persistence in the worker.** IDB load and save (`CitySource 'idb'`, `persistence: 'worker-idb'`), `saved` and `snapped` with the worker's own IDB writes, the journal and its binding, journal replay in `SimCore.boot`, the snapshot cadence of min(30 s, 90 sim days), non-persistent mode | `src/worker/{simWorker,journal}.ts`, `src/save/recovery*.ts`, `main.ts` | `recovery.test.ts`; S2 (save in one host, load in the other); the Playwright kill-the-tab test restores with the journal; at 1M a save blocks the worker ≤ 60 ms and the main thread ≤ 2 ms | 4–5 |
| **S3** (PI-5b) | **B2**: split the steps to ≤ 3 ms at 17k buildings and recalibrate `cost()`. Starting with traffic transit (32–67 ms), crime sources (18–46), services prep (39) and shopB (35), NIMBY (27), traffic final2 (17–26) and commute (10–25), pollution sources (12–25), utilities water (6–21), emergency response (8–18) | `scheduler.ts` and each task | `maxStepMs` p99 ≤ 3 ms (max ≤ 5) at dense1m; the median cost-model error within ±30 %; the balance procedure; new bot hashes | 6–10 |
| **S4** (PI-5b) | **B3**: spread the month-boundary work over the month's days with deterministic offsets: tourism 18–28 ms, EQ/HQ 12–18, advisors 14. The budget (7–10 ms) stays on the boundary | `tourism.ts`, `population.ts`, `advisors.ts` | the month-day unit ≤ the normal day + 10 ms at 1M; the balance procedure | 3–5 |
| **S5** | **W1b + B5.** `InfraScheduler.setFrameBudget(ms)` with the adaptive worker budget (§3.1); `TRAFFIC_MIN_CYCLE_MS` overridable by the host, set to 300 ms in the worker (live mode only) | `scheduler.ts`, `params.ts`, `SimCore` | AC4 at ultra: traffic ≥ 10 cycles per 60 days; services, utilities, pollution and crime ≥ 90 % of design cadence (skeptic 9.1 and 9.2). AC3 ≥ 19.5 days/s. AC5 worker ≤ 45 ms per sim day. Bytes/s re-measured at this cadence | 2 + A/B |
| **R1** (PI-R) | **TerrainRenderer dirty rects.** `updateZones` and `updateTrees`, plus the lights and exits, take the union of the event rects instead of the whole map (today a full 256² refill, 1.44 ms, plus 3 uploads on every frame that carries a building, zone, network, tree or power-line event) | `src/render/world/TerrainRenderer.ts` | ≤ 0.15 ms per event frame at 256²; pixel-identical | 1–2 |
| **R2** (PI-R) | **The render spikes.** Budget `BuildingRenderer.add`: queue the LOD and geometry work at ≤ 2 ms per frame (about 2 ms per building today, max 14.8). Throttle `MiniMap.paintBase` or make it incremental. Make `Fireworks.collectLaunchSites` incremental. Size each on R1 (skeptic 11) | render files | AC2 on R1 | 3–5 |
| **W1.4** | **Default on.** `AppSettings.simThread = 'auto'`, plus the "Simulation thread: Automatic / Main thread" setting | `src/region/settings.ts`, settings UI | WASM_PLAN §5.5, plus: action latency **p95 ≤ 50 ms and p99 ≤ 100 ms**; AC1 including listeners; AC2 on R1; no long task from the sim; a mismatch rate of at most 1 % of **gestures**; main-thread deserialization ≤ 2 ms per real second at the S5 cadence **with a data view shown**, otherwise the steps of §2.10; heap growth ≤ 150 MB, measured with CDP per target | 2 + R1 runs |

After W1.4 the plan continues as WASM_PLAN's corrected order: PI-4 (the J-fixes, re-ranked on the post-B1 profile), PI-8′ (the traffic decision) and B4.

**Critical path:** S2 ∥ (W0.1 → W0.2 → W0.3 ∥ W0.4 ∥ W0.5 → W0.6) → W1.1 → W1.2 → W1.3, then S3 → S4 → S5, then R1 ∥ R2, then W1.4. That is about 60–80 developer-days, or roughly 7–9 weeks with the ui-game owner, the render owner and the sim owners working in parallel. Revision 2 adds about 8–10 days, mostly in W1.1.

**B1 in detail (S2): the triggers.**
- **Today.** `markC` marks services dirty on *any* `buildingChanged` of a relevant building (a coverage facility, park, transport building or NIMBY source). Every 1M pass comes from `Congested` flips. Funding and ordinances emit no event, so they wait up to `SERVICES_PERIOD` = 15 days.
- **The new trigger list:**
  - **The coverage key.** `markB` and `markC` mark dirty only when a per-id key changes: `def`, and `flags & (Powered | Watered | Abandoned | Burnt | OnFire | Constructing | Understaffed)`, and `built ≥ 1`. That covers health facilities' `Watered` flips and power flips, and ignores `Congested`, `Polluted`, `Crime` and `Noisy`.
  - **Staffing.** In `daily()`, scan the coverage facilities: about 2.5k plopped buildings, roughly 0.05 ms. Mark dirty when `|facilityOpFactor(st, b) − opAtLastPass[id]| > 0.05`. This tracks the continuous staffing level, not only the flag.
  - **Funding.** In `daily()`, compare `fundingFactor(st, svc)` for every `ServiceKind` with the values the last pass used. A change marks dirty and *immediate*.
  - **Ordinances.** In `daily()`, compare the effect signature of `budget.ordinances` with the one the last pass used. A change marks dirty and *immediate*.
  - **Justice.** In `monthly()`, compare `justiceFactors(st).policeMul` with `this.policeMul`. A difference over 1e-3 marks dirty and *immediate*.
  - **Unchanged:** `networkChanged` and `subwayChanged` still mark dirty; `buildingAdded` and `buildingRemoved` of a relevant def still mark dirty.
- **What "immediate" means.** `due()` skips the `SERVICES_DIRTY_DAYS` wait and the live cap. It does **not** set the scheduler's `urgent()`: urgent tasks run up to 8 steps per frame outside the budget, which would be 24 ms per frame on the main-thread host.
- **The live cap.** In live mode (the explicit flag of §3.1 once W1.2 lands; `framesActive` until then), a dirty pass (not a periodic one) starts at most once per `SERVICES_MIN_CYCLE_MS`, proposed at 2000 ms. Headless runs are unaffected.
- **Tests:**
  - a `Congested`-only flip is not due;
  - after `setFunding('police', 50)`, `policeCov` changes within `SERVICES_DIRTY_DAYS` + the pass length, at design cadence;
  - the same for enacting an ordinance, a clinic's `Watered` flip, a staffing drop of more than 5 %, and a monthly `policeMul` change.

## 7. Risks, mitigations, and when to stop

| # | risk | mitigation |
|---|---|---|
| 1 | **The replica diverges** because a silent write is missed: a primary layer or exact field written without an event, or a hidden WeakMap read on the replica | Primary layers and exact fields: the 120-day replica tests with every command, at design and live cadence and under lag; `auditExact` in dev builds; a monthly dev `digest` that resyncs on mismatch, into a fresh state. Hidden WeakMaps: `replicaSafe.test.ts`. The authoritative result always comes from the ack. The tornado's tree damage stays silent until its final `treesChanged`, exactly what today's renderer shows |
| 2 | **The main-thread cost of the event flood exceeds AC1.** bot256 at design cadence: about 260 events/day, 0.86 ms p50 for apply + replay with no-op listeners under load | Ultra has 3–4× fewer events. If needed: coalesce consecutive `buildingChanged` of one building within a packet; skip re-firing changes that touch only flags no main listener reads (measured per listener); R1 and R2 for the listener cost |
| 3 | **Action latency.** p95 and p99 are driven by long worker units: days of about 16–18 ms at 1M, month days, saves and snapshots of about 50–110 ms | B2, B3 and the save split; the metric is from post to ack applied; autosave throttling if needed. Hover previews never wait, because they run on the replica |
| 4 | **Wrong predictions** confuse players | Exact predictions only when none of the player's own edits is in flight; provisional commits are reported from the ack; corrections once per gesture through the issuing tool; the rate is counted per gesture in QA (gate ≤ 1 %). If one tool exceeds it, that tool reports from the ack for every commit |
| 5 | **A missed UI reach-in** ends up calling a facade method that returns `undefined` | `SimFacade` types expose only the views; hygiene greps; a dev warning on `getSystem` of an unknown name; the Appendix A checklist |
| 6 | **More progress lost** at unload | The journal bound to its base (no journaled edit lost); snapshots every min(30 s, 90 sim days) while dirty; snapshots and saves on hide; the IDB journal copy with `commit()`; tests against both hosts |
| 7 | **The protector regresses** in the worker or on main | The hygiene suites in CI; the per-isolate probes in the child-process test and in `qa-worker.mjs`; "never grow"; the worker graph never imports `bundle.ts` or `save/index.ts` |
| 8 | **Memory.** The replica (about 12.9 MB of arrays plus about 5 MB of building objects), the worker's state and system arrays (about 25–40 MB), the 11 MB bootstrap clone at load, the recovery payload on main (≤ 2.15 MB), and the debug ring | Main sheds the systems' arrays it holds today, its own `loadCity` copy and its recovery base. The 200-packet debug ring is dev-only and capped at 4 MB (at the S5 cadence 200 packets would hold 15–20 MB). Expected growth +30–50 MB. Measure on R1 with CDP per target; stop if the total grows by more than 150 MB |
| 9 | **Browser support:** module workers need Firefox 114+ and Safari 15+; IndexedDB in workers is universal | Feature test plus the `LocalSimHost` fallback; the overlay shows the host |
| 10 | **Two threads are harder to debug** | `?simworker=loopback` gives the same protocol in one thread, with an optional lag profile; the debug ring (`host.debugDump()`); `verify` |
| 11 | **Two IDB connections** (main and worker) block each other on a version upgrade | Both close on `versionchange`; `onblocked` is handled; the worker owns city writes during a session; main writes only the small recovery records |
| 12 | **Live mode behaves differently** between hosts: commands land between steps, and policy timing differs | Allowed by D2; the policy is tested at the day level; a QA script for the LIVE scenario at ultra; the live-cadence replica test |
| 13 | **Message volume** exceeds the 2 ms/s W3 gate at the S5 cadence | The road-cell-only traffic encoding (2.8–4.7× smaller per pass); the 4 Hz group throttle; the gate measured with a data view shown; then a 2 Hz cap for the shown view, then W3 |
| 14 | **A false crash** after a freeze, the back/forward cache or energy saver | Liveness counts only visible, unfrozen time; ping and pong; the CDP freeze test |
| 15 | **A save of the replica** silently drops lagged fields and `systemData` | The brand in the type and at runtime; the refusals in `serializeCity`, `saveCity` and `writeRecoverySnapshot`; every App path through the host; the crash fallback never boots from the replica |
| 16 | **A throwing view listener** aborts a packet | The isolating emitter; every packet completes; the replica's own errors lead to a resync |

**When to stop and reconsider:**
- **After W1.1**, if the protocol alone (apply + re-fire with no-op listeners) costs more than 1 ms per sim day at ultra on the re-grown bot256-1.4M after the risk-2 mitigations. Or if the replica tests cannot be made exact without adding events to more than a few sim files. Then the event-log replica is the wrong model. Fall back to a render-only replica (primary layers and building records) with everything else through queries, or to W3 shared display buffers, and re-plan.
- **After S3 and S4**, if action-latency p95 stays above 50 ms. Then consider yield points inside a day (receiving messages between systems but applying commands only at day boundaries) or optimistic local application of map edits. Both are more complex and need their own design.
- **If the worker's CPU per day is more than 10 % above the same code headless** (recorder, cloning, scheduler split). Profile before going further; the recorder's budget is ≤ 3 % of worker CPU.
- **If R1 measurements show main-thread frames dominated by rendering even with the sim off.** The worker still removes the month spikes, but the render items (R1, R2) become the priority, and W1.4's acceptance should be re-weighted towards AC2.

## Appendix A: each consumer and its new mechanism

| area (inventory) | after the migration |
|---|---|
| CityScene main loop | `host.frame(dt)` replaces `sim.update(dt)`; `updateAmbience` and the fps overlay read the replica and `host.speed`; `feedWind` runs on the replica's `'day'`; `storeCamera` posts `setCamera`, which does not count as a pending edit; `loadSim` becomes `LocalSimHost.start()`; the scene is built after `host.ready` |
| tool dispatcher and catalog | lock checks on the replica (`unlocked`, `milestones`, unique-def walk, `listRewards`, `config.disasters`); `demolishRisks` becomes a query on mouse-up; gestures from pointer-down to up; pending ghosts instead of suppressing hover previews |
| ZoneTool | previews on `host.preview` with the pending overlay; commit through `Tool.commit`; `sideDemolishRisks` becomes a query |
| NetworkTool | the same; the road ghost stays drawn as pending until the ack's `networkChanged` replays (1–2 frames) |
| BrushTool | each application is a commit in the stroke's gesture; `spent` and `failed` come from the acks; the release sound waits for `gesture.settled`; terrain follows within 1–2 frames; no toasts |
| PlopTool | ghost on the replica with the pending overlay (funds, unique defs); `stopsNear` and `ferryPartnersFor` become queries per key; a unique def deselects on an exact ok or an ok ack |
| QueryTool | readouts on the replica; the hovered building is a focus id; Trucks, tap water and Emergency read their streams or rasters |
| DispatchTool | options are a watch; routes a query per hovered station; `report` a query on click; `dispatch` an awaited ticket tagged with the tool; `host.cause` replaces the `sending` flag; `EmergencyView` for incidents and vehicles |
| DisasterTool | a fire's refusal predicted on the replica; otherwise an awaited `triggerDisaster` |
| InfoPanel and inspectorModel | watches on `inspectBuilding` and `inspectCell`, keyed by target; the header from the replica at once; `setHistoric` is optimistic and never reverts before its ack; demolish = a one-commit gesture, then the panel closes on the ack |
| TopBar | the replica (stats, budget, history, `systemData.economy`); `capHints` a watch while open; speed buttons call `host.setSpeed` |
| BudgetPanel | `setTax` and `setFunding` are optimistic (one command per key per frame); its catch fallbacks are deleted; the forecast is a watch; loans are predicted on the replica and applied on the ack |
| ordinances and rewards | `listOrdinances` and `listRewards` on the replica; `setOrdinance` predicted on the replica, including `needsConfirm`, then confirmed and applied on the ack |
| GraphsPanel | the replica's history (monthly tail) |
| StatsPanel | the replica's stats; `garageStates` a watch |
| AdvisorsPanel and news | `alertCount` on the replica; `advisorIssues` a monthly watch; `openAdvice` a throttled query; `seenNews` by news sequence number |
| DataViewsPanel and legend | `setOverlay` posts `view`; the legend reads the replica (`avgCommute`, `windVector`) and says "Loading…" until a view's first data |
| DemographicsPanel | the replica's stats and history; `tourismSummary` and `attractivenessBreakdown` watches; `unservedClusters` a query |
| EmergenciesPanel | `EmergencyView` (stations subscribed while open), `host.simTime()`, stats |
| EmergencyBanner | renders `host.policy`; the policy itself runs in the worker; outcome text from the incident's emit-time record; `dispatchBest` awaited; dismiss posts a command |
| toasts and ticker | the replica's `'news'` events; the ticker uses the news sequence number |
| Onboarding | the replica; `host.setSpeed(1, 'onboarding')` |
| MiniMap | the replica; also dirty on `layerUpdated('utilities')` |
| pause menu and error overlay | `host.setSpeed(0, 'pause')` and `host.resume()`; the crash choices of §4.4 |
| GameSounds, sirens, ambience | replica events in one ordered burst; event-time records (F2) |
| New Year | the replica's `'year'` with the `live` flag (§3.6) |
| terrain and world renderer | the replica (primary layers, subscribed overlay arrays, derived sources); pending ghosts; R1 dirty rects; `setState(ctx.state)` on `'reset'` |
| city objects renderer | the replica; building objects updated in place; `getTrafficRoutes` and `getEmergency` through the host; R2 |
| traffic vehicles | `traffic` and `congestion` always mirrored, as road cells; routes from the traffic stream |
| emergency vehicles | `EmergencyView` plus the extrapolated sim clock |
| overlay raster cache | `attachOverlays(host.sim)`; views; `registerDerivedSource` |
| saves | worker `save:copy` and `save:put`; main keeps the bookkeeping and the thumbnail; every App path through `host.save` (§4.5) |
| recovery and dirty tracking | worker snapshots; the `RecoveryMirror` and its journal on main; `isDirty` on the replica, read-only |
| region play and lifecycle | region effects in `SimCore.boot`; one worker per city session, pre-spawned; `dispose` on exit; liveness in visible time |
| module facade (`modules.ts`) | the `econ.*` helpers on the replica, except `capHints` and `computeMonthlyBudget` (watches); `triggerDisaster` becomes a command; `infra.getTraffic` and `getUtilities` are replaced by queries and views |
| stand-ins, dev pages, harness hooks | `FallbackActions` only in `LocalSimHost`; the `scene.sim` facade; `ui/demo.ts` with `?simworker=0` |

## Appendix B: probes run for this design

All paths are in the scratch directory `/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/workerplan/`, not in the repo.

**Revision 1: the replica stream.**
- The harness is `h/replica.ts`, bundled as `h/replica.mjs`. Results: `out/replica_dense1m_s10.json` and `out/replica_bot256_s30.json`.
- It ran on the `git archive` snapshot of `c7c7504` (`snap/`), with fixtures loaded through zlib and `decodeBundle`, in node 22, at design cadence (`advanceDay` + `flush`, one packet per day) for 60 days.
- Transport was `structuredClone`. Main received a replica bootstrapped from `serializeCity`, and replayed into an `Emitter` with one no-op listener per type.
- It used full lagged sweeps, not the rolling scheme of §2.5, and node's `v8.serialize` for packet bytes, which undercounts views (§1.4).
- The load average was 14.6 on 4 cores, so the times are inflated about 2–3×. Treat them as upper bounds.

| | dense1m_s7 (1.15M, 17.2k buildings) | bot256_s7_y60 (665k, 11.3k buildings) |
|---|---|---|
| events per day (p50 / mean / max) | 42 / 104 / 296 | 141 / 260 / 960 |
| event-time records per day (p50 / mean) | 32 / 93 | 136 / 251 |
| worker capture (ms/day, p50) | 0.38 | 0.92 |
| packet bytes (p50 / p90; lower bounds) | 25 KB / 591 KB (days with traffic or utilities layers) | 48 KB / 363 KB |
| clone (ms, p50) | 0.54 | 0.45 |
| **main apply, total (ms/day, p50 / p90)** | **0.28 / 0.57** | **0.86 / 2.54** |
| of which event replay (p50) | 0.14 | 0.60 |
| silent changes of exact fields over 60 days | **0** | **0** |
| exactness checks (layers, exact fields, mirrored layers, funds, day, stats, budget) | 3 of 3 clean | 3 of 3 clean |
| full exact-field shadow diff (worker ms/day, p50); rejected | 13.1 | 6.1 |
| full lagged sweep: records / bytes / main apply ms; rejected | 17.2k / 4.1 MB / 43 ms p50 (910 max) | 11.3k / 2.6–2.7 MB / 6.7–27 ms |
| bootstrap: serialize / clone / main deserialize (ms) | 121 / 36 / 151 (11.2 MB) | 68 / 20 / 62 (10.5 MB) |

**Inherited from the inventory** (same machine, other runs):
- At ultra, dense1m has 25–36 `buildingChanged` events per sim day (design cadence: 95.6).
- Events per frame: p50 18–21, max 191–206.
- `layerUpdated`: 8–10 per real second.
- Emergency stream: 7.5 KB mean.
- Sample routes: 6–15 KB.
- Sim init: 936 ms (bot256: 693 ms).
- `serializeCity(copy)`: 40–53 ms wall.
- Recovery snapshot on main: 50–59 ms.

**The critique's probes** (`critic/`), which this revision relies on:

| probe | result |
|---|---|
| `rolling.ts` → `rolling_bot256.json` (bot256, 90 days, design cadence, 512 per packet, load 6.8) | as first specified, the rolling refresh left 12 / 36 / 32 buildings unconverged at days 30 / 60 / 90 after a forced full round, mostly civic staffing; with the shadow following every record: 0 / 0 / 0 |
| `subarray_clone.mjs`, and the `subarray-clone` case of `browser/` | `structuredClone` and `postMessage` of a 16-element subarray of a 64 MB buffer: 100 ms in node, 99 ms in Chromium, a 64 MB buffer received; `slice()`: 1 ms; `v8.serialize` reports 69 B |
| `prot_case.mjs` → `prot_node.txt` (node 22) | invalidated: a transfer, wasm `memory.grow` (also without touching `.buffer`), `Blob.arrayBuffer()`, `Blob.text()`, `Response.arrayBuffer()`. Intact: `structuredClone`, `v8.serialize`, `MessageChannel` posts and self-posts, resizable `ArrayBuffer.resize`, growable SAB `grow`, SAB clone, `TextDecoder`, sync zlib, JSON |
| `browser/` → `probe_nocoi.json`, `probe_coi.json` (Chromium dedicated workers) | intact: clone posts, self-posts, `structuredClone`, IDB put / get of an 11.9 MB record (33 / 22 ms), `fetch().arrayBuffer()`, `instantiateStreaming`, `Blob`, `Response`, Compression and Decompression streams. Invalidated: a transfer (only in the sender), `memory.grow`, `ArrayBuffer.transfer`. Main-thread deserialization: 25 KB packet 0.1 ms p50 (0.2 p90), 540 KB traffic packet 0.5 ms p50 (1.1 max). Without COOP/COEP: `crossOriginIsolated` false and no `SharedArrayBuffer` in page and worker; with them, both present |
| `plainsize.ts` | the plain sections are about 6–9 KB and the emergency stream about 6.7 KB |

**Revision 2's probe** (`r2/traffic_enc.ts`, bundled as `r2/traffic_enc.mjs`). At every `layerUpdated('traffic')`, at design cadence for 40 days, it compares the whole encoding with the road-cell-only one and with a changed-cells one, and counts nonzero values off the network.

| | dense1m (load 3.6) | bot256 (load 2.8) |
|---|---|---|
| traffic passes | 20 | 20 |
| network cells | 23,141 | 13,909 |
| nonzero traffic or congestion off the network (max) | 0 | 0 |
| traffic cells changed per pass: min–max (p50) | 17,319–22,379 (22,103) | 6,920–12,330 (11,717) |
| bytes per pass: whole / road cells only / changed cells | 512 / 181 / 271–350 KB | 512 / 109 / 108–193 KB |

Results: `r2/traffic_enc_dense1m.json` and `r2/traffic_enc_bot256.json`.

## Review changes

Revision 2 against the independent critique. "Required" items are R1–R16; "optional" items O1–O13 were adopted because each is clearly right; O14 lists facts the critique verified, which needed no change.

| # | what changed | where | why |
|---|---|---|---|
| R1 | Pending optimistic ops are re-applied by every write that could revert them: right after the plain sections (tax, funding), right after `policy` (dismissals), after each building record written in the log replay (for ops with `seq >` the last `Ack` replayed so far) and after `blds` (for ops with `seq > p.cmd`). Dev builds assert at the end of each packet. This goes further than "rebase last", so that listeners inside the burst never see a revert either | §2.2, §2.4 (F8) | the single rebase ran right after `plain`, before `policy`, the log and `blds`. A dismissed alert's banner came back for a packet, and the historic toggle (InfoPanel's building is always a focus id) was reverted by any packet built before the worker applied it, which is common at ultra |
| R2 | The rolling shadow is updated by every record that carries pop and jobs: event-time, focus, constructing and rolling | §2.5 | measured: as specified, 12 / 36 / 32 buildings never converged on bot256 (mostly civic staffing, e.g. police station jobs 30 against 15); with the fix, 0. Revision 1's probe used full sweeps and never exercised this path |
| R3 | Query results, `saved`, `snapped` and errors ride inside packets, as `replies`, applied after the log; watch values moved to the end too; `saved` carries `cmd` | §2.1, §2.3, §2.4 (F7), §3.1 | a `qres` posted during `drain` reached main before the packet holding the earlier command's `Ack`, so inspector, `demolishRisks` and dispatch results described edits the replica did not have yet. Carrying them in packets also keeps the order under backpressure |
| R4 | Gestures (pointer-down to up) group commits; `Tool.commit` delivers feedback and corrections to the issuing tool, once per gesture; the global `actionCorrected` handler is gone; BrushTool takes `spent` and `failed` from acks and plays its release sound after the gesture settles; mismatches are counted per gesture, and the W1.4 gate is per gesture | §2.2, §6 (W0.2, W1.1, W1.4), Appendix A | a held brush applies every 70 or 120 ms on a replica one to three applications behind; the worker would reject applications predicted ok ("Nothing to change", "No room for trees here"), and a global handler would have played an error and a toast per application |
| R5 | (a) `host.pending` counts only preview-affecting commands: map edits, plops, loans and ordinances; `setCamera` (every 2 s), taxes, funding, speed, settings, historic and dismissals do not. (b) Predictions are exact only when none of the player's own preview-affecting commands is in flight; otherwise they are provisional, the command is posted anyway, and the tool reports the ack's result. The pending overlay adjusts funds and unique defs, and `claims()` marks the footprints of pending edits in the hover tip | §2.2 | (a) every 2 s `setCamera` would have blanked hover previews for 1–3 frames. (b) "a predicted failure is final" refused bulldoze then plop, terraform then plop and zone then dezone against stale state, with an error toast for an edit that would succeed one unit later. Posting was chosen over deferring and re-predicting: the same latency, no timer, FIFO order with the edits it depends on |
| R6 | The replica is branded in its type and at runtime; `serializeCity`, `saveCity` and `writeRecoverySnapshot` refuse it at compile time and throw at runtime; every App path (`doSaveCity`, `saveCurrentCity`, `exitCity`'s re-save, every `snapshotNow` reason, `enterCity`'s region effects) is mapped to the host; "Continue on the main thread" boots `LocalSimHost` from IDB or snapshot plus journal | §0, §4.4, §4.5, §6 (W0.6) | in worker mode `currentState()` is the replica, which lacks lagged fields and most `systemData` (bot256: emergency 25 KB, `infraTransport` 80 KB, `popGrids` 20 KB, growth, justice, demographics); revision 1's "then App.exitCity runs as today" kept exactly these paths |
| R7 | (a) The journal is bound to its base, either the last save or the last snapshot, and is replayable onto the save itself; the mirror drops its payload on every `saved` and accepts a `snapped` only against its current save. (b) An op whitelist (excludes speed, resume, camera, dispatches, dismissals, settings, debug and `triggerDisaster`); toggles stored as idempotent sets (`setHistoric` is also the wire op); a journal whose record changed is discarded, including after `LocalSimHost` saves; 128 KB reserved inside `LS_BUDGET_BYTES` (snapshots are encoded to the remaining budget); an IDB journal record with `commit()` at unload. (c) The loss bound is stated in sim days: snapshots every min(30 s, 90 sim days) while dirty | §2.2, §4.3 | every `saved` replaced the base, so the mirror's payload became a delta of the old base, which restore rejects, and the journal went with it. At ultra with the default autosave (every 4.5 s) that was almost always the case. "≤ 30 s" meant up to 600 sim days at ultra with autosave off |
| R8 | `Emergency` entries carry an event-time incident record; the replica writes it into the `Incident` object in place before re-firing, and restores end-of-packet values for live incidents afterwards | §2.3, §2.4 (F2, F4), §3.3 | `EmergencySystem.finalize()` removes the incident before emitting `'failed'` or `'resolved'`, and losses are often counted the same day, so the banner showed "Help came too late — 1 building lost" without the loss |
| R9 | Every typed array in a message owns its buffer; `slice`, never `subarray`, for the recorder, cell scratch and sparse buffers; a dev assertion in `post()` and in `protocol.test`; bytes counted with clone semantics | §1.4, §2.3, §3.1, §5.3 | a 16-element subarray of a 64 MB buffer clones the whole buffer: 100 ms in node, 99 ms in Chromium. Node's `v8.serialize` counts only the view, so revision 1's packet sizes are lower bounds |
| R10 | (a) "never grow", with the blur:wasm mode in the protector test and the 64 MiB / 4 MiB sizing kept; (b) node's `Blob.arrayBuffer()`, `Blob.text()` and `Response.arrayBuffer()` added to the hygiene scan, which now covers the node tests and harnesses; (c) the protector test spawns a child node process with the flags and relies on per-isolate probes | §1.5, §5.3, §6 (S1) | measured: `memory.grow` invalidates even without touching `.buffer`; those node APIs invalidate; `execArgv` with V8 flags throws `ERR_WORKER_INVALID_EXEC_ARGV`, and trace lines do not name the isolate |
| R11 | Liveness counts only visible, unfrozen time, reset on `visibilitychange`, `resume` and `pageshow`; main → worker ping and pong; `boot` progress messages with a 20 s timeout before `ready`; fail fast on `worker.onerror`, a script load error or `messageerror`; the loading screen shows the boot phase | §2.10, §4.1, §5.4 | a frozen page freezes its worker, so the 10 s heartbeat timer would show a false crash on resume; a hang between `hello` and `ready` had no timeout and left the veil up |
| R12 | The replica's emitter isolates listener errors, reports them and always finishes the packet; the replica's own errors cause a resync; `adopt()` builds a fresh `CityState`, so every per-state cache starts empty, and WorldView re-reads `ctx.state` on `'reset'` | §2.4, §2.10, §5.3 | `Emitter.emit` does not catch, so one throwing view listener aborted the rest of the packet with nothing to detect it; adopting into the old object could keep `buildingList`'s `listCache` or overlays' `homesCache` returning removed buildings. A fresh state was chosen over invalidating about 25 caches by hand, which would touch many sim files |
| R13 | The cause-tag API: `act(op, args, {tag})` and `host.cause`, set by `LocalSimHost` inside `act()` and by the replica during re-fire; DispatchTool's `sending` guard is replaced in W0.2, on `LocalSimHost` | §1.2, §2.2, §6 (W0.2) | cause tags first existed in W1.1's log, and listeners receive only the payload, so W0.2 could not land |
| R14 | W1.2 runs the worker with `CitySource 'serialized'` and `persistence: 'main'`, with worker-built snapshots stored by main as its recovery strategy, and no journal; the journal check of `qa-worker.mjs` moves to W1.3; W0.6 splits `src/save/index.ts` (city records into `cities.ts`) and the recovery code into codec, IDB and localStorage parts | §4.1, §4.3, §6 | W1.2's acceptance required a W1.3 feature; `index.ts` imports `./bundle` for `packFile` and `unpackFile`, so the "no bundle.ts in the worker graph" rule could not pass; workers have no `localStorage` |
| R15 | The volume budget is redone at the S5 cadence with the measured 0.8–0.9 ms/MB; the road-cell-only traffic encoding (exact by construction, measured 181 / 109 KB per pass instead of 512) ships in W1.1; W1.4 measures the W3 gate with a data view shown, with a 2 Hz cap for the shown view as the next step | §1.4, §2.6, §2.10, §6 | traffic and congestion alone were 1.7 MB/s at 3.3 cycles/s; the total 2.1–2.5 MB/s cost 1.7–2.3 ms/s on main, at or above the design's own 2 ms/s gate. Changed-cell spans were measured and rejected: most road cells change every pass |
| R16 | New suites: a lag loopback with a command fuzzer and five properties; a live-cadence replica test (dt jitter, commands between steps, ultra and 1×, tornado and fires); a query side-effect test; `LocalSimHost` clones acks and results in dev and tests from W0.3; a Playwright freeze test with `Page.setWebLifecycleState`. Existing suites gained the rolling-convergence, incident-record, throwing-listener, resync, brand and journal cases | §5.3, §5.4, §6 | every planned test ran at design cadence with immediate delivery, so none of R1, R3, R4 or R5 could fail |
| O1 | Pending ghosts: the committed preview stays drawn in a pending style until its ack replays; the in-flight suppression of hover previews is removed | §2.2, Appendix A | otherwise every road or zone commit blinks between the ghost and the real edit |
| O2 | Every watch is capped at 5 Hz of real time | §2.8 | "daily" is 20 Hz at ultra, three times today's 6 Hz `uiTick`, on worker CPU |
| O3 | Watch caches are keyed by arguments; InfoPanel renders its header from the replica at once and its sections when the watch lands | §2.8 | switching targets must never show the previous target's report |
| O4 | Acks carry no `cells` | §2.2, §2.3 | up to 20,000 `{x, z, ok}` objects per zone or bulldoze result, which only previews need |
| O5 | `setOrdinance` (including `needsConfirm`) and loans are predicted on the replica and applied on the ack, instead of awaiting a tick first | §1.3, §2.2 | `needsConfirm` depends only on `budget.ordinances`, `stats.population` and `standingBlocked` over exact fields, and `loanOffer` is replica-safe |
| O6 | Main keeps no recovery base and does not run its own `loadCity` and deserialize: CityScene is built from `ready`; the debug ring is dev-only and capped at 4 MB | §4.1, §7 (risk 8) | an 11 MB `SerializedCity` on main that the worker owns; 151 ms and an 11 MB transient at load; the ring would have held 15–20 MB at the S5 cadence |
| O7 | Live mode is an explicit host flag on the scheduler and on disasters | §3.1, §6 (W1.2) | `framesActive` (and `disasters.ts:74`'s own check) flips to headless after a 750 ms gap, which a long worker unit or a debugger can cause |
| O8 | BudgetPanel's catch fallbacks are deleted; the hygiene scan forbids writes into the replica outside `src/worker`; plain sections are applied in place | §2.4, §5.3, §6 (W0.6) | the fallbacks wrote the replica directly; closures such as `renderTaxes`' `const b = ctx.state.budget` stay valid |
| O9 | A view draws nothing until its first subscribed data arrives, including after a resync | §2.6 | the 16 `DERIVED_LAYERS` are not in `ready`, so a never-shown view's first frame would draw zeros |
| O10 | Measurement rules: aggregate counters (coarse timers without COI), CDP per target for memory, protocol cost separate from listener cost | §5.4 | `performance.now()` is 100 µs in Chromium and about 1 ms in Firefox and Safari; `measureUserAgentSpecificMemory` needs COI; SwiftShader inflates render listeners |
| O11 | Hosting facts for W3: GitHub Pages, a COI service worker, self-hosted Inter, no COEP `credentialless` in Safari; the W1 no-SAB decision confirmed by the probe | §1.4 | – |
| O12 | The worker is pre-spawned on the region screen after a prefetch; the `hello` timer starts only after the script has loaded; the duplicated download is noted | §4.1 | first visits download the sim code twice; a timer started before the download could fire on a slow connection |
| O13 | The clock claim is corrected for 1×; pausing and resuming go through the worker (`resume`) | §3.2, §3.5 | packets do not arrive every tick at 1×; PauseMenu could restore a stale 3 after the LIVE policy had set 1, ending LIVE |
| O14 | No change: the critique verified that clones, `MessageChannel`, `worker_threads` and Chromium worker clone posts keep the protector in both isolates; a transfer invalidates only the sender; growable SAB `grow` and resizable `ArrayBuffer.resize` do not invalidate; IDB, `fetch().arrayBuffer()`, `instantiateStreaming`, `Blob`, `Response` and compression streams are intact in a Chromium worker; `lodBuilder`'s arrays are `slice()` copies (J0 is safe); the `CityState` arrays total 12.9 MB and the primary layers 985 KB; plain sections are 6–9 KB and the emergency stream about 6.7 KB; the command table covers every player action (`bulldozeSubway` and `setFamilyTax` are dead code); the exact-field audit premise holds; `CityActions` previews never draw `rng`, call `notify` or call `getSystem`, and `building` grid writes happen only in `placeBuilding` and `removeBuilding` | – | – |

Revision 1 is kept as `WORKER_DESIGN.r1.md` next to this file.
