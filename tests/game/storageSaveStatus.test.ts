/** NEW-04: a disabled save chip explains region ownership and recovers its normal feedback after takeover. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SaveStatus } from '../../src/region/ui/SaveStatus';
import { FEl, FNode, installFakeDom, textOf } from './fakeDom';

vi.mock('../../src/region/ui/dom', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/region/ui/dom')>(),
  icon: () => new FEl('i'),
}));

class StatusEl extends FEl {
  replaceChildren(...children: FNode[]): void { this.textContent = ''; this.append(...children); }
}

installFakeDom();
let status: SaveStatus;
let onSave: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('Node', FNode);
  vi.stubGlobal('window', { setTimeout });
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => new StatusEl(tag)) as typeof document.createElement);
  onSave = vi.fn();
  status = new SaveStatus(onSave);
});
afterEach(() => {
  status.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('storage ownership save chip', () => {
  it.each(['dirty', 'saving', 'error', 'saved'] as const)('explains why a read-only tab cannot save instead of showing %s feedback', (state) => {
    status.el.disabled = true;
    status.set(state);
    expect(status.el.dataset.state).toBe('readonly');
    expect(textOf(status.el as unknown as FEl)).toBe('Open in another tab');
    expect(status.el.title).toBe('This tab cannot save while the region is open in another tab');
    expect(status.el.title).not.toContain('click');
    (status.el as unknown as FEl).click();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('updates on lost ownership even when the dirty state is unchanged, then restores saving after takeover', () => {
    status.set('dirty');
    expect(textOf(status.el as unknown as FEl)).toBe('Unsaved changes');
    status.el.disabled = true;
    status.set('dirty');
    expect(textOf(status.el as unknown as FEl)).toBe('Open in another tab');
    status.el.disabled = false;
    status.set('dirty');
    expect(status.el.dataset.state).toBe('dirty');
    expect(textOf(status.el as unknown as FEl)).toBe('Unsaved changes');
    expect(status.el.title).toContain('click to save now');
    (status.el as unknown as FEl).click();
    expect(onSave).toHaveBeenCalledOnce();
  });
});
