import { readdir, readFile, writeFile, lstat, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { assert } from './harness.mjs';

const PREFIX = 'metropolis-qa-worker-';
const ANCHOR = 'const done = Promise.resolve(predicted);';

/** Change the production host itself, in Vite's input only. Never write src/ or the normal dist/. */
export function breakAckPlugin(op, evidence) {
  evidence.op = op; evidence.rewrites = 0;
  return {
    name: 'qa-worker-break-ack', enforce: 'pre',
    transform(source, id) {
      if (!id.replaceAll('\\', '/').split('?')[0].endsWith('/src/worker/SimHost.ts')) return null;
      assert(source.split(ANCHOR).length === 2, 'break-ack: SimHost done initializer changed; review the transform against source');
      assert(evidence.rewrites === 0, 'break-ack: unexpected duplicate SimHost transform');
      evidence.rewrites++;
      return { code: source.replace(ANCHOR, `const done = op === ${JSON.stringify(op)} ? new Promise<CommandResult<K>>(() => {}) : Promise.resolve(predicted);`), map: null };
    },
    generateBundle() { assert(evidence.rewrites === 1, 'break-ack: the production build did not include the expected LocalSimHost'); },
  };
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
