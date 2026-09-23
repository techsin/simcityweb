import { stressCity, newSim } from '../../../../../../home/user/simcityweb/tests/infra/cityGen';
const city = stressCity(256);
const sim = newSim(city.st);
const p = sim.getSystem<any>('pollution');
for (let k = 0; k < 20; k++) p.compute(sim, false);
let a = 1e9, b = 1e9;
for (let k = 0; k < 20; k++) { let t0 = performance.now(); p.stageA(sim, false); a = Math.min(a, performance.now() - t0); t0 = performance.now(); p.stageB(sim, false); b = Math.min(b, performance.now() - t0); }
console.log('pollution stageA', a.toFixed(2), 'stageB', b.toFixed(2));
