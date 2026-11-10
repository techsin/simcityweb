/**
 * QA round 2 of T070. B2: the build menu's "Rewards & business deals" tab grew from 5 tiles to 19, with twelve locked
 * plaques of one thumbnail and the two gardens ahead of the deals: an honour's buildings join the menu when the honour
 * is earned, after the tab's own tiles. B3: the Clean Air Metropolis plaque showed the airports' icon.
 */
import { describe, expect, it, vi } from 'vitest';
import type { GameContext } from '../../src/game/context';
import { CATEGORIES, allDefs, categoryOfTool, defIcon, findToolSpec, ploppablesOf } from '../../src/game/toolCatalog';
import { CityState } from '../../src/sim/CityState';
import { getDef } from '../../src/sim/catalog';
import { defaultCityConfig } from '../../src/sim/config';
import { HONOURS } from '../../src/sim/economy/rewards';
import { installFakeDom } from './fakeDom';

vi.mock('../../src/ui/thumbs', () => ({ thumbs: { cached: () => null } }));
installFakeDom();

const DEALS = ['rw_military_base', 'rw_missile_range', 'rw_toxic_dump', 'rw_casino', 'rw_research_center'];
const isHonour = (id: string) => !!getDef(id)?.requires?.startsWith('honour_');

function make(sandbox = false) {
  const state = new CityState(defaultCityConfig({ size: 16, seed: 7, terrain: 'flat', disasters: false, treeDensity: 0, waterAmount: 0 }));
  const ctx = { state, mods: {}, sandbox: () => sandbox } as unknown as GameContext;
  const group = (cat: string, label: string) => CATEGORIES.find((c) => c.id === cat)!.groups!(ctx).find((g) => g.label === label)!;
  const tab = () => group('landmarks', 'Rewards & business deals').items.map((s) => s.id.slice(5));
  return { state, ctx, group, tab };
}

describe('QA round 2, B2: honour buildings in the build menu', () => {
  it('names every honour building by its requirement, and nothing else', () => {
    const honours = allDefs().filter((d) => d.requires?.startsWith('honour_')).map((d) => d.id).sort();
    expect(honours).toEqual(HONOURS.flatMap((r) => r.defIds).sort());
    expect(honours).toHaveLength(14);
    for (const id of honours) expect(getDef(id)!.category).toBe('reward');
  });

  it('keeps the Rewards tab to its own tiles, in their order, while no honour is earned', () => {
    const t = make();
    const own = ploppablesOf('reward').map((d) => d.id).filter((id) => !isHonour(id));
    expect(t.tab()).toEqual(own);
    expect(own.filter((id) => DEALS.includes(id))).toEqual(DEALS);
    expect(t.tab().some(isHonour)).toBe(false);
  });

  it('adds an earned honour\'s plaque and garden after them, unlocked', () => {
    const t = make();
    const own = t.tab();
    t.state.unlocked.add('honour_clean_air_metropolis');
    expect(t.tab()).toEqual([...own, 'rw_honour_clean_air_metropolis_plaque', 'rw_eco_plaza']);
    t.state.unlocked.add('honour_safe_city');
    t.state.unlocked.add('honour_megacity');
    expect(t.tab()).toEqual([...own, 'rw_honour_clean_air_metropolis_plaque', 'rw_honour_safe_city_plaque', 'rw_honour_megacity_plaque',
      'rw_eco_plaza', 'rw_firefighters_memorial']);
    const items = t.group('landmarks', 'Rewards & business deals').items;
    for (const s of items.slice(own.length)) expect(s.locked, s.id).toBeNull();
    // (the tab's own tiles keep their locks)
    expect(items.find((s) => s.id === 'plop:rw_casino')!.locked).not.toBeNull();
  });

  it('shows all fourteen once every honour is earned', () => {
    const t = make();
    const own = t.tab();
    for (const r of HONOURS) t.state.unlocked.add(r.id);
    expect(t.tab().slice(0, own.length)).toEqual(own);
    expect(t.tab().slice(own.length).sort()).toEqual(HONOURS.flatMap((r) => r.defIds).sort());
  });

  it('waits for the honour in a sandbox city too', () => {
    const t = make(true);
    expect(t.tab().some(isHonour)).toBe(false);
    expect(t.group('landmarks', 'Rewards & business deals').items.every((s) => s.locked === null)).toBe(true);
    t.state.unlocked.add('honour_green_belt');
    expect(t.tab().filter(isHonour)).toEqual(['rw_honour_green_belt_plaque']);
  });

  it('leaves the other groups as the catalog lists them', () => {
    const t = make();
    for (const r of HONOURS) t.state.unlocked.add(r.id);
    expect(t.group('landmarks', 'Landmarks').items.map((s) => s.id.slice(5))).toEqual(ploppablesOf('landmark').map((d) => d.id));
    expect(t.group('parks', 'Parks & recreation').items.map((s) => s.id.slice(5))).toEqual(ploppablesOf('park').map((d) => d.id));
    expect(t.group('civic', 'Civic').items.map((s) => s.id.slice(5))).toEqual(ploppablesOf('civic').map((d) => d.id));
  });

  it('still finds a plaque\'s tool by its id, in the toolbar\'s category only once it is in the menu', () => {
    const t = make();
    const id = 'plop:rw_honour_green_belt_plaque';
    expect(findToolSpec(t.ctx, id)?.locked).not.toBeNull();
    expect(categoryOfTool(t.ctx, id)).toBeNull();
    t.state.unlocked.add('honour_green_belt');
    expect(findToolSpec(t.ctx, id)).toMatchObject({ id, label: 'Green Belt Plaque', locked: null });
    expect(categoryOfTool(t.ctx, id)).toBe('landmarks');
  });
});

describe('QA round 2, B3: the plaques\' icon', () => {
  it('is the reward icon for all twelve, whatever the honour is called', () => {
    for (const r of HONOURS) expect(defIcon(getDef(r.defIds[0])!), r.name).toBe('reward');
    expect(defIcon(getDef('rw_honour_clean_air_metropolis_plaque')!)).not.toBe('plane');
  });

  it('leaves the airports their plane and the deals their icons', () => {
    expect(defIcon(getDef('tr_airport_small')!)).toBe('plane');
    expect(defIcon(getDef('tr_airport_large')!)).toBe('plane');
    expect(defIcon(getDef('rw_military_base')!)).toBe('target');
    expect(defIcon(getDef('rw_casino')!)).toBe('star');
    expect(defIcon(getDef('rw_eco_plaza')!)).toBe('park');
  });
});
