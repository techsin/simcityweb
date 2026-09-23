import { createServer } from 'vite';
import { chromium } from 'playwright';
const root = '/home/user/simcityweb';
const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false } });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}/demo-ui.html`;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'] });
const p = await browser.newPage({ viewport: { width: 640, height: 400 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(`${base}?${process.argv[2]}`, { waitUntil: 'load', timeout: 240000 });
await p.waitForFunction(() => window.__ready === true, null, { timeout: 480000, polling: 500 });
await p.waitForTimeout(4000);
const r = await p.evaluate(() => {
  const sc = window.__scene;
  const v = sc.objects;
  const veh = v.vehicles;
  const routes = veh.getRoutes ? veh.getRoutes(50) : null;
  const st = sc.sim.state;
  let tr = 0, rc = 0;
  for (let i = 0; i < st.traffic.length; i++) { if (st.network[i] >= 1 && st.network[i] <= 5) { rc++; tr += st.traffic[i]; } }
  return { stats: v.stats?.(), n: veh.n, target: veh.target, spawnCells: veh.spawnCells?.length, routes: routes ? routes.length : null,
    kinds: routes ? routes.slice(0, 50).map((q) => q.kind + ':' + q.cells.length).join(' ') : '', roadCells: rc, trafficSum: Math.round(tr),
    camY: sc.world?.camera?.position?.y, visCount: (() => { let c = 0; for (let i = 0; i < veh.n; i++) c += veh.vis[i]; return c; })(),
    tilesVis: (() => { let c = 0; for (const x of v.culler.vis) c += x; return c + '/' + v.culler.vis.length; })(),
    sample: (() => { const o = []; for (let i = 0; i < Math.min(5, veh.n); i++) o.push([veh.cell[i], veh.t[i].toFixed(1), veh.spd[i].toFixed(1), veh.posX[i].toFixed(0), veh.posZ[i].toFixed(0), veh.inst[i]]); return JSON.stringify(o); })(),
    batchCount: veh.batch.mesh.instanceCount, inScene: !!veh.batch.mesh.parent, updMs: v.lastUpdateMs, frames: v.prof.frames, hidden: veh.hidden, enabled: veh.enabled,
    routeCheck: (routes || []).slice(0, 12).map((q) => {
      const N = st.size; let road = 0, adj = 0, conn = 0;
      for (let k = 0; k < q.cells.length; k++) {
        const c = q.cells[k]; if (st.network[c] >= 1 && st.network[c] <= 5) road++;
        if (k > 0) { const a = q.cells[k - 1]; const dx = Math.abs(a % N - c % N), dz = Math.abs(((a / N) | 0) - ((c / N) | 0)); if (dx + dz === 1) adj++;
          const d = [[1,0],[0,1],[-1,0],[0,-1]].findIndex(([x, z]) => x === c % N - a % N && z === ((c / N) | 0) - ((a / N) | 0));
          if (d >= 0 && (v.net.roadMask[a] & (1 << d))) conn++; }
      }
      return `${q.cells.length}/${road}road/${adj}adj/${conn}conn first=${st.network[q.cells[0]]}`;
    }).join(' | ') };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
await server.close();
