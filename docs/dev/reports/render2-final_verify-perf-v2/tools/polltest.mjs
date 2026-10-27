import { launch, pickRenderer, startPoller, cpuAt } from './lib.mjs';
const { browser, pid } = await launch();
const page = await browser.newPage();
await page.goto('about:blank');
const r = pickRenderer(pid);
const P = startPoller([`/proc/${r}/task/${r}/schedstat`], 'polltest', 400, 60);
await new Promise((res) => setTimeout(res, 300));
const W = await page.evaluate(async () => {
  const now = () => performance.timeOrigin + performance.now();
  const out = [];
  for (let k = 0; k < 12; k++) {
    const dur = [5, 10, 20, 40][k % 4];
    await new Promise((r) => requestAnimationFrame(r));
    const a = now();
    while (now() - a < dur) { /* spin */ }
    const b = now();
    out.push([a, b, dur]);
    await new Promise((r) => setTimeout(r, 30));
  }
  return out;
});
const poll = await P.stop();
for (const [a, b, dur] of W) {
  const c = cpuAt(poll, 0, b) - cpuAt(poll, 0, a);
  const c2 = cpuAt(poll, 0, b + 2) - cpuAt(poll, 0, a - 2);
  console.log(`spin ${dur} ms: poll cpu in [a,b] ${c.toFixed(2)}  in [a-2,b+2] ${c2.toFixed(2)}`);
}
console.log('samples', poll.t.length, 'span ms', (poll.t[poll.t.length - 1] - poll.t[0]).toFixed(0), 'mean dt ms', ((poll.t[poll.t.length - 1] - poll.t[0]) / poll.t.length).toFixed(3));
await browser.close();
