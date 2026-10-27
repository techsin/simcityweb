/**
 * W0.1 + WASM_PLAN PI-6: the simulation imports the blur drop-in, and wasm blur is opt-in. With no flag the JS blur
 * runs and wasm is never instantiated (the bot's plain Simulation included); SIM_WASM=wasm or the host's simwasm flag
 * selects the wasm blur. Each case loads fresh modules, so the switchboard starts from its defaults.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as BlurModule from '../../src/sim/infra/blur';

const jsCalls: Record<string, number> = {};
(globalThis as { __jsBlurCalls?: Record<string, number> }).__jsBlurCalls = jsCalls;

// Count the JS original's calls: the drop-in runs it whenever the blur kernel is not active.
vi.mock('../../src/sim/infra/blur', async (importOriginal) => {
  const m = await importOriginal<typeof BlurModule>();
  const calls = (globalThis as { __jsBlurCalls?: Record<string, number> }).__jsBlurCalls!;
  const out: Record<string, unknown> = { ...m };
  for (const [name, f] of Object.entries(m)) {
    if (typeof f !== 'function') continue;
    out[name] = (...a: unknown[]) => {
      calls[name] = (calls[name] ?? 0) + 1;
      return (f as (...a: unknown[]) => unknown)(...a);
    };
  }
  return out;
});

const DAYS = 30;
const savedEnv = process.env.SIM_WASM;

beforeEach(() => {
  vi.resetModules();
  delete process.env.SIM_WASM;
  for (const k of Object.keys(jsCalls)) delete jsCalls[k];
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (savedEnv === undefined) delete process.env.SIM_WASM;
  else process.env.SIM_WASM = savedEnv;
});

async function load() {
  return {
    wasm: await import('../../src/wasm/simWasm'),
    Simulation: (await import('../../src/sim/Simulation')).Simulation,
    createSystems: (await import('../../src/sim/systems/index')).createSystems,
    CityActions: (await import('../../src/sim/actions')).CityActions,
    SimCore: (await import('../../src/worker/SimCore')).SimCore,
    stressCity: (await import('../infra/cityGen')).stressCity,
  };
}
type Loaded = Awaited<ReturnType<typeof load>>;

/** the bot's way: a plain Simulation, no SimCore */
function runPlain(m: Loaded): void {
  const { st } = m.stressCity(128);
  const sim = new m.Simulation(st, m.createSystems());
  for (let d = 0; d < DAYS; d++) sim.advanceDay();
}

function runCore(m: Loaded, simwasm: string | null): void {
  const { st } = m.stressCity(128);
  const core = new m.SimCore(st, undefined, { simwasm });
  core.boot(null, { createSystems: m.createSystems, CityActions: m.CityActions });
  for (let d = 0; d < DAYS; d++) core.sim.advanceDay();
  core.dispose();
}

function expectJs(m: Loaded): void {
  expect(jsCalls.blur3 ?? 0, 'crime blurred on the JS original').toBeGreaterThan(0);
  expect(m.wasm.isSimWasmReady()).toBe(false);
  const s = m.wasm.simWasmStatus();
  expect(s.state).toBe('idle'); // never instantiated
  expect(s.kernels.blur).toMatchObject({ preference: 'js', active: false });
}

function expectWasm(m: Loaded, preference: string): void {
  const s = m.wasm.simWasmStatus();
  expect(s.state).toBe('ready');
  expect(s.kernels.blur).toMatchObject({ preference, active: true });
  // crime's blur3 (N = 128, r = 1, separate arrays) is in the kernel's domain: it never reaches the JS original
  expect(jsCalls.blur3 ?? 0, 'crime blurred on wasm').toBe(0);
}

describe('simwasm: blur is opt-in (WASM_PLAN PI-6)', () => {
  it("a plain Simulation with no flag (the bot's way) runs the JS blur and never instantiates wasm", { timeout: 120000 }, async () => {
    const m = await load();
    runPlain(m);
    expectJs(m);
  });

  it('SimCore with no flag keeps the JS blur', { timeout: 120000 }, async () => {
    const m = await load();
    runCore(m, null);
    expectJs(m);
  });

  it('SIM_WASM=wasm selects the wasm blur for a plain Simulation', { timeout: 120000 }, async () => {
    process.env.SIM_WASM = 'wasm';
    const m = await load();
    runPlain(m);
    expectWasm(m, 'wasm');
  });

  it("SimCore's simwasm flag selects the wasm blur", { timeout: 120000 }, async () => {
    const m = await load();
    runCore(m, 'blur:wasm');
    expectWasm(m, 'wasm');
  });

  it('the kernel default yields to any source that names blur or chooses the global preference', async () => {
    const { wasm } = await load();
    expect(wasm.simWasmPreference('blur')).toBe('js');
    expect(wasm.simWasmPreference('traffic')).toBe('auto'); // other kernels keep 'auto'
    wasm.setSimWasmPreference('auto', 'blur');
    expect(wasm.simWasmPreference('blur')).toBe('auto');
    vi.resetModules();
    const fresh = await import('../../src/wasm/simWasm');
    fresh.setSimWasmPreference('auto');
    expect(fresh.simWasmPreference('blur')).toBe('auto');
  });

  it.each<[string | null, boolean]>([
    [null, false], ['', false], ['js', false], ['traffic:wasm', false], ['js,blur:auto', false], ['auto,blur:js', false],
    ['wasm', true], ['auto', true], ['1', true], ['blur:wasm', true], ['blur:auto', true], ['js,blur:wasm', true],
  ])('flag %j selects the wasm blur: %s', async (flag, selects) => {
    const { wasm } = await load();
    expect(wasm.simWasmFlagSelects(flag, 'blur')).toBe(selects);
  });

  it("reads the page's flag from ?simwasm= before localStorage", async () => {
    const { wasm } = await load();
    expect(wasm.pageSimWasmFlag()).toBe(null); // node: no location, no storage
    const store = new Map([['metropolis.simwasm', 'blur:auto']]);
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null });
    expect(wasm.pageSimWasmFlag()).toBe('blur:auto');
    vi.stubGlobal('location', { search: '?city=a&simwasm=blur:wasm' });
    expect(wasm.pageSimWasmFlag()).toBe('blur:wasm');
  });
});
