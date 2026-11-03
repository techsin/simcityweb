/**
 * T029 supplement: the emergency speed policy at a real GPU's cadence, headless. The real SimCore (systems, actions,
 * LivePolicy) runs a big-city fixture with a virtual real-time clock: 60 frames per virtual second, each frame
 * core.frame(1/60) as LocalSimHost calls it, then the microtasks (the policy's settled-burst flush). Ultra is 20 game
 * days per virtual second, as on a fast machine, where days never batch into one frame.
 * The player is the browser harness's: Ultra at the start, and Ultra again `react` virtual seconds after the policy
 * took the speed (setSpeed(3, 'topbar')); never a dispatch, never a dismissal.
 *
 *   npx tsx vclock.ts <tree root> <fixture.metropolis> <label> <out.json> [virtual minutes=10] [react s=3]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const [ROOT, FIXTURE, LABEL, OUT, MIN = '10', REACT = '3'] = process.argv.slice(2);
const mod = async (p: string) => import(`${ROOT}/src/${p}`);
const { SimCore } = await mod('worker/SimCore.ts');
const { createSystems } = await mod('sim/systems/index.ts');
const { CityActions } = await mod('sim/actions.ts');
const { deserializeCity } = await mod('save/serialize.ts');
const { decodeBundle } = await mod('save/bundle.ts');

const st = deserializeCity(decodeBundle(new Uint8Array(gunzipSync(readFileSync(FIXTURE)))));
let vnow = 0; // virtual ms
const core = new SimCore(st, undefined, undefined, () => vnow);
core.boot(null, { createSystems, CityActions });
const sim = core.sim;
const tick = () => new Promise<void>((r) => setImmediate(r)); // drains the microtask queue (the policy's flush)
await tick();
const t = () => +(vnow / 1000).toFixed(2);
const speed: unknown[] = [], policy: unknown[] = [], emg: unknown[] = [], player: unknown[] = [];
sim.events.on('speedChanged', (s: number) => speed.push([t(), st.day, s, sim.liveSlowdown]));
sim.events.on('emergency', (e: { type: string; id: number; kind: string; major: boolean; manualPossible?: boolean; reason?: string }) => emg.push([t(), st.day, e.type, e.id, e.kind, e.major ? 1 : 0, e.manualPossible ? 1 : 0, e.reason ?? '']));
const ac = new AbortController();
core.livePolicy.view.subscribe((p: { live: boolean; alerts: { id: number }[]; toast?: { text: string } }) => policy.push([t(), st.day, p.live ? 1 : 0, p.alerts.map((a) => a.id).join(','), p.toast?.text ?? '']), ac.signal);
const set3 = (why: string) => { player.push([t(), why]); core.applyCommand({ op: 'setSpeed', args: [3, 'topbar'] }, core.actions); };
const day0 = st.day, pop0 = st.stats.population, wall0 = performance.now();
set3('start');
const END = +MIN * 60_000, FRAME = 1000 / 60, REACT_MS = +REACT * 1000;
let offSince = -1, atUltra = 0, frames = 0, lastLog = 0;
while (vnow < END) {
  vnow += FRAME;
  core.frame(FRAME / 1000);
  await tick();
  frames++;
  if (sim.speed === 3) { atUltra++; offSince = -1; }
  else if (offSince < 0) offSince = vnow;
  else if (vnow - offSince >= REACT_MS) { set3(sim.speed === 0 ? 'resume-pause' : 'restore-ultra'); offSince = -1; }
  if (vnow - lastLog >= 60_000) { lastLog = vnow; console.log(`[${LABEL}] virtual ${t()} s, day ${st.day - day0}, wall ${((performance.now() - wall0) / 1000).toFixed(0)} s`); }
}
const drops: { t: number; day: number; to: number }[] = [];
let prev = 3;
for (const [tt, day, sp] of speed as [number, number, number][]) { if (sp < prev) drops.push({ t: tt, day, to: sp }); prev = sp; }
let lastLive = 0, liveEpisodes = 0;
const alertIds = new Set<number>();
for (const [, , live, ids] of policy as [number, number, number, string][]) {
  if (live && !lastLive) liveEpisodes++;
  lastLive = live;
  for (const id of ids.split(',').filter(Boolean)) alertIds.add(+id);
}
const unc = new Map<number, Set<string>>();
for (const [, , type, id, , , , reason] of emg as [number, number, string, number, string, number, number, string][]) if (type === 'uncovered') { const s = unc.get(id) ?? new Set(); s.add(reason || '?'); unc.set(id, s); }
const byReason: Record<string, number> = {};
for (const s of unc.values()) for (const r of s) byReason[r] = (byReason[r] ?? 0) + 1;
const busyOnly = [...alertIds].filter((id) => { const s = unc.get(id); return s && s.size === 1 && s.has('busy'); }).length;
const summary = {
  label: LABEL, root: ROOT, fixture: FIXTURE, virtualMinutes: +MIN, reactS: +REACT, pop0, pop1: st.stats.population,
  days: st.day - day0, wallS: +((performance.now() - wall0) / 1000).toFixed(0), frames,
  slowdowns: drops.length, toLive: drops.filter((d) => d.to === 1).length, toPause: drops.filter((d) => d.to === 0).length,
  liveEpisodes, bannersRaised: alertIds.size, busyOnlyBannered: busyOnly, playerClicks: player.length,
  ultraShare: +(atUltra / frames).toFixed(3), uncoveredIncidents: unc.size, byReason,
};
writeFileSync(OUT, JSON.stringify({ summary, drops, player, timeline: { speed, policy, emg } }, null, 1));
console.log('RESULT', JSON.stringify(summary));
ac.abort();
core.dispose();
