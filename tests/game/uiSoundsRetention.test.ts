/**
 * Close-out c2 sweep (item 1: module-level references that outlive the city): src/ui/uiSounds.ts kept the last hovered
 * menu / toolbar control and the held slider in module-level variables. After exit to region the city's HUD is a
 * detached DOM tree, and one of its buttons held there keeps the whole tree — its listeners, and through them the
 * CityScene — alive until the next hover. Both are weak references now; hover de-duplication and the slider's release
 * sound still work.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import v8 from 'node:v8';
import vm from 'node:vm';

v8.setFlagsFromString('--expose_gc');
const gc = vm.runInNewContext('gc') as () => void;

class FakeElement {
  disabled = false;
  /** stand-in for the detached city HUD a control keeps alive */
  tree = { hud: new Float64Array(1 << 14) };
  constructor(readonly cls: string) {}
  closest(sel: string): FakeElement | null {
    return sel.split(',').some((s) => s.trim() === '.' + this.cls) ? this : null;
  }
  getAttribute(): string | null {
    return null;
  }
  get classList() {
    return { contains: () => false };
  }
}
class FakeInput extends FakeElement {
  type = 'range';
  value = '10';
  min = '0';
  max = '100';
}

const win = new Map<string, ((e: unknown) => void)[]>();
const g = globalThis as unknown as Record<string, unknown>;
const had: Record<string, unknown> = {};
const played: string[] = [];
let hovers = 0;
beforeAll(() => {
  for (const k of ['window', 'Element', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLLabelElement']) had[k] = g[k];
  g.Element = FakeElement;
  g.HTMLInputElement = FakeInput;
  g.HTMLSelectElement = class {};
  g.HTMLLabelElement = class {};
  g.window = { addEventListener: (k: string, f: (e: unknown) => void) => win.set(k, [...(win.get(k) ?? []), f]), removeEventListener: () => undefined, innerWidth: 1280 };
});
afterAll(() => {
  for (const k of Object.keys(had)) g[k] = had[k];
});

const fire = (k: string, e: unknown) => { for (const f of win.get(k) ?? []) f(e); };

async function collected(ref: WeakRef<object>): Promise<boolean> {
  for (let k = 0; k < 20; k++) {
    await new Promise((r) => setTimeout(r, k ? 20 : 0));
    gc();
    if (ref.deref() === undefined) return true;
  }
  return false;
}

describe('uiSounds keeps no exited HUD element alive (close-out c2 sweep)', () => {
  it('the last hovered toolbar button and the held slider are weak references', async () => {
    const { installUiSounds } = await import('../../src/ui/uiSounds');
    const audio = { play: (n: string) => { played.push(n); }, hover: () => { hovers++; }, get playCount() { return played.length; } };
    const off = installUiSounds(() => audio);
    expect(win.has('pointerover') && win.has('pointerdown') && win.has('pointerup')).toBe(true);
    // hover a toolbar button (one blip), hover it again (none), then the city goes: its HUD is dropped
    const hoverAndDrop = (): WeakRef<object> => {
      const btn = new FakeElement('tb-btn');
      fire('pointerover', { pointerType: 'mouse', target: btn });
      fire('pointerover', { pointerType: 'mouse', target: btn });
      return new WeakRef(btn);
    };
    const btnRef = hoverAndDrop();
    expect(hovers).toBe(1);
    expect(await collected(btnRef)).toBe(true);
    // a slider pressed and the city gone before its release
    const pressAndDrop = (): WeakRef<object> => {
      const s = new FakeInput('range');
      fire('pointerdown', { target: s });
      return new WeakRef(s);
    };
    const sliderRef = pressAndDrop();
    expect(await collected(sliderRef)).toBe(true);
    // (a release with nothing held plays nothing; a live slider still settles with its sound)
    fire('pointerup', {});
    expect(played).toEqual([]);
    const live = new FakeInput('range');
    fire('pointerdown', { target: live });
    live.value = '40';
    fire('pointerup', {});
    expect(played).toEqual(['sliderRelease']);
    off();
  });
});
