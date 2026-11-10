/**
 * T089 (NOTE-080 section 3, the owner's choice on W1.3 decision 3: "discard, and say so"): the worker crash dialog says
 * what its buttons do to unsaved progress. "Restart from autosave" and "Continue on the main thread" now delete the
 * crashed session's recovery copy (main.ts onWorkerCrash), so the dialog says that the progress since the last save is
 * lost unless Recover is chosen. The buttons and the title keep their text (tools/qa-worker.mjs finds them by it).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openSimCrashDialog } from '../../src/region/ui/dialogs';
import { setUiRoot } from '../../src/region/ui/modal';
import { FEl, FNode, installFakeDom, textOf } from './fakeDom';

installFakeDom();

describe('the worker crash dialog says what happens to unsaved progress (T089)', () => {
  let root: FEl;
  beforeEach(() => {
    vi.stubGlobal('Node', FNode);
    vi.stubGlobal('window', new FEl('window'));
    root = new FEl('div');
    setUiRoot(root as unknown as HTMLElement);
  });
  afterEach(() => { vi.unstubAllGlobals(); });
  const body = () => textOf(root.querySelector('.recover-body')!);
  const buttons = () => root.querySelectorAll('button').map((b) => textOf(b));
  const click = (label: string) => root.querySelectorAll('button').find((b) => textOf(b) === label)!.click();

  it('with a recovery copy: the progress is lost unless Recover is chosen, and the other two buttons delete the copy', async () => {
    const choice = openSimCrashDialog({ cityName: 'Testville', message: 'Invalid tick', recoverable: true });
    expect(textOf(root.querySelector('h2')!)).toBe('The simulation stopped');
    expect(body()).toContain('The simulation of Testville stopped. Unsaved progress since the last save is lost unless you choose Recover: a recovery copy of it was kept on this device.');
    expect(body()).toContain('Recover brings back the unsaved progress.');
    expect(body()).toContain('Restart reloads the last save and deletes the recovery copy.');
    expect(body()).toContain('Continue on the main thread does that too, and runs without the simulation worker for the rest of this visit.');
    // NOTE-092: Recover is the default, so it is the last button of the row, as each dialog's default is
    expect(buttons()).toEqual(['Continue on the main thread', 'Restart from autosave', 'Recover unsaved progress']);
    click('Recover unsaved progress');
    await expect(choice).resolves.toBe('recover');
  });

  it('without one: the progress is lost, no Recover is offered, and nothing speaks of a copy to delete', async () => {
    const choice = openSimCrashDialog({ cityName: 'Testville', message: 'Invalid tick', recoverable: false });
    expect(body()).toContain('The simulation of Testville stopped. Unsaved progress since the last save is lost: no recovery copy of it was kept on this device.');
    expect(body()).not.toContain('unless you choose Recover');
    expect(body()).not.toContain('deletes the recovery copy');
    expect(buttons()).toEqual(['Continue on the main thread', 'Restart from autosave']);
    click('Continue on the main thread');
    await expect(choice).resolves.toBe('local');
  });
});
