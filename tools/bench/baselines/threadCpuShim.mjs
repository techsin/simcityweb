// Preload for tools/bench/sim-profile/profile.js on node builds without process.threadCpuUsage (node < 23.9, e.g. the
// Windows box's 22.12): `node --import ./tools/bench/baselines/threadCpuShim.mjs profile.js ...`. It maps
// threadCpuUsage to the high-resolution wall clock, so every "cpu" figure profile.js reports becomes main-thread WALL
// time. Use it only on an otherwise idle machine with spare cores, and say so next to the numbers; check it against a
// long-window process.cpuUsage() total (process.cpuUsage ticks at ~15.6 ms on Windows, too coarse per frame).
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
