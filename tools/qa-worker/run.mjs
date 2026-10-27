import { execFileSync } from 'node:child_process';
import { mkdtemp, access, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, deadline } from './harness.mjs';
import { BROWSER_CHECKS, runChecks } from './checks.mjs';
import { watchProtectors } from './w1.mjs';
import { breakAckPlugin, ownTemp, removeTemp, sweepTemps } from './build.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const GPU = ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=default'];
export const SWIFTSHADER = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'];

export async function run(options, report, signal) {
  report.signal = signal;
  try { report.details.head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim(); }
  catch { report.details.head = 'unavailable'; }
  if (options.host !== 'local' && !options.w1) {
    const why = `${options.host} requires --w1 and ${options.host === 'worker' ? 'W1.2 WorkerSimHost' : 'W1.1b LoopbackSimHost'}; this base only has LocalSimHost`;
    for (const n of ['production build', 'Chromium', ...BROWSER_CHECKS, 'console errors', 'cleanup']) report.add(n, 'SKIPPED', why);
    return;
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
      const vite = await import('vite');
      dir = await mkdtemp(join(await realpath(tmpdir()), 'metropolis-qa-worker-'));
      await ownTemp(dir);
      const outDir = join(dir, 'dist');
      const config = { root: ROOT, logLevel: 'warn', build: { outDir, emptyOutDir: true } };
      if (options.breakAck) {
        report.details.brokenBuild = {};
        config.plugins = [breakAckPlugin(options.breakAck, report.details.brokenBuild)];
      }
      let digestPath;
      if (options.digestModule) {
        digestPath = resolve(ROOT, options.digestModule);
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
      server = await vite.preview({ root: ROOT, logLevel: 'error', build: { outDir }, preview: { port: 0, host: '127.0.0.1', strictPort: true, open: false } });
      const addr = server.httpServer.address();
      assert(addr && typeof addr !== 'string', 'vite preview has no TCP address');
      options.url = `http://127.0.0.1:${addr.port}/`;
      report.details.url = options.url;
      return 'vite build + owned vite preview on an ephemeral loopback port';
    });
    await report.check('Chromium', async () => {
      const { chromium } = await import('playwright');
      browser = await chromium.launch({ headless: !options.headed, executablePath: options.executable,
        handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
        args: [...(options.swiftshader ? SWIFTSHADER : GPU), '--js-flags=--allow-natives-syntax'] });
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
      if (options.w1) protectors = await watchProtectors(page);
      report.details.browser = browser.version();
      return `${browser.version()}; ${options.swiftshader ? 'SwiftShader (not a real-GPU acceptance run)' : 'real GPU requested'}`;
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
