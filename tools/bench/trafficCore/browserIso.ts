/**
 * ISOLATED browser A/B of the traffic cycle (node side, driven by tools/bench/trafficCore.bench.mjs browser): every
 * arm is its own page in its own browser context, i.e. its own renderer process and V8 isolate (browserArm.ts), so no
 * JIT / inline-cache feedback is shared between arms. The coordinator sends one cycle at a time to one arm (rotating
 * order, >= 31 rounds after warm-up) and waits; the other renderers are idle.
 * Clocks: CPU time of the arm's renderer process = sum over its threads of /proc/<pid>/task/<tid>/schedstat (ns; read
 * before the cycle and `settle` ms after it, so the arm's trailing background GC / compile work is included), plus
 * the wall time measured around runCycleSync inside the page (performance.now). The renderer's pid is the renderer
 * whose CPU time grew most while the arm loaded its city (CDP SystemInfo.getProcessInfo).
 * Identity: per-field digests of every arm's traffic state and city outputs against the first arm.
 */
import { readdirSync, readFileSync } from 'node:fs';
import type { Browser, BrowserContext, CDPSession, Page } from 'playwright';
import { bootstrapMedianCI } from '../ab';
import { diffDigests } from './compare';
import { PHASE_NAMES } from './phases';

type Where = 'main' | 'worker';
export interface IsoOpts {
  base: string;
  testdefs: boolean;
  pairs: number;
  warm: number;
  resident: boolean;
  kinds: string[];
  where: Where[];
  settle: number;
}

const median = (xs: number[]) => { const s = xs.slice().sort((a, b) => a - b); const n = s.length; return n === 0 ? NaN : n % 2 ? s[(n - 1) >> 1] : 0.5 * (s[n / 2 - 1] + s[n / 2]); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** CPU ms of every thread of a process (schedstat: ns on CPU, current for threads that are not running) */
function procCpuMs(pid: number): number {
  let tasks: string[];
  try { tasks = readdirSync(`/proc/${pid}/task`); } catch { return NaN; }
  let ns = 0;
  for (const t of tasks) {
    try { ns += Number(readFileSync(`/proc/${pid}/task/${t}/schedstat`, 'utf8').split(' ')[0]); } catch { /* thread exited */ }
  }
  return ns / 1e6;
}

async function rendererCpu(cdp: CDPSession): Promise<Map<number, number>> {
  const r = (await cdp.send('SystemInfo.getProcessInfo' as never)) as unknown as { processInfo: { type: string; id: number; cpuTime: number }[] };
  return new Map(r.processInfo.filter((p) => p.type === 'renderer').map((p) => [p.id, p.cpuTime]));
}

interface ArmPage { kind: string; ctx: BrowserContext; page: Page; pid: number; info: Record<string, number> }
interface Sample { cpu: number; wall: number; phases: number[] }

export async function runIsolatedBrowser(browser: Browser, o: IsoOpts, log: (s: string) => void): Promise<Record<string, unknown>> {
  const cdp = await browser.newBrowserCDPSession();
  const out: Record<string, unknown> = {};
  for (const where of o.where) {
    const arms: ArmPage[] = [];
    try {
      for (const kind of o.kinds) {
        const before = await rendererCpu(cdp);
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        page.on('console', (m) => log(`[${where} ${kind}] ${m.text()}`));
        page.on('pageerror', (e) => log(`[pageerror ${where} ${kind}] ${e.message}`));
        await page.goto(`${o.base}/arm.html`);
        const info = (await page.evaluate(`window.__arm.init(${JSON.stringify({ kind, testdefs: o.testdefs, resident: o.resident, where })})`)) as Record<string, number>;
        const after = await rendererCpu(cdp);
        let pid = -1, best = 0.5;
        for (const [p, c] of after) { const d = c - (before.get(p) ?? 0); if (d > best) { best = d; pid = p; } }
        if (pid < 0 || !(procCpuMs(pid) > 0)) throw new Error(`${where} ${kind}: renderer process not identified`);
        arms.push({ kind, ctx, page, pid, info });
        log(`[${where}] arm ${kind}: renderer pid ${pid} (setup ${best.toFixed(1)} s CPU, ${(info.setupMs / 1000).toFixed(1)} s wall), pop ${info.pop}, road nodes ${info.nodes}, simd ${info.simd}`);
      }
      const n = arms.length;
      const cycle = async (i: number): Promise<Sample> => {
        const a = arms[i];
        const c0 = procCpuMs(a.pid);
        const r = (await a.page.evaluate('window.__arm.cycle()')) as { ms: number; phases: number[] };
        await sleep(o.settle);
        return { cpu: procCpuMs(a.pid) - c0, wall: r.ms, phases: r.phases };
      };
      for (let k = 0; k < o.warm; k++) for (let i = 0; i < n; i++) await cycle(i);
      const S: Sample[][] = arms.map(() => []);
      const t0 = Date.now();
      for (let k = 0; k < o.pairs; k++) {
        for (let q = 0; q < n; q++) { const i = (q + k) % n; S[i].push(await cycle(i)); }
        if (k < 2 || k === o.pairs - 1 || k % 10 === 9) log(`[${where}] pair ${k}: ${arms.map((a, i) => `${a.kind} ${S[i][k].cpu.toFixed(1)} cpu / ${S[i][k].wall.toFixed(1)} wall`).join(' | ')} ms (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
      }
      const vs = (i: number, j: number, f: (s: Sample) => number) => {
        const r = S[i].map((x, k) => f(S[j][k]) / f(x)).filter((v) => v === v && v > 0 && v !== Infinity);
        if (r.length < 5) return null;
        const ci = bootstrapMedianCI(r);
        return { speedup: 1 / median(r), lo: 1 / ci.hi, hi: 1 / ci.lo, n: r.length };
      };
      const fmt = (r: ReturnType<typeof vs>) => (r ? `${r.speedup.toFixed(3)}x [${r.lo.toFixed(3)}, ${r.hi.toFixed(3)}]` : 'n/a');
      const idx = (k: string) => o.kinds.indexOf(k);
      const ratios: Record<string, unknown> = {};
      for (const [x, y] of [['orig', 'orig2'], ['orig', 'fair'], ['orig', 'wasm'], ['fair', 'wasm'], ['wasm-scalar', 'wasm']]) {
        const i = idx(x), j = idx(y);
        if (i < 0 || j < 0) continue;
        const cpu = vs(i, j, (s) => s.cpu), wall = vs(i, j, (s) => s.wall);
        ratios[`${x}->${y}`] = { cpu, wall };
        log(`[${where}] ${x} -> ${y}: cycle CPU ${fmt(cpu)}, wall ${fmt(wall)}`);
      }
      const summary = arms.map((a, i) => ({
        kind: a.kind, cpuMedian: median(S[i].map((s) => s.cpu)), cpuMin: Math.min(...S[i].map((s) => s.cpu)),
        wallMedian: median(S[i].map((s) => s.wall)), wallMin: Math.min(...S[i].map((s) => s.wall)),
        phasesWall: Object.fromEntries(PHASE_NAMES.map((nm, p) => [nm, median(S[i].map((s) => s.phases[p]))])),
      }));
      for (const s of summary) log(`[${where}] ${s.kind.padEnd(12)} CPU median ${s.cpuMedian.toFixed(1)} ms (min ${s.cpuMin.toFixed(1)}), wall median ${s.wallMedian.toFixed(1)} ms (min ${s.wallMin.toFixed(1)})`);
      const dg: { digest: Record<string, number>; stats: Record<string, unknown>; arena: number; lastJsReason: string | null }[] = [];
      for (const a of arms) dg.push((await a.page.evaluate('window.__arm.digest()')) as (typeof dg)[number]);
      const identity = Object.fromEntries(arms.slice(1).map((a, i) => [a.kind, diffDigests(dg[0].digest, dg[i + 1].digest)]));
      log(`[${where}] identical to ${arms[0].kind} after ${o.warm + o.pairs} cycles: ${Object.entries(identity).map(([k, d]) => `${k} ${d.length ? 'NO ' + d.slice(0, 3).join('; ') : 'yes'}`).join(', ')}`);
      const wi = idx('wasm');
      if (wi >= 0) log(`[${where}] wasm stats ${JSON.stringify(dg[wi].stats)}; arena ${(dg[wi].arena / 1048576).toFixed(1)} MiB; last JS reason ${dg[wi].lastJsReason || '-'}`);
      out[where] = { arms: summary, ratios, identity, pids: arms.map((a) => a.pid), wasm: wi >= 0 ? dg[wi] && { stats: dg[wi].stats, arena: dg[wi].arena } : null };
    } finally {
      for (const a of arms) await a.ctx.close().catch(() => {});
    }
  }
  await cdp.detach().catch(() => {});
  return out;
}
