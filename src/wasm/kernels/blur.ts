/**
 * src/sim/infra/blur.ts with the WebAssembly kernels: drop-in replacement (same exports, bit-identical results; JS is
 * used whenever wasm is unavailable, disabled with ?simwasm=js / SIM_WASM=js, or the arguments are unusual).
 */
import * as js from '../../sim/infra/blur';
import { makeBlurKernels } from './blurBind';

export { BLUR_KERNEL, makeBlurKernels, type BlurApi } from './blurBind';

const k = makeBlurKernels(js);
export const boxH = k.boxH;
export const boxV = k.boxV;
export const blur3 = k.blur3;
export const blurSigma2 = k.blurSigma2;
export const shiftField = k.shiftField;
export const shiftPlume = k.shiftPlume;
export const boxAverage = k.boxAverage;
export const blurDown = k.blurDown;
export const upsampleAdd = k.upsampleAdd;
export const blurDownAdd = k.blurDownAdd;
