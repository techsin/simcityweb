// @ts-nocheck — dev tool, bundled with rolldown (not type-checked by design)
/**
 * T015 latency probe on a real city: how many sim days until a funding / ordinance change shows in coverage.
 * For each start offset (0..offsets-1 warm days), two identical sims are loaded from the fixture and warmed alike;
 * the action is applied to one of them; both advance day by day and the first day their coverage arrays differ is
 * the latency (deterministic sims: identical until the change is reflected).
 *
 *   node tools/bench/sim-profile/bundle.mjs ../exact/serviceLatency
 *   node node_modules/.cache/sim-profile/serviceLatency.js --fixture F.metropolis [--offsets 15] [--max 40]
 *        [--mode headless|design] [--case eduFunding|policeFunding|freeClinics|strikeEdu]
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { decodeBundle } from '../../../src/save/bundle';
import { deserializeCity } from '../../../src/save/serialize';
import { Simulation } from '../../../src/sim/Simulation';
import { createSystems } from '../../../src/sim/systems/index';
import { schedulerOf } from '../../../src/sim/infra/scheduler';
import { CityActions } from '../../../src/sim/actions';
import { econData } from '../../../src/sim/economy/runtime';

const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const fixture = arg('fixture'), offsets = +arg('offsets', '15'), max = +arg('max', '40'), mode = arg('mode', 'headless');
const which = arg('case', 'eduFunding');
const gz = readFileSync(fixture);
const load = () => new Simulation(deserializeCity(decodeBundle(new Uint8Array(gunzipSync(gz)))), createSystems());
const day = (sim) => { sim.advanceDay(); if (mode === 'design') schedulerOf(sim).flush(sim); };
const CASES = {
  eduFunding: { field: 'eduElemCov', act: (a) => { a.setFunding('education', 50); return { ok: true }; } },
  policeFunding: { field: 'policeCov', act: (a) => { a.setFunding('police', 50); return { ok: true }; } },
  // toggles: enacts it, or repeals it where the bot already enacted it (bot cities over 120k)
  freeClinics: { field: 'healthCov', act: (a, st) => a.setOrdinance('free_clinics', !st.budget.ordinances.includes('free_clinics'), { confirm: true }) },
  // what the monthly budget does to a service under STRIKE_FUNDING (no action, no event)
  strikeEdu: { field: 'eduElemCov', act: (a, st) => { econData(st).strikes.education = 2; return { ok: true, reason: 'education strike (2 months)' }; } },
};
const c = CASES[which];
const res = [], full = [];
let toggled = '';
for (let off = 0; off < offsets; off++) {
  const A = load(), B = load();
  for (let d = 0; d < off; d++) { day(A); day(B); }
  const t0 = B.state.day;
  const r = c.act(new CityActions(B), B.state);
  if (!r.ok) { console.log(JSON.stringify({ off, refused: r.reason })); continue; }
  toggled = r.reason ?? '';
  const a = A.state[c.field], b = B.state[c.field];
  const svc = B.getSystem('services');
  // full: the first pass that started AFTER the change has finished (passNo counts pass starts; a pass already
  // running at the change keeps the old inputs)
  const pass0 = svc.passNo;
  let lat = -1, fin = -1;
  for (let d = 1; d <= max && (lat < 0 || fin < 0); d++) {
    day(A); day(B);
    if (lat < 0) for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { lat = d; break; }
    if (fin < 0 && svc.passNo !== pass0 && svc.stepIdx < 0) fin = d;
  }
  res.push(lat); full.push(fin);
  console.log(JSON.stringify({ off, startDay: t0, latency: lat, passDone: fin }));
}
const stats = (xs) => {
  const ok = xs.filter((x) => x > 0).sort((x, y) => x - y);
  const q = (p) => ok.length ? ok[Math.min(ok.length - 1, Math.floor(p * ok.length))] : null;
  return { notSeen: xs.filter((x) => x < 0).length, min: ok[0] ?? null, median: q(0.5), max: ok[ok.length - 1] ?? null };
};
console.log(JSON.stringify({ fixture: fixture.split(/[\\/]/).pop(), case: which, action: toggled, mode, n: res.length,
  firstChange: stats(res), passDone: stats(full), all: res, allDone: full }));
