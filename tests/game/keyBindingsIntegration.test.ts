import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CityScene } from '../../src/game/CityScene';
import type { GameContext } from '../../src/game/context';
import { DEFAULT_SETTINGS } from '../../src/game/settings';
import { PlopTool } from '../../src/game/tools/PlopTool';
import { CameraController } from '../../src/render/world/CameraController';
import type { BuildingDef } from '../../src/sim/catalogTypes';
import { HelpPanel } from '../../src/ui/Modals';
import { FEl, installFakeDom } from './fakeDom';

installFakeDom();
beforeEach(() => {
  Object.assign(document, { activeElement: null });
  vi.stubGlobal('window', new FEl('window'));
  vi.stubGlobal('HTMLButtonElement', class {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function key(code: string, char: string, extra: Record<string, unknown> = {}): KeyboardEvent {
  return Object.assign(new Event('keydown', { cancelable: true }), { code, key: char, repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra }) as KeyboardEvent;
}

function scene(bindings: Record<string, string>) {
  const sim = { speed: 1 };
  const host = { sim, get speed() { return sim.speed; }, setSpeed: vi.fn((speed: number) => { sim.speed = speed; }) };
  return Object.assign(Object.create(CityScene.prototype), {
    host, settings: { ...DEFAULT_SETTINGS, keyBindings: bindings }, disposed: false,
    pause: { isOpen: false }, tools: { key: vi.fn(() => false), activeId: null, select: vi.fn() },
    panels: { toggle: vi.fn() }, sound: vi.fn(), save: vi.fn(),
    newYear: { cancel: vi.fn() }, showCamera: { cancel: vi.fn() }, photo: { active: false, enter: vi.fn(), exit: vi.fn() },
  });
}

describe('profile key routing', () => {
  it('routes rebound tool and panel codes while removing the old character shortcuts', () => {
    const s = scene({ bulldoze: 'KeyF', dataviews: 'KeyZ' });
    s.onKey(key('KeyB', 'b'));
    expect(s.tools.select).not.toHaveBeenCalled();
    s.onKey(key('KeyF', 'ü'));
    expect(s.tools.select).toHaveBeenCalledExactlyOnceWith('bulldoze');
    s.onKey(key('KeyO', 'o'));
    expect(s.panels.toggle).not.toHaveBeenCalled();
    s.onKey(key('KeyZ', 'w'));
    expect(s.panels.toggle).toHaveBeenCalledExactlyOnceWith('dataviews');
  });

  it('routes rebound pause, speed, save, help and photo actions through the existing paths', () => {
    const s = scene({ pause: 'KeyF', speed2: 'KeyZ', save: 'KeyP', help: 'KeyJ', photo: 'KeyG' });
    s.onKey(key('KeyF', 'f'));
    expect(s.host.setSpeed).toHaveBeenLastCalledWith(0, 'keyboard');
    s.onKey(key('KeyZ', 'z'));
    expect(s.host.setSpeed).toHaveBeenLastCalledWith(2, 'keyboard');
    s.onKey(key('KeyS', 's', { ctrlKey: true }));
    expect(s.save).not.toHaveBeenCalled();
    s.onKey(key('KeyP', 'p', { ctrlKey: true }));
    expect(s.save).toHaveBeenCalledExactlyOnceWith(false);
    s.onKey(key('KeyJ', 'j'));
    expect(s.panels.toggle).toHaveBeenCalledExactlyOnceWith('help');
    s.onKey(key('KeyG', 'g'));
    expect(s.photo.enter).toHaveBeenCalledOnce();
    expect(s.newYear.cancel).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('a focused capture input keeps all shortcuts out of the scene', () => {
    const s = scene({ bulldoze: 'KeyF' });
    Object.assign(document, { activeElement: Object.assign(new FEl('input'), { tagName: 'INPUT', type: 'text' }) });
    s.onKey(key('KeyF', 'f'));
    expect(s.tools.key).not.toHaveBeenCalled();
    expect(s.tools.select).not.toHaveBeenCalled();
  });
});

describe('camera and contextual rotate bindings', () => {
  it('a rebound physical pan key works; the old primary stops, and arrows still work', () => {
    const dom = new FEl('canvas') as unknown as HTMLElement;
    const c = new CameraController(new THREE.PerspectiveCamera(), dom, { mapSize: 4096, heightAt: () => 0 });
    const fire = (e: Event) => (window as unknown as FEl).fire('keydown', { code: (e as KeyboardEvent).code, key: (e as KeyboardEvent).key });
    try {
      c.setView(2000, 2000, 800, 52, 45);
      c.setKeyBindings({ panForward: 'KeyZ' });
      const start = c.target.clone();
      fire(key('KeyW', 'z'));
      c.update(0.1);
      expect(c.target.distanceTo(start)).toBe(0);
      fire(key('KeyZ', 'w'));
      c.update(0.1);
      expect(c.target.distanceTo(start)).toBeGreaterThan(1);
      c.setKeyBindings({ panForward: 'KeyF' });
      const stopped = c.target.clone();
      c.setView(stopped.x, stopped.z, 800);
      fire(key('ArrowUp', 'ArrowUp'));
      c.update(0.1);
      expect(c.target.distanceTo(stopped)).toBeGreaterThan(1);
    } finally { c.dispose(); }
  });

  it('Plop consumes its rebound rotate key and reports that key in its hints', () => {
    const ctx = {
      settings: { ...DEFAULT_SETTINGS, keyBindings: { rotateBuilding: 'KeyJ' } },
      world: { setHighlight: vi.fn() }, objects: { setGhost: vi.fn() }, tip: { hide: vi.fn() }, sound: vi.fn(),
    } as unknown as GameContext;
    const tool = new PlopTool(ctx, { id: 'test', name: 'Test', category: 'park', model: 'park', footprint: [1, 1] } as BuildingDef, 'park');
    expect(tool.key(key('KeyR', 'r'), null)).toBe(false);
    expect(tool.key(key('KeyJ', 'j'), null)).toBe(true);
    expect(ctx.sound).toHaveBeenCalledExactlyOnceWith('rotate');
    expect(tool.hints().join(' ')).toContain('J rotate');
  });
});

it('Help refreshes the actual key row after a profile change without rebuilding the panel', () => {
  const ctx = { settings: { ...DEFAULT_SETTINGS, keyBindings: { bulldoze: 'KeyF' } }, signal: new AbortController().signal } as unknown as GameContext;
  const panel = new HelpPanel(ctx);
  const body = new FEl('div');
  Object.assign(panel, { body });
  (panel as unknown as { build(): void }).build();
  panel.update();
  const row = () => body.querySelectorAll('.hk').find((el) => el.textContent.startsWith('Bulldoze'))!;
  expect(row().querySelector('.keys')!.textContent).toContain('F');
  const original = row();
  ctx.settings.keyBindings = { bulldoze: 'KeyZ' };
  panel.update();
  expect(row()).toBe(original);
  expect(row().querySelector('.keys')!.textContent).toContain('Z');
  expect(row().querySelector('.keys')!.textContent).not.toContain('F');
});
