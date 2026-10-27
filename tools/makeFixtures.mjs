#!/usr/bin/env node
/**
 * npm run fixtures [-- options] — rebuild the gitignored test / benchmark fixtures, e.g. after a container reset
 * (docs/dev/TEST_CITIES.md). Every generator is bundled with rolldown (a vite dependency: no tsx, no network) and run
 * with plain node; every output appears atomically (built in a temp dir, then renamed into place).
 *
 * WASM fixtures (the default targets; read by tests/wasm/{trafficCore,roadTransitSearch,servicesTierEngine}.test.ts and
 * tools/bench/**):
 *   snap      $SIM_SNAP or tools/bench/.fixtures/snap: `git archive 24f8609`, the frozen tree trafficCore.test.ts B/C/D and
 *             the benches' `--tree snap` run on, WITHOUT its *.test.* / *.spec.* files (vitest collects test files
 *             anywhere under the repo, dot directories included), plus node_modules -> the repo's node_modules and the
 *             three tools/bench/sim-profile/fixtures generators (not in 24f8609), so they build against the frozen src.
 *             A shallow clone is unshallowed first (git fetch --unshallow) when 24f8609 is missing.
 *   dense1m   $SIM_FIXTURES or tools/bench/.fixtures/fixtures, dense1m_s7.metropolis: sim-profile/fixtures/dense1m.ts on
 *             snap, target population 1,150,000, 120 warm days, seed 7: the profiler's original of Sep 28
 *             (docs/WASM_PLAN.md: 1,118,755 residents, 17,154 buildings, 23,141 road cells).
 *   stress1m  stress1m_testdefs_s7.metropolis: sim-profile/fixtures/stress.ts on snap, tests/infra/cityGen.ts
 *             stressCity(256, 7, { popScale: 1.55, jobsPerWorker: 1.05 }) with the test defs (1,034,100 residents,
 *             19,484 buildings, 36,003 road cells).
 *   bot256    bot256_s7_y60.metropolis: sim-profile/fixtures/botgrow.ts on snap, the 24f8609 SimBot, 256 map, seed 7,
 *             60 years (the profiler's pre-WP6a bot city).
 * Shared test cities (target cities, only with --cities DIR): tools/simbot.ts --save-years on THIS tree; each pair
 * <name>.city.metropolis + <name>.region.metropolis is followed by <name>.READY (vet_s7_y21's before the run goes on):
 *   small_s7_y10               128 map, seed 7, 10 years
 *   vet_s7_y21, vet_s7_y43     256 map, seed 7, one 43-year run
 *
 * options:
 *   --only a,b     targets snap, dense1m, stress1m, bot256, cities (default: the first four, + cities with --cities);
 *                  a target whose output exists is kept unless --force
 *   --cities DIR   also build the shared test cities into DIR
 *   --force        rebuild existing outputs
 * Each rebuilt fixture is counted and compared with the original's numbers; a mismatch is reported (exit code 3) and the
 * file is kept, so a test run can still show what differs.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP_COMMIT = '24f860996746c97d1df771e4483bdce84cf93d34';
const SNAP = resolve(process.env.SIM_SNAP ?? join(ROOT, 'tools', 'bench', '.fixtures', 'snap'));
const FIX = resolve(process.env.SIM_FIXTURES ?? join(ROOT, 'tools', 'bench', '.fixtures', 'fixtures'));
const CACHE = join(ROOT, 'node_modules', '.cache', 'sim-fixtures');
const GENERATORS = ['dense1m', 'stress', 'botgrow'];
const TARGETS = ['snap', 'dense1m', 'stress1m', 'bot256', 'cities'];

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (args.includes('--help') || args.includes('-h')) {
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  console.log(src.slice(src.indexOf('/**') + 4, src.indexOf('*/')).replace(/^ \* ?/gm, ''));
  process.exit(0);
}
const force = args.includes('--force');
const citiesDir = opt('--cities') ? resolve(opt('--cities')) : null;
const only = new Set((opt('--only') ?? [...TARGETS.slice(0, 4), ...(citiesDir ? ['cities'] : [])].join(',')).split(','));
for (const t of only) if (!TARGETS.includes(t)) fail(`unknown target ${t} (${TARGETS.join(', ')})`);
if (only.has('cities') && !citiesDir) fail('target cities needs --cities DIR');
// (shared containers: the kernel's OOM killer picks this process and its children before the agent session)
try { writeFileSync('/proc/self/oom_score_adj', '800'); } catch { /* not Linux, or not allowed */ }

function fail(msg) {
  console.error(`makeFixtures: ${msg}`);
  process.exit(2);
}
const log = (msg) => console.log(`[fixtures] ${msg}`);
const git = (...a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' });
const show = (p) => (relative(ROOT, p).startsWith('..') ? p : relative(ROOT, p));

/** run a node program, its output prefixed with `label`; resolves with the wall seconds */
function run(label, file, argv, cwd) {
  return new Promise((res, rej) => {
    const t0 = performance.now();
    const p = spawn(process.execPath, [file, ...argv], { cwd, stdio: ['ignore', 'pipe', 'inherit'] });
    let part = '';
    p.stdout.on('data', (d) => {
      const lines = (part + d).split('\n');
      part = lines.pop();
      for (const l of lines) console.log(`  ${label} | ${l}`);
    });
    p.on('error', rej);
    p.on('close', (code) => {
      if (part) console.log(`  ${label} | ${part}`);
      if (code !== 0) rej(new Error(`${label}: ${file} exited with ${code}`));
      else res((performance.now() - t0) / 1000);
    });
  });
}

/** bundle `entry` (TypeScript; its imports resolve where it lies) into CACHE/<name>/<name>.mjs */
async function bundle(entry, name) {
  const { rolldown } = await import('rolldown');
  const dir = join(CACHE, name);
  rmSync(dir, { recursive: true, force: true });
  const b = await rolldown({ input: entry, platform: 'node', logLevel: 'warn' });
  await b.write({ format: 'esm', dir, entryFileNames: `${name}.mjs` });
  await b.close();
  return join(dir, `${name}.mjs`);
}

/** count a gzip'd city bundle (the src/save/bundle.ts layout) without the game code; `digest` is the sha256 of its
 *  content minus savedAt, so two builds of the same city have the same digest */
function inspectCity(file) {
  const bytes = gunzipSync(readFileSync(file));
  const jl = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, true);
  const tree = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + jl)));
  const blob = bytes.subarray(Math.ceil((12 + jl) / 8) * 8);
  const arr = (o) => {
    const C = globalThis[o.$ta];
    const buf = new ArrayBuffer(o.n * C.BYTES_PER_ELEMENT);
    new Uint8Array(buf).set(blob.subarray(o.o, o.o + buf.byteLength));
    return new C(buf);
  };
  let residents = 0, roadCells = 0;
  for (const v of arr(tree.buildings.pop)) residents += v;
  for (const v of arr(tree.layers.network)) if (v >= 1 && v <= 5) roadCells++;
  const { savedAt, ...content } = tree;
  void savedAt;
  const digest = createHash('sha256').update(JSON.stringify(content)).update(blob).digest('hex');
  return { residents: Math.round(residents), buildings: tree.buildings.count, roadCells, bytes: statSync(file).size, digest };
}

const results = [];
let mismatches = 0;

// ------------------------------------------------------------------------------------------------ snap
function ensureCommit() {
  if (git('cat-file', '-e', `${SNAP_COMMIT}^{commit}`).status === 0) return;
  if (git('rev-parse', '--is-shallow-repository').stdout.trim() === 'true') {
    log(`commit ${SNAP_COMMIT.slice(0, 7)} is not in this shallow clone: git fetch --unshallow`);
    spawnSync('git', ['fetch', '--unshallow'], { cwd: ROOT, stdio: 'inherit' });
    if (git('cat-file', '-e', `${SNAP_COMMIT}^{commit}`).status === 0) return;
  }
  fail(`commit ${SNAP_COMMIT} is not available (git fetch --unshallow origin <branch>, then run this again)`);
}

function buildSnap() {
  const marker = join(SNAP, '.commit');
  const ours = existsSync(marker) && readFileSync(marker, 'utf8').trim() === SNAP_COMMIT;
  if (ours && !force) log(`snap: ${show(SNAP)} exists (${SNAP_COMMIT.slice(0, 7)})`);
  else {
    // never delete a directory this script did not make (SIM_SNAP may point anywhere)
    if (existsSync(SNAP) && !existsSync(marker)) fail(`${SNAP} exists and is not a snapshot made by this script: remove it or set SIM_SNAP`);
    ensureCommit();
    const t0 = performance.now();
    const tmp = `${SNAP}.tmp${process.pid}`;
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    const archive = spawnSync('git', ['archive', '--format=tar', SNAP_COMMIT], { cwd: ROOT, maxBuffer: 1 << 30 });
    if (archive.status !== 0) fail(`git archive failed: ${archive.stderr}`);
    const tar = spawnSync('tar', ['-x', '-C', tmp, '--exclude=*.test.*', '--exclude=*.spec.*'], { input: archive.stdout, maxBuffer: 1 << 30 });
    if (tar.status !== 0) fail(`tar failed: ${tar.stderr}`);
    // bare imports of the frozen tree (vitest, three, rolldown, ...) resolve to this repo's packages
    symlinkSync(relative(tmp, join(ROOT, 'node_modules')), join(tmp, 'node_modules'));
    writeFileSync(join(tmp, '.commit'), SNAP_COMMIT + '\n');
    rmSync(SNAP, { recursive: true, force: true });
    mkdirSync(dirname(SNAP), { recursive: true });
    renameSync(tmp, SNAP);
    log(`snap: ${SNAP_COMMIT.slice(0, 7)} extracted into ${show(SNAP)} in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  }
  // the fixture generators (added after 24f8609) build against the frozen src; refreshed from this tree on every run
  const gdir = join(SNAP, 'tools', 'bench', 'sim-profile', 'fixtures');
  mkdirSync(gdir, { recursive: true });
  for (const g of GENERATORS) cpSync(join(ROOT, 'tools', 'bench', 'sim-profile', 'fixtures', `${g}.ts`), join(gdir, `${g}.ts`));
}

// ------------------------------------------------------------------------------------------------ fixtures
/** build FIX/<name> with generator `gen` on snap (argv(tmpDir) makes it write tmpDir/<name>); compare with `expect` */
async function fixture(target, name, gen, argv, expect) {
  const file = join(FIX, name);
  if (existsSync(file) && !force) {
    log(`${target}: ${show(file)} exists`);
    results.push({ target, file, ...inspectCity(file), kept: true });
    return;
  }
  if (!existsSync(join(SNAP, 'tools', 'bench', 'sim-profile', 'fixtures', `${gen}.ts`))) fail(`${target} needs the snap target (${SNAP})`);
  const tmp = join(FIX, `.tmp-${target}-${process.pid}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const prog = await bundle(join(SNAP, 'tools', 'bench', 'sim-profile', 'fixtures', `${gen}.ts`), `${gen}.snap`);
  const wall = await run(target, prog, argv(tmp), tmp);
  renameSync(join(tmp, name), file);
  rmSync(tmp, { recursive: true, force: true });
  const info = inspectCity(file);
  const bad = Object.entries(expect).filter(([k, v]) => info[k] !== v);
  if (bad.length) {
    mismatches++;
    log(`${target}: WARNING ${name} differs from the original: ${bad.map(([k, v]) => `${k} ${info[k]} (original ${v})`).join(', ')}`);
  }
  results.push({ target, file, ...info, wall });
}

// ------------------------------------------------------------------------------------------------ cities
async function cities() {
  mkdirSync(citiesDir, { recursive: true });
  const ready = (n) => join(citiesDir, `${n}.READY`);
  const jobs = [
    { names: ['small_s7_y10'], argv: ['--size', '128', '--years', '10', '--seed', '7', '--quiet', '--save-years', '10', '--save-prefix', join(citiesDir, 'small_s7_')] },
    { names: ['vet_s7_y21', 'vet_s7_y43'], argv: ['--size', '256', '--years', '43', '--seed', '7', '--quiet', '--save-years', '21,43', '--save-prefix', join(citiesDir, 'vet_s7_')] },
  ];
  // (the bundle's file name must contain "simbot": that is what starts simbot's command line)
  const bot = await bundle(join(ROOT, 'tools', 'simbot.ts'), 'simbot');
  for (const j of jobs) {
    const kept = !force && j.names.every((n) => existsSync(ready(n)));
    if (kept) log(`cities: ${j.names.join(', ')} ready in ${citiesDir}`);
    else {
      for (const n of j.names) rmSync(ready(n), { force: true });
      j.wall = await run(j.names.join('+'), bot, j.argv, ROOT);
    }
    for (const n of j.names) {
      const r = JSON.parse(readFileSync(ready(n), 'utf8'));
      results.push({ target: 'cities', file: r.city.path, residents: r.population, buildings: r.buildings, bytes: r.city.bytes, region: r.region.bytes, wall: j.wall, kept });
    }
  }
}

// ------------------------------------------------------------------------------------------------ main
const t0 = performance.now();
if (only.has('snap')) buildSnap();
mkdirSync(FIX, { recursive: true });
if (only.has('dense1m')) {
  await fixture('dense1m', 'dense1m_s7.metropolis', 'dense1m', (d) => [d, '1150000', '120', '7'], { residents: 1118755, buildings: 17154, roadCells: 23141 });
}
if (only.has('stress1m')) {
  await fixture('stress1m', 'stress1m_testdefs_s7.metropolis', 'stress', (d) => [join(d, 'stress1m_testdefs_s7.metropolis')], { residents: 1034100, buildings: 19484, roadCells: 36003 });
}
if (only.has('bot256')) await fixture('bot256', 'bot256_s7_y60.metropolis', 'botgrow', (d) => ['60', '7', '60', d], {});
if (only.has('cities')) await cities();

log(`done in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
const n = (v) => (v ?? 0).toLocaleString('en-US');
for (const r of results) {
  log(`  ${r.target.padEnd(8)} ${show(r.file)}: ${n(r.residents)} residents, ${n(r.buildings)} buildings${r.roadCells ? `, ${n(r.roadCells)} road cells` : ''}, `
    + `${(r.bytes / 1e6).toFixed(2)} MB${r.region ? ` (+ region file ${(r.region / 1e6).toFixed(2)} MB)` : ''}`
    + `${r.kept ? ', kept' : `, built in ${r.wall?.toFixed(0)} s`}${r.digest ? `, content sha256 ${r.digest.slice(0, 16)}` : ''}`);
}
if (mismatches) {
  log(`${mismatches} fixture(s) differ from the originals (warnings above)`);
  process.exit(3);
}
