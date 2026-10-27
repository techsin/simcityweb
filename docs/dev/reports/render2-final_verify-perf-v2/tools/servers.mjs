// one process hosting a vite dev server per side: node servers.mjs side1 side2 ... (ports from 9741 up)
import { createServer } from '/home/user/simcityweb/node_modules/vite/dist/node/index.js';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, SIDES, oom } from './lib.mjs';
oom(process.pid);
writeFileSync(resolve(ROOT, 'servers.pid'), String(process.pid));
const sides = process.argv.slice(2);
const file = resolve(ROOT, 'servers.json');
const ports = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
let base = 9741;
const used = new Set(Object.values(ports));
for (const side of sides) {
  let port = ports[side];
  if (!port) { while (used.has(base)) base++; port = base++; used.add(port); }
  const server = await createServer({
    configFile: false, root: resolve(SIDES, side), cacheDir: resolve(ROOT, 'vitecache', side), logLevel: 'warn', clearScreen: false,
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false, watch: null },
  });
  await server.listen();
  ports[side] = port;
  console.log(`[servers] ${side} on ${port}`);
}
writeFileSync(file, JSON.stringify(ports, null, 1));
console.log('[servers] up', JSON.stringify(ports));
setInterval(() => {}, 1 << 30);
