/** T025: a live city signal must not retain the Budget subtrees replaced each month. */
import { describe, expect, it, vi } from 'vitest';
import v8 from 'node:v8';
import vm from 'node:vm';
import { setMaxListeners } from 'node:events';
import type { GameContext } from '../../src/game/context';
import { Simulation } from '../../src/sim/Simulation';
import { BudgetPanel } from '../../src/ui/panels/BudgetPanel';
import { h, paintFill, setSlider, slider } from '../../src/ui/dom';
import { newState } from '../infra/cityGen';
import { FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();
v8.setFlagsFromString('--expose_gc');
const gc = vm.runInNewContext('gc') as () => void;

async function collected(refs: WeakRef<object>[]): Promise<boolean> {
  for (let k = 0; k < 40; k++) {
    await new Promise((r) => setTimeout(r, k ? 25 : 0));
    gc();
    if (refs.every((r) => r.deref() === undefined)) return true;
  }
  return false;
}

function replacedRows(panel: BudgetPanel, sim: Simulation): WeakRef<object>[] {
  const refs: WeakRef<object>[] = [];
  for (let month = 1; month <= 40; month++) {
    const input = (panel.el as unknown as FEl).querySelector('input')!;
    refs.push(new WeakRef(input), new WeakRef(input.parentElement!));
    sim.events.emit('month', month);
  }
  return refs;
}

describe('slider retention (T025)', () => {
  it('signal-bound listeners do not keep their target alive, even when the callback captures it', async () => {
    const ac = new AbortController();
    const make = () => {
      const el = new FEl('button');
      el.addEventListener('click', () => { el.title = 'clicked'; }, { signal: ac.signal });
      return new WeakRef(el);
    };
    expect(await collected([make()])).toBe(true);
    expect(ac.signal.aborted).toBe(false);
    ac.abort('dispose');
  });

  it('abort removes live listeners and an already aborted signal adds none', () => {
    const ac = new AbortController(), hit = vi.fn();
    const el = h('button', { signal: ac.signal, onclick: hit }) as unknown as FEl;
    el.click();
    ac.abort('dispose');
    el.click();
    el.addEventListener('click', hit, { signal: ac.signal });
    expect(el.listenerCount()).toBe(0);
    expect(hit).toHaveBeenCalledTimes(1);
  });

  it.each(['Taxes', 'Services'])('%s: 40 monthly rebuilds are collectable before the city exits', async (tab) => {
    const ac = new AbortController();
    setMaxListeners(0, ac.signal);
    const state = newState(32), sim = new Simulation(state, []);
    const ctx = { state, sim, signal: ac.signal, mods: {} } as unknown as GameContext;
    const panel = new BudgetPanel(ctx);
    panel.mount(() => {}, () => {}, () => {});
    panel.isOpen = true;
    const el = panel.el as unknown as FEl;
    el.all().find((e) => e.tagName === 'button' && textOf(e) === tab)!.click();
    try {
      expect(await collected(replacedRows(panel, sim))).toBe(true);
      expect(ac.signal.aborted).toBe(false);
      expect(el.querySelectorAll('input').length).toBeGreaterThan(0);
      expect(panel.isOpen).toBe(true);
    } finally {
      ac.abort('dispose');
    }
  });

  it('a held slider cannot retain its callback owner after abort, and can still paint', async () => {
    const ac = new AbortController();
    const make = () => {
      const city = { value: 0 };
      const el = slider({ signal: ac.signal, min: 0, max: 10, value: 5, oninput: (v) => { city.value = v; } });
      return { el, ref: new WeakRef(city) };
    };
    const { el, ref } = make();
    ac.abort('dispose');
    expect(await collected([ref])).toBe(true);
    setSlider(el, 7);
    expect((el as unknown as FEl).style['--fill']).toBe('70.0%');
  });

  it('initial, input and programmatic fills use the input bounds without firing extra callbacks', () => {
    const hit = vi.fn();
    const el = slider({ min: 10, max: 20, step: 0.5, value: 12.5, oninput: hit });
    const fake = el as unknown as FEl;
    expect(fake.style['--fill']).toBe('25.0%');
    el.value = '15';
    fake.fire('input');
    expect(fake.style['--fill']).toBe('50.0%');
    expect(hit).toHaveBeenCalledExactlyOnceWith(15);
    setSlider(el, 20);
    expect(fake.style['--fill']).toBe('100.0%');
    expect(hit).toHaveBeenCalledTimes(1);
    fake.setAttribute('max', '30');
    paintFill(el);
    expect(fake.style['--fill']).toBe('50.0%');
    fake.setAttribute('min', '20');
    fake.setAttribute('max', '20');
    paintFill(el);
    expect(fake.style['--fill']).toBe('0.0%');
  });
});
