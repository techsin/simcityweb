/** Browser-free native probe controls; exact V8 flags and commands are in README.md. */
import assert from 'node:assert/strict';
import { installProtector, PROTECTOR_V8_FLAGS } from './w1.mjs';

installProtector();
if (!process.execArgv.includes('--allow-natives-syntax')) {
  assert.equal(globalThis.__qaProtector().intact, false);
  assert.match(globalThis.__qaProtector().error, /SyntaxError/);
  console.log('PASS protector fails closed without native-syntax support');
} else {
  for (const flag of PROTECTOR_V8_FLAGS) assert(process.execArgv.includes(flag), `native controls require ${flag}`);
  const probe = globalThis.__qaProtector;
  const clean = probe();
  assert.equal(clean.intact, true, JSON.stringify(clean));
  assert.equal(clean.turbofan, true);
  for (let i = 0; i < 32; i++) assert.equal(probe().intact, true, 'clean repeated checks must pass');
  structuredClone(new Float32Array(64));
  assert.equal(probe().intact, true, 'clone must keep the protector intact');
  const buffer = new ArrayBuffer(64);
  structuredClone(buffer, { transfer: [buffer] });
  assert.equal(buffer.byteLength, 0, 'negative control must actually detach its unrelated buffer');
  const transferred = probe();
  assert.equal(transferred.intact, false, 'negative-control transfer must invalidate the protector');
  assert.equal(transferred.turbofan, false, 'transfer must deoptimize the dependent loop');
  installProtector();
  assert.equal(globalThis.__qaProtector, probe, 'reinstallation must not reset the baseline');
  for (let i = 0; i < 32; i++) assert.equal(probe().intact, false, 'invalidation must remain sticky');
  console.log(`PASS protector clean/clone controls; unrelated transfer fails persistently (V8 statuses ${clean.status} -> ${transferred.status})`);
}
delete globalThis.__qaProtector;
