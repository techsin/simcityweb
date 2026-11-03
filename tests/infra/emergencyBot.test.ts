/**
 * EM-1 (final-fix round 2) on bot towns (tools/simbot.ts; their own file: the synthetic towns of emergencyBurst.test.ts
 * register test defs into the shared catalog, which changes what a bot builds):
 *  - an earthquake in a 3-station town with an attentive player (verify-factors r2's vf_burst2 setup): every prompt
 *    the player sees can be dispatched, nothing scores as ignored;
 *  - normal play keeps its prompts: the prompts counted at settle points are the prompts raised.
 */
import { describe, expect, it } from 'vitest';
import type { Simulation } from '../../src/sim/Simulation';
import { INCIDENT_RESPONDERS, emergencyOf } from '../../src/sim/infra/emergency';
import { SimBot, botSystems } from '../../tools/simbot';

describe('EM-1: an earthquake in a bot town with an attentive player (verify-factors r2 vf_burst2 setup)', () => {
  it('magnitude 7 in a 3-station town: every prompt the player sees can be dispatched, nothing scores as ignored', { timeout: 900000 }, async () => {
    const bot = new SimBot({ size: 128, years: 2, seed: 7, difficulty: 'medium', terrain: 'plains', water: 0.2, quiet: true, noInfra: false }, await botSystems(false));
    bot.run(2);
    bot.sim.advanceDay();
    bot.sim.advanceDay();
    const sim = bot.sim, st = bot.st;
    const em = emergencyOf(sim)!;
    const fireStations = [...st.buildings.values()].filter((b) => b.def.startsWith('civ_fire'));
    expect(fireStations.length).toBeGreaterThanOrEqual(3);
    let sx = 0, sz = 0, n = 0;
    for (const b of st.buildings.values()) if (b.pop + b.jobs > 0) { sx += b.x; sz += b.z; n++; }
    const y0 = { ...st.stats.emergency.year };
    const failed: number[] = [];
    sim.events.on('emergency', (e) => { if (e.type === 'failed') failed.push(e.id); });
    (sim.getSystem('disasters') as unknown as { earthquake(s: Simulation, x: number, z: number, mag: number): void }).earthquake(sim, Math.round(sx / n), Math.round(sz / n), 7);
    expect(em.incidents().length).toBeGreaterThan(10);
    /** waiting major prompts with no free unit of their primary responder among the dispatch options */
    const stale = () => em.incidents().filter((i) => (i.state === 'uncovered' || i.state === 'queued') && i.major && i.manualPossible
      && !em.dispatchOptions(sim, i.id).some((o) => o.free > 0 && Number.isFinite(o.etaMin) && o.responder === INCIDENT_RESPONDERS[i.kind][0]));
    expect(stale()).toEqual([]);
    expect(st.stats.emergency.manualActive).toBe(em.incidents().filter((i) => i.state === 'uncovered' && i.major && i.manualPossible).length);
    // the attentive player: every waiting major prompt, at once and then every day
    let tries = 0, fails = 0;
    const attempt = () => {
      for (const i of em.incidents()) {
        if (!(i.state === 'uncovered' || i.state === 'queued') || !i.major || !i.manualPossible) continue;
        tries++;
        if (!em.dispatchBest(sim, i.id).ok) fails++;
      }
      expect(stale()).toEqual([]);
    };
    attempt();
    for (let d = 1; d <= 40; d++) {
      sim.advanceDay();
      attempt();
    }
    const y = st.stats.emergency.year;
    console.log(`EM-1 quake: ${em.incidents().length} still active, ${failed.length} failed, ${tries} prompts tried, ${fails} failed attempts, ignored ${(y.ignored ?? 0) - (y0.ignored ?? 0)}`);
    expect(fails).toBe(0);
    expect((y.ignored ?? 0) - (y0.ignored ?? 0)).toBe(0);
  });
});

describe('EM-1: normal play keeps its prompts', () => {
  it('a bot town over 5 years (no disasters, nobody answers): the prompts counted at settle points are the prompts raised', { timeout: 900000 }, async () => {
    // (the scenario needs a town with a few uncovered major incidents. B2's honest step estimates move the bot's schedule,
    // so which seed has them moves too: G1 measured seeds 1, 2, 4, 5, 6, 7 at 0, 4, 2, 2, 1, 0 prompts and G2's tier
    // pieces moved seed 2 to 1. G3's crime / pollution pieces left every seed 1-16 at 0 or 1 prompt in 4 years, so the
    // towns run 5 years (seeds 2 and 4: 3 prompts each). The first town of these seeds that raises at least two is checked.)
    let checked = 0;
    for (const seed of [2, 4, 5, 6, 1, 3, 8]) {
      const bot = new SimBot({ size: 128, years: 5, seed, difficulty: 'medium', terrain: 'plains', water: 0.2, quiet: true, noInfra: false, neglect: true }, await botSystems(false));
      const sim = bot.sim;
      // raised: an 'uncovered' event of a major incident with manualPossible (the old rule set prompted right then)
      const raised = new Set<number>(), counted = new Set<number>();
      sim.events.on('emergency', (e) => { if (e.type === 'uncovered' && e.major && e.manualPossible) raised.add(e.id); });
      sim.events.on('day', () => { for (const i of emergencyOf(sim)!.incidents()) if (i.prompted) counted.add(i.id); });
      bot.run(5);
      const y = bot.st.stats.emergency.year;
      console.log(`EM-1 normal play, seed ${seed}: ${raised.size} prompts raised, ${counted.size} counted, ignored (12 months) ${y.ignored ?? 0}`);
      if (raised.size < 2) continue;
      for (const id of counted) expect(raised.has(id)).toBe(true);
      // without a disaster's burst a prompt loses its unit before the day ends at most rarely (a unit coming back the
      // same day, or another incident taking it): normal play is unaffected
      expect(raised.size - counted.size).toBeLessThanOrEqual(1);
      checked++;
      break;
    }
    expect(checked, 'a bot town with at least two prompts').toBe(1);
  });
});
