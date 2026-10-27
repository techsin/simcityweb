// Contact sheets + GPU-vs-SwiftShader diff scores, rendered in a 2D canvas (no extra npm packages).
//   node montage.mjs <outDir with PNGs> <sheetDir>
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire('C:/Users/techsin/Desktop/projects/simcityweb-worker/package.json');
const { chromium } = require('playwright');
const [src, dst] = process.argv.slice(2);
mkdirSync(dst, { recursive: true });
const VIEWS = ['street_day_jun', 'default_day_jun', 'far_day_jun', 'default_night_jun', 'default_day_jan', 'street_night_jan'];
const url = (f) => 'data:image/png;base64,' + readFileSync(join(src, f)).toString('base64');
const b = await chromium.launch();
const p = await b.newPage();
const draw = (rows, cols, tile, cells) => p.evaluate(async ({ rows, cols, tile, cells }) => {
  const c = document.createElement('canvas'); c.width = cols * tile[0]; c.height = rows * (tile[1] + 18);
  const g = c.getContext('2d'); g.fillStyle = '#222'; g.fillRect(0, 0, c.width, c.height); g.font = '14px sans-serif';
  for (const { i, src, label } of cells) {
    const x = (i % cols) * tile[0], y = Math.floor(i / cols) * (tile[1] + 18);
    if (src) { const im = new Image(); im.src = src; await im.decode(); g.drawImage(im, x, y + 18, tile[0], tile[1]); }
    g.fillStyle = '#ff0'; g.fillText(label, x + 4, y + 14);
  }
  return c.toDataURL('image/png');
}, { rows, cols, tile, cells });
const diff = (a, s) => p.evaluate(async ({ a, s }) => {
  const W = 480, H = 270, px = async (u) => { const im = new Image(); im.src = u; await im.decode(); const c = new OffscreenCanvas(W, H); const g = c.getContext('2d'); g.drawImage(im, 0, 0, W, H); return g.getImageData(0, 0, W, H).data; };
  const A = await px(a), S = await px(s);
  let sum = 0; const blocks = new Float64Array(16 * 9);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = (y * W + x) * 4, d = (Math.abs(A[k] - S[k]) + Math.abs(A[k + 1] - S[k + 1]) + Math.abs(A[k + 2] - S[k + 2])) / 3;
    sum += d; blocks[Math.floor(y / 30) * 16 + Math.floor(x / 30)] += d / 900;
  }
  let mb = 0, mi = 0; blocks.forEach((v, i) => { if (v > mb) { mb = v; mi = i; } });
  return { mean: +(sum / (W * H)).toFixed(2), maxBlock: +mb.toFixed(1), at: [mi % 16, Math.floor(mi / 16)] };
}, { a, s });
const scores = [];
for (const scene of ['city', 'ui', 'world', 'gamefresh', 'game300k']) for (const q of ['low', 'high', 'ultra']) {
  const cells = [];
  VIEWS.forEach((v, k) => {
    const gf = `${scene}_${q}_1920_gpu_${v}.png`, sf = `${scene}_${q}_1920_ss_${v}.png`;
    const row = Math.floor(k / 3) * 2, col = k % 3;
    cells.push({ i: row * 3 + col, src: existsSync(join(src, gf)) ? url(gf) : null, label: `GPU ${v}` });
    cells.push({ i: (row + 1) * 3 + col, src: existsSync(join(src, sf)) ? url(sf) : null, label: `SwiftShader ${v}` });
  });
  writeFileSync(join(dst, `pair_${scene}_${q}.png`), Buffer.from((await draw(4, 3, [640, 360], cells)).split(',')[1], 'base64'));
  for (const v of VIEWS) {
    const gf = `${scene}_${q}_1920_gpu_${v}.png`, sf = `${scene}_${q}_1920_ss_${v}.png`;
    if (existsSync(join(src, gf)) && existsSync(join(src, sf))) scores.push({ shot: `${scene}_${q}_${v}`, ...(await diff(url(gf), url(sf))) });
  }
  const k4 = VIEWS.map((v, i) => { const f = `${scene}_${q}_3840_gpu_${v}.png`; return { i, src: existsSync(join(src, f)) ? url(f) : null, label: `GPU 4K ${v}` }; });
  writeFileSync(join(dst, `4k_${scene}_${q}.png`), Buffer.from((await draw(2, 3, [640, 360], k4)).split(',')[1], 'base64'));
  console.log('sheet', scene, q);
}
writeFileSync(join(dst, 'diff_scores.json'), JSON.stringify(scores, null, 1));
scores.sort((x, y) => y.maxBlock - x.maxBlock).slice(0, 25).forEach((s) => console.log(JSON.stringify(s)));
await b.close();
