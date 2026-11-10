/**
 * LG-12: the New City dialog when it founds a sister city (src/region/NewCityDialog.ts endowmentField).
 * - The parent's mayor is filled in; the endowment slider runs from 0 to the plan's limit, with a note on the rule and on
 *   what the new city starts with.
 * - "Found City" with an endowment asks first: the transfer can't be undone. Declining returns to the form, agreeing
 *   founds the city and writes the amount into the plan. Cancelling the dialog leaves the amount at 0.
 * - A parent inside its 10 years gets the reason with the date instead of the slider; a sandbox city gets no endowment.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openNewCityDialog } from '../../src/region/NewCityDialog';
import type { RegionModel } from '../../src/region/RegionModel';
import type { SisterPlan } from '../../src/region/regionEffects';
import type { RegionTile } from '../../src/region/types';
import { setUiRoot } from '../../src/region/ui/modal';
import { defaultCityConfig, type CityConfigData } from '../../src/sim/config';
import { FEl, FNode, installFakeDom, textOf } from './fakeDom';

installFakeDom();
let store: Map<string, string>;
let root: FEl;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal('Node', FNode);
  vi.stubGlobal('window', new FEl('window'));
  root = new FEl('div');
  setUiRoot(root as unknown as HTMLElement);
});
afterEach(() => vi.unstubAllGlobals());

/** a region stand-in with the parent's tile and the free tile next to it (a profile that has founded cities: Medium) */
function region(): RegionModel {
  const free: RegionTile = { key: '6_4', x: 6, z: 4, size: 2 };
  const parent = { key: '4_4', x: 4, z: 4, size: 2, city: { name: 'Queensbury' } } as unknown as RegionTile;
  return { data: { name: 'Test Valley', tiles: [free, parent] }, cityConfigFor: (_t: RegionTile, p: Partial<CityConfigData> = {}) => defaultCityConfig({ size: 128, terrain: 'region', ...p }) } as unknown as RegionModel;
}

const BLOCKED = 'Queensbury endowed a sister city in Apr 2043. It can endow another from Apr 2053 (once every 10 years).';
function sisterPlan(m: RegionModel, over: Partial<SisterPlan> = {}): SisterPlan {
  return {
    id: 's1', from: m.data.tiles[1], to: m.data.tiles[0],
    parent: { tileKey: '4_4', name: 'Queensbury', mayor: 'Ada Lovell', funds: 8_000_000, day: 15_570, startYear: 2000, sandbox: false, edgeRoads: { n: [], s: [], e: [], w: [] } },
    limit: 2_000_000, step: 10_000, amount: 0, stub: [], ...over,
  };
}

type Input = FEl & { checked: boolean };
/** open the dialog (with a plan: founding a sister city); its parts, and the promise of its result */
function open(over?: Partial<SisterPlan> | null) {
  const m = region();
  const plan = over === null ? undefined : sisterPlan(m, over);
  let settled = false;
  const result = openNewCityDialog({ region: m, tile: m.data.tiles[0], sister: plan });
  void result.then(() => { settled = true; });
  const dlg = root.querySelector('.modal')!;
  const texts = dlg.querySelectorAll('input').filter((i) => i.getAttribute('type') === 'text') as Input[];
  const endow = () => dlg.querySelector('.nc-endow');
  const range = () => (endow()?.querySelector('input') ?? undefined) as Input | undefined;
  const press = (box: FEl, label: string) => box.querySelectorAll('button').find((b) => textOf(b) === label)!.click();
  return {
    plan, result, dlg, name: texts[0], mayor: texts[1], endow, range,
    settled: () => settled,
    note: () => textOf(endow()!.querySelector('.nc-note')!),
    card: (title: string) => dlg.querySelector('.nc-diff')!.querySelectorAll('.seg-item').find((b) => textOf(b.querySelector('.si-t')!) === title)!,
    slide: (v: number) => { const i = range()!; i.value = String(v); i.fire('input'); },
    found: () => press(dlg, 'Found City'),
    cancel: () => press(dlg, 'Cancel'),
    /** the confirmation on top of the dialog, if one is open (a closed one stays in the tree for its fade) */
    confirm: () => { const all = root.querySelectorAll('.modal'); return all.length > 1 ? all[all.length - 1] : null; },
    press,
  };
}
/** let the dialogs' promises run */
const tick = async () => { for (let k = 0; k < 4; k++) await Promise.resolve(); };

describe('LG-12: the New City dialog founding a sister city', () => {
  it('is titled for it, with the parent\'s mayor filled in and the endowment under the starting funds', () => {
    const d = open();
    expect(textOf(d.dlg.querySelector('h2')!)).toBe('Found a Sister City');
    expect(textOf(d.dlg.querySelector('.mh-sub')!)).toContain('Test Valley · sister city of Queensbury');
    expect(d.mayor.getAttribute('value')).toBe('Ada Lovell');
    expect(d.name.getAttribute('value')).not.toBe('Ada Lovell');
    const r = d.range()!;
    expect([r.getAttribute('type'), r.min, r.max, r.step, r.value]).toEqual(['range', '0', '2000000', '10000', '0']);
    expect(textOf(d.endow()!.querySelector('.field-label')!)).toBe('Endowment from Queensbury§0');
    expect(d.note()).toBe('Queensbury can give up to §2,000,000: 25% of its §8,000,000, at most §5,000,000, once every 10 years.');
    // the field sits right after the difficulty cards (the starting funds it adds to)
    const form = d.endow()!.parentElement!;
    const at = form.children.indexOf(d.endow()!);
    expect(form.children[at - 1].querySelector('.nc-diff')).not.toBeNull();
  });

  it('the note follows the slider and the difficulty: what the new city starts with', () => {
    const d = open();
    d.card('Medium').click();
    d.slide(2_000_000);
    expect(textOf(d.endow()!.querySelector('.fl-val')!)).toBe('§2.00M');
    expect(d.note()).toBe('The new city starts with §2,100,000 (§100,000 + §2,000,000). Queensbury pays it once, on its budget line “Sister city endowment”.');
    d.card('Hard').click();
    expect(d.note()).toBe('The new city starts with §2,040,000 (§40,000 + §2,000,000). Queensbury pays it once, on its budget line “Sister city endowment”.');
    d.slide(0);
    expect(d.note()).toMatch(/^Queensbury can give up to §2,000,000/);
    // never more than the limit, whatever the control reports
    d.slide(9_000_000);
    expect(d.note()).toMatch(/^The new city starts with §2,040,000 /);
  });

  it('Found City asks first, saying the transfer can\'t be undone; declining returns to the form, agreeing founds', async () => {
    const d = open();
    d.card('Medium').click();
    d.name.value = 'Fairland';
    d.mayor.value = d.mayor.getAttribute('value')!; // (a browser shows the attribute as the field's value)
    d.slide(2_000_000);
    d.found();
    await tick();
    const ask = d.confirm()!;
    expect(textOf(ask.querySelector('h2')!)).toBe('Give §2,000,000 to Fairland?');
    expect(textOf(ask.querySelector('.modal-body')!)).toBe('Queensbury pays §2,000,000 from its treasury when the city is founded. This transfer can’t be undone, and Queensbury can’t endow another sister city for 10 years.');
    expect([d.settled(), d.plan!.amount]).toEqual([false, 0]);
    // pressing Found again while it asks opens no second question
    d.found();
    expect(root.querySelectorAll('.modal')).toHaveLength(2);
    d.press(ask, 'Cancel');
    await tick();
    expect([d.settled(), d.plan!.amount]).toEqual([false, 0]);
    // the form is still there, with the amount as it was: ask again, and agree
    d.found();
    await tick();
    const again = d.confirm()!;
    expect(again).not.toBe(ask);
    d.press(again, 'Found and give');
    await tick();
    expect(d.settled()).toBe(true);
    const cfg = (await d.result)!;
    expect(cfg).toMatchObject({ name: 'Fairland', mayor: 'Ada Lovell', difficulty: 'medium', startFunds: 100_000, size: 128 });
    expect(d.plan!.amount).toBe(2_000_000);
  });

  it('without an endowment it founds at once; cancelling the dialog founds nothing and gives nothing', async () => {
    const none = open();
    none.found();
    await tick();
    expect(none.confirm()).toBeNull();
    expect((await none.result)?.name).toBeTruthy();
    expect(none.plan!.amount).toBe(0);
    root = new FEl('div');
    setUiRoot(root as unknown as HTMLElement);
    const d = open({ amount: 123_456 }); // (a plan that was through a dialog before starts from nothing again)
    expect(d.plan!.amount).toBe(0);
    d.slide(1_500_000);
    d.cancel();
    expect(await d.result).toBeNull();
    expect(d.plan!.amount).toBe(0);
  });

  it('a parent inside its 10 years gets the reason and the date instead of the slider, and founds without asking', async () => {
    const d = open({ limit: 0, blocked: BLOCKED });
    expect(d.range()).toBeUndefined();
    expect(d.note()).toBe(BLOCKED);
    expect(textOf(d.endow()!.querySelector('label')!)).toBe('Endowment from Queensbury');
    d.found();
    await tick();
    expect(d.confirm()).toBeNull();
    expect(await d.result).not.toBeNull();
    expect(d.plan!.amount).toBe(0);
  });

  it('a sandbox city takes no endowment; another difficulty brings the chosen amount back', async () => {
    const d = open();
    d.card('Medium').click();
    d.slide(500_000);
    d.card('Sandbox').click();
    expect(d.range()!.disabled).toBe(true);
    expect(d.endow()!.querySelector('.slider')!.classList.contains('disabled')).toBe(true);
    expect(d.note()).toBe('A sandbox city has unlimited money: no endowment is sent.');
    d.card('Easy').click();
    expect(d.range()!.disabled).toBe(false);
    expect(d.note()).toMatch(/^The new city starts with §750,000 \(§250,000 \+ §500,000\)/);
    d.card('Sandbox').click();
    d.found();
    await tick();
    expect(d.confirm()).toBeNull();
    expect((await d.result)!).toMatchObject({ difficulty: 'sandbox', sandbox: true });
    expect(d.plan!.amount).toBe(0);
  });

  it('an ordinary founding has no endowment field and keeps its title', async () => {
    const d = open(null);
    expect(textOf(d.dlg.querySelector('h2')!)).toBe('Found a New City');
    expect(d.endow()).toBeNull();
    expect(textOf(d.dlg.querySelector('.mh-sub')!)).not.toContain('sister');
    d.found();
    expect(await d.result).not.toBeNull();
  });
});
