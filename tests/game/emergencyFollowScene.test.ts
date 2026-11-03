import { afterEach, describe, expect, it, vi } from 'vitest';
import { CityScene } from '../../src/game/CityScene';

afterEach(() => vi.unstubAllGlobals());

function scene(motion: 'full' | 'reduced' | 'system' = 'full') {
  const position = { x: 160, y: 4, z: 320, onScene: false };
  const controls = { follow: vi.fn(), stopFollowing: vi.fn() };
  const vehicles = { followPosition: vi.fn(() => position) };
  const banner = { refreshFollow: vi.fn() };
  const s = Object.assign(Object.create(CityScene.prototype), {
    world: { controls }, objects: { emergency: vehicles }, settings: { motion }, emgBanner: banner,
    followedVehicle: null,
  }) as {
    followEmergency(id: number): void;
    stopEmergencyFollow(): void;
    followedVehicle: number | null;
  };
  return { s, controls, vehicles, banner, position };
}

describe('emergency follow scene wiring', () => {
  it('uses the renderer feed for one fixed vehicle and clears the chip on camera release', () => {
    const { s, controls, vehicles, banner, position } = scene();
    s.followEmergency(7);
    expect(s.followedVehicle).toBe(7);
    const [source, opts] = controls.follow.mock.calls[0] as unknown as [() => unknown, { onEnd(): void; reducedMotion: boolean }];
    expect(source()).toBe(position);
    expect(vehicles.followPosition.mock.calls).toEqual([[7], [7]]);
    expect(opts.reducedMotion).toBe(false);
    opts.onEnd();
    expect(s.followedVehicle).toBeNull();
    expect(banner.refreshFollow).toHaveBeenCalledOnce();
  });

  it.each(['full', 'reduced', 'system'] as const)('resolves %s motion through the shared setting', (motion) => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const { s, controls } = scene(motion);
    s.followEmergency(7);
    expect(controls.follow.mock.calls[0][1]).toMatchObject({ reducedMotion: motion !== 'full' });
  });

  it('does not start when the renderer cannot supply that unit', () => {
    const { s, controls, vehicles } = scene();
    vehicles.followPosition.mockReturnValue(null as unknown as ReturnType<typeof vehicles.followPosition>);
    s.followEmergency(7);
    expect(controls.follow).not.toHaveBeenCalled();
    expect(s.followedVehicle).toBeNull();
  });

  it('stops the camera and clears the chip when the banner is reset or disposed', () => {
    const { s, controls, banner } = scene();
    s.followEmergency(7);
    s.stopEmergencyFollow();
    expect(controls.stopFollowing).toHaveBeenCalledOnce();
    expect(s.followedVehicle).toBeNull();
    expect(banner.refreshFollow).toHaveBeenCalledOnce();
  });
});
