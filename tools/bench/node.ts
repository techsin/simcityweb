/**
 * Node helpers for benchmarks: run the measurement on a dedicated worker thread (the main thread only waits), the
 * worker's CPU-time clock, load average, and JSON output. Benchmarks are bundled + run by tools/bench/run.mjs.
 */
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { cpus, loadavg } from 'node:os';
import { writeFileSync } from 'node:fs';

/**
 * Process CPU time in ms (user + system), 1 µs resolution. Used from the measuring worker while the main thread is
 * idle, so it is that thread's CPU time plus V8 background threads (quiet after warm-up: kernels do not allocate).
 * process.threadCpuUsage() / /proc/thread-self/schedstat are per thread but on this kernel only advance at scheduler
 * events (median step ~0.7-0.9 ms), too coarse for millisecond samples.
 */
export function cpuMs(): number {
  const u = process.cpuUsage();
  return (u.user + u.system) / 1000;
}

export function loadAvg(): number[] {
  return loadavg().map((v) => Math.round(v * 10) / 10);
}

export interface BenchEnv {
  args: string[];
  log: (line: string) => void;
}

/**
 * Entry point of a benchmark bundle: in the main thread, spawns this same file as a worker and relays its log lines;
 * in the worker, runs `body` and returns its result (printed as JSON / written to --json FILE by the main thread).
 */
export function benchMain(body: (env: BenchEnv) => unknown | Promise<unknown>): void {
  if (isMainThread) {
    const args = process.argv.slice(2);
    const jsonIdx = args.indexOf('--json');
    const jsonFile = jsonIdx >= 0 ? args[jsonIdx + 1] : undefined;
    const meta = { node: process.version, v8: process.versions.v8, cpus: cpus().length, cpu: cpus()[0]?.model, loadBefore: loadAvg() };
    console.log(`# node ${meta.node} (V8 ${meta.v8}), ${meta.cpus} cpus (${meta.cpu}), load average ${meta.loadBefore.join(' ')}`);
    const w = new Worker(new URL(import.meta.url), { workerData: { args } });
    w.on('message', (m: { log?: string; result?: unknown }) => {
      if (m.log !== undefined) console.log(m.log);
      if (m.result !== undefined) {
        const out = { ...meta, loadAfter: loadAvg(), result: m.result };
        console.log(`# load average after: ${out.loadAfter.join(' ')}`);
        if (jsonFile) {
          writeFileSync(jsonFile, JSON.stringify(out, null, 1));
          console.log(`# wrote ${jsonFile}`);
        }
      }
    });
    w.on('error', (e) => {
      console.error(e);
      process.exitCode = 1;
    });
    return;
  }
  const env: BenchEnv = { args: (workerData as { args: string[] }).args, log: (line) => parentPort!.postMessage({ log: line }) };
  Promise.resolve(body(env)).then(
    (result) => parentPort!.postMessage({ result: result ?? null }),
    (e) => {
      parentPort!.postMessage({ log: `ERROR ${e instanceof Error ? e.stack : String(e)}` });
      process.exitCode = 1;
    },
  );
}
