import { readdir, readFile, writeFile, lstat, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { assert } from './harness.mjs';

const PREFIX = 'metropolis-qa-worker-';
const ANCHOR = 'const done = Promise.resolve(predicted);';
const PACKET_ACK = 'private ack(seq: number, result: unknown): void {';
const PACKET_RESOLVE = 'else ticket?.resolve(result);';

/** Change the production host itself, in Vite's input only. Never write src/ or the normal dist/. */
export function breakAckPlugin(op, evidence, host = 'local') {
  const local = host === 'local';
  evidence.op = op; evidence.host = host; evidence.rewrites = 0;
  return {
    name: 'qa-worker-break-ack', enforce: 'pre',
    transform(source, id) {
      const file = local ? 'SimHost.ts' : 'LoopbackSimHost.ts';
      if (!id.replaceAll('\\', '/').split('?')[0].endsWith(`/src/worker/${file}`)) return null;
      const anchors = local ? [ANCHOR] : [PACKET_ACK, PACKET_RESOLVE];
      for (const anchor of anchors) assert(source.split(anchor).length === 2, `break-ack: ${file} ${local ? 'done initializer' : 'acknowledgement'} changed; review the transform against source`);
      assert(evidence.rewrites === 0, `break-ack: unexpected duplicate ${file} transform`);
      evidence.rewrites++;
      const code = local
        ? source.replace(ANCHOR, `const done = op === ${JSON.stringify(op)} ? new Promise<CommandResult<K>>(() => {}) : Promise.resolve(predicted);`)
        : source.replace(PACKET_ACK, `${PACKET_ACK}\n    const qaCommand = this.edits.get(seq);`)
          .replace(PACKET_RESOLVE, `else if (qaCommand?.op !== ${JSON.stringify(op)}) ticket?.resolve(result);`);
      return { code, map: null };
    },
    generateBundle() { assert(evidence.rewrites === 1, `break-ack: the production build did not include the expected ${local ? 'LocalSimHost' : 'PacketSimHost'}`); },
  };
}

/** `--port`: a taken port fails here, before the build, with the bind the preview will make (it is strict too). */
export function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', (e) => reject(new Error(e.code === 'EADDRINUSE' ? `--port ${port} is already in use on 127.0.0.1` : `--port ${port}: ${e.message}`)));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve()));
  });
}

export async function ownTemp(dir) {
  await writeFile(join(dir, 'owner.json'), JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
}

async function ownedPath(dir) {
  const root = await realpath(tmpdir()), path = resolve(dir);
  const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  assert(same(dirname(path), resolve(root)) && basename(path).startsWith(PREFIX), 'refusing a path outside the QA temporary build directory');
  const stat = await lstat(path);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), 'refusing to remove a non-directory or linked temporary build');
  assert(same(await realpath(path), path), 'refusing a redirected temporary build path');
  return { path, stat };
}

export async function removeTemp(dir) {
  const { path } = await ownedPath(dir);
  await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

export async function sweepTemps() {
  const root = await realpath(tmpdir()), removed = [], kept = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.name.startsWith(PREFIX) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
    const dir = join(root, entry.name);
    const { stat } = await ownedPath(dir);
    let owner;
    try { owner = JSON.parse(await readFile(join(dir, 'owner.json'), 'utf8')); } catch { /* legacy or interrupted creation */ }
    let stale = false;
    if (Number.isSafeInteger(owner?.pid) && owner.pid > 0) {
      try { process.kill(owner.pid, 0); }
      catch (e) { stale = e.code === 'ESRCH'; } // EPERM is not proof that another lane is dead.
    } else stale = Date.now() - stat.mtimeMs > 24 * 60 * 60 * 1000;
    if (stale) { await removeTemp(dir); removed.push(entry.name); }
    else kept.push(entry.name);
  }
  return { removed, kept };
}
