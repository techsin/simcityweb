/**
 * tools/qa-worker.mjs's verdicts on the protector control (risk 7; T061 F3), apart from the browser so a unit test reads
 * them. The worker's "protector intact" steps are evidence only where the positive control deoptimizes the probe
 * (`observable`), so a control that does not fails the run.
 */
export function controlChecks(control) {
  return [
    { step: 'control: the probe technique works in this browser (TurboFan code that depends on a protector deoptimizes when it goes)',
      ok: control.technique === true && control.made === true && control.before === true },
    { step: "control: a detach of a buffer with two views deoptimizes the probe (the worker's probe is evidence)",
      ok: control.observable === true },
  ];
}
