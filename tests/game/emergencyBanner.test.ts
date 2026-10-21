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
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Network } from '../../src/core/types';
import type { CityState } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { emergencyOf } from '../../src/sim/infra/emergency';
import { getFire, infraSystems, triggerDisaster } from '../../src/sim/systems/infra';
import { deserializeCity, serializeCity, type SerializedCity } from '../../src/save/serialize';
import {
  BANNER_MIN_W, BANNER_W, EmergencyBanner, KIND_COOLDOWN, MAX_BANNERS, PANEL_HEAD_H, PRESS_HOLD_MS, STACK_TOP, TOOLBAR_GAP, dockBanners, fitRows, stateText,
  supportText,
  type DockPlace,
} from '../../src/ui/EmergencyBanner';
import type { GameContext } from '../../src/game/context';
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
  addEventListener(t: string, f: (e: unknown) => void): void {
    this.listeners.set(t, [...(this.listeners.get(t) ?? []), f]);
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
interface Harness { banner: EmergencyBanner; sim: Simulation; root: FakeEl; toasts: string[]; tick(): void }
function harness(sim: Simulation): Harness {
  const root = new FakeEl('div');
  const toasts: string[] = [];
  const handlers: (() => void)[] = [];
  const ctx = {
    get state() { return sim.state; },
    sim,
    root,
    settings: { emergencyUncovered: 'live', emergencyAlerts: 'major', emergencyLiveSlowmo: 3 },
    ui: { on: (_k: string, f: () => void) => { handlers.push(f); return () => undefined; } },
    signal: new AbortController().signal,
    panels: { open: () => undefined },
    sound: () => undefined,
    toast: (t: string) => { toasts.push(t); },
    focusCell: () => undefined,
    showQuery: () => undefined,
  } as unknown as GameContext;
  const banner = new EmergencyBanner(ctx, root as unknown as HTMLElement);
  return { banner, sim, root, toasts, tick: () => { for (const f of handlers) f(); } };
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
  it('F2: a second uncovered major call of the same kind 7 days later still gets a banner and LIVE mode', () => {
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

  it('P1: an industrial accident whose ambulance went automatically keeps its banner and LIVE until a fire truck is sent', () => {
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
  const pending = (h: Harness) => (h.banner as unknown as { pendingCount(p: string): number }).pendingCount('live');

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
    for (const b of (h.banner as unknown as { banners: Map<number, { optsDay: number }> }).banners.values()) b.optsDay = -1;
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
      // a press whose release the window never saw (let go outside it) holds the docking PRESS_HOLD_MS at most
      fly.className = 'flyout mp-glass open';
      (t.h.banner.el as unknown as FakeEl).fire('pointerdown');
      now.mockReturnValue(1e6 + 300);
      t.h.tick();
      expect(stackBottom(t.h).shown).toEqual(s2.shown);
      now.mockReturnValue(1e6 + 300 + PRESS_HOLD_MS + 1);
      t.h.tick();
      expect(stackBottom(t.h).bottom).toBeLessThanOrEqual(top - TOOLBAR_GAP);
    } finally {
      now.mockRestore();
      gw.window = hadWin;
    }
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
