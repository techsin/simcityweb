/**
 * T089 (NOTE-080 section 3) on the real App: main.ts's onWorkerCrash with `?simworker=1`. main.ts boots on import, over a
 * fake DOM (as storageTakeover.test.ts), and its cities run on the real worker (node worker_threads; the worker's
 * IndexedDB is the test's KV, through nodeWorker.ts's bridge) behind the real WorkerSimHost, recovery store, region lock
 * and storage dialog. The screens that draw are stubs, the crash dialog's answer is the test's, and a crash is W1.3's
 * Desktop QA line: an invalid tick, which is a fatal in the worker.
 *
 * (a) W1.3 decision 3, the owner's choice: "Restart from autosave" and "Continue on the main thread" discard the crashed
 *     session's recovery copy. Before, the worker's snapshot stayed stored, and a Recover after a later crash restored
 *     that old session in place of the newer edit.
 * (b) W1.3 decision 20: a Recover that does not restore is never followed by a replay, and no city opens over a recovery
 *     copy that is still stored. Before, the boot that followed deleted the journal bound to the kept snapshot.
 * Round 2 (NOTE-092): the region then says why nothing was recovered and that the copy is kept, and the city's Play
 *     recovers it once the cause is gone; and with the real dialog over the crashed city, neither Space nor Enter
 *     deletes the copy (the dialog's keys alone, and the city's under it: crashDialogKeys.test.ts).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevType } from '../../src/core/types';
import type { RegionData, RegionTile } from '../../src/region/types';
import type { RecoveryJournal, RecoveryMarker } from '../../src/save';
import type { StoreName } from '../../src/save/db';
import type { WorkerInit, WorkerInput, WorkerPort } from '../../src/worker/workerProtocol';
import { buildWorkerTest } from '../../tools/bench/worker/buildTests.mjs';
import { nodeWorkerPort } from '../../tools/bench/worker/nodePort';
import { FEl, FNode, textNode, textOf } from './fakeDom';
import { FakeLocks } from '../save/fakeLocks';

interface ScreenStub { el: FEl; disposed: boolean }
interface RegionStub extends ScreenStub {
  model: { data: RegionData; tileByKey(key: string): RegionTile | undefined };
  cb: { onPlay(tile: RegionTile): void };
  /** the tile whose card is open (its Play button) */
  selected: string | null;
}
/** the host as this test drives it (WorkerSimHost; `link` is its private transport) */
interface Host {
  kind: 'worker' | 'local' | 'loopback';
  changes: number;
  state: { budget: { taxRates: number[]; funding: Record<string, number> } };
  post(op: string, args: unknown[]): { done: Promise<unknown> };
  flushCommands(): void;
  snapshot(why: 'hidden'): Promise<{ ok: boolean; idb: boolean; marker: RecoveryMarker } | null>;
  link: { post(message: unknown): void };
  dispose(): Promise<void> | void;
}
/** what main.ts hands its scene (CitySceneOptions) */
interface SceneOptions { state: unknown; host?: Host; rctx?: unknown; persistence?: unknown; replayJournal?: boolean }

const ui = vi.hoisted(() => ({
  titles: [] as (ScreenStub & { o: { onContinue?: () => void } })[],
  regions: [] as RegionStub[],
  recover: vi.fn(), crash: vi.fn(), toast: vi.fn(),
  screen: (cls: string): FEl => Object.assign(document.createElement('div') as unknown as FEl, { className: cls }),
}));

vi.mock('../../src/audio', () => ({ audio: new Proxy({}, { get: () => () => undefined }) }));
vi.mock('../../src/ui/uiSounds', () => ({ installUiSounds: () => undefined }));
vi.mock('../../src/region/NeighborLabels', () => ({ NeighborLabels: class {} }));
vi.mock('../../src/region/NewCityDialog', () => ({ openNewCityDialog: vi.fn(), terrainOptionsFor: vi.fn() }));
vi.mock('../../src/region/mapPreview', () => ({
  cityThumbnail: () => 'thumb', drawCityMap: () => undefined, normalizeThumbnail: async (t: string) => t,
  regionPreviewDataUrl: () => 'preview', regionPreviewKey: () => 'key',
}));
vi.mock('../../src/region/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/region/settings')>()), // the defaults and checks src/game/settings.ts reads
  applyFirstRunQuality: () => false, cityOverrides: () => ({}), loadSettings: () => ({ quality: 'medium' }),
  saveSettings: () => undefined, takeCityChanges: () => undefined,
}));
vi.mock('../../src/region/ui/dialogs', () => ({
  openRecoverDialog: ui.recover, openSimCrashDialog: ui.crash, openCredits: vi.fn(), openLoadRegion: vi.fn(), openNewRegion: vi.fn(), openSettings: vi.fn(),
}));
vi.mock('../../src/region/ui/SaveStatus', () => ({ SaveStatus: class { el = { disabled: false }; mount() {} set() {} dispose() {} } }));
vi.mock('../../src/region/ui/TitleScreen', () => ({
  TitleScreen: class {
    readonly ready = Promise.resolve();
    readonly el = ui.screen('title-screen');
    disposed = false;
    constructor(root: FEl, readonly o: { onContinue?: () => void }) { root.appendChild(this.el); ui.titles.push(this); }
    dispose(): void { this.disposed = true; this.el.remove(); }
  },
}));
vi.mock('../../src/region/RegionScreen', () => ({
  RegionScreen: class {
    readonly ready = Promise.resolve();
    readonly el = ui.screen('region-hud');
    disposed = false;
    selected: string | null = null;
    constructor(root: FEl, readonly model: RegionStub['model'], readonly cb: RegionStub['cb']) { root.appendChild(this.el); ui.regions.push(this); }
    selectTile(tile: RegionTile | null): void { this.selected = tile?.key ?? null; }
    async refresh(): Promise<void> {}
    dispose(): void { this.disposed = true; this.el.remove(); }
  },
}));
vi.mock('../../src/worker/simWorkerUrl', () => ({ SIM_WORKER_URL: 'test:sim-worker' }));

class El extends FEl {
  hidden = false;
  replaceChildren(...children: (FNode | string)[]): void { this.textContent = ''; this.append(...children); }
}
class LocalStore {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
  removeItem(key: string): void { this.values.delete(key); }
}

/** the App's state this test reads (private in main.ts) */
interface AppView {
  root: El;
  busy: boolean;
  region: RegionStub['model'] | null;
  city: { tile: RegionTile; host: Host; entered?: boolean } | null;
}

const REGION = 'rtest', TILE = '0_0', KEY = `${REGION}:${TILE}`, JOURNAL = `${KEY}#journal`, CITY = 'Crashville';
/** the save's values (CityState's defaults): every edit below moves away from them */
const TAX = 9, FUNDING = 100;
const realTimers = { setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval };
let workerUrl: URL;
/** One test's App and what its mocks share with the test. Each test has its own: after a failure an earlier App can
 *  still be in a flow, and it must not reach a later test's worker spawner. */
interface Run {
  /** main.ts's browserSimWorker: the node worker, whose IndexedDB is the test's KV */
  spawn: () => WorkerPort;
  ports: WorkerPort[];
  scenes: { opts: SceneOptions }[];
  /** what the App wrote with console.error, as one line each */
  logged: string[];
  /** crash dialogs the test did not make: the host's watchdog on a stalled machine, or a real fault */
  strays: string[];
}
let run: Run;
let timers: ReturnType<typeof setTimeout>[];

beforeAll(async () => { workerUrl = await buildWorkerTest(); }, 120000);
beforeEach(() => {
  vi.resetModules();
  const mine: Run = run = { spawn: () => { throw new Error('no worker for this test'); }, ports: [], scenes: [], logged: [], strays: [] };
  // These two mocks hold modules of the App's graph, and the result of a vi.mock factory outlives vi.resetModules():
  // each test registers them anew, so the worker host and the scene's local host are this test's modules (its KV).
  vi.doMock('../../src/worker/WorkerSimHost', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../src/worker/WorkerSimHost')>()),
    browserSimWorker: () => mine.spawn(),
  }));
  // CityScene's part in this: it runs on the worker host the App booted, or on a local host of its own on the loaded state
  vi.doMock('../../src/game/CityScene', async () => {
    const { LocalSimHost } = await import('../../src/worker/SimHost');
    const { CityActions } = await import('../../src/sim/actions');
    class Scene {
      readonly ready = Promise.resolve();
      readonly host: Host;
      private local: InstanceType<typeof LocalSimHost> | null = null;
      constructor(readonly opts: SceneOptions) {
        this.host = opts.host ?? ((this.local = new LocalSimHost(opts.state as never, { rctx: opts.rctx as never, persistence: opts.persistence as never, replayJournal: opts.replayJournal })) as unknown as Host);
        mine.scenes.push(this);
      }
      async start(): Promise<void> { await this.local?.start({ CityActions }); }
      dispose(): void { void this.host.dispose(); }
    }
    return { CityScene: Scene };
  });
  // the App's toasts are the test's to read; the last test puts the real Modal back, for the real crash dialog
  vi.doMock('../../src/region/ui/modal', () => {
    let root: unknown = null;
    return { setUiRoot: (el: unknown) => { root = el; }, uiRoot: () => root, toast: ui.toast };
  });
  ui.titles.length = ui.regions.length = 0;
  ui.recover.mockReset().mockResolvedValue(null);
  // a crash the test did not make leaves its dialog open, and the test's next wait says so
  ui.crash.mockReset().mockImplementation((o: { message: string }) => { mine.strays.push(o.message); return new Promise(() => {}); });
  ui.toast.mockReset();
  // kept as one line each: a crash's error carries the worker bundle's data: URL in every stack frame, megabytes a crash
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { mine.logged.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ')); });
  timers = [];
  // every timer the App starts ends with its test: the city's 1 s ticker and the host's watchdog would outlive it
  const tracked = <A extends unknown[]>(start: (...args: A) => ReturnType<typeof setTimeout>) => (...args: A) => {
    const id = start(...args);
    timers.push(id);
    return id;
  };
  const timeout = tracked((fn: () => void, ms?: number) => realTimers.setTimeout(fn, ms));
  const interval = tracked((fn: () => void, ms?: number) => realTimers.setInterval(fn, ms));
  vi.stubGlobal('setTimeout', timeout);
  vi.stubGlobal('setInterval', interval);
  const events = () => {
    const t = new EventTarget();
    // (node's removeEventListener takes a boolean `capture` for false: spelled out, as a browser reads it)
    const options = <T extends EventListenerOptions>(o?: boolean | T) => (typeof o === 'boolean' ? { capture: o } : o);
    return {
      addEventListener: (type: string, f: EventListener, o?: boolean | AddEventListenerOptions) => t.addEventListener(type, f, options(o)),
      removeEventListener: (type: string, f: EventListener, o?: boolean | EventListenerOptions) => t.removeEventListener(type, f, options(o)),
      dispatchEvent: t.dispatchEvent.bind(t),
    };
  };
  vi.stubGlobal('document', {
    ...events(), body: new El('body'), hidden: false, visibilityState: 'visible',
    createElement: (tag: string) => new El(tag), createTextNode: (s: string) => textNode(s), getElementById: () => null, querySelector: () => null,
  });
  vi.stubGlobal('Node', FNode);
  vi.stubGlobal('window', { ...events(), setTimeout: timeout, setInterval: interval, clearTimeout, clearInterval });
  vi.stubGlobal('location', { search: '?simworker=1' });
  vi.stubGlobal('localStorage', new LocalStore());
  vi.stubGlobal('navigator', { locks: new FakeLocks() });
  vi.stubGlobal('requestAnimationFrame', (fn: (t: number) => void) => timeout(() => fn(performance.now()), 1));
  // the worker script's prefetch (main.ts prefetchWorkerScript): nothing to download here
  vi.stubGlobal('fetch', async () => ({ blob: async () => null }));
});
afterEach(async () => {
  // a flow a failed test left running starts no further worker and enters no further city
  run.spawn = () => { throw new Error('the test has ended'); };
  const app = (window as unknown as { __metropolis?: AppView }).__metropolis;
  if (app) app.busy = true;
  // the open city's host first: a worker that is only terminated reads as one more crash
  await app?.city?.host.dispose();
  for (const port of run.ports) await port.terminate();
  for (const id of timers) clearTimeout(id);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** (generous: the full suite runs this beside CPU-heavy files, and each step boots a worker) */
const long = { timeout: 120000, interval: 10 };
/** per test: up to four such waits */
const TEST_MS = 600000;
const CRASHED = '[main] the simulation worker crashed Invalid tick';
const liveRegions = () => ui.regions.filter((r) => !r.disposed);
const slot = () => localStorage.getItem('metropolis.recovery');
/** post a command and send it at once (a slider otherwise waits for the next frame) */
function send(host: Host, op: string, args: unknown[]): Promise<unknown> {
  const ticket = host.post(op, args);
  host.flushCommands();
  return ticket.done;
}
/** vi.waitFor, except that a crash dialog the test did not make ends the wait at once and fails it */
async function until(check: () => void): Promise<void> {
  await vi.waitFor(() => { if (!run.strays.length) check(); }, long);
  expect(run.strays, 'a crash dialog this test did not make').toEqual([]);
}
/** the city the App is in once it has finished entering one, on a host other than `before` */
async function entered(app: AppView, before: Host | null): Promise<Host> {
  await until(() => {
    expect(app.city?.entered).toBe(true);
    expect(app.city!.host).not.toBe(before);
  });
  return app.city!.host;
}
/** the App returned to its region screen, with no city and no loading screen left */
async function backOnTheRegion(app: AppView): Promise<void> {
  await until(() => {
    expect(liveRegions()).toHaveLength(1);
    expect(app.root.querySelectorAll('.loading')).toHaveLength(0);
  });
}
/** FNV-1a of a snapshot's payload */
function checksum(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 16777619);
  return h >>> 0;
}
type Choice = 'restart' | 'recover' | 'local';
/** W1.3's Desktop QA crash: an invalid tick is a fatal in the worker. The crash dialog answers `choice`. */
function crash(host: Host, choice: Choice | ((o: { cityName: string; message: string; recoverable: boolean }) => Promise<Choice>)): void {
  if (typeof choice === 'function') ui.crash.mockImplementationOnce(choice);
  else ui.crash.mockResolvedValueOnce(choice);
  host.link.post({ t: 'tick', seq: 0, dt: -1, ack: 0 });
}
/** NOTE-092: what the region says after a Recover that restored nothing and left the copy stored */
const NOT_RECOVERED = {
  full: 'Crashville was not recovered: your browser\'s storage for Metropolis is full. Its recovery copy is kept. Free some browser storage, then play the city to recover it.',
  unread: 'Crashville was not recovered: its recovery copy could not be read. The copy is kept. Free some browser storage, then play the city to try again.',
  otherTab: 'Crashville was not recovered: this region is now open in another tab. Its recovery copy is kept.',
};
/** the App is back on its region screen and has said `text` there, once, after the loading screen went */
async function noticed(app: AppView, text: string): Promise<void> {
  const shown: { regions: number; loading: number }[] = [];
  ui.toast.mockImplementation(() => { shown.push({ regions: liveRegions().length, loading: app.root.querySelectorAll('.loading').length }); });
  await backOnTheRegion(app);
  // (it follows the loading screen's removal in the same task: a short wait, so a missing notice fails at once)
  await vi.waitFor(() => expect(ui.toast).toHaveBeenCalled(), { timeout: 10000, interval: 10 });
  expect(ui.toast.mock.calls).toEqual([[text, 'bad', 9000]]);
  expect(shown, 'over the region screen, not the loading screen').toEqual([{ regions: 1, loading: 0 }]);
}
const clickButton = (app: AppView, label: string) => app.root.querySelectorAll('button').find((b) => textOf(b) === label)!.click();
/** a key press on the page's window, as the browser dispatches it */
function key(type: 'keydown' | 'keyup', char: string, code: string): Event {
  const e = Object.assign(new Event(type, { cancelable: true }), { key: char, code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false });
  window.dispatchEvent(e);
  return e;
}

/**
 * A stored region with one saved city, and the App on `?simworker=1`, in that city through the title's Continue: a
 * worker host on the worker's own IndexedDB (persistence 'worker-idb').
 */
async function boot() {
  const db = await import('../../src/save/db');
  const fx = await import('../save/fixtures');
  const save = await import('../../src/save');
  const { summarizeCity } = await import('../../src/region/citySummary');
  const { newState } = await import('../infra/cityGen');
  const kv = new fx.PersistentMemoryKV();
  db.setKV(kv);
  const st = newState(64);
  st.config.name = CITY; st.funds = 1_000_000;
  const region = fx.regionData(REGION);
  region.tiles[0].city = summarizeCity(st);
  await kv.put('regions', region);
  const record = save.createCityRecord(REGION, TILE, st);
  record.savedAt = record.city.savedAt = 1000; // older than every snapshot the worker's clock stamps
  await kv.put('cities', record, record.key);
  save.setLastSession({ regionId: REGION, tileKey: TILE });
  /** every init the App posted: one per worker boot, `replay: false` when it boots the save without its journal */
  const inits: WorkerInit[] = [];
  run.spawn = () => {
    const port = nodeWorkerPort(workerUrl, { kv });
    run.ports.push(port);
    return { ...port, postMessage(m: WorkerInput) { if (m.t === 'init') inits.push(m); port.postMessage(m); } };
  };
  await import('../../src/main');
  const app = (window as unknown as { __metropolis: AppView }).__metropolis;
  await vi.waitFor(() => expect(ui.titles).toHaveLength(1), long);
  ui.titles[0].o.onContinue!();
  const first = await entered(app, null);
  expect(first.kind).toBe('worker');
  expect(inits).toHaveLength(1);
  expect(inits[0]).toMatchObject({ city: { kind: 'idb', regionId: REGION, tileKey: TILE }, persistence: 'worker-idb' });
  const snapshotRecord = () => kv.get<{ marker: RecoveryMarker; payload: Uint8Array }>('recovery', KEY);
  /** the city's recovery records and its save, as the store holds them (the snapshot's payload as its size and a
   *  checksum: a failed comparison prints two numbers, not 230 KB) */
  const stored = async () => {
    const snapshot = await snapshotRecord();
    return {
      snapshot: snapshot ? { marker: snapshot.marker, bytes: snapshot.payload.length, sum: checksum(snapshot.payload) } : null,
      journal: (await kv.get<RecoveryJournal>('recovery', JOURNAL)) ?? null,
      savedAt: (await save.getCityRecord(kv, REGION, TILE))!.savedAt,
    };
  };
  /** the stored save's budget */
  const saved = async () => save.deserializeCity((await save.getCityRecord(kv, REGION, TILE))!.city).budget;
  /** a session's unsaved progress: a tax edit, a worker snapshot that holds it, then a funding edit in the journal
   *  bound to that snapshot (the page's mirror wrote both journals into this store) */
  const playWithSnapshot = async (host: Host) => {
    await send(host, 'setTax', [DevType.R1, 14]);
    const snap = (await host.snapshot('hidden'))!;
    expect(snap).toMatchObject({ ok: true, idb: true });
    expect(await stored()).toMatchObject({
      snapshot: { marker: { regionId: REGION, tileKey: TILE, at: snap.marker.at, baseSavedAt: 1000 } },
      journal: { base: { kind: 'snapshot', at: snap.marker.at, baseSavedAt: 1000 }, ops: [] },
    });
    await send(host, 'setFunding', ['fire', 125]);
  };
  /** from now on the store is full for `full(store)`'s writes (the worker's own reach it through the bridge) */
  const fill = (full: (store: StoreName) => boolean) => {
    const put = kv.put.bind(kv);
    return vi.spyOn(kv, 'put').mockImplementation(async (store: StoreName, value: unknown, key?: string) => {
      if (full(store)) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return put(store, value, key);
    });
  };
  return { app, db, kv, first, inits, stored, snapshotRecord, saved, playWithSnapshot, fill };
}

describe('the crash dialog\'s Restart and Continue on the main thread discard the crashed session (T089 a)', () => {
  it('crash after a worker snapshot, Restart, an edit, crash again, Recover: the save plus the new edit, never the old snapshot', async () => {
    const { app, first, inits, stored, saved, playWithSnapshot } = await boot();
    await playWithSnapshot(first);

    crash(first, 'restart');
    const second = await entered(app, first);
    expect(ui.crash).toHaveBeenLastCalledWith({ cityName: CITY, message: 'Invalid tick', recoverable: true });
    // the save as it is, on a new worker, and nothing of the crashed session is left to offer
    expect(second.kind).toBe('worker');
    expect(inits).toHaveLength(2);
    expect(inits[1].replay).toBe(false);
    expect(second.state.budget.taxRates[DevType.R1]).toBe(TAX);
    expect(second.state.budget.funding.fire).toBe(FUNDING);
    expect(await stored()).toEqual({ snapshot: null, journal: null, savedAt: 1000 });
    expect(slot()).toBeNull();

    // the new session's own edit, and a second crash before any snapshot of it
    await send(second, 'setTax', [DevType.R2, 11]);
    crash(second, 'recover');
    const third = await entered(app, second);
    expect(ui.crash).toHaveBeenLastCalledWith({ cityName: CITY, message: 'Invalid tick', recoverable: true });
    expect(inits).toHaveLength(3);
    expect(inits[2].replay).toBeUndefined();
    expect(third.state.budget.taxRates[DevType.R2], 'the new edit').toBe(11);
    expect(third.state.budget.taxRates[DevType.R1], 'not the first session\'s snapshot').toBe(TAX);
    expect(third.state.budget.funding.fire, 'nor its journal').toBe(FUNDING);
    // the worker saved the replayed edit before its Ready, which deleted the journal
    const budget = await saved();
    expect([budget.taxRates[DevType.R1], budget.taxRates[DevType.R2], budget.funding.fire]).toEqual([TAX, 11, FUNDING]);
    expect(await stored()).toMatchObject({ snapshot: null, journal: null });
    expect(third.changes).toBe(0);
    expect(ui.recover, 'the crash dialog was the question: no second one').not.toHaveBeenCalled();
    expect(run.logged).toEqual([CRASHED, CRASHED]);
  }, TEST_MS);

  it('Continue on the main thread discards it too, and runs the save on a local host', async () => {
    const { app, first, inits, stored, playWithSnapshot } = await boot();
    await playWithSnapshot(first);

    crash(first, 'local');
    const local = await entered(app, first);
    expect(local.kind).toBe('local');
    expect(inits, 'no second worker').toHaveLength(1);
    expect(run.scenes.at(-1)!.opts.replayJournal).toBe(false);
    expect(local.state.budget.taxRates[DevType.R1]).toBe(TAX);
    expect(local.state.budget.funding.fire).toBe(FUNDING);
    expect(await stored()).toEqual({ snapshot: null, journal: null, savedAt: 1000 });
    expect(slot()).toBeNull();
    expect(run.logged).toEqual([CRASHED]);
  }, TEST_MS);
});

describe('a Recover that does not restore (T089 b, W1.3 decision 20)', () => {
  it('a restore that fails on quota opens no city: the snapshot and its journal stay, and a retry from the region brings both back', async () => {
    const { app, first, inits, stored, playWithSnapshot, fill } = await boot();
    await playWithSnapshot(first);
    // the store fills up: the restored city cannot be written
    const full = fill((store) => store === 'cities');
    let kept!: Awaited<ReturnType<typeof stored>>;
    crash(first, async () => { kept = await stored(); return 'recover'; });
    await noticed(app, NOT_RECOVERED.full);

    // back on the region screen with the guided dialog; the city did not boot again, so nothing replaced the copy
    expect(app.city).toBeNull();
    expect(app.root.querySelectorAll('.city-host')).toHaveLength(0);
    expect(inits, 'no boot after the failed restore').toHaveLength(1);
    expect(textOf(app.root.querySelector('.storage-dialog')!)).toContain('Storage full');
    expect(kept.journal).toMatchObject({ base: { kind: 'snapshot', at: kept.snapshot!.marker.at, baseSavedAt: 1000 }, ops: [{ op: 'setFunding', args: ['fire', 125] }] });
    expect(await stored()).toEqual(kept);

    // space is freed: the dialog's Retry asks again, and Recover restores the snapshot
    full.mockRestore();
    ui.recover.mockResolvedValue('recover');
    clickButton(app, 'Retry');
    await vi.waitFor(() => expect(ui.toast).toHaveBeenCalledWith(expect.stringMatching(/^Recovered Crashville/), 'good', 3500), long);
    expect(ui.recover).toHaveBeenLastCalledWith(expect.objectContaining({ regionId: REGION, tileKey: TILE, at: kept.snapshot!.marker.at }));
    const restored = await stored();
    expect(restored.savedAt).toBeGreaterThan(1000);
    expect(restored.snapshot).toBeNull();
    expect(restored.journal, 'its journal moved to the restored save').toMatchObject({ base: { kind: 'save', savedAt: restored.savedAt }, ops: [{ op: 'setFunding' }] });

    // Play: the journal is the question now, and the worker replays it onto the restored snapshot
    liveRegions()[0].cb.onPlay(app.region!.tileByKey(TILE)!);
    const again = await entered(app, first);
    expect(ui.recover).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'journal', baseSavedAt: restored.savedAt }));
    expect(inits).toHaveLength(2);
    expect(inits[1].replay).toBeUndefined();
    expect(again.state.budget.taxRates[DevType.R1], 'from the snapshot').toBe(14);
    expect(again.state.budget.funding.fire, 'from its journal').toBe(125);
    expect(run.logged).toEqual([CRASHED, '[main] recovery failed The quota has been exceeded.']);
  }, TEST_MS);

  it('storage full: the region says so and that the copy is kept, and the tile\'s Play recovers it once space is freed', async () => {
    const { app, first, inits, stored, saved, playWithSnapshot, fill } = await boot();
    await playWithSnapshot(first);
    const full = fill((store) => store === 'cities');
    let kept!: Awaited<ReturnType<typeof stored>>;
    crash(first, async () => { kept = await stored(); return 'recover'; });
    await noticed(app, NOT_RECOVERED.full);

    // the region screen, on the city's tile; T036s4's dialog names the cause too, with its ways to free space
    expect(app.city).toBeNull();
    expect(inits, 'no boot after the failed restore').toHaveLength(1);
    expect(liveRegions()[0].selected).toBe(TILE);
    const dialog = app.root.querySelector('.storage-dialog')!;
    expect(textOf(dialog.querySelector('h2')!)).toBe('Storage full');
    expect(dialog.querySelectorAll('button').map((b) => textOf(b))).toEqual(['Export', 'Manage storage', 'Retry', 'Close']);
    // the copy is still stored: the snapshot, and the journal bound to it
    expect(kept.snapshot).not.toBeNull();
    expect(kept.journal).toMatchObject({ base: { kind: 'snapshot', at: kept.snapshot!.marker.at }, ops: [{ op: 'setFunding', args: ['fire', 125] }] });
    expect(await stored()).toEqual(kept);

    // the player closes the dialog and frees space: the tile's Play asks about the copy, and Recover restores it
    clickButton(app, 'Close');
    expect(app.root.querySelector('.storage-dialog')).toBeNull();
    full.mockRestore();
    ui.recover.mockResolvedValue('recover');
    liveRegions()[0].cb.onPlay(app.region!.tileByKey(TILE)!);
    const again = await entered(app, first);
    expect(ui.recover).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ regionId: REGION, tileKey: TILE, at: kept.snapshot!.marker.at, baseSavedAt: 1000 }));
    expect(ui.toast).toHaveBeenLastCalledWith(expect.stringMatching(/^Recovered Crashville/), 'good', 3500);
    // one question: the worker replayed the journal that the restore bound to the new save, and saved before its Ready
    expect(inits).toHaveLength(2);
    expect(inits[1].replay).toBeUndefined();
    expect(again.state.budget.taxRates[DevType.R1], 'from the snapshot').toBe(14);
    expect(again.state.budget.funding.fire, 'from its journal').toBe(125);
    const budget = await saved();
    expect([budget.taxRates[DevType.R1], budget.funding.fire]).toEqual([14, 125]);
    expect(await stored()).toMatchObject({ snapshot: null, journal: null });
    expect(again.changes).toBe(0);
    expect(run.logged).toEqual([CRASHED, '[main] recovery failed The quota has been exceeded.']);
  }, TEST_MS);

  it('a region taken over by another tab while the dialog was open: nothing is recovered here, the region says why, and the copy stays', async () => {
    const { app, db, first, inits, stored, playWithSnapshot } = await boot();
    await playWithSnapshot(first);
    const other = new db.RegionSaveLock(REGION, false);
    let kept!: Awaited<ReturnType<typeof stored>>;
    crash(first, async () => {
      kept = await stored();
      // "Use it here instead" in another tab, while this one shows the crash dialog
      await other.acquire(true);
      return 'recover';
    });
    await noticed(app, NOT_RECOVERED.otherTab);

    expect(other.writable).toBe(true);
    expect(app.city).toBeNull();
    expect(inits, 'no boot').toHaveLength(1);
    expect(app.root.querySelector('.storage-dialog'), 'not a storage failure').toBeNull();
    expect(textOf(app.root.querySelector('.storage-lock-notice')!.querySelector('span')!)).toBe('This region is now open in another tab');
    expect(kept.snapshot).not.toBeNull();
    expect(await stored()).toEqual(kept);
    expect(run.logged).toEqual([CRASHED, '[main] recovery failed This region is open in another tab']);
    other.dispose();
  }, TEST_MS);

  it('a snapshot that cannot be restored is reported and deleted, and the save boots without a replay', async () => {
    const { app, kv, first, inits, stored, snapshotRecord, playWithSnapshot } = await boot();
    await playWithSnapshot(first);
    crash(first, async () => {
      // the stored payload is cut short: nothing can be rebuilt from it
      const snapshot = (await snapshotRecord())!;
      await kv.put('recovery', { marker: snapshot.marker, payload: snapshot.payload.slice(0, 24) }, KEY);
      return 'recover';
    });
    const second = await entered(app, first);
    expect(ui.toast).toHaveBeenCalledWith(expect.stringMatching(/^The snapshot of Crashville could not be restored\. Your last save/), 'bad', 6000);
    expect(inits).toHaveLength(2);
    expect(inits[1].replay).toBe(false);
    expect(second.state.budget.taxRates[DevType.R1]).toBe(TAX);
    expect(second.state.budget.funding.fire).toBe(FUNDING);
    expect(await stored()).toEqual({ snapshot: null, journal: null, savedAt: 1000 });
    expect(liveRegions()).toHaveLength(0);
    expect(run.logged).toEqual([CRASHED, expect.stringMatching(/^\[main\] recovery failed /)]);
  }, TEST_MS);

  it('a recovery copy that cannot be read keeps the city closed: the journal in localStorage is offered once the store takes it', async () => {
    const { app, first, inits, stored, fill } = await boot();
    // the store takes no recovery record: the crash's journal lands in localStorage alone
    const full = fill((store) => store === 'recovery');
    await send(first, 'setTax', [DevType.R1, 14]);
    crash(first, 'recover');
    await noticed(app, NOT_RECOVERED.unread);

    expect(ui.crash).toHaveBeenLastCalledWith({ cityName: CITY, message: 'Invalid tick', recoverable: true });
    expect(app.city).toBeNull();
    expect(inits, 'no boot over the copy').toHaveLength(1);
    expect(liveRegions()[0].selected).toBe(TILE);
    expect(await stored()).toEqual({ snapshot: null, journal: null, savedAt: 1000 });
    expect(JSON.parse(slot()!)).toMatchObject({ kind: 'journal', regionId: REGION, tileKey: TILE, why: 'crash' });
    expect(JSON.parse(localStorage.getItem('metropolis.recovery.journal')!)).toMatchObject({ base: { kind: 'save', savedAt: 1000 }, ops: [{ op: 'setTax', args: [DevType.R1, 14] }] });

    // the store works again: Play asks about the journal, and the worker replays it
    full.mockRestore();
    ui.recover.mockResolvedValue('recover');
    liveRegions()[0].cb.onPlay(app.region!.tileByKey(TILE)!);
    const again = await entered(app, first);
    expect(ui.recover).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind: 'journal', baseSavedAt: 1000 }));
    expect(inits).toHaveLength(2);
    expect(inits[1].replay).toBeUndefined();
    expect(again.state.budget.taxRates[DevType.R1]).toBe(14);
    expect(slot()).toBeNull();
    expect(run.logged).toEqual([CRASHED]);
  }, TEST_MS);
});

describe('the real crash dialog over the crashed city: no key deletes the recovery copy (T089, NOTE-092)', () => {
  it('Space chooses nothing and the copy stays; Enter is Recover, and the session comes back', async () => {
    // the real Modal for this test, and the real dialog through the mock that stands for it
    vi.doMock('../../src/region/ui/modal', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../src/region/ui/modal')>()), toast: ui.toast }));
    vi.stubGlobal('HTMLTextAreaElement', class {});
    const { app, first, inits, stored, saved, playWithSnapshot } = await boot();
    const { openSimCrashDialog } = await vi.importActual<typeof import('../../src/region/ui/dialogs')>('../../src/region/ui/dialogs');
    await playWithSnapshot(first);
    crash(first, openSimCrashDialog);
    const dialog = () => app.root.querySelectorAll('.modal-top');
    await until(() => expect(dialog()).toHaveLength(1));
    expect(dialog()[0].querySelector('.modal-foot')!.querySelectorAll('button').map((b) => textOf(b))).toEqual(['Continue on the main thread', 'Restart from autosave', 'Recover unsaved progress']);
    const kept = await stored();
    expect(kept.snapshot).not.toBeNull();
    expect(kept.journal).toMatchObject({ base: { kind: 'snapshot', at: kept.snapshot!.marker.at }, ops: [{ op: 'setFunding', args: ['fire', 125] }] });

    // Space, the pause key, down and up: the browser gets no default action, and the App no choice
    expect([key('keydown', ' ', 'Space').defaultPrevented, key('keyup', ' ', 'Space').defaultPrevented]).toEqual([true, true]);
    await new Promise((resolve) => realTimers.setTimeout(resolve, 300));
    expect(dialog(), 'the dialog is still the question').toHaveLength(1);
    expect(app.city?.host, 'the crashed city is still under it').toBe(first);
    expect(app.root.querySelectorAll('.loading')).toHaveLength(0);
    expect(inits).toHaveLength(1);
    expect(await stored()).toEqual(kept);

    // Enter is the default button, Recover: the snapshot is restored, and the worker replays its journal
    expect(key('keydown', 'Enter', 'Enter').defaultPrevented).toBe(true);
    const second = await entered(app, first);
    expect(ui.toast).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^Recovered Crashville/), 'good', 3500);
    expect(inits).toHaveLength(2);
    expect(inits[1].replay).toBeUndefined();
    expect(second.state.budget.taxRates[DevType.R1], 'from the snapshot').toBe(14);
    expect(second.state.budget.funding.fire, 'from its journal').toBe(125);
    const budget = await saved();
    expect([budget.taxRates[DevType.R1], budget.funding.fire]).toEqual([14, 125]);
    expect(await stored()).toMatchObject({ snapshot: null, journal: null });
    expect(ui.recover, 'the crash dialog was the question: no second one').not.toHaveBeenCalled();
    expect(run.logged).toEqual([CRASHED]);
  }, TEST_MS);
});
