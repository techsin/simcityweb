/** NEW-04: storage copy names autosave and explains recovery after a live tab hands over its region. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecoveryMarker } from '../../src/save';
import { openRecoverDialog, openSettings } from '../../src/region/ui/dialogs';
import { setUiRoot, type Modal } from '../../src/region/ui/modal';
import { FEl, FNode, installFakeDom, textOf } from './fakeDom';

const storage = vi.hoisted(() => ({ regionTakenOver: vi.fn() }));
vi.mock('../../src/ui/StorageDialog', () => ({
  regionTakenOver: storage.regionTakenOver, deleteStorageRegion: vi.fn(), exportStorageRegion: vi.fn(),
}));
vi.mock('../../src/audio', () => ({ audio: { play: vi.fn(), getVolume: () => 0.5 } }));

installFakeDom();
let root: FEl;
let settings: Modal | null;
const marker: RecoveryMarker = {
  v: 1, regionId: 'harbour', tileKey: '0_0', cityName: 'Port City', at: 1000, baseSavedAt: 0,
  bytes: 1, ls: false, dropped: [], day: 30, population: 120, funds: 2000,
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  storage.regionTakenOver.mockReturnValue(false);
  vi.stubGlobal('localStorage', { getItem: () => null });
  vi.stubGlobal('Node', FNode);
  vi.stubGlobal('window', new FEl('window'));
  root = new FEl('div');
  settings = null;
  setUiRoot(root as unknown as HTMLElement);
});
afterEach(() => {
  settings?.close(true);
  vi.runOnlyPendingTimers();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function recoveryText(m: RecoveryMarker): Promise<string> {
  const choice = openRecoverDialog(m);
  const text = textOf(root.querySelector('.recover-body')!);
  root.querySelectorAll('button').find((b) => textOf(b) === 'Discard')!.click();
  expect(await choice).toBe('discard');
  return text;
}

describe('storage dialog copy', () => {
  it('names Autosave beside its real-time floor in app and region Settings', () => {
    settings = openSettings();
    expect(root.querySelectorAll('label').map(textOf)).toContain('Autosave · Every N game months, at most once a minute');
  });

  it.each([undefined, 'exit'])('explains takeover recovery without saying the other tab closed (why: %s)', async (why) => {
    storage.regionTakenOver.mockReturnValue(true);
    const text = await recoveryText({ ...marker, why });
    expect(storage.regionTakenOver).toHaveBeenCalledExactlyOnceWith(marker.regionId, marker.at);
    expect(text).toContain('This region was opened in another tab. Unsaved progress for Port City was kept in a recovery snapshot on this device.');
    expect(text).not.toContain('Metropolis closed');
    expect(text).not.toContain('failed when you left');
  });

  it('W1.3: describes a journal alone as a record of edits after a takeover too', async () => {
    storage.regionTakenOver.mockReturnValue(true);
    const text = await recoveryText({ ...marker, kind: 'journal' });
    expect(text).toContain('This region was opened in another tab. A record of your edits to Port City since the last save was kept on this device.');
    expect(text).not.toContain('recovery snapshot');
    expect(text).toContain('Recover makes those edits again on the last save');
  });

  it('keeps the closed-session explanation for recovery without takeover', async () => {
    expect(await recoveryText(marker)).toContain('Metropolis closed before Port City was saved.');
  });

  it('keeps the failed-exit explanation for recovery without takeover', async () => {
    expect(await recoveryText({ ...marker, why: 'exit' })).toContain('Saving Port City failed when you left it.');
  });
});
