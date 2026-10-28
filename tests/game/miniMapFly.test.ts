/** FEEL-08: a minimap click is a long jump and flies; a drag scrubs (and so stops a flight); a click's wobble is no drag */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CELL_SIZE } from '../../src/core/constants';
import { Overlay } from '../../src/core/types';
import type { GameContext } from '../../src/game/context';
import { MiniMap } from '../../src/ui/MiniMap';
import { LocalSimHost } from '../../src/worker/SimHost';
import { newState } from '../infra/cityGen';
import { FEl, installFakeDom } from './fakeDom';

installFakeDom();
afterEach(() => vi.restoreAllMocks());

describe('FEEL-08 minimap jumps', () => {
  it('a click flies, a click with a few pixels of wobble still flies, and a real drag scrubs without flying', async () => {
    const abort = new AbortController();
    const host = new LocalSimHost(newState(16), { signal: abort.signal });
    const calls: unknown[][] = [];
    const ctx = {
      host, get state() { return host.state; }, sim: host.sim, signal: abort.signal, overlay: Overlay.None,
      world: { controls: { focusOn: (...a: unknown[]) => { calls.push(a); }, rotateStep: () => {} } },
      sound: () => {}, focusCell: () => {}, panels: { open: () => {} },
    } as unknown as GameContext;
    const g = {
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => {}, clearRect: () => {}, drawImage: () => {}, imageSmoothingEnabled: false,
    };
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = new FEl(tag);
      return tag !== 'canvas' ? el : Object.assign(el, {
        getContext: () => g,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
        setPointerCapture: () => {},
      });
    }) as typeof document.createElement);
    const map = new MiniMap(ctx, new FEl('div') as unknown as HTMLElement);
    const canvas = (map as unknown as { canvas: FEl }).canvas;
    const m = 16 * CELL_SIZE, fly = { fly: true };
    try {
      // a click with 2 px of wobble: one flying focus, the wobble ignored
      canvas.fire('pointerdown', { button: 0, clientX: 80, clientY: 20, pointerId: 1 });
      canvas.fire('pointermove', { clientX: 82, clientY: 21 });
      canvas.fire('pointerup', {});
      expect(calls).toEqual([[0.8 * m, 0.2 * m, undefined, fly]]);
      // a drag: the press flies, then each move past 4 px scrubs without flying
      canvas.fire('pointerdown', { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
      canvas.fire('pointermove', { clientX: 30, clientY: 10 });
      canvas.fire('pointermove', { clientX: 40, clientY: 12 });
      canvas.fire('pointerup', {});
      expect(calls.slice(1)).toEqual([
        [0.1 * m, 0.1 * m, undefined, fly],
        [0.3 * m, 0.1 * m, undefined, undefined],
        [0.4 * m, 0.12 * m, undefined, undefined],
      ]);
      // moves without a press do nothing; another button does not jump
      canvas.fire('pointermove', { clientX: 60, clientY: 60 });
      canvas.fire('pointerdown', { button: 2, clientX: 60, clientY: 60, pointerId: 1 });
      expect(calls).toHaveLength(4);
    } finally {
      abort.abort('dispose');
      map.dispose();
      await host.dispose();
    }
  });
});
