import { chromium } from '/home/user/simcityweb/node_modules/playwright/index.mjs';
import { readFileSync, readdirSync } from 'node:fs';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'] });
const p = await b.newPage();
await p.goto('about:blank');
await p.evaluate(() => { const c = document.createElement('canvas'); const g = c.getContext('webgl2'); return !!g; });
const procs = [];
for (const d of readdirSync('/proc')) {
  if (!/^\d+$/.test(d)) continue;
  try {
    const cmd = readFileSync(`/proc/${d}/cmdline`, 'utf8').split('\0');
    if (!cmd[0].includes('chrom') && !cmd[0].includes('headless')) continue;
    const type = (cmd.find((a) => a.startsWith('--type=')) || '--type=browser').slice(7);
    const ppid = readFileSync(`/proc/${d}/stat`, 'utf8').split(') ')[1].split(' ')[1];
    const tasks = readdirSync(`/proc/${d}/task`).map((t) => t + ':' + readFileSync(`/proc/${d}/task/${t}/comm`, 'utf8').trim());
    procs.push({ pid: d, ppid, type, exe: cmd[0], ntasks: tasks.length, tasks: tasks.slice(0, 40) });
  } catch {}
}
console.log(JSON.stringify(procs, null, 1));
await b.close();
