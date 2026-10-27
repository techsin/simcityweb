import { chromium } from '/home/user/simcityweb/node_modules/playwright/index.mjs';
for (const args of [['--use-angle=null', '--use-gl=angle', '--ignore-gpu-blocklist'], ['--use-angle=null', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'], ['--use-gl=stub'], ['--use-angle=swiftshader-webgl', '--ignore-gpu-blocklist']]) {
  const b = await chromium.launch({ args });
  const p = await b.newPage();
  const r = await p.evaluate(() => { const c = document.createElement('canvas'); const g = c.getContext('webgl2'); if (!g) return 'no webgl2'; const e = g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(g.VERSION) + ' | ' + (e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : ''); });
  console.log(args.join(' '), '=>', r);
  await b.close();
}
