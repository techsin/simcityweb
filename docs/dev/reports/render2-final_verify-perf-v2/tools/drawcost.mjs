// main-thread CPU per WebGL draw call (what nodraw=1 leaves out): plain draws, indexed draws, instanced draws, multi-draw
import { launch, pickRenderer, threadCpu, sleep } from './lib.mjs';
const { browser, pid } = await launch();
const page = await browser.newPage();
await page.goto('about:blank');
await page.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64; document.body.appendChild(c);
  const gl = c.getContext('webgl2');
  const vs = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(vs, '#version 300 es\nin vec3 p; uniform mat4 m; void main(){ gl_Position = m * vec4(p,1.0); }'); gl.compileShader(vs);
  const fs = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(fs, '#version 300 es\nprecision mediump float; out vec4 o; void main(){ o = vec4(1.0); }'); gl.compileShader(fs);
  const pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr); gl.useProgram(pr);
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(3 * 3 * 64), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(192).map((_, i) => i), gl.STATIC_DRAW);
  gl.enable(gl.SCISSOR_TEST); gl.scissor(0, 0, 1, 1);
  const um = gl.getUniformLocation(pr, 'm'); const M = new Float32Array(16); M[0] = M[5] = M[10] = M[15] = 1;
  const md = gl.getExtension('WEBGL_multi_draw');
  const starts = new Int32Array(64).map((_, i) => i * 3), counts = new Int32Array(64).fill(3), offs = new Int32Array(64).map((_, i) => i * 6);
  window.__t = {
    none(n) { for (let i = 0; i < n; i++) { M[12] = i; gl.uniformMatrix4fv(um, false, M); } gl.flush(); },
    arrays(n) { for (let i = 0; i < n; i++) { M[12] = i; gl.uniformMatrix4fv(um, false, M); gl.drawArrays(gl.TRIANGLES, 0, 3); } gl.flush(); },
    elements(n) { for (let i = 0; i < n; i++) { M[12] = i; gl.uniformMatrix4fv(um, false, M); gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_SHORT, 0); } gl.flush(); },
    instanced(n) { for (let i = 0; i < n; i++) { M[12] = i; gl.uniformMatrix4fv(um, false, M); gl.drawElementsInstanced(gl.TRIANGLES, 3, gl.UNSIGNED_SHORT, 0, 4); } gl.flush(); },
    multi(n) { for (let i = 0; i < n; i++) { M[12] = i; gl.uniformMatrix4fv(um, false, M); md.multiDrawElementsWEBGL(gl.TRIANGLES, counts, 0, gl.UNSIGNED_SHORT, offs, 0, 64); } gl.flush(); },
    finish() { gl.finish(); },
  };
});
const r = pickRenderer(pid);
const res = {};
for (let rep = 0; rep < 5; rep++) {
  for (const [k, n] of [['none', 20000], ['arrays', 20000], ['elements', 20000], ['instanced', 20000], ['multi', 2000]]) {
    await page.evaluate(() => window.__t.finish());
    const a = threadCpu(r);
    await page.evaluate(([k, n]) => window.__t[k](n), [k, n]);
    const b = threadCpu(r);
    (res[k] ??= []).push((b - a) / 1e3 / n); // us per call
    await sleep(50);
  }
}
const med = (v) => v.sort((x, y) => x - y)[v.length >> 1];
const base = med(res.none);
for (const k of Object.keys(res)) console.log(k.padEnd(10), 'us/call median', med(res[k]).toFixed(2), 'minus uniform-only loop', (med(res[k]) - base).toFixed(2), 'all', res[k].map((x) => x.toFixed(2)).join(' '));
await browser.close();
