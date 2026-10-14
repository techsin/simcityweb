/**
 * Final fixes, lane ui-panels:
 *  N1 (card part) — the Utilities advisor said "Power, water and garbage services are keeping up." while occupied
 *     buildings had no power or water (31 days after one bulldoze cut a district off): utilityOutages counts them live
 *     from the buildings' flags and outageAssessment says so, with "Show me" on the biggest one;
 *  N8 — "Show me" only moved the camera (a newcomer told "Water data view → Tap water quality" opened Water pollution):
 *     adviceView maps each advice to its data view and variant.
 */
import { describe, expect, it } from 'vitest';
import { Overlay, Zone } from '../../src/core/types';
import { BF } from '../../src/sim/CityState';
import { OVERLAY_VARIANTS } from '../../src/sim/infra/overlays';
import { adviceView, outageAssessment, outageWho, utilityOutages } from '../../src/ui/advisorModel';
import { newState, place } from '../infra/cityGen';

describe('adviceView (final fixes N8): "Show me" opens the advice\'s data view', () => {
  const name = (id: string) => {
    const v = adviceView(id);
    if (!v) return null;
    const vars = OVERLAY_VARIANTS[v.overlay];
    return `${Overlay[v.overlay]}${v.variant !== undefined && vars ? ' · ' + vars[v.variant] : ''}`;
  };
  it('the routed cases', () => {
    expect(name('tapWater')).toBe('Water · Tap water quality');
    for (const id of ['gridGap', 'powerShortage', 'noPower']) expect(name(id)).toBe('Power');
    for (const id of ['waterGap', 'waterShortage']) expect(name(id)).toBe('Water · Service');
    expect(name('noise')).toBe('Noise');
    expect(name('gridlock')).toBe('Traffic · Cars');
    expect(name('commute')).toBe('Commute');
    expect(name('garbage')).toBe('Garbage · Uncollected piles');
    expect(name('landfillFull')).toBe('Garbage · Landfill fill');
    expect(name('parkingPressure')).toBe('Parking');
  });
  it('service gaps open their coverage view', () => {
    expect(name('noElementary')).toBe('Education · Elementary');
    expect(name('noHigh')).toBe('Education · High school');
    expect(name('noCollege')).toBe('Education · University');
    expect(name('playgrounds')).toBe('Parks · Play & sports');
    expect(name('parks')).toBe('Parks · Gardens & parks');
    expect(name('noPolice')).toBe('Police');
    expect(name('noFireResponse')).toBe('Emergency · Fire');
    expect(name('slowAmbulances')).toBe('Emergency · Medical');
    expect(name('seniorsHealth')).toBe('Health');
    expect(name('jailOvercrowded')).toBe('Crime');
    expect(name('abandoned')).toBe('Desirability');
  });
  it('zone advice per building type; money and demand advice have no view', () => {
    expect(name('zoneDev2')).toBe('Desirability · R$$$');
    expect(name('zoneNoFitR')).toBe('Desirability');
    for (const id of ['deficit', 'taxHigh', 'capR', 'unemployment', 'nonsense', '']) expect(adviceView(id)).toBeNull();
    // every mapped variant exists
    for (const id of ['tapWater', 'noElementary', 'noCollege', 'parks', 'slowAmbulances', 'landfillFull', 'zoneDev11']) {
      const v = adviceView(id)!;
      expect(v.variant).toBeLessThan(OVERLAY_VARIANTS[v.overlay]!.length);
    }
  });
});

describe('utilityOutages (final fixes N1, card part)', () => {
  const town = () => {
    const st = newState(24);
    // sim-infra's utilities run (infraFlags): the buildings' Powered / Watered flags are what population reads
    st.systemData.infraVersion = 1;
    for (let z = 0; z < 24; z++) for (let x = 0; x < 24; x++) st.zone[st.idx(x, z)] = x < 12 ? Zone.ResLow : Zone.ResMed;
    return st;
  };
  it('counts occupied buildings without power / without the water they need, with their residents', () => {
    const st = town();
    place(st, 't_r1', 2, 2, { pop: 40 });                                  // dark
    place(st, 't_r1', 4, 2, { pop: 43 });                                  // dark (the biggest)
    place(st, 't_r1', 6, 2, { pop: 30, flags: BF.Powered });               // fine (low density: no piped water needed)
    place(st, 't_r1', 8, 2, { pop: 0 });                                   // empty: not counted
    place(st, 't_r1', 10, 2, { pop: 20, flags: BF.Abandoned });            // abandoned: not counted
    place(st, 't_r2', 14, 2, { pop: 50, flags: BF.Powered });              // dry (medium density needs water)
    place(st, 't_r2', 16, 2, { pop: 50, flags: BF.Powered | BF.Watered }); // fine
    const o = utilityOutages(st);
    expect(o.power).toMatchObject({ buildings: 2, residents: 83, jobs: 0, at: { x: 4, z: 2 } });
    expect(o.water).toMatchObject({ buildings: 1, residents: 50, at: { x: 14, z: 2 } });
    expect(outageWho(o.power)).toBe('2 occupied buildings (83 residents)');
    const a = outageAssessment(o)!;
    expect(a.level).toBe('bad');
    expect(a.text).toMatch(/^2 occupied buildings \(83 residents\) have no power \(and 1 building no water\): they aren't connected to the grid\. Reconnect them with a road or power line/);
    expect(a.kind).toBe('power');
    expect(a.at).toEqual({ x: 4, z: 2 });
    expect(a.view.overlay).toBe(Overlay.Power);
  });
  it('water only: a warning with the Water view; nothing out: no line; no utilities system: nothing counts', () => {
    const st = town();
    place(st, 't_r2', 14, 2, { pop: 12, jobs: 0, flags: BF.Powered });
    const a = outageAssessment(utilityOutages(st))!;
    expect(a.level).toBe('bad');
    expect(a.kind).toBe('water');
    expect(a.text).toMatch(/^1 occupied building \(12 residents\) has no water — .* connect its road to a pump or water tower/);
    expect(a.view).toEqual({ overlay: Overlay.Water, variant: 0 });
    const ok = town();
    place(ok, 't_r1', 2, 2, { pop: 9, flags: BF.Powered });
    expect(outageAssessment(utilityOutages(ok))).toBeNull();
    const bare = newState(16);
    place(bare, 't_r1', 2, 2, { pop: 9 });
    expect(utilityOutages(bare).power.buildings).toBe(0);
  });
  it('recounts after a second of real time, or at once when a building comes or goes (cut and repair show)', () => {
    const st = town();
    const b = place(st, 't_r1', 2, 2, { pop: 40, flags: BF.Powered });
    expect(utilityOutages(st, 100).power.buildings).toBe(0);
    b.flags &= ~BF.Powered;
    // a moment later: the cached count (the panel asks on every UI tick)
    expect(utilityOutages(st, 400).power.buildings).toBe(0);
    expect(utilityOutages(st, 1200).power.buildings).toBe(1);
    // repaired while paused (same sim day): shows within a second
    b.flags |= BF.Powered;
    expect(utilityOutages(st, 2300).power.buildings).toBe(0);
    // a new building: recounted at once
    place(st, 't_r1', 4, 2, { pop: 5 });
    expect(utilityOutages(st, 2310).power.buildings).toBe(1);
  });
});
