#!/usr/bin/env node
/** WORKER_DESIGN §5.4 acceptance gate. See tools/qa-worker/README.md. */
import { parseArgs, help, Report } from './qa-worker/harness.mjs';

let options;
try { options = parseArgs(process.argv.slice(2)); }
catch (e) { console.error(`FAIL arguments: ${e.message}`); process.exitCode = 2; }
if (options?.help) console.log(help);
else if (options) {
  const report = new Report();
  report.configure(options);
  const controller = new AbortController();
  const onSignal = (signal) => {
    if (controller.signal.aborted) return;
    report.details.interrupted = signal;
    report.add('interrupted', 'FAIL', `${signal}; closing Chromium, preview and the temporary build`);
    controller.abort(signal);
  };
  const onInt = () => onSignal('SIGINT'), onTerm = () => onSignal('SIGTERM');
  process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
  try {
    const { run } = await import('./qa-worker/run.mjs');
    await run(options, report, controller.signal);
  } catch (e) { report.add('runner', 'FAIL', e.stack ?? String(e)); }
  finally { process.off('SIGINT', onInt); process.off('SIGTERM', onTerm); }
  await report.finish(options);
  process.exitCode = controller.signal.aborted ? (controller.signal.reason === 'SIGINT' ? 130 : 143) : report.exitCode;
}
