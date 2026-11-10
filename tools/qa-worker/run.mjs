import { execFileSync } from 'node:child_process';
import { mkdtemp, access, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, deadline } from './harness.mjs';
import { BROWSER_CHECKS, runChecks } from './checks.mjs';
import { PROTECTOR_V8_FLAGS, watchProtectors } from './w1.mjs';
import { assertPortFree, breakAckPlugin, ownTemp, removeTemp, sweepTemps } from './build.mjs';
import { GPU, SWIFTSHADER } from './launch.mjs';

/** The tree this harness lives in: what it builds and serves. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export { GPU, SWIFTSHADER };

export async function run(options, report, signal) {
  report.signal = signal;
  try { report.details.head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim(); }
  catch { report.details.head = 'unavailable'; }
  if (options.host === 'worker') {
    try { await access(join(ROOT, 'src/worker/WorkerSimHost.ts')); }
    catch (e) {
      if (e.code !== 'ENOENT') throw e;
      for (const n of ['production build', 'Chromium', ...BROWSER_CHECKS, 'console errors', 'cleanup']) report.add(n, 'SKIPPED', 'worker host not in this build; requires T034 / W1.2 WorkerSimHost');
      return;
    }
  }
  let dir, server, browser, page, protectors;
  // Playwright must not exit the process before our finally removes the owned build.
  const interrupt = () => { void browser?.close().catch(() => {}); };
  signal?.addEventListener('abort', interrupt, { once: true });
  const errors = [], warnings = [];
  try {
    await report.check('temporary build sweep', async () => {
      const swept = await sweepTemps(); report.details.tempSweep = swept;
      return `removed ${swept.removed.length} stale builds; retained ${swept.kept.length} live/recent builds`;
    });
    await report.check('production build', async () => {
      if (options.port) await assertPortFree(options.port);
      const vite = await import('vite');
      dir = await mkdtemp(join(await realpath(tmpdir()), 'metropolis-qa-worker-'));
      await ownTemp(dir);
      const outDir = join(dir, 'dist');
      const config = { root: ROOT, logLevel: 'warn', build: { outDir, emptyOutDir: true } };
      if (options.breakAck) {
        report.details.brokenBuild = {};
        config.plugins = [breakAckPlugin(options.breakAck, report.details.brokenBuild, options.host)];
      }
      let digestPath;
      const digestModule = options.digestModule ?? (options.w1 || options.host !== 'local' ? 'src/worker/queries.ts' : null);
      if (digestModule) {
        digestPath = resolve(ROOT, digestModule);
        await access(digestPath);
        config.build.rollupOptions = { preserveEntrySignatures: 'strict', input: { main: join(ROOT, 'index.html'), gallery: join(ROOT, 'gallery.html'), 'qa-digest': digestPath } };
      }
      const built = await vite.build(config);
      assert(!signal?.aborted, 'run interrupted during production build');
      if (digestPath) {
        const chunk = (Array.isArray(built) ? built : [built]).flatMap((b) => b.output ?? []).find((c) => c.type === 'chunk' && c.isEntry && c.name === 'qa-digest');
        assert(chunk, 'build did not emit the requested exactDigest module');
        options.digestAsset = chunk.fileName;
      }
      // --port N: that port or a failure (strictPort), never a neighbouring one; 0 lets the system pick a free port
      server = await vite.preview({ root: ROOT, logLevel: 'error', build: { outDir }, preview: { port: options.port ?? 0, host: '127.0.0.1', strictPort: true, open: false } });
      const addr = server.httpServer.address();
      assert(addr && typeof addr !== 'string', 'vite preview has no TCP address');
      assert(!options.port || addr.port === options.port, `vite preview listens on ${addr.port}, not on --port ${options.port}`);
      options.url = `http://127.0.0.1:${addr.port}/`;
      report.details.url = options.url;
      return `vite build of this tree + owned vite preview on 127.0.0.1:${addr.port} (${options.port ? '--port' : 'a free port'})`;
    });
    await report.check('Chromium', async () => {
      const { chromium } = await import('playwright');
      report.details.v8Flags = [...PROTECTOR_V8_FLAGS];
      report.details.gpuFlags = [...(options.swiftshader ? SWIFTSHADER : GPU)];
      browser = await chromium.launch({ headless: !options.headed, executablePath: options.executable,
        handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
        args: [...report.details.gpuFlags, `--js-flags=${PROTECTOR_V8_FLAGS.join(' ')}`] });
      assert(!signal?.aborted, 'run interrupted during browser launch');
      const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
      page = await context.newPage();
      page.setDefaultTimeout(options.ackTimeout);
      // Playwright's evaluate has no timeout of its own. A wedged local sim must fail instead of hanging the gate.
      const evaluate = page.evaluate.bind(page);
      page.evaluate = (...args) => deadline(evaluate(...args), options.ackTimeout, 'page evaluation timed out (renderer/simulation unresponsive)');
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push({ type: 'console', text: m.text(), location: m.location() });
        if (m.type() === 'warning') warnings.push(m.text());
      });
      page.on('pageerror', (e) => errors.push({ type: 'pageerror', text: e.stack ?? e.message }));
      page.on('crash', () => errors.push({ type: 'crash', text: 'Chromium page crashed' }));
      if (options.w1 || options.host !== 'local') protectors = await watchProtectors(page);
      report.details.browser = browser.version();
      return `${browser.version()}; ${options.swiftshader ? 'SwiftShader (not a real-GPU acceptance run)' : `real GPU requested (${GPU.join(' ')}); host ready checks the renderer`}`;
    }, ['production build']);
    if (report.passed('Chromium')) {
      try { await runChecks(page, options, report, protectors, signal); }
      catch (e) { if (!signal?.aborted) report.add('browser checks', 'FAIL', e.stack ?? String(e), e.failure); }
    }
  } finally {
    for (const name of BROWSER_CHECKS) if (!report.checks.some((c) => c.name === name)) report.add(name, 'SKIPPED', 'browser setup or an earlier prerequisite failed; see FAIL above');
    report.details.consoleErrors = errors;
    report.details.consoleWarnings = warnings;
    if (page) {
      await report.check('console errors', async () => {
        assert(errors.length === 0, `${errors.length} errors: ${errors.map((e) => e.text).join('; ')}`);
        return '0 console errors, 0 page exceptions, 0 crashes across boot, commands and reload';
      });
    } else report.add('console errors', 'SKIPPED', 'no browser page was opened');
    await report.check('cleanup', async () => {
      const failures = [];
      for (const close of [
        () => page && !page.isClosed() && page.evaluate(() => window.__qaWorker?.dispose()),
        () => protectors?.dispose(),
        () => browser?.close(),
        () => server?.close(),
        () => dir && removeTemp(dir),
      ]) { try { await close(); } catch (e) { failures.push(e.message); } }
      assert(failures.length === 0, failures.join('; '));
      return 'probe, Chromium, preview and temporary build closed';
    });
    signal?.removeEventListener('abort', interrupt);
  }
}
