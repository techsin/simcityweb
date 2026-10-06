/**
 * Public entry of the WebAssembly simulation kernels (headless-safe: no DOM, no static node imports).
 * Browser code additionally calls initSimWasmBrowser() from './browser'. Guide: wasm/README.md.
 */
export {
  SIM_WASM_ABI, SIM_WASM_FILE, applySimWasmFlag, initSimWasm, initSimWasmSync, isSimWasmReady, kernelSlot, parseSimWasmFlag,
  resetSimWasm, setSimWasmPreference, simWasmCallFailed, simWasmImports, simWasmInstance, simWasmPreference, simWasmStatus, simWasmWanted,
  type SimWasmFeatures, type SimWasmInstance, type SimWasmPreference, type SimWasmState, type SimWasmStatus,
} from './simWasm';
export { WasmHeap, WasmHeapFullError, scratchSlot, type HeapArray, type HeapArrayCtor, type WasmHeapStats } from './heap';
export { adoptLayers, type AdoptedLayers } from './layers';
export * as wasmBlur from './kernels/blur';
