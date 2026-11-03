/** Exercise the scene's real save / exit methods with deferred persistence and view stand-ins. */
import { describe, expect, it, vi } from 'vitest';
import { CityScene } from '../../src/game/CityScene';
import type { HostState, SaveReason } from '../../src/worker/SimHost';
import { deferred, smallCity } from '../save/fixtures';

function fixture() {
  const gate = deferred(), state = smallCity(), order: string[] = [];
  const onSave = vi.fn((_state: HostState, reason?: SaveReason) => { order.push(reason!); return gate.promise; });
  const scene = {
    disposed: false, saving: null as Promise<void> | null, monthsSinceSave: 3,
    host: { state, setSpeed: vi.fn(() => { order.push('pause'); }) },
    storeCamera: vi.fn(() => { order.push('camera'); }),
    opts: { onSave, onExitToRegion: vi.fn(() => { order.push('region'); }) },
    savePill: { saving: vi.fn(), done: vi.fn() }, sound: vi.fn(), errors: { report: vi.fn() },
    tools: { select: vi.fn() }, panels: { closeAll: vi.fn() },
    world: { capture: vi.fn(() => { order.push('capture'); return 'thumbnail'; }) },
    save(auto?: boolean, reason?: SaveReason) { return CityScene.prototype.save.call(this as unknown as CityScene, auto, reason); },
  };
  return { scene, gate, order, onSave };
}

describe('CityScene saves through App host persistence', () => {
  for (const auto of [false, true]) {
    it(`${auto ? 'autosave' : 'manual save'} stores the camera first and waits before showing success`, async () => {
      const { scene, gate, order, onSave } = fixture();
      const saving = scene.save(auto), coalesced = scene.save(auto);
      expect(order).toEqual(['camera', auto ? 'autosave' : 'manual']);
      expect(onSave).toHaveBeenCalledExactlyOnceWith(scene.host.state, auto ? 'autosave' : 'manual');
      expect(scene.savePill.done).not.toHaveBeenCalled();
      gate.resolve(); await Promise.all([saving, coalesced]);
      expect(scene.savePill.done).toHaveBeenCalledExactlyOnceWith(true, auto ? 'Autosaved' : 'City saved');
      expect(scene.monthsSinceSave).toBe(0); expect(scene.saving).toBeNull();
    });
  }

  it('exit pauses, awaits the exit save, then captures the thumbnail and returns to the region', async () => {
    const { scene, gate, order } = fixture();
    const exiting = CityScene.prototype.exitToRegion.call(scene as unknown as CityScene);
    expect(scene.host.setSpeed).toHaveBeenCalledExactlyOnceWith(0, 'exit');
    expect(order).toEqual(['pause', 'camera', 'exit']);
    expect(scene.world.capture).not.toHaveBeenCalled();
    gate.resolve(); await exiting;
    expect(order).toEqual(['pause', 'camera', 'exit', 'capture', 'region']);
    expect(scene.opts.onExitToRegion).toHaveBeenCalledExactlyOnceWith('thumbnail');
  });

  it('reports a failed save and lets App handle exit recovery', async () => {
    const { scene, gate } = fixture();
    const exiting = CityScene.prototype.exitToRegion.call(scene as unknown as CityScene);
    gate.reject(new Error('quota')); await exiting;
    expect(scene.savePill.done).toHaveBeenCalledExactlyOnceWith(false);
    expect(scene.monthsSinceSave).toBe(3);
    expect(scene.errors.report).toHaveBeenCalledOnce();
    expect(scene.opts.onExitToRegion).toHaveBeenCalledOnce();
  });

  it('an exit acknowledgement cannot capture or re-enter the region after disposal', async () => {
    const { scene, gate } = fixture();
    const exiting = CityScene.prototype.exitToRegion.call(scene as unknown as CityScene);
    scene.disposed = true; gate.resolve(); await exiting;
    expect(scene.world.capture).not.toHaveBeenCalled();
    expect(scene.opts.onExitToRegion).not.toHaveBeenCalled();
  });

  for (const failed of [false, true]) {
    it(`a late ${failed ? 'failure' : 'success'} stays silent after disposal`, async () => {
      const { scene, gate, onSave } = fixture();
      const saving = scene.save(); scene.disposed = true;
      if (failed) gate.reject(new Error('quota')); else gate.resolve();
      await saving; await scene.save();
      expect(scene.savePill.done).not.toHaveBeenCalled();
      expect(scene.sound).not.toHaveBeenCalled();
      expect(scene.errors.report).not.toHaveBeenCalled();
      expect(onSave).toHaveBeenCalledOnce();
    });
  }
});
