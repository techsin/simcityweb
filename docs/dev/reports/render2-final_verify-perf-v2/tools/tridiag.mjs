// which objects submit the triangles of a still view: bench page (nodraw), view settled 40 frames, then the last of
// two more settle frames with three's renderBufferDirect wrapped: per object (path, geometry, material) the triangles
// and calls three counts, main pass (M), shadow pass (S) or other (O).
//   node tridiag.mjs <side> <scene> <q> <views csv>     (prints one JSON line)
import { launch, serverUrl, guard } from './lib.mjs';
const [side, scene, q, viewCsv] = process.argv.slice(2);
const { browser, pid } = await launch();
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await page.goto(`${serverUrl(side)}/bench.html?scene=${scene}&q=${q}&nodraw=1`, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 900000, polling: 200 });
  guard(pid);
  const out = {};
  for (const v of viewCsv.split(',')) {
    await page.evaluate((n) => window.__bench.still(n, 40), v);
    out[v] = await page.evaluate(async (n) => {
      const wv = window.__wv, r = wv.renderer, sm = r.shadowMap;
      const f = r.renderBufferDirect, smr = sm.render;
      let rec = {}, inShadow = 0;
      sm.render = function (...a) { inShadow++; try { return smr.apply(this, a); } finally { inShadow--; } };
      r.renderBufferDirect = function (camera, sc, geometry, material, object, group) {
        const t0 = r.info.render.triangles, c0 = r.info.render.calls;
        try { return f.call(this, camera, sc, geometry, material, object, group); } finally {
          let p = object;
          const path = [];
          while (p && path.length < 3) { path.push(p.name || p.type); p = p.parent; }
          const key = `${inShadow ? 'S' : (sc === wv.scene && camera === wv.camera ? 'M' : 'O')} ${path.join('<')} | ${geometry.name || geometry.type} | ${material.name || material.type}`;
          const e = rec[key] ?? (rec[key] = { t: 0, c: 0 });
          e.t += r.info.render.triangles - t0; e.c += r.info.render.calls - c0;
        }
      };
      try {
        await window.__bench.still(n, 1);
        rec = {};
        await window.__bench.still(n, 1);
      } finally {
        r.renderBufferDirect = f;
        sm.render = smr;
      }
      return rec;
    }, v);
  }
  console.log(JSON.stringify({ side, scene, q, out }));
} finally {
  await browser.close();
}
