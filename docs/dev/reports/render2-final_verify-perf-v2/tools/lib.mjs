// perfrev-v2 driver library: browsers, process discovery, schedstat CPU, poller, stats.
import { chromium } from '/home/user/simcityweb/node_modules/playwright/index.mjs';
import { readFileSync, readdirSync, writeFileSync, existsSync, appendFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOOLS = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(TOOLS, '..');
export const SIDES = resolve(ROOT, 'sides');
export const OUT = resolve(ROOT, 'out');
mkdirSync(OUT, { recursive: true });

export const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle', '--enable-precise-memory-info', '--js-flags=--expose-gc'];

export function oom(pid, v = 800) {
  try { writeFileSync(`/proc/${pid}/oom_score_adj`, String(v)); } catch { /* gone */ }
}
oom(process.pid);

export function procInfo(pid) {
  try {
    const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const ppid = +stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1];
    // (zygote children rewrite their argv into one space-separated string: match the flag in the joined line)
    const full = cmd.join(' ');
    const m = full.match(/--type=([a-z-]+)/);
    const type = m ? m[1] : 'browser';
    return { pid: +pid, ppid, type, cmd, full };
  } catch { return null; }
}
export function allProcs() {
  const out = [];
  for (const d of readdirSync('/proc')) if (/^\d+$/.test(d)) { const p = procInfo(d); if (p) out.push(p); }
  return out;
}
export function descendants(root) {
  const ps = allProcs(), kids = new Map();
  for (const p of ps) { if (!kids.has(p.ppid)) kids.set(p.ppid, []); kids.get(p.ppid).push(p); }
  const out = [], st = [root];
  while (st.length) { const x = st.pop(); for (const c of kids.get(x) ?? []) { out.push(c); st.push(c.pid); } }
  return out;
}

/** launch a fresh headless browser (own profile); returns { browser, pid } with OOM guards on the whole tree */
export async function launch(extra = []) {
  // the browser process = the browser-type child of ours that was not there before the launch (pids wrap around:
  // picking the highest pid picked an older browser of the same driver)
  const isBrowser = (p) => p.type === 'browser' && /headless-shell|chrome/.test(p.cmd[0]) && p.ppid === process.pid;
  const before = new Set(descendants(process.pid).filter(isBrowser).map((p) => p.pid));
  const browser = await chromium.launch({ args: [...ARGS, ...extra] });
  const fresh = descendants(process.pid).filter((p) => isBrowser(p) && !before.has(p.pid));
  const pid = fresh.length === 1 ? fresh[0].pid : 0;
  if (!pid) throw new Error(`browser pid not found (${fresh.length} new browser processes)`);
  guard(pid);
  return { browser, pid };
}
export function guard(pid) {
  if (!pid) return;
  oom(pid);
  for (const p of descendants(pid)) oom(p.pid);
}
export function rendererPids(bpid) { return descendants(bpid).filter((p) => p.type === 'renderer').map((p) => p.pid); }
export function gpuPid(bpid) { const g = descendants(bpid).find((p) => p.type === 'gpu-process'); return g ? g.pid : 0; }

/** the renderer that hosts the (single) page: the renderer whose main thread used the most CPU so far (Chrome keeps
 *  an idle spare renderer around for the next navigation; picking the newest pid can pick that spare) */
export function pickRenderer(bpid) {
  const r = rendererPids(bpid);
  let best = 0, bestCpu = -1;
  for (const p of r) { const c = threadCpu(p); if (c > bestCpu) { bestCpu = c; best = p; } }
  return best;
}

export function threadCpu(pid, tid = pid) {
  try { return +readFileSync(`/proc/${pid}/task/${tid}/schedstat`, 'utf8').split(' ')[0]; } catch { return NaN; }
}
export function procCpu(pid) {
  let s = 0;
  try { for (const t of readdirSync(`/proc/${pid}/task`)) { try { s += +readFileSync(`/proc/${pid}/task/${t}/schedstat`, 'utf8').split(' ')[0]; } catch { /* exited */ } } } catch { return NaN; }
  return s;
}
export function loadavg() { return readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).map(Number); }

/** CPU snapshot: renderer main thread (ns), renderer process total, GPU process total */
export function snap(ctx) {
  return { t: Date.now(), main: threadCpu(ctx.rpid), rproc: procCpu(ctx.rpid), gpu: ctx.gpid ? procCpu(ctx.gpid) : NaN };
}
export function delta(a, b) { return { wall: b.t - a.t, main: (b.main - a.main) / 1e6, rproc: (b.rproc - a.rproc) / 1e6, gpu: (b.gpu - a.gpu) / 1e6 }; }

// ------------------------------------------------------------------ poller (per-frame main-thread CPU)
export function startPoller(paths, tag, usInterval = 400, maxS = 900) {
  const bin = resolve(OUT, 'poll', `${tag}.bin`), stopf = bin + '.stop';
  mkdirSync(dirname(bin), { recursive: true });
  if (existsSync(stopf)) unlinkSync(stopf);
  const ch = spawn(resolve(TOOLS, 'poll'), [String(usInterval), String(maxS), bin, stopf, ...paths], { stdio: 'ignore' });
  oom(ch.pid);
  return {
    bin,
    async stop() {
      writeFileSync(stopf, '1');
      // the poller writes its whole buffer at exit (tens of MB): wait for the exit itself (a 3 s cap read truncated
      // files at load 60+: WM_ui_low row 1 came back with zero CPU)
      if (ch.exitCode === null && ch.signalCode === null) await new Promise((r) => { ch.on('exit', r); setTimeout(r, 180000); });
      try { unlinkSync(stopf); } catch { /* */ }
      return readPoll(bin);
    },
  };
}
export function readPoll(bin) {
  const b = readFileSync(bin);
  const np = b.readInt32LE(0);
  const rec = np + 1, n = Math.floor((b.length - 4) / 8 / rec);
  const t = new Float64Array(n), v = Array.from({ length: np }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    const o = 4 + i * rec * 8;
    t[i] = Number(b.readBigInt64LE(o)) / 1e6; // epoch ms
    for (let k = 0; k < np; k++) v[k][i] = Number(b.readBigInt64LE(o + 8 * (k + 1))) / 1e6; // cpu ms
  }
  return { t, v };
}
/** cumulative CPU (ms) of series k at epoch-ms time x (linear interpolation) */
export function cpuAt(poll, k, x) {
  const t = poll.t, v = poll.v[k];
  let lo = 0, hi = t.length - 1;
  if (x <= t[0]) return v[0];
  if (x >= t[hi]) return v[hi];
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] <= x) lo = m; else hi = m; }
  const f = (x - t[lo]) / (t[hi] - t[lo] || 1);
  return v[lo] + (v[hi] - v[lo]) * f;
}
/** per-frame CPU from frame start times (epoch ms): frame i = [t_i, t_{i+1}) ; last frame ends at tEnd */
export function frameCpu(poll, k, starts, tEnd) {
  const out = [];
  for (let i = 0; i < starts.length; i++) {
    const a = starts[i], b = i + 1 < starts.length ? starts[i + 1] : tEnd;
    out.push(cpuAt(poll, k, b) - cpuAt(poll, k, a));
  }
  return out;
}

// ------------------------------------------------------------------ servers
export function serverUrl(side) {
  const s = JSON.parse(readFileSync(resolve(ROOT, 'servers.json'), 'utf8'));
  if (!s[side]) throw new Error('no server for ' + side);
  return `http://127.0.0.1:${s[side]}`;
}

// ------------------------------------------------------------------ stats
export function median(a) { const s = [...a].filter((x) => Number.isFinite(x)).sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; }
export function mean(a) { const s = a.filter((x) => Number.isFinite(x)); return s.reduce((p, x) => p + x, 0) / s.length; }
let seed = 12345;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
/** bootstrap 90% CI of the median of values */
export function bootMedian(vals, B = 4000) {
  const v = vals.filter((x) => Number.isFinite(x));
  if (!v.length) return [NaN, NaN, NaN];
  const ms = [];
  for (let b = 0; b < B; b++) { const s = []; for (let i = 0; i < v.length; i++) s.push(v[Math.floor(rnd() * v.length)]); ms.push(median(s)); }
  ms.sort((a, b) => a - b);
  return [median(v), ms[Math.floor(B * 0.05)], ms[Math.floor(B * 0.95)]];
}
/** ratio of medians with a bootstrap CI (independent samples a / b) */
export function bootRatio(a, b, B = 4000) {
  const A = a.filter(Number.isFinite), Bv = b.filter(Number.isFinite);
  if (!A.length || !Bv.length) return [NaN, NaN, NaN];
  const rs = [];
  for (let k = 0; k < B; k++) {
    const sa = [], sb = [];
    for (let i = 0; i < A.length; i++) sa.push(A[Math.floor(rnd() * A.length)]);
    for (let i = 0; i < Bv.length; i++) sb.push(Bv[Math.floor(rnd() * Bv.length)]);
    rs.push(median(sa) / median(sb));
  }
  rs.sort((x, y) => x - y);
  return [median(A) / median(Bv), rs[Math.floor(B * 0.05)], rs[Math.floor(B * 0.95)]];
}
export function appendJsonl(file, obj) { appendFileSync(file, JSON.stringify(obj) + '\n'); }
export function readJsonl(file) { return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
