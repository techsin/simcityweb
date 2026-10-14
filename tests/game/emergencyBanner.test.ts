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
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Network } from '../../src/core/types';
import type { CityState } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { emergencyOf } from '../../src/sim/infra/emergency';
import { getFire, infraSystems, triggerDisaster } from '../../src/sim/systems/infra';
import { deserializeCity, serializeCity, type SerializedCity } from '../../src/save/serialize';
import { BANNER_MIN_W, BANNER_W, EmergencyBanner, KIND_COOLDOWN, PANEL_HEAD_H, dockBanners, stateText, supportText, type DockPlace } from '../../src/ui/EmergencyBanner';
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
