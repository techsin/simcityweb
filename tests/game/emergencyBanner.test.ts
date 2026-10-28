/**
 * The emergency banner itself (src/ui/EmergencyBanner.ts) on a real simulation, with a minimal DOM stand-in (no DOM
 * library in this project): the final-fix items of the emergency lane —
 *  F2  a second uncovered major call of the same kind within the 15-day cooldown still gets its banner and LIVE mode;
 *  P1  an industrial accident whose ambulance went automatically keeps its banner and LIVE mode (no "Emergencies
 *      handled" toast) until a fire truck is sent, and every vehicle is named by its own kind;
 *  P2  a fire that failed shows its outcome, no countdown, no urgency;
 *  P6  a loaded game (the banner is built before the sim systems load) gets the banner and the urgent pause back;
 *  P9  the banner stack docks beside open panels (dockBanners).
 * Final-fix round 2:
 *  EM-1 a prompt whose unit a burst's later incident took raises no banner, LIVE mode or urgent pause; the urgent pause
 *       ends once nothing can be sent;
 *  EM-2 no place over a panel's title or tabs, even when no gap is free beside the panels (dockBanners);
 *  EM-4 the Send button's and the pill's texts change in place (a click spanning the update is not lost);
 *  EM-5 "3.0 min left to send a truck" (industrial, never "too far?"); "No fire truck could reach it in time" when
 *       nobody was ever sent.
 * Final-fix round 4:
 *  U1   the stack ends above an open toolbar flyout (watched: class and size) and does not re-dock while one of its
 *       banners is pressed (the press may close the flyout: the click must still land).
 * Close-out c1:
 *  a press that lands just after the stack moved under the pointer (opening a flyout re-docked it to compact rows) is
 *  ignored instead of reaching the banner that moved there (SETTLE_MS from the move's first frame on screen); the
 *  tallest tab seen since the flyout opened bounds the stack (no re-dock with every tab switch).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Network } from '../../src/core/types';
import { Emitter } from '../../src/core/events';
import { LIVE_COOLDOWN_MS, pendingCount, sendDays } from '../../src/game/emergencyPolicy';
import { LivePolicy } from '../../src/worker/SimCore';
import { queryHost } from './queryHost';
import type { Command } from '../../src/worker/SimHost';
import type { CityState } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { emergencyOf } from '../../src/sim/infra/emergency';
import { getFire, infraSystems, triggerDisaster } from '../../src/sim/systems/infra';
import { deserializeCity, serializeCity, type SerializedCity } from '../../src/save/serialize';
import {
  BANNER_MIN_W, BANNER_W, EmergencyBanner, KIND_COOLDOWN, MAX_BANNERS, PANEL_HEAD_H, SETTLE_MS, STACK_TOP, TOOLBAR_GAP, dockBanners, fitRows, stateText,
  supportText,
  type DockPlace,
} from '../../src/ui/EmergencyBanner';
import type { GameContext, UIEvents } from '../../src/game/context';
import { newSim, newState, place, roadLine } from '../infra/cityGen';

// ------------------------------------------------------------------------------------------------ minimal DOM
class FakeNode {
  parentElement: FakeEl | null = null;
  childNodes: FakeNode[] = [];
  protected text = '';
  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null;
  }
  get textContent(): string {
    return this.text + this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(v: string) {
    this.childNodes = [];
    this.text = v;
  }
  remove(): void {
    const p = this.parentElement;
    if (!p) return;
    const i = p.childNodes.indexOf(this);
    if (i >= 0) p.childNodes.splice(i, 1);
    this.parentElement = null;
  }
}
class FakeEl extends FakeNode {
  className = '';
  style: Record<string, unknown> & { setProperty(k: string, v: string): void } = { setProperty(k: string, v: string) { this[k] = v; } };
  dataset: Record<string, string> = {};
  disabled = false;
  title = '';
  offsetLeft = 0;
  offsetTop = 70;
  offsetWidth = 440;
  offsetHeight = 0;
  clientWidth = 1600;
  clientHeight = 0;
  private html = '';
  private listeners = new Map<string, ((e: unknown) => void)[]>();
  constructor(readonly tagName: string) {
    super();
  }
  get classList() {
    const get = () => new Set(this.className.split(/\s+/).filter(Boolean));
    const put = (s: Set<string>) => { this.className = [...s].join(' '); };
    return {
      contains: (c: string) => get().has(c),
      add: (...cs: string[]) => { const s = get(); for (const c of cs) s.add(c); put(s); },
      remove: (...cs: string[]) => { const s = get(); for (const c of cs) s.delete(c); put(s); },
      toggle: (c: string, on?: boolean) => { const s = get(); const v = on ?? !s.has(c); if (v) s.add(c); else s.delete(c); put(s); return v; },
    };
  }
  get innerHTML(): string {
    return this.html;
  }
  set innerHTML(v: string) {
    this.childNodes = [];
    this.text = '';
    this.html = v;
  }
  override get textContent(): string {
    return super.textContent + this.html.replace(/<[^>]*>/g, '');
  }
  override set textContent(v: string) {
    this.html = '';
    super.textContent = v;
  }
  setAttribute(k: string, v: string): void {
    (this as unknown as Record<string, string>)[k] = v;
  }
  addEventListener(t: string, f: (e: unknown) => void, opts?: boolean | AddEventListenerOptions): void {
    const signal = typeof opts === 'object' ? opts.signal : undefined;
    if (signal?.aborted) return;
    this.listeners.set(t, [...(this.listeners.get(t) ?? []), f]);
    signal?.addEventListener('abort', () => this.listeners.set(t, (this.listeners.get(t) ?? []).filter((fn) => fn !== f)), { once: true });
  }
  click(): void {
    for (const f of this.listeners.get('click') ?? []) f({});
  }
  /** an event of another type (its listeners, as click() does) */
  fire(t: string): void {
    for (const f of this.listeners.get(t) ?? []) f({});
  }
  appendChild<T extends FakeNode>(c: T): T {
    c.remove();
    c.parentElement = this;
    this.childNodes.push(c);
    return c;
  }
  insertBefore<T extends FakeNode>(c: T, ref: FakeNode | null): T {
    c.remove();
    c.parentElement = this;
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(c);
    else this.childNodes.splice(i, 0, c);
    return c;
  }
  removeChild<T extends FakeNode>(c: T): T {
    c.remove();
    return c;
  }
  /** all descendant elements */
  all(): FakeEl[] {
    const out: FakeEl[] = [];
    for (const c of this.childNodes) if (c instanceof FakeEl) out.push(c, ...c.all());
    return out;
  }
  querySelectorAll(): FakeEl[] {
    return [];
  }
  /** "button, .emg-more" (tags / .classes, comma separated): the nearest match up the tree */
  closest(sel: string): FakeEl | null {
    const alts = sel.split(',').map((a) => a.trim());
    for (let e: FakeEl | null = this; e; e = e.parentElement) {
      const el = e;
      if (alts.some((a) => (a.startsWith('.') ? el.classList.contains(a.slice(1)) : el.tagName.toLowerCase() === a))) return el;
    }
    return null;
  }
  contains(n: FakeNode | null): boolean {
    for (let e: FakeNode | null = n; e; e = e.parentElement) if (e === this) return true;
    return false;
  }
}
const g = globalThis as unknown as { document?: unknown };
let hadDoc: unknown;
beforeAll(() => {
  hadDoc = g.document;
  g.document = { createElement: (t: string) => new FakeEl(t), createTextNode: (s: string) => { const n = new FakeNode(); n.textContent = s; return n; } };
});
afterAll(() => {
  g.document = hadDoc;
});

// ------------------------------------------------------------------------------------------------ harness
interface Harness { banner: EmergencyBanner; policy: LivePolicy; sim: Simulation; root: FakeEl; toasts: string[]; abort: AbortController; tick(): void }
const lifetimes: AbortController[] = [];
afterEach(() => { for (const ac of lifetimes.splice(0)) ac.abort('dispose'); vi.restoreAllMocks(); });
function harness(sim: Simulation): Harness {
  const root = new FakeEl('div');
  const toasts: string[] = [];
  const ui = new Emitter<UIEvents>();
  const abort = new AbortController();
  lifetimes.push(abort);
  const policy = new LivePolicy(sim, abort.signal);
  policy.attach();
  const ctx = {
    get state() { return sim.state; },
    sim,
    host: {
      ...queryHost(sim),
      setSpeed: (speed: number) => { sim.speed = speed; },
      policy: policy.view,
      simTime: () => sim.simTime(),
      act: (op: Command['op'], args: Command['args']) => {
        const cmd = { op, args } as Command;
        const predicted = cmd.op === 'dispatchBest' ? emergencyOf(sim)!.dispatchBest(sim, ...cmd.args) : undefined;
        if (cmd.op === 'setSettings') policy.setSettings(cmd.args[0]);
        if (cmd.op === 'dismissAlert') policy.dismiss(cmd.args[0]);
        if (cmd.op === 'dispatchBest') policy.apply();
        return { seq: 1, exact: true, predicted, done: Promise.resolve(predicted) };
      },
    },
    root,
    settings: { emergencyUncovered: 'live', emergencyAlerts: 'major', emergencyLiveSlowmo: 3 },
    ui,
    signal: abort.signal,
    panels: { open: () => undefined },
    sound: () => undefined,
    toast: (t: string) => { toasts.push(t); },
    focusCell: () => undefined,
    showQuery: () => undefined,
  } as unknown as GameContext;
  const banner = new EmergencyBanner(ctx, root as unknown as HTMLElement);
  return { banner, policy, sim, root, toasts, abort, tick: () => { policy.tick(); ui.emit('uiTick', undefined); } };
}
/** the banner elements of an incident (title, time, note, sub, buttons) */
function parts(h: Harness, id: number): { el: FakeEl; title: string; time: string; note: string; sub: FakeEl; send: FakeEl; choose: FakeEl } {
  const b = (h.banner as unknown as { banners: Map<number, Record<string, FakeEl>> }).banners.get(id);
  expect(b, `banner for incident ${id}`).toBeDefined();
  return { el: b!.el, title: b!.title.textContent, time: b!.time.textContent, note: b!.note.textContent, sub: b!.sub, send: b!.send, choose: b!.choose };
}
const shown = (e: FakeEl) => e.style.display !== 'none';

/** a street along z = 20 with homes at x = 50 / 52 and four far clinics (4.0-4.8 min > their 2.3-min reach): a major
 *  call needs two ambulances */
function medTown(): { st: CityState; sim: Simulation } {
  const st = newState(64);
  roadLine(st, 2, 20, 62, 20, Network.Road);
  for (const x of [4, 6, 8, 10]) place(st, 't_clinic', x, 19);
  for (const x of [50, 52]) place(st, 't_r2', x, 21, { pop: 60 });
  const sim = newSim(st);
  getFire(sim)!.riskBoost = 0;
  st.stats.population = 5000;
  return { st, sim };
}

describe('EmergencyBanner on a live simulation', () => {
  it('W0.4: renders host policy feedback once and forwards settings and dismissal commands until the city aborts', async () => {
    const { st, sim } = medTown();
    const h = harness(sim);
    const ctx = (h.banner as unknown as { ctx: GameContext }).ctx;
    const act = vi.spyOn(ctx.host, 'act'), speed = vi.spyOn(ctx.host, 'setSpeed');
    const warning = vi.fn();
    ctx.sound = warning;
    sim.speed = 3;
    const id = emergencyOf(sim)!.spawn(sim, 'medical', 50, 21, { buildingId: st.buildingAt(50, 21)!.id, major: true, severity: 4 });
    await Promise.resolve(); // no UI tick: the owner's view publishes the settled burst
    expect(h.banner.bannerIds).toContain(id);
    expect(h.root.classList.contains('emg-live')).toBe(true);
    for (let k = 0; k < 3; k++) h.tick();
    expect(warning.mock.calls.filter(([name]) => name === 'warning')).toHaveLength(1);
    ctx.settings.emergencyLiveSlowmo = 5;
    ctx.ui.emit('settings', ctx.settings);
    expect(act).toHaveBeenLastCalledWith('setSettings', [{ emergencyUncovered: 'live', emergencyAlerts: 'major', emergencyLiveSlowmo: 5 }], { tag: h.banner });
    expect(sim.liveSlowdown).toBe(5);
    parts(h, id).el.all().find((e) => e.classList.contains('emg-x'))!.click();
    expect(act).toHaveBeenLastCalledWith('dismissAlert', [id], { tag: h.banner });
    expect(h.banner.bannerIds).toEqual([]);
    expect(h.root.classList.contains('emg-live')).toBe(false);
    expect(h.toasts.filter((t) => t.startsWith('Emergency over'))).toHaveLength(1);
    h.tick(); h.tick();
    expect(h.toasts.filter((t) => t.startsWith('Emergency over'))).toHaveLength(1);
    expect(speed).not.toHaveBeenCalled(); // speed and both slowdown writers now live in the core
    const count = act.mock.calls.length;
    h.abort.abort('dispose');
    ctx.ui.emit('settings', ctx.settings);
    expect(act).toHaveBeenCalledTimes(count);
    act.mockRestore(); speed.mockRestore();
  });

  it('F2: a second uncovered major call of the same kind 7 days later still gets a banner and LIVE mode', () => {
    let now = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { st, sim } = medTown();
    const h = harness(sim);
    const em = emergencyOf(sim)!;
    sim.speed = 3;
    h.tick();
    const a = em.spawn(sim, 'medical', 50, 21, { buildingId: st.buildingAt(50, 21)!.id, major: true, severity: 4 });
    expect(em.incident(a)!.state).toBe('uncovered');
    expect(em.incident(a)!.manualPossible).toBe(true);
    // (the banner takes 'uncovered' events up once the dispatch call is over: a microtask, or the next UI tick — EM-1)
    h.tick();
    expect(h.banner.bannerIds).toEqual([a]);
    expect(sim.speed).toBe(1);
    expect(h.banner.liveActive).toBe(true);
    // the player answers it; once the ambulance has been on scene a while the speed comes back
    expect(em.dispatchBest(sim, a).ok).toBe(true);
    for (let d = 0; d < 7; d++) { sim.runDays(1); h.tick(); }
    expect(h.banner.liveActive).toBe(false);
    expect(sim.speed).toBe(3);
    expect(h.toasts.some((t) => /back to ultra speed/.test(t))).toBe(true);
    now += LIVE_COOLDOWN_MS; // T029: the real-time speed cooldown has ended; the per-kind game-day limit has not.
    // 7 days after the first (inside the 15-day cooldown per kind): a second uncovered major medical call
    expect(7).toBeLessThan(KIND_COOLDOWN);
    const b = em.spawn(sim, 'medical', 52, 21, { buildingId: st.buildingAt(52, 21)!.id, major: true, severity: 4 });
    const inc = em.incident(b)!;
    expect(inc.state).toBe('uncovered');
    expect(inc.manualPossible).toBe(true);
    // EM-1: the prompt counts (an ignored one if nobody answers) from the day's settle point on, not from the decision
    expect(inc.prompted).toBeFalsy();
    h.tick();
    expect(h.banner.bannerIds).toContain(b);
    expect(sim.speed).toBe(1);
    expect(h.banner.liveActive).toBe(true);
    sim.runDays(1);
    expect(inc.prompted).toBe(true);
  });

  it('P1: an industrial accident whose ambulance went automatically keeps its banner and LIVE until a fire truck is sent', async () => {
    const st = newState(64);
    roadLine(st, 2, 20, 62, 20, Network.Road);
    place(st, 't_fire', 4, 19);
    place(st, 't_clinic', 48, 19);
    const f = place(st, 't_id', 50, 21, { jobs: 40 });
    const sim = newSim(st);
    getFire(sim)!.riskBoost = 0;
    st.stats.population = 5000;
    const h = harness(sim);
    const em = emergencyOf(sim)!;
    sim.speed = 3;
    h.tick();
    const id = em.spawn(sim, 'industrial', f.x, f.z, { buildingId: f.id });
    h.tick();
    expect(h.banner.bannerIds).toEqual([id]);
    expect(h.banner.liveActive).toBe(true);
    // 3 minutes to the ignition are under 8 s at live speed: the urgent pause (critic item 27) until the player acts
    expect(sim.speed).toBe(0);
    let p = parts(h, id);
    expect(p.note).toMatch(/Outside fire coverage — nearest free fire truck: Fire #1/);
    // the window is the ignition 3 minutes away (not the 12-minute deadline)
    expect(p.time).toMatch(/3\.0 min left/);
    expect(shown(p.sub)).toBe(true);
    expect(p.sub.textContent).toMatch(/^Ambulance from Clinic #1 on the way .* — no fire truck yet: dispatch one$/);
    // a day later the ambulance is on scene: still waiting, still LIVE, no "Emergencies handled" toast
    sim.runDays(1);
    h.tick();
    p = parts(h, id);
    expect(em.incident(id)!.state).toBe('uncovered');
    expect(p.sub.textContent).toBe('Ambulance from Clinic #1 on scene — no fire truck yet: dispatch one');
    expect(p.time).toMatch(/2\.0 min left/);
    expect(h.banner.liveActive).toBe(true);
    expect(sim.speed).toBe(0);
    expect(h.toasts.filter((t) => /Emergenc/.test(t))).toEqual([]);
    // "Send nearest" sends the fire truck and names it
    p.send.click();
    await Promise.resolve(); // dispatch feedback follows the command acknowledgement
    expect(h.toasts.at(-1)).toMatch(/^Fire truck dispatched — ETA 4\.6 min$/);
    const inc = em.incident(id)!;
    expect(inc.state).toBe('dispatched');
    expect(stateText(inc, sim.simTime(), em)).toMatch(/^Fire truck from Fire #1 on the way — arrives in 4\.6 min$/);
    expect(supportText(inc, sim.simTime(), em)).toBe('');
    // LIVE (1x) follows the truck the player sent, then the speed comes back; the plant is saved
    h.tick();
    expect(h.banner.liveActive).toBe(true);
    expect(sim.speed).toBe(1);
    for (let d = 0; d < 10; d++) { sim.runDays(1); h.tick(); }
    expect(h.banner.liveActive).toBe(false);
    expect(sim.speed).toBe(3);
    expect(h.toasts.some((t) => /^Emergencies handled — back to ultra speed$/.test(t))).toBe(true);
    expect(st.stats.emergency.month.failed).toBe(0);
  });

  it('P2: a fire that failed shows its outcome — no countdown, no urgency, no dispatch buttons', () => {
    const st = newState(96);
    roadLine(st, 2, 20, 93, 20, Network.Road);
    place(st, 't_fire', 4, 19);
    const home = place(st, 't_r2', 40, 21, { pop: 60 });
    const sim = newSim(st);
    getFire(sim)!.riskBoost = 0;
    const h = harness(sim);
    const em = emergencyOf(sim)!;
    sim.speed = 1;
    h.tick();
    triggerDisaster(sim, 'fire', home.x, home.z);
    const id = em.incidents()[0].id;
    h.tick();
    expect(h.banner.bannerIds).toEqual([id]);
    expect(parts(h, id).time).toMatch(/min left/);
    // nobody sends a truck: the home burns down
    for (let d = 0; d < 8 && em.incident(id); d++) { sim.runDays(1); h.tick(); }
    expect(em.incident(id)).toBeUndefined();
    h.tick();
    const p = parts(h, id);
    // EM-5: nobody was sent although a truck could have made it in time (not "help came too late")
    expect(p.note).toBe('No fire truck was sent in time — 1 building lost');
    expect(p.time).not.toMatch(/left/);
    expect(p.el.classList.contains('urgent')).toBe(false);
    expect(p.el.classList.contains('handled')).toBe(true);
    expect(shown(p.send)).toBe(false);
    expect(shown(p.choose)).toBe(false);
  });

  it('P6: a loaded game gets its waiting incident\'s banner and the urgent pause back (the banner is built before the systems load)', () => {
    const st = newState(96);
    roadLine(st, 2, 20, 93, 20, Network.Road);
    place(st, 't_fire', 4, 19);
    const home = place(st, 't_r2', 44, 21, { pop: 60 });
    const sim = newSim(st);
    getFire(sim)!.riskBoost = 0;
    triggerDisaster(sim, 'fire', home.x, home.z);
    const inc = emergencyOf(sim)!.incidents()[0];
    expect(inc.state).toBe('uncovered');
    expect(inc.manualPossible).toBe(true);
    // saved, then loaded the way CityScene does: the scene (and its banner) first, the systems a moment later
    const st2 = deserializeCity(structuredClone(serializeCity(st, { copy: true })) as SerializedCity);
    const sim2 = new Simulation(st2, []);
    const h = harness(sim2);
    sim2.speed = 1; // a saved city resumes at normal speed
    h.tick();
    expect(h.banner.bannerIds).toEqual([]);
    const systems = infraSystems();
    for (const s of systems) sim2.systems.push(s);
    for (const s of systems) s.init?.(sim2);
    getFire(sim2)!.riskBoost = 0;
    h.tick();
    expect(h.banner.bannerIds).toEqual([inc.id]);
    // 4.0 min to a 6-day burn: under 8 s at live speed to react -> the urgent pause is back
    expect(sim2.speed).toBe(0);
    expect(h.banner.liveActive).toBe(true);
    const loaded = emergencyOf(sim2)!.incident(inc.id)!;
    expect([loaded.state, loaded.reason, loaded.manualPossible, loaded.bestEta, loaded.deadline]).toEqual([inc.state, inc.reason, inc.manualPossible, inc.bestEta, inc.deadline]);
  });

  it('every alert a dispatch can still save gets a banner; beyond three they are compact', () => {
    const st = newState(96);
    roadLine(st, 2, 20, 93, 20, Network.Road);
    for (const x of [4, 6, 8, 10, 12]) place(st, 't_fire', x, 19);
    const homes = [40, 48, 56, 64].map((x) => place(st, 't_r2', x, 21, { pop: 60 })); // 2.8-5.2 min from the nearest station
    const sim = newSim(st);
    getFire(sim)!.riskBoost = 0;
    const h = harness(sim);
    const em = emergencyOf(sim)!;
    sim.speed = 2;
    h.tick();
    for (const b of homes) triggerDisaster(sim, 'fire', b.x, b.z);
    h.tick();
    const ids = em.incidents().map((i) => i.id);
    expect(ids.length).toBe(4);
    expect(em.incidents().every((i) => i.state === 'uncovered' && i.manualPossible)).toBe(true);
    expect(h.banner.bannerIds.sort()).toEqual([...ids].sort());
    const compact = ids.filter((id) => parts(h, id).el.classList.contains('compact'));
    expect(compact.length).toBe(1);
    expect(compact[0]).toBe(Math.max(...ids));
  });
});

describe('EmergencyBanner: final-fix round 2', () => {
  /** a street along z = 20 (x 2..size-3), a fire station (2 trucks, 2.6-min reach) at x = 4; 5,000 residents */
  function fireTown(size = 96): { st: CityState; sim: Simulation; station: ReturnType<typeof place> } {
    const st = newState(size);
    roadLine(st, 2, 20, size - 3, 20, Network.Road);
    const station = place(st, 't_fire', 4, 19);
    const sim = newSim(st);
    getFire(sim)!.riskBoost = 0;
    st.stats.population = 5000;
    return { st, sim, station };
  }
  const pending = (h: Harness) => {
    const em = emergencyOf(h.sim)!;
    return pendingCount('live', new Map(h.policy.view.alerts.map((a) => [a.id, a])), em.incidents(), new Set(), h.sim.simTime(),
      (inc) => sendDays(inc, h.sim.simTime(), () => em.dispatchOptions(h.sim, inc.id))).count;
  };

  it('EM-1: a burst whose later incident takes the free truck raises no banner, no LIVE mode, no ignored prompt', async () => {
    const { st, sim } = fireTown();
    const f1 = place(st, 't_id', 8, 21, { jobs: 40 });
    const f2 = place(st, 't_id', 12, 21, { jobs: 40 });
    const homes = [40, 46].map((x) => place(st, 't_r2', x, 21, { pop: 60 }));
    const h = harness(sim);
    const em = emergencyOf(sim)!;
    sim.speed = 3;
    h.tick();
    // one dispatch call after the other, as a disaster does: a spill takes one truck, two fires beyond the station's
    // reach are prompts for the other one, a second spill in reach takes it
    em.spawn(sim, 'spill', f1.x, f1.z, { buildingId: f1.id });
    for (const b of homes) triggerDisaster(sim, 'fire', b.x, b.z);
    const fires = em.incidents().filter((i) => i.kind === 'fire');
    expect(fires.length).toBe(2);
    expect(fires.every((f) => f.manualPossible)).toBe(true);
    em.spawn(sim, 'spill', f2.x, f2.z, { buildingId: f2.id });
    expect(fires.every((f) => !f.manualPossible && !f.canSend)).toBe(true);
    // the banner takes the events up once the calls are over (a microtask): nothing to alert, the speed stays
    await Promise.resolve();
    expect(h.banner.bannerIds).toEqual([]);
    expect(pending(h)).toBe(0);
    expect(sim.speed).toBe(3);
    expect(h.banner.liveActive).toBe(false);
    for (let d = 0; d < 10 && fires.some((f) => em.incident(f.id)); d++) { sim.runDays(1); h.tick(); }
    expect(fires.every((f) => !em.incident(f.id))).toBe(true);
    expect(st.stats.emergency.month.failed).toBeGreaterThanOrEqual(2);
    expect(st.stats.emergency.month.ignored ?? 0).toBe(0);
    expect(sim.speed).toBe(3);
    expect(h.toasts.filter((t) => /Emergenc/.test(t))).toEqual([]);
  });

  it('EM-1: the urgent pause ends once nothing can be sent (the trucks went elsewhere, or no free unit is left at all)', () => {
    for (const how of ['dispatched elsewhere', 'no free unit'] as const) {
      const { st, sim, station } = fireTown();
      const far = place(st, 't_r2', 54, 21, { pop: 60 }); // 5.0 min to a 6-day burn: under 8 s at live speed
      const near = place(st, 't_r2', 46, 21, { pop: 60 }); // (more than 3 cells apart: its own fire incident)
      const h = harness(sim);
      const em = emergencyOf(sim)!;
      sim.speed = 3;
      h.tick();
      triggerDisaster(sim, 'fire', far.x, far.z);
      const a = em.incidents()[0];
      h.tick();
      expect(h.banner.bannerIds).toEqual([a.id]);
      expect(sim.speed).toBe(0); // the urgent pause
      expect(h.banner.liveActive).toBe(true);
      if (how === 'dispatched elsewhere') {
        // a second fire nearby: the player sends both trucks there — the paused prompt cannot be answered any more
        triggerDisaster(sim, 'fire', near.x, near.z);
        const b = em.incidents().find((i) => i.buildingId === near.id)!;
        h.tick();
        expect(h.banner.bannerIds).toEqual([a.id, b.id]);
        expect(em.dispatch(sim, b.id, station.id, 2).ok).toBe(true);
        expect(a.manualPossible).toBe(false);
        h.tick();
        // LIVE follows the trucks the player sent (1x), the pause is over
        expect(sim.speed).toBe(1);
        expect(h.banner.liveActive).toBe(true);
        expect(parts(h, a.id).send.disabled).toBe(true);
      } else {
        // (both trucks out behind the sim's back: the banner itself checks the live free counts)
        (em as unknown as { out: Map<number, number> }).out.set(station.id, 2);
        (em as unknown as { stVer: number }).stVer++; // publish the fixture's synthetic fleet change
        h.tick();
        expect(sim.speed).toBe(3);
        expect(h.banner.liveActive).toBe(false);
        expect(h.toasts.at(-1)).toBe('Emergency over — back to ultra speed');
      }
    }
  });

  it('EM-1: a prompt whose truck another call took holds LIVE only while a free truck can still make it; its Send button follows at once', () => {
    // the near station (x = 4, 2 trucks) is 3.6 min from the home; the far one (x = 120) 8.0 min: too far for a 6-day burn
    const { st, sim, station } = fireTown(128);
    const far = place(st, 't_fire', 120, 19);
    sim.events.emit('buildingAdded', far);
    const home = place(st, 't_r2', 40, 21, { pop: 60 });
    const spills = [8, 12].map((x) => place(st, 't_id', x, 21, { jobs: 40 }));
    const h = harness(sim);
    const em = emergencyOf(sim)!;
    sim.speed = 3;
    h.tick();
    triggerDisaster(sim, 'fire', home.x, home.z);
    const fire = em.incidents()[0];
    h.tick();
    expect([fire.reason, fire.manualPossible, fire.bestFrom]).toEqual(['outOfRange', true, station.id]);
    expect(h.banner.bannerIds).toEqual([fire.id]);
    expect(h.banner.liveActive).toBe(true);
    expect(parts(h, fire.id).send.textContent).toMatch(/^Send nearest3\.\d min$/);
    // two spills in the near station's reach take both its trucks (between two day ticks: the sim decides the fire
    // again at the next dispatch pass, a free truck is still left far away)
    for (const b of spills) expect(em.incident(em.spawn(sim, 'spill', b.x, b.z, { buildingId: b.id }))!.state).toBe('dispatched');
    expect(em.stationFleet(station.id)!.free).toBe(0);
    expect(fire.manualPossible).toBe(true);
    h.tick();
    // nothing can make it in time any more: no LIVE mode for it; the button names the truck that would go now
    expect(h.banner.liveActive).toBe(false);
    expect(sim.speed).toBe(3);
    expect(h.toasts.at(-1)).toBe('Emergency over — back to ultra speed');
    const p = parts(h, fire.id);
    expect(p.send.disabled).toBe(false);
    expect(p.send.textContent).toMatch(/^Send nearest8\.\d min · too far\?$/);
    // the next day's pass decides it again: no prompt, nothing to count as ignored
    sim.runDays(1);
    h.tick();
    expect([fire.state, fire.manualPossible, fire.canSend, fire.prompted]).toEqual(['uncovered', false, true, undefined]);
    expect(h.banner.liveActive).toBe(false);
  });

  it('EM-4: the Send button keeps its label / ETA spans and the pill its text span: a press and release across the update still clicks', () => {
    const { st, sim } = fireTown();
    const homes = [40, 48].map((x) => place(st, 't_r2', x, 21, { pop: 60 }));
    const h = harness(sim);
    const em = emergencyOf(sim)!;
    sim.speed = 1;
    h.tick();
    for (const b of homes) triggerDisaster(sim, 'fire', b.x, b.z);
    h.tick();
    const [a, b] = em.incidents().map((i) => i.id);
    const send = parts(h, a).send;
    const kids = [...send.childNodes];
    expect(kids.length).toBe(2);
    expect(send.textContent).toMatch(/^Send nearest\d+\.\d min$/);
    // the press lands on the ETA span; a day passes (the ETA is read again) before the release
    const pressed = kids[1] as FakeEl;
    sim.runDays(1);
    h.tick();
    expect([...send.childNodes]).toEqual(kids);
    expect(pressed.parentElement).toBe(send); // still the same element under the pointer: the click goes to the button
    send.click();
    expect(em.incident(a)!.state).toBe('dispatched');
    // the "N more" pill: a dismissed prompt — its text span stays across ticks
    const close = parts(h, b).el.all().find((e) => e.className.includes('emg-x'))!;
    close.click();
    h.tick();
    const more = (h.banner as unknown as { more: FakeEl }).more;
    expect(shown(more)).toBe(true);
    expect(more.textContent).toBe('1 more emergency needs you — open Emergencies');
    const pill = [...more.childNodes];
    for (let k = 0; k < 3; k++) h.tick();
    expect([...more.childNodes]).toEqual(pill);
  });

  it('EM-3: no layout read on a UI tick without a banner; with banners only after the layout changed', () => {
    // count the layout reads dock() makes (root size, panel and banner boxes)
    let reads = 0;
    const count = (o: object, keys: string[]) => {
      for (const k of keys) {
        const v = (o as Record<string, number>)[k];
        Object.defineProperty(o, k, { configurable: true, get: () => { reads++; return v; } });
      }
    };
    // the browser's observers, driven by hand
    const g2 = globalThis as unknown as { ResizeObserver?: unknown; MutationObserver?: unknown };
    const had = [g2.ResizeObserver, g2.MutationObserver];
    const fire: (() => void)[] = [];
    class FakeObs {
      constructor(cb: () => void) { fire.push(cb); }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    g2.ResizeObserver = FakeObs;
    g2.MutationObserver = FakeObs;
    try {
      const { st, sim } = fireTown();
      const home = place(st, 't_r2', 40, 21, { pop: 60 });
      const h = harness(sim);
      const em = emergencyOf(sim)!;
      count(h.root, ['clientWidth', 'clientHeight']);
      count(h.banner.el, ['offsetWidth']);
      count((h.banner as unknown as { more: FakeEl }).more, ['offsetHeight']);
      // a docked panel the stack has to clear (the Advisors panel, right)
      const panel = new FakeEl('div');
      panel.className = 'panel';
      Object.assign(panel, { offsetLeft: 946, offsetTop: 72, offsetWidth: 640, offsetHeight: 578 });
      count(panel, ['offsetLeft', 'offsetTop', 'offsetWidth', 'offsetHeight']);
      h.root.querySelectorAll = () => [panel];
      for (let k = 0; k < 5; k++) h.tick();
      expect(reads).toBe(0); // no banner: nothing measured at all
      triggerDisaster(sim, 'fire', home.x, home.z);
      h.tick();
      expect(em.incidents()[0].manualPossible).toBe(true);
      expect(h.banner.bannerIds.length).toBe(1);
      count(parts(h, h.banner.bannerIds[0]).el, ['offsetHeight']);
      h.tick(); // (the first docking measures)
      const after = reads;
      expect(after).toBeGreaterThan(0);
      expect(h.banner.el.style.left).toBe(`${Math.round(946 - 12 - BANNER_W)}px`); // left of the panel
      for (let k = 0; k < 5; k++) h.tick();
      expect(reads).toBe(after); // nothing changed: no layout read
      for (const f of fire) f(); // a panel moved / resized
      h.tick();
      expect(reads).toBeGreaterThan(after);
    } finally {
      g2.ResizeObserver = had[0];
      g2.MutationObserver = had[1];
    }
  });

  it('EM-5: "3.0 min left to send a truck" and never "too far?" for an industrial accident; how a failure ended', () => {
    // an industrial accident 12.3 min from the only fire station: a truck sent now still saves the plant
    {
      const st = newState(128);
      roadLine(st, 2, 20, 126, 20, Network.Road);
      place(st, 't_fire', 2, 19);
      const f = place(st, 't_id', 125, 21, { jobs: 40 });
      const sim = newSim(st);
      getFire(sim)!.riskBoost = 0;
      st.stats.population = 5000;
      const h = harness(sim);
      const em = emergencyOf(sim)!;
      h.tick();
      const id = em.spawn(sim, 'industrial', f.x, f.z, { buildingId: f.id });
      h.tick();
      const p = parts(h, id);
      expect(p.time).toMatch(/· 3\.0 min left to send a truck$/);
      expect(p.send.textContent).toMatch(/^Send nearest12\.\d min$/);
      expect(p.send.textContent).not.toMatch(/too far/);
    }
    // a fire no truck can reach in time ("too far?"): nobody sent -> "could reach"; sent anyway -> "too late"
    for (const send of [false, true]) {
      const { st, sim } = fireTown();
      const home = place(st, 't_r2', 70, 21, { pop: 60 }); // 6.6 min to a 6-day burn
      const h = harness(sim);
      const em = emergencyOf(sim)!;
      h.tick();
      triggerDisaster(sim, 'fire', home.x, home.z);
      const id = em.incidents()[0].id;
      h.tick();
      expect(em.incident(id)!.canSend).toBe(true);
      expect(em.incident(id)!.manualPossible).toBe(false);
      expect(parts(h, id).send.textContent).toMatch(/too far\?$/);
      if (send) parts(h, id).send.click();
      for (let d = 0; d < 8 && em.incident(id); d++) { sim.runDays(1); h.tick(); }
      expect(em.incident(id)).toBeUndefined();
      h.tick();
      expect(parts(h, id).note).toBe(send ? 'Help came too late — 1 building lost' : 'No fire truck could reach it in time — 1 building lost');
    }
  });
});

describe('EmergencyBanner: final-fix round 3 — the stack never runs into the toolbar', () => {
  it('fitRows: the banners that fit above the bound, room kept for the "N more" pill while some are left out', () => {
    // 3 full (150) + compact (64) banners from y 70, 8 px apart; the pill 34 + 8
    const hs = [150, 150, 150, 64, 64, 64, 64, 64, 64, 64];
    expect(fitRows(70, 2000, hs, 42)).toBe(0); // all fit
    // 5 banners end at 680, with the pill 722; a sixth at 752 (+ pill 794)
    expect(fitRows(70, 792, hs, 42)).toBe(5);
    expect(fitRows(70, 794, hs, 42)).toBe(6);
    // exactly all of them, no pill needed — unless it shows anyway
    expect(fitRows(70, 70 + 3 * 158 + 7 * 72 - 8, hs, 42)).toBe(0);
    expect(fitRows(70, 70 + 3 * 158 + 7 * 72 - 8, hs, 42, true)).toBe(9);
    // never less than one row
    expect(fitRows(70, 100, hs, 42)).toBe(1);
    expect(fitRows(70, 100, [], 42)).toBe(0);
  });

  /**
   * Two streets that do not connect: z = 20 (x 2..60, fire station A at x = 4) and z = 40 (x 66..125, station B at
   * x = 123); five homes on each, 2.8-4.8 min from their station (beyond its 2.6-min reach, a truck sent at once still
   * makes it). The 1280x720 window's layer: 1600 x 900 css px, the bottom toolbar block's top at y 804.
   */
  function quakeTown() {
    const st = newState(128);
    roadLine(st, 2, 20, 60, 20, Network.Road);
    roadLine(st, 66, 40, 125, 40, Network.Road);
    const a = place(st, 't_fire', 4, 19);
    const b = place(st, 't_fire', 123, 39);
    // (B's homes first: the oldest banners — the stack shows the oldest first unless they cannot be answered)
    // (5 cells apart: each its own fire incident, FIRE_CLUSTER_R = 3)
    const homesB = [95, 90, 85, 80, 75].map((x) => place(st, 't_r2', x, 41, { pop: 60 }));
    const homesA = [32, 37, 42, 47, 52].map((x) => place(st, 't_r2', x, 21, { pop: 60 }));
    const sim = newSim(st);
    getFire(sim)!.riskBoost = 0;
    st.stats.population = 5000;
    const h = harness(sim);
    h.root.clientHeight = 900;
    const hud = new FakeEl('div');
    Object.assign(hud, { offsetTop: 804, offsetHeight: 84, offsetParent: h.root });
    (h.root as unknown as { querySelector: (s: string) => FakeEl | null }).querySelector = (s) => (s === '.hud-bottom' ? hud : null);
    return { st, sim, h, a, b, homesA, homesB, bound: 804 - TOOLBAR_GAP };
  }
  /** the stack's bottom edge (the CSS stack from STACK_TOP: the shown banners in display order, 8 px apart, the pill) */
  function stackBottom(h: Harness): { bottom: number; shown: number[]; capped: number[]; pill: boolean } {
    const banners = [...(h.banner as unknown as { banners: Map<number, { el: FakeEl; fullH?: number; compH?: number }> }).banners.entries()]
      .sort((x, y) => Number(x[1].el.style.order) - Number(y[1].el.style.order));
    const shownB = banners.filter(([, b]) => !b.el.classList.contains('capped'));
    const more = (h.banner as unknown as { more: FakeEl }).more;
    const pill = more.style.display !== 'none';
    let y = STACK_TOP - 8;
    for (const [, b] of shownB) y += (b.el.classList.contains('compact') ? b.compH ?? 64 : b.fullH ?? 150) + 8;
    return { bottom: y + (pill ? 34 + 8 : 0), shown: shownB.map(([id]) => id), capped: banners.filter(([, b]) => b.el.classList.contains('capped')).map(([id]) => id), pill };
  }

  it('ten prompts at 1280x720 with no panel open: the stack ends above the toolbar, the pill counts the rest', () => {
    const { sim, h, homesA, homesB, bound } = quakeTown();
    const em = emergencyOf(sim)!;
    sim.speed = 1;
    h.tick();
    for (const b of [...homesB, ...homesA]) triggerDisaster(sim, 'fire', b.x, b.z);
    h.tick();
    h.tick();
    const incs = em.incidents();
    expect(incs.length).toBe(10);
    expect(incs.every((i) => i.state === 'uncovered' && i.manualPossible)).toBe(true);
    // every prompt a dispatch can still save has its banner (EM-1 / F2) ...
    expect(h.banner.bannerIds.length).toBe(10);
    // ... but only the rows that fit are shown: the old stack ran to 70 + 3 × 158 + 7 × 72 − 8 = 1040 px, past the
    // 900-px layer and over the toolbar
    const s = stackBottom(h);
    expect(s.bottom).toBeLessThanOrEqual(bound);
    expect(s.shown.length).toBeGreaterThanOrEqual(MAX_BANNERS);
    expect(s.shown.length).toBeLessThan(10);
    // (the most that fit: one more row would run into the toolbar)
    expect(s.bottom + 64 + 8).toBeGreaterThan(bound);
    expect(s.pill).toBe(true);
    const more = (h.banner as unknown as { more: FakeEl }).more;
    expect(more.textContent).toBe(`${10 - s.shown.length} more emergencies need you — open Emergencies`);
    // the full banners stay the first three: the most urgent keep their place, note and buttons
    const compact = s.shown.filter((id) => parts(h, id).el.classList.contains('compact'));
    expect(compact.length).toBe(s.shown.length - MAX_BANNERS);
    // stable for the next ticks (no flip-flop with the banners' own size)
    for (let k = 0; k < 3; k++) h.tick();
    expect(stackBottom(h).shown).toEqual(s.shown);
  });

  it('"No free unit" banners are the first folded into the pill; a docked panel keeps the cap', () => {
    const { sim, h, b: stationB, homesA, homesB, bound } = quakeTown();
    const em = emergencyOf(sim)!;
    sim.speed = 1;
    h.tick();
    for (const b of [...homesB, ...homesA]) triggerDisaster(sim, 'fire', b.x, b.z);
    h.tick();
    const idsB = homesB.map((b) => em.incidents().find((i) => i.buildingId === b.id)!.id);
    const idsA = homesA.map((b) => em.incidents().find((i) => i.buildingId === b.id)!.id);
    // the oldest first while every prompt can be answered: street B's
    let s = stackBottom(h);
    expect(s.shown.slice(0, idsB.length)).toEqual(idsB.slice(0, s.shown.length));
    // both of B's trucks out (behind the sim's back, as in the EM-1 test): street B's banners read "No free unit"
    (em as unknown as { out: Map<number, number> }).out.set(stationB.id, 2);
    (em as unknown as { stVer: number }).stVer++;
    for (const b of (h.banner as unknown as { banners: Map<number, { optsVersion: number }> }).banners.values()) b.optsVersion = -1;
    h.tick();
    h.tick();
    for (const id of idsB) expect(parts(h, id).send.textContent).toBe('No free unit');
    for (const id of idsA) expect(parts(h, id).send.textContent).toMatch(/^Send nearest\d+\.\d min$/);
    s = stackBottom(h);
    expect(s.bottom).toBeLessThanOrEqual(bound);
    // street A's prompts (a dispatch can save them) are shown; the folded ones are all "No free unit" banners
    for (const id of idsA) expect(s.shown).toContain(id);
    expect(s.capped.length).toBe(10 - s.shown.length);
    for (const id of s.capped) expect(idsB).toContain(id);
    const more = (h.banner as unknown as { more: FakeEl }).more;
    expect(more.textContent).toBe(`${s.capped.length} more emergenc${s.capped.length === 1 ? 'y' : 'ies'} — open Emergencies`);
    // the Advisors panel docked right: the stack goes left of it, still above the toolbar
    const panel = new FakeEl('div');
    panel.className = 'panel';
    Object.assign(panel, { offsetLeft: 946, offsetTop: 72, offsetWidth: 640, offsetHeight: 578 });
    h.root.querySelectorAll = () => [panel];
    h.tick();
    h.tick();
    expect(h.banner.el.style.left).toBe(`${Math.round(946 - 12 - BANNER_W)}px`);
    const s2 = stackBottom(h);
    expect(s2.bottom).toBeLessThanOrEqual(bound);
    expect(s2.capped.length).toBeGreaterThan(0);
  });

  // ------------------------------------------------------------------------------------ final fixes r4 U1
  /**
   * An open toolbar flyout over the quake town's 1280x720 layer (playtest r4 p44: the Civic flyout at y 485-648, i.e.
   * 606-810 of the 1600 x 900 layer): absolutely positioned in the toolbar (20 px below the bottom block's top), 10 px
   * above it — no part of the block's box. Its top in the layer: 804 + 20 − 10 − height.
   */
  function withFlyout(h: Harness, height: number): { fly: FakeEl; top: number } {
    const hud = (h.root as unknown as { querySelector: (s: string) => FakeEl | null }).querySelector('.hud-bottom')!;
    const bar = new FakeEl('div');
    Object.assign(bar, { offsetTop: 20, offsetParent: hud });
    const fly = new FakeEl('div');
    fly.className = 'flyout mp-glass open';
    Object.assign(fly, { offsetTop: -10 - height, offsetHeight: height, offsetParent: bar });
    (hud as unknown as { querySelector: (s: string) => FakeEl | null }).querySelector = (s) => (s === '.flyout' ? fly : null);
    return { fly, top: 804 + 20 - 10 - height };
  }
  /** ten prompts (both streets on fire) */
  function quake(t: ReturnType<typeof quakeTown>): void {
    t.sim.speed = 1;
    t.h.tick();
    for (const b of [...t.homesB, ...t.homesA]) triggerDisaster(t.sim, 'fire', b.x, b.z);
    t.h.tick();
    t.h.tick();
    expect(t.h.banner.bannerIds.length).toBe(10);
  }

  it('U1: with the Civic flyout open the stack ends above the flyout (the pill counts the rest); closed, it reaches the toolbar again', () => {
    const t = quakeTown();
    const { fly, top } = withFlyout(t.h, 204);
    quake(t);
    // (the old bound was the bottom block's top: banners down to y 792 over the flyout's tabs and cards from y 610)
    let s = stackBottom(t.h);
    expect(s.bottom).toBeLessThanOrEqual(top - TOOLBAR_GAP);
    expect(s.bottom + 64 + 8).toBeGreaterThan(top - TOOLBAR_GAP); // (as many as fit)
    expect(s.pill).toBe(true);
    const open = s.shown.length;
    expect(open).toBeGreaterThanOrEqual(1);
    const more = (t.h.banner as unknown as { more: FakeEl }).more;
    expect(more.textContent).toBe(`${10 - open} more emergencies need you — open Emergencies`);
    // closed (the flyout stays laid out, hidden): the r3 bound, the bottom block, again
    fly.className = 'flyout mp-glass';
    t.h.tick();
    s = stackBottom(t.h);
    expect(s.bottom).toBeLessThanOrEqual(t.bound);
    expect(s.bottom + 64 + 8).toBeGreaterThan(t.bound);
    expect(s.shown.length).toBeGreaterThan(open);
    // a flyout lower than the block's top (none is) never lowers the bound below the block
    fly.className = 'flyout mp-glass open';
    Object.assign(fly, { offsetTop: 0, offsetHeight: 10 });
    t.h.tick();
    expect(stackBottom(t.h).shown).toEqual(s.shown);
  });

  it('U1 / EM-3: the flyout is watched (opened / closed: its class; a tab switch: its size) — the stack re-docks after a change only', () => {
    const g2 = globalThis as unknown as { ResizeObserver?: unknown; MutationObserver?: unknown };
    const had = [g2.ResizeObserver, g2.MutationObserver];
    const obs: { kind: string; cb: () => void; targets: [unknown, unknown][] }[] = [];
    const fake = (kind: string) => class {
      private o: { kind: string; cb: () => void; targets: [unknown, unknown][] };
      constructor(cb: () => void) { this.o = { kind, cb, targets: [] }; obs.push(this.o); }
      observe(t: unknown, opts?: unknown): void { this.o.targets.push([t, opts]); }
      unobserve(): void {}
      disconnect(): void {}
    };
    g2.ResizeObserver = fake('ro');
    g2.MutationObserver = fake('mo');
    try {
      const t = quakeTown();
      const { fly, top } = withFlyout(t.h, 204);
      quake(t);
      const ro = obs.find((o) => o.kind === 'ro')!, mo = obs.find((o) => o.kind === 'mo')!;
      // the first docking measured the open flyout and watches it from then on
      expect(ro.targets.some(([el]) => el === fly)).toBe(true);
      expect(mo.targets.find(([el]) => el === fly)?.[1]).toEqual({ attributes: true, attributeFilter: ['class'] });
      const s0 = stackBottom(t.h);
      expect(s0.bottom).toBeLessThanOrEqual(top - TOOLBAR_GAP);
      for (let k = 0; k < 3; k++) t.h.tick();
      expect(stackBottom(t.h).shown).toEqual(s0.shown); // (stable: nothing changed)
      // closed: the class change (its MutationObserver record) re-docks the stack on the next tick
      fly.className = 'flyout mp-glass';
      mo.cb();
      t.h.tick();
      const s1 = stackBottom(t.h);
      expect(s1.bottom).toBeLessThanOrEqual(t.bound);
      expect(s1.shown.length).toBeGreaterThan(s0.shown.length);
      // opened on a taller tab (its ResizeObserver record): above it again
      fly.className = 'flyout mp-glass open';
      Object.assign(fly, { offsetTop: -10 - 300, offsetHeight: 300 });
      ro.cb();
      t.h.tick();
      expect(stackBottom(t.h).bottom).toBeLessThanOrEqual(804 + 20 - 10 - 300 - TOOLBAR_GAP);
    } finally {
      g2.ResizeObserver = had[0];
      g2.MutationObserver = had[1];
    }
  });

  it('U1 / EM-4: a press on a banner whose pointerdown closes the flyout still clicks — no re-dock until it is released', () => {
    // the window's pointer listeners (the release ends the hold)
    const gw = globalThis as unknown as { window?: unknown };
    const hadWin = gw.window;
    const winL = new Map<string, ((e: unknown) => void)[]>();
    gw.window = {
      addEventListener: (k: string, f: (e: unknown) => void) => { winL.set(k, [...(winL.get(k) ?? []), f]); },
      removeEventListener: () => undefined,
    };
    const now = vi.spyOn(performance, 'now');
    try {
      const t = quakeTown();
      const em = emergencyOf(t.sim)!;
      // a tall flyout (from y 454): only compact banners fit above it
      const { fly, top } = withFlyout(t.h, 360);
      quake(t);
      // (the UI clock from here on: the hold is measured in real ms)
      now.mockReturnValue(1e6);
      t.h.tick();
      const s0 = stackBottom(t.h);
      expect(s0.bottom).toBeLessThanOrEqual(top - TOOLBAR_GAP);
      const id = s0.shown[1];
      const p = parts(t.h, id);
      expect(p.el.classList.contains('compact')).toBe(true);
      const [order, cls] = [p.el.style.order, p.el.className];
      // the press on its Send button: pointerdown on the stack — the toolbar closes its flyout on any press outside it
      (t.h.banner.el as unknown as FakeEl).fire('pointerdown');
      fly.className = 'flyout mp-glass';
      // UI ticks before the release (a click takes ~100 ms): the docking holds — no full banners, no new rows that would
      // move the button away from under the pointer
      now.mockReturnValue(1e6 + 80);
      t.h.tick();
      now.mockReturnValue(1e6 + 160);
      t.h.tick();
      const s1 = stackBottom(t.h);
      expect(s1.shown).toEqual(s0.shown);
      expect([p.el.style.order, p.el.className]).toEqual([order, cls]);
      // released over the same button: it clicks
      for (const f of winL.get('pointerup') ?? []) f({});
      p.send.click();
      expect(em.incident(id)!.state).toBe('dispatched');
      // then the stack re-docks for the closed flyout: full banners first, down to the toolbar
      now.mockReturnValue(1e6 + 240);
      t.h.tick();
      const s2 = stackBottom(t.h);
      expect(s2.bottom).toBeLessThanOrEqual(t.bound);
      expect(s2.shown.length).toBeGreaterThan(s0.shown.length);
      expect(parts(t.h, s2.shown[0]).el.classList.contains('compact')).toBe(false);
      // close-out c2: a long press holds the docking until it is released, however long — a 1.5 s cap re-docked under
      // a 2.5 s press at 1366x650 and the release clicked nothing — then a release the window never saw as a pointerup
      // (the window lost focus with the button held) lets it re-dock
      fly.className = 'flyout mp-glass open';
      (t.h.banner.el as unknown as FakeEl).fire('pointerdown');
      for (const ms of [300, 1800, 2500, 10000]) {
        now.mockReturnValue(1e6 + ms);
        t.h.tick();
        expect(stackBottom(t.h).shown).toEqual(s2.shown);
      }
      for (const f of winL.get('blur') ?? []) f({});
      now.mockReturnValue(1e6 + 10100);
      t.h.tick();
      expect(stackBottom(t.h).bottom).toBeLessThanOrEqual(top - TOOLBAR_GAP);
    } finally {
      now.mockRestore();
      gw.window = hadWin;
    }
  });

  // ------------------------------------------------------------------------------------ close-out c1
  /** the window (its pointer / resize listeners) and the frame clock, faked for a test */
  function fakeWindowAndFrames() {
    const gw = globalThis as unknown as { window?: unknown; requestAnimationFrame?: unknown };
    const had = [gw.window, gw.requestAnimationFrame];
    const winL = new Map<string, ((e: unknown) => void)[]>();
    gw.window = {
      addEventListener: (k: string, f: (e: unknown) => void) => { winL.set(k, [...(winL.get(k) ?? []), f]); },
      removeEventListener: () => undefined,
    };
    let frames: (() => void)[] = [];
    gw.requestAnimationFrame = (cb: () => void) => { frames.push(cb); return frames.length; };
    return {
      winL,
      /** one frame: the callbacks requested before it */
      frame: () => { const f = frames; frames = []; for (const cb of f) cb(); },
      restore: () => { gw.window = had[0]; gw.requestAnimationFrame = had[1]; },
    };
  }
  /** a pointer press and release on a control of the stack as the browser delivers them: the stack's capture listeners
   *  first (they may stop the event), the window's pointerup, then — unless stopped — the control's own click */
  function press(t: ReturnType<typeof quakeTown>, winL: Map<string, ((e: unknown) => void)[]>, ctl: FakeEl): boolean {
    const stack = t.h.banner.el as unknown as FakeEl;
    const L = (el: FakeEl, k: string) => (el as unknown as { listeners: Map<string, ((e: unknown) => void)[]> }).listeners.get(k) ?? [];
    let stopped = false;
    const ev = () => ({ target: ctl, preventDefault() {}, stopPropagation() { stopped = true; } });
    for (const f of L(stack, 'pointerdown')) f(ev());
    const downStopped = stopped;
    stopped = false;
    for (const f of winL.get('pointerup') ?? []) f({});
    for (const f of L(stack, 'click')) f(ev());
    if (!stopped && !downStopped) ctl.click();
    return !(downStopped || stopped);
  }
  /** a banner's control by its text (Jump / Send nearest) */
  const button = (h: Harness, id: number, text: RegExp): FakeEl => {
    const b = parts(h, id).el.all().find((e) => e.tagName === 'button' && text.test(e.textContent));
    expect(b, `button ${text} of ${id}`).toBeDefined();
    return b!;
  };

  it('c1: a press that lands just after a flyout re-docked the stack is ignored — not sent to the banner that moved under the pointer', () => {
    const w = fakeWindowAndFrames();
    const now = vi.spyOn(performance, 'now');
    try {
      const t = quakeTown();
      const em = emergencyOf(t.sim)!;
      const { fly, top } = withFlyout(t.h, 360);
      fly.className = 'flyout mp-glass'; // closed for now
      quake(t);
      now.mockReturnValue(1e6);
      t.h.tick();
      w.frame(); w.frame();
      // settled: a press clicks at once (stable stack, no move for a while)
      now.mockReturnValue(1e6 + 2000);
      t.h.tick();
      const s0 = stackBottom(t.h);
      expect(parts(t.h, s0.shown[0]).el.classList.contains('compact')).toBe(false);
      // the player opens the Civic flyout: the stack re-docks to compact rows above it, and banner 1 moves up to where
      // banner 0's row was (playtest c1 p15: a press aimed at banner 0's Jump jumped to banner 1's fire)
      fly.className = 'flyout mp-glass open';
      now.mockReturnValue(1e6 + 2100);
      t.h.tick();
      const s1 = stackBottom(t.h);
      expect(s1.bottom).toBeLessThanOrEqual(top - TOOLBAR_GAP);
      expect(parts(t.h, s1.shown[0]).el.classList.contains('compact')).toBe(true);
      const victim = s1.shown[1];
      const send = button(t.h, victim, /^Send nearest/);
      // the press lands before the move is on screen, then within SETTLE_MS of its first frame: ignored, nothing sent
      expect(press(t, w.winL, send)).toBe(false);
      w.frame();
      now.mockReturnValue(1e6 + 2200);
      expect(press(t, w.winL, send)).toBe(false);
      w.frame(); // (the second frame: the move has been on screen since the first one)
      now.mockReturnValue(1e6 + 2200 + SETTLE_MS - 1);
      expect(press(t, w.winL, send)).toBe(false);
      expect(em.incident(victim)!.state).toBe('uncovered');
      // an ignored press holds no docking (nothing waits for its release)
      expect((t.h.banner as unknown as { pressAt: number }).pressAt).toBe(0);
      // aimed again once the stack has settled: it sends
      now.mockReturnValue(1e6 + 2200 + SETTLE_MS + 1);
      expect(press(t, w.winL, send)).toBe(true);
      expect(em.incident(victim)!.state).toBe('dispatched');
      // (the pill too: a press on it just after a move opens nothing)
      const opened: string[] = [];
      (t.h.banner as unknown as { ctx: { panels: { open: (id: string) => void } } }).ctx.panels.open = (id) => opened.push(id);
      fly.className = 'flyout mp-glass';
      now.mockReturnValue(1e6 + 4000);
      t.h.tick(); // (closed: the stack moves back down)
      const more = (t.h.banner as unknown as { more: FakeEl }).more;
      expect(press(t, w.winL, more)).toBe(false);
      expect(opened).toEqual([]);
      w.frame(); w.frame();
      now.mockReturnValue(1e6 + 4000 + SETTLE_MS + 1);
      expect(press(t, w.winL, more)).toBe(true);
      expect(opened).toEqual(['emergencies']);
    } finally {
      now.mockRestore();
      w.restore();
    }
  });

  it('c1: the tallest flyout tab seen since it opened bounds the stack — a switch to a shorter tab (and back) does not re-dock it', () => {
    const w = fakeWindowAndFrames();
    try {
      const t = quakeTown();
      const { fly } = withFlyout(t.h, 300);
      quake(t);
      const tall = stackBottom(t.h);
      expect(tall.bottom).toBeLessThanOrEqual(804 + 20 - 10 - 300 - TOOLBAR_GAP);
      const tab = (height: number) => Object.assign(fly, { offsetTop: -10 - height, offsetHeight: height });
      // a shorter tab, and back: the stack stays where the tallest put it
      tab(204);
      t.h.tick();
      expect(stackBottom(t.h)).toEqual(tall);
      tab(300);
      t.h.tick();
      expect(stackBottom(t.h)).toEqual(tall);
      // closed: forgotten — the toolbar bound again; opened on the short tab: its own, lower bound
      fly.className = 'flyout mp-glass';
      t.h.tick();
      expect(stackBottom(t.h).bottom).toBeLessThanOrEqual(t.bound);
      fly.className = 'flyout mp-glass open';
      tab(204);
      t.h.tick();
      const short = stackBottom(t.h);
      expect(short.bottom).toBeLessThanOrEqual(804 + 20 - 10 - 204 - TOOLBAR_GAP);
      // (the shorter tab leaves room for the three full banners: a different, lower-reaching stack)
      expect(short.bottom).toBeGreaterThan(tall.bottom);
      expect(short).not.toEqual(tall);
      // a window resize measures afresh (the flyout re-wraps): the tallest so far is forgotten too
      tab(300);
      t.h.tick();
      expect(stackBottom(t.h)).toEqual(tall);
      tab(204);
      for (const f of w.winL.get('resize') ?? []) f({});
      t.h.tick();
      expect(stackBottom(t.h)).toEqual(short);
    } finally {
      w.restore();
    }
  });

  // ------------------------------------------------------------------------------------ close-out c2
  /** the stack's width follows its inline width (docked) or the CSS default; a banner is 150 px tall as a full one in
   *  the 440-px stack and 260 px in a narrower one (its text wraps), 64 px compact, 0 folded */
  function sizedBanners(t: ReturnType<typeof quakeTown>): void {
    const stack = t.h.banner.el as unknown as FakeEl;
    Object.defineProperty(stack, 'offsetWidth', { configurable: true, get: () => parseInt(String(stack.style.width ?? '')) || BANNER_W });
    for (const id of t.h.banner.bannerIds) {
      const el = parts(t.h, id).el;
      Object.defineProperty(el, 'offsetHeight', {
        configurable: true,
        get: () => (el.classList.contains('capped') ? 0 : el.classList.contains('compact') ? 64 : stack.offsetWidth < 420 ? 260 : 150),
      });
    }
  }
  const fullShown = (t: ReturnType<typeof quakeTown>) => stackBottom(t.h).shown.filter((id) => !parts(t.h, id).el.classList.contains('compact'));

  // ------------------------------------------------------------------------------------ close-out c4 (T016 lane E)
  it('c4: exit to region removes every element listener, even while the detached stack is retained', () => {
    const t = quakeTown();
    quake(t);
    const ctx = (t.h.banner as unknown as { ctx: GameContext }).ctx;
    const open = vi.fn(), focus = vi.fn(), query = vi.fn(), select = vi.fn(() => false);
    ctx.panels.open = open;
    ctx.focusCell = focus;
    ctx.showQuery = query;
    ctx.tools = { active: null, select } as unknown as GameContext['tools'];
    const [id, dismissed] = t.h.banner.bannerIds;
    const p = parts(t.h, id), more = (t.h.banner as unknown as { more: FakeEl }).more;
    button(t.h, id, /^Jump$/).click();
    p.choose.click();
    more.click();
    p.send.click();
    parts(t.h, dismissed).el.all().find((e) => e.classList.contains('emg-x'))!.click();
    expect([open.mock.calls.length, focus.mock.calls.length, query.mock.calls.length, select.mock.calls.length]).toEqual([1, 1, 1, 1]);
    expect(emergencyOf(t.sim)!.incident(id)!.state).toBe('dispatched');
    expect(t.h.banner.bannerIds).not.toContain(dismissed);
    const stack = t.h.banner.el as unknown as FakeEl;
    const retained = [stack, ...stack.all()];
    const ids = t.h.banner.bannerIds, states = emergencyOf(t.sim)!.incidents().map((i) => i.state), toasts = [...t.h.toasts];
    stack.remove();
    t.h.abort.abort();
    for (const el of retained) if (el.tagName === 'button' || el === more) el.click();
    stack.fire('pointerdown');
    stack.fire('lostpointercapture');
    expect([open.mock.calls.length, focus.mock.calls.length, query.mock.calls.length, select.mock.calls.length]).toEqual([1, 1, 1, 1]);
    expect(t.h.banner.bannerIds).toEqual(ids);
    expect(emergencyOf(t.sim)!.incidents().map((i) => i.state)).toEqual(states);
    expect(t.h.toasts).toEqual(toasts);
    expect((t.h.banner as unknown as { pressAt: number }).pressAt).toBe(0);
    // Capture listeners must be unregistered too, not merely leave their controls inert.
    for (const el of retained) expect([...(el as unknown as { listeners: Map<string, unknown[]> }).listeners.values()].flat()).toEqual([]);
  });

  it.each([190, 110])('c4 / EM-3: an upper banner resizing from 150 to %i guards only the banners below it, using the observed height', (height) => {
    const w = fakeWindowAndFrames();
    const now = vi.spyOn(performance, 'now');
    const g2 = globalThis as unknown as { ResizeObserver?: unknown; MutationObserver?: unknown };
    const had = [g2.ResizeObserver, g2.MutationObserver];
    const changed: (() => void)[] = [];
    class FakeObs {
      constructor(cb: () => void) { changed.push(cb); }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    g2.ResizeObserver = g2.MutationObserver = FakeObs;
    try {
      const t = quakeTown();
      t.h.tick();
      for (const home of t.homesB.slice(0, 3)) triggerDisaster(t.sim, 'fire', home.x, home.z);
      t.h.tick();
      sizedBanners(t);
      const [above, upper, lower] = t.h.banner.bannerIds;
      let measured = 150, reads = 0;
      Object.defineProperty(parts(t.h, upper).el, 'offsetHeight', { configurable: true, get: () => { reads++; return measured; } });
      now.mockReturnValue(1e6);
      changed[0](); // ResizeObserver: the three full banners have been measured
      t.h.tick();
      w.frame(); w.frame();
      now.mockReturnValue(1e6 + 2000);
      const before = reads;
      for (let k = 0; k < 3; k++) t.h.tick();
      expect(reads).toBe(before);
      const banners = (t.h.banner as unknown as { banners: Map<number, { settleGen: number }> }).banners;
      const gens = [above, upper, lower].map((id) => banners.get(id)!.settleGen);
      measured = height;
      changed[0](); // a note / ETA wraps or shrinks; no full / compact switch or reordering
      t.h.tick();
      expect(reads).toBe(before + 1);
      expect([above, upper].map((id) => banners.get(id)!.settleGen)).toEqual(gens.slice(0, 2));
      expect(banners.get(lower)!.settleGen).toBeGreaterThan(gens[2]);
      expect(fullShown(t)).toEqual([above, upper, lower]);
      expect(press(t, w.winL, button(t.h, lower, /^Jump$/))).toBe(false);
      expect(press(t, w.winL, button(t.h, upper, /^Jump$/))).toBe(true);
      w.frame(); w.frame();
      now.mockReturnValue(1e6 + 2000 + SETTLE_MS + 1);
      expect(press(t, w.winL, button(t.h, lower, /^Jump$/))).toBe(true);
    } finally {
      now.mockRestore();
      w.restore();
      g2.ResizeObserver = had[0];
      g2.MutationObserver = had[1];
    }
  });

  it('c4: at 1024x600 a centred Budget folds the stack into the counted pill, clear of the panel title', () => {
    const t = quakeTown();
    quake(t);
    sizedBanners(t);
    // UI zoom 0.8: the playtest's Budget [259,110,995,458] and 1024x600 viewport, in layout px.
    t.h.root.clientWidth = 1024 / 0.8;
    t.h.root.clientHeight = 600 / 0.8;
    const hud = (t.h.root as unknown as { querySelector: (s: string) => FakeEl }).querySelector('.hud-bottom');
    hud.offsetTop = t.h.root.clientHeight - 96;
    const panel = new FakeEl('div');
    panel.className = 'panel center';
    Object.assign(panel, { offsetLeft: 259 / 0.8, offsetTop: 110 / 0.8, offsetWidth: 736 / 0.8, offsetHeight: 348 / 0.8 });
    t.h.root.querySelectorAll = () => [panel];
    const more = (t.h.banner as unknown as { more: FakeEl }).more;
    const s = t.h.banner.el.style;
    for (let k = 0; k < 4; k++) t.h.tick();
    expect(stackBottom(t.h).shown).toEqual([]);
    expect(stackBottom(t.h).capped).toHaveLength(10);
    expect(shown(more)).toBe(true);
    expect(more.textContent).toBe('10 more emergencies need you — open Emergencies');
    const width = parseFloat(String(s.width)) || BANNER_W;
    const left = parseFloat(String(s.left)) || (t.h.root.clientWidth - width) / 2;
    let y = parseFloat(String(s.top)) || STACK_TOP;
    const intersects = (top: number, height: number, py: number, ph: number) => left < panel.offsetLeft + panel.offsetWidth && left + width > panel.offsetLeft && top < py + ph && top + height > py;
    for (const id of stackBottom(t.h).shown) {
      const height = parts(t.h, id).el.offsetHeight;
      expect(intersects(y, height, panel.offsetTop + PANEL_HEAD_H, panel.offsetHeight - PANEL_HEAD_H)).toBe(false);
      y += height + 8;
    }
    expect(intersects(y, 34, panel.offsetTop, PANEL_HEAD_H)).toBe(false);
    expect(y + 34).toBeLessThanOrEqual(hud.offsetTop - TOOLBAR_GAP);
    // No room above even for the pill: the same pill-only docking clears the whole panel below it.
    panel.offsetTop = 60;
    t.h.tick();
    expect(parseFloat(String(s.top))).toBeGreaterThanOrEqual(panel.offsetTop + panel.offsetHeight);
    expect(more.textContent).toBe('10 more emergencies need you — open Emergencies');
    // A dismissed prompt is still counted alongside the folded banners.
    parts(t.h, t.h.banner.bannerIds[0]).el.all().find((e) => e.classList.contains('emg-x'))!.click();
    t.h.tick();
    expect(more.textContent).toBe('10 more emergencies need you — open Emergencies');
    // Closing Budget recovers the ordinary stack; folding did not dismiss its incidents.
    t.h.root.querySelectorAll = () => [];
    for (let k = 0; k < 3; k++) t.h.tick();
    expect(stackBottom(t.h).shown.length).toBeGreaterThan(0);
    expect(t.h.banner.bannerIds).toHaveLength(9);
  });

  it.each([
    { width: 1280, height: 720, zoom: 0.8, beside: false },
    { width: 1366, height: 650, zoom: 0.8, beside: true },
    { width: 1920, height: 1080, zoom: 1.09, beside: true },
  ])('c4: the existing Budget docking at $width x $height stays unchanged', ({ width, height, zoom, beside }) => {
    const t = quakeTown();
    quake(t);
    sizedBanners(t);
    t.h.root.clientWidth = width / zoom;
    t.h.root.clientHeight = height / zoom;
    const hud = (t.h.root as unknown as { querySelector: (s: string) => FakeEl }).querySelector('.hud-bottom');
    hud.offsetTop = t.h.root.clientHeight - 96;
    const panel = new FakeEl('div');
    panel.className = 'panel';
    Object.assign(panel, { offsetLeft: (t.h.root.clientWidth - 920) / 2, offsetTop: Math.round((t.h.root.clientHeight - 435) / 2) - 20, offsetWidth: 920, offsetHeight: 435 });
    t.h.root.querySelectorAll = () => [panel];
    const s = t.h.banner.el.style;
    const snapshot = () => ({ left: s.left, width: s.width, top: s.top, ...stackBottom(t.h), full: fullShown(t), more: (t.h.banner as unknown as { more: FakeEl }).more.textContent });
    for (let k = 0; k < 4; k++) t.h.tick();
    const before = snapshot(); // the original docking, without the centred-panel fallback
    panel.classList.add('center');
    for (let k = 0; k < 4; k++) t.h.tick();
    expect(snapshot()).toEqual(before);
    expect(before.shown.length).toBeGreaterThan(0);
    if (beside) {
      const left = parseFloat(String(s.left)), w = parseFloat(String(s.width));
      expect(left + w <= panel.offsetLeft + 1 || left >= panel.offsetLeft + panel.offsetWidth - 1).toBe(true);
    } else expect(before.bottom).toBeLessThanOrEqual(panel.offsetTop);
  });

  it('c2 (playtest c2 #1): heights are kept per stack width — a centre panel docks the stack narrow and compact; closed again, the centred stack gets its full banners back', () => {
    const t = quakeTown();
    quake(t);
    sizedBanners(t);
    const stack = t.h.banner.el as unknown as FakeEl;
    for (let k = 0; k < 3; k++) t.h.tick();
    const base = stackBottom(t.h);
    expect(fullShown(t).length).toBe(MAX_BANNERS);
    expect(base.pill).toBe(true);
    // a centre panel 788 px wide: the gaps beside it are 382 px — the stack docks narrow, where its banners are taller
    const panel = new FakeEl('div');
    panel.className = 'panel';
    Object.assign(panel, { offsetLeft: 406, offsetTop: 72, offsetWidth: 788, offsetHeight: 600 });
    t.h.root.querySelectorAll = () => [panel];
    for (let k = 0; k < 4; k++) t.h.tick();
    expect(parseInt(String(stack.style.width))).toBeLessThan(420);
    expect(fullShown(t).length).toBe(0);
    // closed: centred again with three full banners, the compact rows and the pill — not all compact for good (the
    // full heights measured in the narrow column were read for the centred stack)
    t.h.root.querySelectorAll = () => [];
    for (let k = 0; k < 4; k++) t.h.tick();
    expect(stack.style.width).toBe('');
    expect(fullShown(t).length).toBe(MAX_BANNERS);
    expect(stackBottom(t.h)).toEqual(base);
  });

  it('c2 (audit c2 #2): the settle guard holds only the banners that moved — a press above the change clicks at once; an ignored press flashes and sounds denied', () => {
    const w = fakeWindowAndFrames();
    const now = vi.spyOn(performance, 'now');
    try {
      const t = quakeTown();
      const em = emergencyOf(t.sim)!;
      const sounds: string[] = [];
      (t.h.banner as unknown as { ctx: { sound: (n: string) => void } }).ctx.sound = (n) => sounds.push(n);
      quake(t);
      now.mockReturnValue(1e6);
      t.h.tick();
      w.frame(); w.frame();
      now.mockReturnValue(1e6 + 2000);
      t.h.tick();
      const s0 = stackBottom(t.h).shown;
      // the third banner is dismissed (settled: its X clicks): the banners below it move up, the two above stay
      const x = parts(t.h, s0[2]).el.all().find((e) => e.className.includes('emg-x'))!;
      expect(press(t, w.winL, x)).toBe(true);
      now.mockReturnValue(1e6 + 2100);
      t.h.tick();
      const s1 = stackBottom(t.h).shown;
      expect(s1.slice(0, 2)).toEqual(s0.slice(0, 2));
      expect(s1[2]).toBe(s0[3]);
      // a press on the banner that moved up into the dismissed one's row: ignored — it flashes, its click sounds denied
      sounds.length = 0;
      const movedUp = button(t.h, s0[3], /^Send nearest/);
      expect(press(t, w.winL, movedUp)).toBe(false);
      expect(parts(t.h, s0[3]).el.classList.contains('settling')).toBe(true);
      expect(sounds).toEqual(['error']);
      expect(em.incident(s0[3])!.state).toBe('uncovered');
      // a press on a banner above the change (it never moved): sent at once (c1's guard dropped it)
      expect(press(t, w.winL, button(t.h, s0[1], /^Send nearest/))).toBe(true);
      expect(em.incident(s0[1])!.state).toBe('dispatched');
      // the moved banner, once settled: sent
      w.frame(); w.frame();
      now.mockReturnValue(1e6 + 2100 + SETTLE_MS + 1);
      expect(press(t, w.winL, movedUp)).toBe(true);
      expect(em.incident(s0[3])!.state).toBe('dispatched');
    } finally {
      now.mockRestore();
      w.restore();
    }
  });

  it('c2 (playtest c2 #2): the pressed control captures the pointer, and the hold ends on lostpointercapture', () => {
    const w = fakeWindowAndFrames();
    const now = vi.spyOn(performance, 'now');
    try {
      const t = quakeTown();
      quake(t);
      now.mockReturnValue(1e6);
      t.h.tick();
      w.frame(); w.frame();
      now.mockReturnValue(1e6 + 2000);
      const id = stackBottom(t.h).shown[0];
      const send = button(t.h, id, /^Send nearest/);
      const captured: number[] = [];
      (send as unknown as { setPointerCapture: (p: number) => void }).setPointerCapture = (p) => captured.push(p);
      const stack = t.h.banner.el as unknown as FakeEl;
      const L = (k: string) => (stack as unknown as { listeners: Map<string, ((e: unknown) => void)[]> }).listeners.get(k) ?? [];
      for (const f of L('pointerdown')) f({ target: send, pointerId: 7, preventDefault() {}, stopPropagation() {} });
      expect(captured).toEqual([7]);
      expect((t.h.banner as unknown as { pressAt: number }).pressAt).toBeGreaterThan(0);
      stack.fire('lostpointercapture');
      expect((t.h.banner as unknown as { pressAt: number }).pressAt).toBe(0);
    } finally {
      now.mockRestore();
      w.restore();
    }
  });

  it('c2: with the capture a drag off the pressed control still cancels it; a control that moved away from under a still pointer still clicks', () => {
    const w = fakeWindowAndFrames();
    const now = vi.spyOn(performance, 'now');
    try {
      const t = quakeTown();
      const em = emergencyOf(t.sim)!;
      quake(t);
      now.mockReturnValue(1e6);
      t.h.tick();
      w.frame(); w.frame();
      now.mockReturnValue(1e6 + 2000);
      t.h.tick();
      const [a, b] = stackBottom(t.h).shown;
      const stack = t.h.banner.el as unknown as FakeEl;
      const L = (k: string) => (stack as unknown as { listeners: Map<string, ((e: unknown) => void)[]> }).listeners.get(k) ?? [];
      type Box = { left: number; right: number; top: number; bottom: number };
      let box: Box = { left: 100, right: 220, top: 100, bottom: 128 };
      const boxed = (el: FakeEl): FakeEl => Object.assign(el, { getBoundingClientRect: () => ({ ...box }) });
      /** a mouse press at (x0, y0) released at (x1, y1) — the control moved to `moved` meanwhile: did its click run? */
      const drag = (ctl: FakeEl, x0: number, y0: number, x1: number, y1: number, moved?: Box): boolean => {
        let stopped = false;
        const ev = (x: number, y: number) => ({ target: ctl, pointerId: 1, detail: 1, clientX: x, clientY: y, preventDefault() {}, stopPropagation() { stopped = true; } });
        for (const f of L('pointerdown')) f(ev(x0, y0));
        if (stopped) return false;
        if (moved) box = moved;
        for (const f of w.winL.get('pointerup') ?? []) f({});
        for (const f of L('click')) f(ev(x1, y1));
        if (stopped) return false;
        ctl.click();
        return true;
      };
      // dragged 200 px off Send nearest and released there: nothing sent (the capture would have clicked it)
      const sendA = boxed(button(t.h, a, /^Send nearest/));
      expect(drag(sendA, 150, 114, 150, 314)).toBe(false);
      expect(em.incident(a)!.state).toBe('uncovered');
      // released on it: sent
      expect(drag(sendA, 150, 114, 160, 120)).toBe(true);
      expect(em.incident(a)!.state).toBe('dispatched');
      t.h.tick();
      w.frame(); w.frame();
      now.mockReturnValue(1e6 + 2000 + SETTLE_MS + 1000);
      // the next banner's button moved up a row during the press, the pointer stayed: sent
      box = { left: 100, right: 220, top: 100, bottom: 128 };
      const sendB = boxed(button(t.h, b, /^Send nearest/));
      expect(drag(sendB, 150, 114, 150, 114, { left: 100, right: 220, top: 40, bottom: 68 })).toBe(true);
      expect(em.incident(b)!.state).toBe('dispatched');
    } finally {
      now.mockRestore();
      w.restore();
    }
  });

  it('c2 (audit c2 #3): with every banner dismissed the pill alone docks clear of a centred panel\'s title row; it does not say "open Emergencies" while that panel is open', () => {
    const t = quakeTown();
    quake(t);
    for (const id of [...t.h.banner.bannerIds]) parts(t.h, id).el.all().find((e) => e.className.includes('emg-x'))!.click();
    t.h.tick();
    t.h.tick();
    expect(t.h.banner.bannerIds.length).toBe(0);
    const more = (t.h.banner as unknown as { more: FakeEl }).more;
    expect(shown(more)).toBe(true);
    expect(more.textContent).toBe('10 more emergencies need you — open Emergencies');
    const s = t.h.banner.el.style;
    expect(s.left ?? '').toBe(''); // (nothing in the way: the centred default)
    // a centred panel (the Rewards panel; its title and tabs at y 60 .. 60 + PANEL_HEAD_H)
    const panel = new FakeEl('div');
    panel.className = 'panel';
    Object.assign(panel, { offsetLeft: 480, offsetTop: 60, offsetWidth: 640, offsetHeight: 600 });
    t.h.root.querySelectorAll = () => [panel];
    t.h.tick();
    const left = parseInt(String(s.left)), top = s.top ? parseInt(String(s.top)) : STACK_TOP;
    expect(Number.isFinite(left)).toBe(true);
    const besideIt = left + BANNER_W <= 480 - 12 || left >= 480 + 640 + 12;
    expect(besideIt || top >= 60 + PANEL_HEAD_H).toBe(true);
    // the Emergencies panel open: the pill no longer tells the player to open it
    (t.h.banner as unknown as { ctx: { panels: { isOpen?: (id: string) => boolean } } }).ctx.panels.isOpen = (id) => id === 'emergencies';
    t.h.tick();
    expect(more.textContent).toBe('10 more emergencies need you — see the Emergencies panel');
    // closed: the centred default again
    t.h.root.querySelectorAll = () => [];
    t.h.tick();
    expect(s.left).toBe('');
  });
});

describe('dockBanners (P9)', () => {
  const W = 1600, top = 70, h = 110;
  it('centred while nothing is in the way', () => {
    expect(dockBanners(W, top, h, BANNER_W, [])).toBeNull();
    // a panel below the stack's rows is not in the way
    expect(dockBanners(W, top, h, BANNER_W, [{ x: 370, y: 220, w: 860, h: 400 }])).toBeNull();
  });
  it('left of a right-docked panel (the Advisors panel at 1280x720 / 1920x1080), as near the centre as fits', () => {
    const adv = { x: W - 640 - 14, y: 72, w: 640, h: 600 };
    const d = dockBanners(W, top, h, BANNER_W, [adv])!;
    expect(d.width).toBe(BANNER_W);
    expect(d.left + d.width).toBeLessThanOrEqual(adv.x - 12);
    expect(d.left + d.width).toBeCloseTo(adv.x - 12, 6);
    const W2 = 1920 / 1.09;
    const adv2 = { x: W2 - 640 - 14, y: 72, w: 640, h: 600 };
    const d2 = dockBanners(W2, top, h, BANNER_W, [adv2])!;
    expect(d2.left + d2.width).toBeLessThanOrEqual(adv2.x - 12);
  });
  it('narrower when the gap is tight; compact banners when only a lower stack fits; beside the headers at worst', () => {
    // Advisors on the right + Budget centred, overlapping the stack's rows: the left gap is 358 px wide -> narrowed
    const adv = { x: W - 654, y: 72, w: 640, h: 600 };
    const bud = { x: 370, y: 150, w: 860, h: 420 };
    const d = dockBanners(W, top, 230, BANNER_W, [adv, bud])!;
    expect(d.width).toBeGreaterThanOrEqual(BANNER_MIN_W);
    expect(d.width).toBeLessThan(BANNER_W);
    expect(d.left + d.width).toBeLessThanOrEqual(bud.x - 12);
    expect(d.compact).toBeUndefined();
    // the 1280x720 case: Advisors docked right, Budget pushed left under the stack (no gap beside both): a compact,
    // lower stack clears the Budget and goes left of Advisors
    const bud2 = { x: 80, y: 232, w: 847, h: 412 };
    const c = dockBanners(W, top, 187, BANNER_W, [adv, bud2], 70)!;
    expect(c.compact).toBe(true);
    expect(c.width).toBe(BANNER_W);
    expect(c.left + c.width).toBeLessThanOrEqual(adv.x - 12);
    // without a compact height to try: never over either panel's title / tab rows
    const c2 = dockBanners(W, top, 187, BANNER_W, [adv, bud2]);
    expect(clearOfHeads(c2, [adv, bud2], c2?.rows ? stackH(c2, 3) : 187)).toBe(true);
    // a wide panel across the middle: the stack may cover its body, never its title row
    const wide = { x: 200, y: 160, w: 1200, h: 500 };
    const d2 = dockBanners(W, top, 230, BANNER_W, [adv, wide]);
    expect(clearOfHeads(d2, [adv, wide], d2?.rows ? stackH(d2, 3) : 230)).toBe(true);
  });

  // EM-2: the two layouts that fell back to the centred default over the panels' titles and tabs (1280x720 = a 1600 x
  // 900 css-px layer at UI zoom 0.8): no gap of BANNER_MIN_W beside the panels, not even at their header rows
  const fb = (n: number) => ({ H: 900, rowH: 72, moreH: 42, n });
  it('EM-2: Advisors + Budget with 4 crime sprees — compact, at most 2 rows, never over a title or tab row', () => {
    const adv = { x: 946, y: 72, w: 640, h: 578 };
    const bud = { x: 341, y: 215, w: 918, h: 429 };
    // 3 full banners + 1 compact (the old stack: x 580-1020 over "Advisors & news", its tab and the Budget's tax columns)
    const d = dockBanners(W, top, 3 * 170 + 70 - 8, BANNER_W, [adv, bud], 4 * 72 - 8, 12, fb(4));
    expect(d).not.toBeNull();
    expect(d!.compact).toBe(true);
    expect(d!.rows).toBeGreaterThanOrEqual(1);
    expect(d!.rows).toBeLessThanOrEqual(2);
    expect(d!.width).toBe(BANNER_W);
    expect(clearOfHeads(d, [adv, bud], stackH(d!, 4))).toBe(true);
    // on the layer, above the bottom toolbar
    expect(d!.left).toBeGreaterThanOrEqual(12);
    expect(d!.left + d!.width).toBeLessThanOrEqual(W - 12);
    expect(d!.top! + stackH(d!, 4)).toBeLessThanOrEqual(900 - 84);
  });
  it('EM-2: Budget + Advisors + inspector with one banner — below their header rows, never over the Budget tabs', () => {
    const bud = { x: 341, y: 119, w: 918, h: 625 };
    const adv = { x: 556, y: 72, w: 640, h: 578 };
    const insp = { x: 1207, y: 72, w: 378, h: 572 };
    const d = dockBanners(W, top, 156, BANNER_W, [bud, adv, insp], 64, 12, fb(1));
    expect(d).not.toBeNull();
    expect(d!.compact).toBe(true);
    expect(d!.rows).toBe(1);
    expect(clearOfHeads(d, [bud, adv, insp], stackH(d!, 1))).toBe(true);
    // the old place (x 580-1020 from y 70) hid the Budget's tab row: now it starts below it
    expect(d!.top!).toBeGreaterThanOrEqual(bud.y + PANEL_HEAD_H);
    // room beside the panels keeps the old docking (full banners at the default top): the inspector alone leaves the
    // centre free, Advisors docked right puts the stack left of it
    expect(dockBanners(W, top, 156, BANNER_W, [insp], 64, 12, fb(1))).toBeNull();
    const one = dockBanners(W, top, 156, BANNER_W, [{ x: 946, y: 72, w: 640, h: 578 }], 64, 12, fb(1))!;
    expect([one.top, one.rows, one.compact, one.width]).toEqual([undefined, undefined, undefined, BANNER_W]);
    expect(one.left + one.width).toBeLessThanOrEqual(946 - 12);
    // the centred Budget alone (its title at y 119, under a 156-px banner from y 70): below its tab row as well
    const b1 = dockBanners(W, top, 156, BANNER_W, [bud], 64, 12, fb(1));
    expect(clearOfHeads(b1, [bud], b1?.rows ? stackH(b1, 1) : 156)).toBe(true);
  });
});

/** the stack's height at place d with n banners (capped: rows + the "more" pill) */
function stackH(d: DockPlace, n: number): number {
  const k = d.rows ?? n;
  return k * 72 + (n > k ? 42 : 0) - 8;
}
/** the stack (place d, or the centred default from the top) covers no panel's title / tab rows (PANEL_HEAD_H) */
function clearOfHeads(d: DockPlace | null, panels: { x: number; y: number; w: number; h: number }[], h: number, W = 1600, top = 70): boolean {
  const l = d ? d.left : (W - BANNER_W) / 2, w = d ? d.width : BANNER_W, y = d?.top ?? top;
  return panels.every((p) => l >= p.x + p.w || l + w <= p.x || y >= p.y + Math.min(p.h, PANEL_HEAD_H) || y + h <= p.y);
}
