import { expect, it } from 'vitest';
import { DisastersSystem } from '../../src/sim/infra/disasters';
import { SimBot, botSystems } from '../../tools/simbot';
import { terrainPair, tornadoPath } from './terrainRectsHarness';

it('matches full zone, light, tree and exit arrays for 60 years of a 128-cell bot city with disasters on', { timeout: 1800000 }, async () => {
  const bot = new SimBot({ size: 128, years: 60, seed: 7, difficulty: 'medium', terrain: 'plains', water: 0.2, quiet: true, noInfra: false }, await botSystems(false));
  bot.st.config.disasters = true;
  const pair = terrainPair(bot.sim);
  const hazards = bot.sim.systems.find((s): s is DisastersSystem => s instanceof DisastersSystem)!;
  // R1's one known lag: an active tornado's tree damage reaches the texture at its end event (tornadoPath)
  const path = tornadoPath(bot.sim);
  let frames = 0, failures = 0, buildings = 0, disasters = 0, tornadoes = 0;
  const firstFailures: string[] = [];
  // The bot's clearedPlopRot marks a lot's cells free around its preview plops and restores them afterwards: the
  // state is not real until it returns, so no check runs inside it.
  let probing = 0;
  const clearedPlopRot = bot.clearedPlopRot;
  bot.clearedPlopRot = (...args) => {
    probing++;
    try { return clearedPlopRot.apply(bot, args); } finally { probing--; }
  };
  const check = (when: string) => {
    if (probing) return;
    frames++;
    if (!hazards.active.some((d) => d.kind === 'tornado')) path.clear();
    try {
      pair.check(`day ${bot.st.day}, ${when}`, path.rect);
    } catch (e) {
      failures++;
      if (firstFailures.length < 5) firstFailures.push(String(e));
    }
  };
  const actions = bot.A;
  bot.A = new Proxy(actions, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const result = Reflect.apply(value, target, args);
        check(`action ${String(key)}`);
        return result;
      };
    },
  });
  const off = [
    bot.sim.events.on('day', () => check('simulation')),
    bot.sim.events.on('buildingAdded', () => buildings++),
    bot.sim.events.on('disaster', (d) => {
      if (!d.active) return;
      disasters++;
      if (d.kind === 'tornado') tornadoes++;
    }),
    path.dispose,
  ];
  try {
    bot.run(60);
    check('final');
    expect(frames).toBeGreaterThanOrEqual(60 * 360);
    expect(buildings).toBeGreaterThan(0);
    expect(disasters).toBeGreaterThan(0);
    expect(tornadoes, 'the tornado lag rule was exercised').toBeGreaterThan(0);
    // Strict acceptance gate: every other byte matches the full refill after every event frame.
    expect(failures, `${failures} event frames differed; first failures:\n${firstFailures.join('\n')}`).toBe(0);
  } finally {
    bot.A = actions;
    for (const f of off) f();
    pair.dispose();
  }
});
