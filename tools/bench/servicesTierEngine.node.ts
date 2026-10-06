/**
 * Services tier engine A/B — one ARM in its own node process (own V8 isolate: its own ArrayBuffer-detaching protector,
 * GC and compiler threads), forked and driven over IPC by tools/bench/servicesTierEngine.bench.mjs. The process is
 * otherwise idle, so process.cpuUsage() around a command is that arm's CPU time (main thread + V8 helper threads).
 *
 * Messages in:  { cmd: 'init', kind, group, fixture (path), wasm (path | null), protector }
 *               { cmd: 'pass', cold } | { cmd: 'days', n } | { cmd: 'replay', family, inner } | { cmd: 'hash' } | { cmd: 'info' } | { cmd: 'exit' }
 * Messages out: { ok: true, ... } | { ok: false, error }; every reply carries the load average and the protector state.
 * Run `node --allow-natives-syntax` for the protector probe (the driver does).
 */
import { readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { BenchArm, type ArmConfig, type ReplayFamily } from './servicesTierEngine.core';

const cpu = (): number => {
  const u = process.cpuUsage();
  return (u.user + u.system) / 1000;
};

let arm: BenchArm | null = null;

function reply(m: Record<string, unknown>): void {
  process.send!({ ok: true, load: loadavg()[0], protector: arm?.probe ? arm.probe() : null, ...m });
}

process.on('message', (m: Record<string, unknown>) => {
  void (async () => {
    try {
      switch (m.cmd) {
        case 'init': {
          const t0 = cpu();
          const cfg: ArmConfig = {
            kind: m.kind as ArmConfig['kind'], group: m.group as ArmConfig['group'], fixture: new Uint8Array(readFileSync(m.fixture as string)),
            wasm: m.wasm ? new Uint8Array(readFileSync(m.wasm as string)) : null, protector: m.protector as ArmConfig['protector'], clock: cpu,
          };
          arm = await BenchArm.create(cfg);
          reply({ initMs: cpu() - t0, info: arm.info(), pid: process.pid });
          return;
        }
        case 'pass': reply({ s: arm!.pass(!!m.cold) }); return;
        case 'days': reply({ s: arm!.days(m.n as number) }); return;
        case 'replay': reply({ ms: arm!.replay(m.family as ReplayFamily, m.inner as number) }); return;
        case 'hash': reply({ hash: arm!.hash() }); return;
        case 'info': {
          const mu = process.memoryUsage();
          reply({ info: arm!.info(), mem: { rss: mu.rss, heapUsed: mu.heapUsed, external: mu.external, arrayBuffers: mu.arrayBuffers } });
          return;
        }
        case 'exit': process.exit(0);
        // eslint-disable-next-line no-fallthrough
        default: process.send!({ ok: false, error: `unknown command ${String(m.cmd)}` });
      }
    } catch (e) {
      process.send!({ ok: false, error: e instanceof Error ? e.stack ?? e.message : String(e) });
    }
  })();
});
process.send!({ ready: true });
