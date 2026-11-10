import { createRequire } from 'node:module';
import { assert } from './harness.mjs';

const require = createRequire(import.meta.url);

/** Focus emulation belongs to Playwright's owning CDP session, not newCDPSession(). */
export function owningLifecycleSession(page, version = require('playwright-core/package.json').version) {
  assert(version === '1.56.1', `freeze: owning-session adapter supports Playwright 1.56.1; found ${version}; review its focus-emulation setup`);
  const impl = page._connection?.toImpl?.(page);
  const session = impl?.delegate?._mainFrameSession?._client;
  assert(typeof session?.send === 'function', 'freeze: Playwright 1.56.1 owning CDP session is unavailable; cannot disable its focus emulation');
  return session;
}
