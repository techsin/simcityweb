// Legacy preload for node builds without process.threadCpuUsage (e.g. Windows node 22.12). profile.js no longer needs
// it: the profiler uses hrtime for short timings and long-window process.cpuUsage totals, with clocks labelled in JSON.
// Kept for old bundles: `node --import ./tools/bench/baselines/threadCpuShim.mjs profile.js ...`. It maps threadCpuUsage
// to wall time; label old bundles' "cpu" figures accordingly and compare with the process CPU total printed at exit.
if (typeof process.threadCpuUsage !== 'function') {
  const t0 = process.hrtime.bigint();
  process.threadCpuUsage = () => ({ user: Number((process.hrtime.bigint() - t0) / 1000n), system: 0 });
  process.env.PI1_THREADCPU_SHIM = '1';
  // the long-window check: process CPU (all threads, coarse ticks but exact over seconds) vs wall for the whole run
  const c0 = process.cpuUsage();
  process.on('exit', () => {
    const c = process.cpuUsage(c0), wall = Number(process.hrtime.bigint() - t0) / 1e6, cpu = (c.user + c.system) / 1000;
    process.stderr.write(`[threadCpuShim] wall ${wall.toFixed(0)} ms, process cpu ${cpu.toFixed(0)} ms, cpu/wall ${(cpu / wall).toFixed(3)}\n`);
  });
}
