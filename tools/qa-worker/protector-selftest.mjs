/** Browser-free native probe control: node --allow-natives-syntax tools/qa-worker/protector-selftest.mjs. */
import assert from 'node:assert/strict';
import { installProtector } from './w1.mjs';

installProtector();
if (!process.execArgv.includes('--allow-natives-syntax')) {
  assert.equal(globalThis.__qaProtector().intact, false);
  assert.match(globalThis.__qaProtector().error, /SyntaxError/);
  console.log('PASS protector fails closed without native-syntax support');
} else {
  assert.equal(globalThis.__qaProtector().intact, true);
  structuredClone(new Float32Array(64));
  assert.equal(globalThis.__qaProtector().intact, true, 'clone must keep the protector intact');
  const buffer = new ArrayBuffer(64);
  structuredClone(buffer, { transfer: [buffer] });
  assert.equal(globalThis.__qaProtector().intact, false, 'negative-control transfer must invalidate the protector');
  console.log('PASS protector warms and accepts clones; transfer negative control fails');
}
delete globalThis.__qaProtector;
