/// <reference lib="webworker" />
/**
 * Services tier engine A/B — one ARM in a dedicated Web Worker (its own V8 isolate, like the sim worker of the game),
 * driven by the page that tools/bench/servicesTierEngine.bench.mjs serves to headless Chromium. Same commands as the
 * node arm (servicesTierEngine.node.ts); the clock is performance.now() (browsers expose no CPU-time clock: wall time
 * under machine load, so the driver interleaves arms and reports paired ratios). Nothing is transferred: postMessage
 * with a transfer list would detach a buffer and invalidate the protector this measurement keeps intact.
 */
import { BenchArm, type ArmConfig, type ReplayFamily } from './servicesTierEngine.core';

let arm: BenchArm | null = null;
const post = (m: Record<string, unknown>) => (self as unknown as Worker).postMessage({ ok: true, protector: arm?.probe ? arm.probe() : null, ...m });

self.onmessage = async (ev: MessageEvent<Record<string, unknown>>) => {
  const m = ev.data;
  try {
    switch (m.cmd) {
      case 'init': {
        const t0 = performance.now();
        const fixture = new Uint8Array(await (await fetch(m.fixture as string)).arrayBuffer());
        const wasm = m.wasm ? new Uint8Array(await (await fetch(m.wasm as string)).arrayBuffer()) : null;
        const cfg: ArmConfig = {
          kind: m.kind as ArmConfig['kind'], group: m.group as ArmConfig['group'], fixture, wasm, protector: m.protector as ArmConfig['protector'],
          clock: () => performance.now(),
        };
        arm = await BenchArm.create(cfg);
        post({ initMs: performance.now() - t0, info: arm.info(), ua: navigator.userAgent });
        return;
      }
      case 'pass': post({ s: arm!.pass(!!m.cold) }); return;
      case 'days': post({ s: arm!.days(m.n as number) }); return;
      case 'replay': post({ ms: arm!.replay(m.family as ReplayFamily, m.inner as number) }); return;
      case 'hash': post({ hash: arm!.hash() }); return;
      case 'info': post({ info: arm!.info() }); return;
      default: (self as unknown as Worker).postMessage({ ok: false, error: `unknown command ${String(m.cmd)}` });
    }
  } catch (e) {
    (self as unknown as Worker).postMessage({ ok: false, error: e instanceof Error ? e.stack ?? e.message : String(e) });
  }
};
