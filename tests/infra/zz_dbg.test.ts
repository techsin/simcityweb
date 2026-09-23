import { it } from 'vitest';
import { Network } from '../../src/core/types';
import { getTraffic } from '../../src/sim/systems/infra';
import { newSim, newState, place } from './cityGen';
function gridCity(jobsPerWorker: number) {
  const N = 128; const st = newState(N);
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) if (x % 4 === 0 || z % 4 === 0) st.network[z * N + x] = x % 16 === 0 || z % 16 === 0 ? Network.Avenue : Network.Road;
  let workers = 0; let rs = 99; const rnd = () => { rs = (Math.imul(rs, 1103515245) + 12345) >>> 0; return rs / 4294967296; };
  const homes: [number, number][] = [], jobs: [number, number][] = [];
  for (let bz = 0; bz < N / 4; bz++) for (let bx = 0; bx < N / 4; bx++) { const dc = Math.hypot(bx - 16, bz - 16) / 16;
    for (let dz = 1; dz <= 3; dz++) for (let dx = 1; dx <= 3; dx++) if (dx !== 2 || dz !== 2) (rnd() < 0.25 + 0.35 * (1 - dc) ? jobs : homes).push([bx * 4 + dx, bz * 4 + dz]); }
  for (const [x, z] of homes) { place(st, 't_r2', x, z, { pop: 50, wealth: 2 }); workers += 27.5; }
  const per = (jobsPerWorker * workers) / jobs.length;
  for (const [x, z] of jobs) { const b = place(st, 't_cs', x, z); b.capacity = per; }
  st.stats.population = homes.length * 50;
  return st;
}
it('dbg', () => {
  for (const jr of [0.75, 1.4]) {
    const st = gridCity(jr); const sim = newSim(st); const tr = getTraffic(sim)! as any;
    for (let k = 0; k < 10; k++) {
      tr.invalidate(); tr.phase = 0; let rounds = 0; const acc: number[] = [];
      while (tr.phase >= 0) { if (tr.phase === 3) { rounds++; } tr.step(sim); if (tr.phase === 2 || tr.phase === 4) { let a = 0; for (let o = 0; o < tr.oN; o++) a += tr.oAsg[o]; acc.push(a); } }
      let W = 0, A = 0; for (let o = 0; o < tr.oN; o++) { W += tr.oW[o]; A += tr.oAsg[o]; }
      let S = 0, F = 0; for (let j = 0; j < tr.jB; j++) { S += tr.jSlots[j]; F += tr.jAsg[j]; }
      let pmin = 1e9, pmax = -1e9, psum = 0, zp = 0; for (let j = 0; j < tr.jB; j++) { const p = tr.priceById[tr.jBid[j]]; pmin = Math.min(pmin, p); pmax = Math.max(pmax, p); psum += p; if (tr.qProp[tr.jQ[j]] === 0) zp++; }
      console.log(`prices min ${pmin.toFixed(2)} max ${pmax.toFixed(2)} mean ${(psum / tr.jB).toFixed(2)} zeroProp ${zp}/${tr.jB}`);
      console.log(`jr=${jr} cycle ${k}: rounds=${rounds} assigned by round ${acc.map((v) => (v / W).toFixed(2)).join(' ')} raw access=${(A / W).toFixed(3)} raw fill=${(F / S).toFixed(3)} (ideal access ${Math.min(1, S / W).toFixed(2)}) prop=${tr.propFactor.toFixed(2)}`);
    }
  }
});
