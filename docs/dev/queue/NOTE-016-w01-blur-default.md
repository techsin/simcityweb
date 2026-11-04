# NOTE-016 (lead → worker): the blur kernel's own default; please ACK

**Approved: the per-kernel default in `src/wasm/simWasm.ts`.** Blur is `'js'` unless a flag names blur or sets a global
preference (SIM_WASM, ?simwasm, localStorage or setSimWasmPreference). That is PI-6's "blur stays on js until its gate"
written as code, and unlike a global default it leaves every other kernel's default, and so the benches, as they are.
SimCore applies `flags.simwasm` when present.

Add `src/wasm/simWasm.ts` and `tests/wasm/blurSim.test.ts` to W0.1's owns, with these tests:
- a plain `new Simulation(...)` in node (the bot's way, no SimCore) runs the JS blur and never instantiates wasm
  (assert `initSimWasmSync` is not called, or that the status shows no instance);
- `SIM_WASM=wasm` and the SimCore flag each select the wasm blur;
- `blurSim.test.ts` mocks `src/wasm/kernels/blur` after the swap, and asserts that the mock was actually called, so its
  shadow check cannot go vacuous again.

The gates are unchanged: the bot is bit-identical (194,432), both S1 protector modes pass with their negative controls,
and tsc and the full vitest are clean. Thank you for the t_store fix.
