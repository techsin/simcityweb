import { launch, pickRenderer, gpuPid, rendererPids, descendants } from './lib.mjs';
const { browser, pid } = await launch();
const p = await browser.newPage();
await p.goto('about:blank');
console.log('browser', pid, 'renderers', rendererPids(pid), 'gpu', gpuPid(pid), descendants(pid).map((x) => x.pid + ':' + x.type).join(' '));
await browser.close();
