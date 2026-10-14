/**
 * Lane ui-panels, final fixes:
 *  P12 — open panels were not re-anchored after a 1920×1080 → 1280×720 resize (the Data views panel sat mid-screen):
 *        anchoredPos keeps a panel's docked edge (right / centred / left) and the panel fully on screen;
 *  A1  — panels rebuilt their whole content on every 6 Hz UI tick at ultra speed: Panel.gate lets a data-only change
 *        through at most once per real second (a change of what is shown — a tab — at once);
 *  P10 — the budget sliders: stepSlider / stepButtons give exact −/+ steps (and the slider keeps the keyboard focus).
 */
import { describe, expect, it } from 'vitest';
import { PANEL_REBUILD_MS, Panel, anchoredPos } from '../../src/ui/Panel';
import { stepSlider } from '../../src/ui/dom';
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
