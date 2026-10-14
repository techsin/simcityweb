/**
 * Lane ui-panels, final fixes:
 *  P12 — open panels were not re-anchored after a 1920×1080 → 1280×720 resize (the Data views panel sat mid-screen):
 *        anchoredPos keeps a panel's docked edge (right / centred / left) and the panel fully on screen;
 *  A1  — panels rebuilt their whole content on every 6 Hz UI tick at ultra speed: Panel.gate lets a data-only change
 *        through at most once per real second (a change of what is shown — a tab — at once);
 *  P10 — the budget sliders: stepSlider / stepButtons give exact −/+ steps (and the slider keeps the keyboard focus).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PANEL_REBUILD_MS, Panel, anchoredPos, clearOfHud } from '../../src/ui/Panel';
import { slider, stepButtons, stepSlider } from '../../src/ui/dom';
import type { GameContext } from '../../src/game/context';

describe('anchoredPos (final fixes P12): a resize keeps the docked edge', () => {
  it('right-docked keeps its gap to the right edge', () => {
    // the Data views panel at 1920×1080 (layout 1761 × 990): x = 1761 − 400 − 14
    const a = anchoredPos(1347, 72, 400, 560, 1761, 990, 1600, 900);
    expect(a).toEqual({ x: 1600 - 400 - 14, y: 72 });
  });
  it('centred stays centred (also vertically for centre panels); left-docked keeps its left', () => {
    const c = anchoredPos((1761 - 900) / 2, Math.round((990 - 600) / 2) - 20, 900, 600, 1761, 990, 1600, 900, true);
    expect(c.x).toBe(350);
    expect(c.y).toBe(Math.round((900 - 600) / 2) - 20);
    const l = anchoredPos(40, 200, 300, 300, 1761, 990, 1600, 900);
    expect(l).toEqual({ x: 40, y: 200 });
  });
  it('always fully on screen, below the top bar', () => {
    expect(anchoredPos(1500, 800, 400, 300, 1600, 900, 1280, 720)).toEqual({ x: 1280 - 400 - 4, y: 720 - 300 - 8 });
    expect(anchoredPos(-300, 10, 400, 300, 1600, 900, 1600, 900)).toEqual({ x: 4, y: 64 });
    // taller than the layer: the top stays under the top bar
    expect(anchoredPos(100, 300, 400, 2000, 1600, 900, 1600, 900).y).toBe(64);
  });
});

describe('clearOfHud (routed from emergency r1): panels open right of the toasts', () => {
  // the top-left HUD column (toasts, onboarding card) is 12 + 350 px wide: panels keep 12 px from it
  const minLeft = 374;
  it('a centred 920 px Budget in a 1600 px layer (1280×720) moves right of the column instead of under the toasts', () => {
    expect(clearOfHud((1600 - 920) / 2, 920, 1600, minLeft)).toBe(minLeft);
    // the panel beside Advisors & news would have been shifted to x = 60
    expect(clearOfHud(60, 920, 1600, minLeft)).toBe(minLeft);
  });
  it('already clear, or no room for it (a narrow layer): x stays', () => {
    expect(clearOfHud(500, 920, 1920, minLeft)).toBe(500);
    expect(clearOfHud(180, 920, 1280, minLeft)).toBe(180);
  });
  it('a centre panel moved out of the column still re-centres after a resize', () => {
    expect(anchoredPos(minLeft, 130, 920, 600, 1600, 900, 1920, 1080, true).x).toBe((1920 - 920) / 2);
    // a non-centre panel that far off centre keeps its docked edge
    expect(anchoredPos(minLeft, 130, 920, 600, 1600, 900, 1920, 1080).x).toBe(1920 - 920 - (1600 - minLeft - 920));
  });
});

class GatePanel extends Panel {
  readonly id = 'g';
  readonly title = 'G';
  protected build(): void {}
  /** expose the gate */
  check(key: string, sig: string): boolean {
    return this.gate(key, sig);
  }
  reset(): void {
    this.resetGate();
  }
}

describe('Panel.gate (final fixes A1): at most one data-only rebuild per real second', () => {
  it('same content: no rebuild; new data: once a second; new key (tab) or reset: at once', async () => {
    const p = new GatePanel({} as GameContext);
    expect(p.check('people', 'a')).toBe(true);
    expect(p.check('people', 'a')).toBe(false);
    // the data moved on a moment later: held back
    expect(p.check('people', 'b')).toBe(false);
    // a tab switch: at once
    expect(p.check('services', 'b')).toBe(true);
    p.reset();
    expect(p.check('services', 'b')).toBe(true);
    // a second later the held-back data goes through
    const t0 = performance.now();
    await new Promise((r) => setTimeout(r, PANEL_REBUILD_MS + 30));
    expect(performance.now() - t0).toBeGreaterThanOrEqual(PANEL_REBUILD_MS);
    expect(p.check('services', 'c')).toBe(true);
  });
});

describe('stepSlider (final fixes P10): exact steps like the arrow keys', () => {
  const fake = (value: number, min = 0, max = 20, step = 0.5) => {
    const events: string[] = [];
    const el = { value: String(value), min: String(min), max: String(max), step: String(step), dispatchEvent: (e: Event) => events.push(e.type) };
    return { el: el as unknown as HTMLInputElement, events };
  };
  it('one step per press, snapped to the step grid, clamped at the ends, with the input event the panels listen to', () => {
    const a = fake(9);
    expect(stepSlider(a.el, 1)).toBe(true);
    expect(a.el.value).toBe('9.5');
    expect(a.events).toEqual(['input', 'change']);
    const b = fake(11.25);
    stepSlider(b.el, 1);
    expect(b.el.value).toBe('11.5');
    const c = fake(20);
    expect(stepSlider(c.el, 1)).toBe(false);
    expect(c.el.value).toBe('20');
    const d = fake(100, 0, 150, 5);
    stepSlider(d.el, -1);
    expect(d.el.value).toBe('95');
  });
});

// ------------------------------------------------------------------------------------------------ slider focus (P10)
/** a minimal element / document: listeners, focus and blur (what slider() and stepButtons() touch) */
class FakeEl {
  listeners = new Map<string, ((e: unknown) => void)[]>();
  attrs: Record<string, string> = {};
  style = { setProperty: (_k: string, _v: string) => {} } as unknown as CSSStyleDeclaration;
  className = '';
  value = '';
  isConnected = true;
  children: unknown[] = [];
  constructor(readonly tagName: string, private doc: FakeDoc) {}
  get min() { return this.attrs.min; }
  get max() { return this.attrs.max; }
  get step() { return this.attrs.step; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  appendChild(c: unknown) { this.children.push(c); return c; }
  addEventListener(t: string, f: (e: unknown) => void) { this.listeners.set(t, [...(this.listeners.get(t) ?? []), f]); }
  dispatchEvent(e: { type: string }) { this.fire(e.type, e); return true; }
  fire(t: string, e: unknown = {}) { for (const f of this.listeners.get(t) ?? []) f(e); }
  focus() { if (this.doc.activeElement !== this) { this.doc.activeElement = this; this.fire('focus'); } }
  blur() { if (this.doc.activeElement === this) { this.doc.activeElement = null; this.fire('blur'); } }
  closest() { return null; }
}
class FakeDoc {
  activeElement: FakeEl | null = null;
  docListeners = new Map<string, ((e: unknown) => void)[]>();
  createElement(t: string) { return new FakeEl(t.toUpperCase(), this); }
  createTextNode(s: string) { return { textContent: s }; }
  addEventListener(t: string, f: (e: unknown) => void) { this.docListeners.set(t, [...(this.docListeners.get(t) ?? []), f]); }
  removeEventListener(t: string, f: (e: unknown) => void) { this.docListeners.set(t, (this.docListeners.get(t) ?? []).filter((g) => g !== f)); }
  firePointerDown(target: unknown) { for (const f of [...(this.docListeners.get('pointerdown') ?? [])]) f({ target }); }
}

describe('slider focus (final fixes P10): arrows step it, any other key or a press elsewhere releases it', () => {
  const g = globalThis as unknown as { document?: unknown };
  let had: unknown;
  const doc = new FakeDoc();
  beforeAll(() => {
    had = g.document;
    g.document = doc;
  });
  afterAll(() => {
    g.document = had;
  });
  const make = () => {
    const values: number[] = [];
    const el = slider({ min: 0, max: 20, step: 0.5, value: 9, oninput: (v) => values.push(v) }) as unknown as FakeEl;
    return { el, values };
  };
  it('keeps the focus for the keys a slider uses; W / Esc / a hotkey release it before the camera sees the key', () => {
    const { el } = make();
    el.focus();
    for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End', 'PageUp', 'Shift']) {
      el.fire('keydown', { key });
      el.fire('keyup', { key });
      expect(doc.activeElement).toBe(el);
    }
    el.fire('keydown', { key: 'w' });
    expect(doc.activeElement).toBeNull();
    el.focus();
    el.fire('keydown', { key: 'Escape' });
    expect(doc.activeElement).toBeNull();
  });
  it('a key held from before the click: its release frees the slider (the camera then sees the key-up)', () => {
    const { el } = make();
    el.focus();
    el.fire('keyup', { key: 'w' });
    expect(doc.activeElement).toBeNull();
  });
  it('a pointer press elsewhere releases it; on the slider itself or its own − / + buttons it keeps it', () => {
    const { el, values } = make();
    const [dn, up] = stepButtons(el as unknown as HTMLInputElement, 'R$ tax') as unknown as FakeEl[];
    el.focus();
    doc.firePointerDown(el);
    expect(doc.activeElement).toBe(el);
    const own = { closest: () => up };
    doc.firePointerDown(own);
    expect(doc.activeElement).toBe(el);
    up.fire('click');
    expect(values).toEqual([9.5]);
    dn.fire('click');
    expect(values).toEqual([9.5, 9]);
    expect(doc.activeElement).toBe(el);
    doc.firePointerDown({ closest: () => null });
    expect(doc.activeElement).toBeNull();
    // (no listener left behind once it lost the focus)
    expect(doc.docListeners.get('pointerdown') ?? []).toHaveLength(0);
  });
});
