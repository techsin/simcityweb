/**
 * WasmHeap (src/wasm/heap.ts) on a bare WebAssembly.Memory: first-fit reuse, coalescing, alignment, growth and the
 * pinned-view growth policy, view refresh after memory.grow, scratch slots.
 */
import { describe, expect, it } from 'vitest';
import { WasmHeap, WasmHeapFullError, scratchSlot } from '../../src/wasm/heap';

const PAGE = 65536;
const mk = (pages = 2, base = 1000) => new WasmHeap(new WebAssembly.Memory({ initial: pages }), base);

describe('WasmHeap', () => {
  it('aligns, reuses freed blocks first-fit and coalesces neighbours', () => {
    const h = mk();
    expect(h.heapBase).toBe(1008); // aligned to 16
    const a = h.alloc(10), b = h.alloc(100), c = h.alloc(33);
    expect([a % 16, b % 16, c % 16]).toEqual([0, 0, 0]);
    expect(b).toBe(a + 16);
    expect(c).toBe(b + 112);
    h.free(b);
    expect(h.alloc(50)).toBe(b); // first fit into the hole
    h.free(a);
    h.free(b);
    // a + b coalesced: 128 bytes at a
    expect(h.alloc(120)).toBe(a);
    const top = h.stats().top;
    h.free(c);
    expect(h.stats().top).toBeLessThan(top); // a free block at the top lowers it
    const d = h.alloc(64, 256);
    expect(d % 256).toBe(0);
  });

  it('grows memory when unpinned and detaches old views; refresh() re-creates them', () => {
    const h = mk(1);
    const v = h.allocArray(Float32Array, 1000);
    v.fill(3.5);
    const g0 = h.generation;
    // pinned view exists: implicit growth is refused
    expect(() => h.alloc(2 * PAGE)).toThrow(WasmHeapFullError);
    expect(() => h.scratch(scratchSlot(), 2 * PAGE)).toThrow(WasmHeapFullError);
    expect(h.generation).toBe(g0);
    // explicit reserve grows (safe point): the old view is detached, refresh gives a live one with the same data
    h.reserve(3 * PAGE);
    expect(h.generation).toBe(g0 + 1);
    expect(v.length).toBe(0);
    const v2 = h.refresh(v);
    expect(v2.length).toBe(1000);
    expect(v2[999]).toBe(3.5);
    expect(h.ptrOf(v2)).toBeGreaterThan(0);
    expect(h.F32[(h.ptrOf(v2) >> 2) + 5]).toBe(3.5); // whole-memory views follow the new buffer
    h.free(v2);
    // nothing pinned any more: implicit growth works
    const big = h.alloc(8 * PAGE);
    expect(big + 8 * PAGE).toBeLessThanOrEqual(h.capacity);
  });

  it('allocArray zero-fills reused blocks; onGrow listeners run after growth', () => {
    const h = mk(1);
    const p = h.alloc(256);
    h.U8.fill(0xff, p, p + 256);
    h.free(p);
    const v = h.allocArray(Uint8Array, 200);
    expect(h.ptrOf(v)).toBe(p);
    expect(v.every((x) => x === 0)).toBe(true);
    let calls = 0;
    const off = h.onGrow(() => calls++);
    h.reserve(4 * PAGE);
    expect(calls).toBe(1);
    off();
    h.reserve(64 * PAGE);
    expect(calls).toBe(1);
  });

  it('scratch slots are cached per slot and grow on demand', () => {
    const h = mk(4);
    const s1 = scratchSlot(), s2 = scratchSlot();
    const p1 = h.scratch(s1, 100);
    expect(h.scratch(s1, 64)).toBe(p1); // big enough: same block
    const p2 = h.scratch(s2, 100);
    expect(p2).not.toBe(p1);
    const p1b = h.scratch(s1, 5000); // grows: a new block
    expect(p1b).not.toBe(p1);
    expect(h.stats().used).toBeGreaterThanOrEqual(5000 + 100);
  });

  it('rejects bad sizes and alignments; free checks ownership', () => {
    const h = mk();
    expect(() => h.alloc(-1)).toThrow(RangeError);
    expect(() => h.alloc(Number.NaN)).toThrow(RangeError);
    expect(() => h.alloc(8, 48)).toThrow(RangeError);
    expect(() => h.free(12345)).toThrow(/not a live block/);
    expect(() => h.free(new Float32Array(4))).toThrow(/not allocated by this heap/);
  });
});
