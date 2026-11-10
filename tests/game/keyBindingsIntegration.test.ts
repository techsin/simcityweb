import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { CityScene } from '../../src/game/CityScene';
import type { GameContext } from '../../src/game/context';
import { DEFAULT_SETTINGS } from '../../src/game/settings';
import { PlopTool } from '../../src/game/tools/PlopTool';
import { CameraController } from '../../src/render/world/CameraController';
import type { BuildingDef } from '../../src/sim/catalogTypes';
import { HelpPanel, PauseMenu } from '../../src/ui/Modals';
import { ShowCamera, type ShowControls } from '../../src/game/ShowCamera';
import { CATEGORIES, hotkeyLabel, type ToolSpec } from '../../src/game/toolCatalog';
import { Toolbar, specTipFooter } from '../../src/ui/Toolbar';
import { FEl, installFakeDom, textOf } from './fakeDom';

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
    newYear: { cancel: vi.fn(), ownsTime: true }, showCamera: { cancel: vi.fn() }, photo: { active: false, enter: vi.fn(), exit: vi.fn() },
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
    // (a camera show still running gives the player's view back before the photo, QA B2)
    expect(s.showCamera.cancel).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('entering photo mode ends a celebration that holds the clock, and leaves fireworks alone (QA B14)', () => {
    const s = scene({});
    s.newYear.ownsTime = false;
    s.onKey(key('KeyH', 'h'));
    expect(s.photo.enter).toHaveBeenCalledOnce();
    expect(s.newYear.cancel).not.toHaveBeenCalled();
  });

  // QA B12: once Save or Help was rebound, Ctrl+S opened the browser's Save dialog and F1 its Help page
  it('keeps Ctrl+S and F1 from the browser wherever Save and Help are bound', () => {
    const s = scene({ save: 'KeyP', help: 'KeyJ' });
    const ctrlS = key('KeyS', 's', { ctrlKey: true }), cmdS = key('KeyS', 'S', { metaKey: true, shiftKey: true }), f1 = key('F1', 'F1');
    for (const e of [ctrlS, cmdS, f1]) {
      s.onKey(e);
      expect(e.defaultPrevented, e.code).toBe(true);
    }
    expect(s.save).not.toHaveBeenCalled();
    expect(s.panels.toggle).not.toHaveBeenCalled();
    // (the game's own keys only: another Ctrl chord, Alt chords and F2 stay the browser's)
    for (const e of [key('KeyR', 'r', { ctrlKey: true }), key('KeyS', 's', { ctrlKey: true, altKey: true }), key('F1', 'F1', { altKey: true }), key('F2', 'F2')]) {
      s.onKey(e);
      expect(e.defaultPrevented, e.code).toBe(false);
    }
    // an auto-repeating F1 stays prevented too
    const held = key('F1', 'F1', { repeat: true });
    s.onKey(held);
    expect(held.defaultPrevented).toBe(true);
  });

  it('leaves F1 to the camera when a camera action is bound to it, and keeps Ctrl+S out of the browser in photo mode', () => {
    const s = scene({ help: 'KeyJ', panForward: 'F1' });
    const f1 = key('F1', 'F1');
    s.onKey(f1);
    expect(f1.defaultPrevented).toBe(false);
    const photo = scene({});
    photo.photo.active = true;
    const ctrlS = key('KeyS', 's', { ctrlKey: true }), space = key('Space', ' ');
    photo.onKey(ctrlS);
    photo.onKey(space);
    expect(ctrlS.defaultPrevented).toBe(true);
    expect(photo.save).not.toHaveBeenCalled();
    expect(space.defaultPrevented).toBe(false);
    expect(photo.host.setSpeed).not.toHaveBeenCalled();
  });

  it('the scene uses a stored table only as far as the binding model allows it (QA B12)', () => {
    const src = readFileSync(new URL('../../src/game/CityScene.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/this\.settings = loadSettings\(opts\.settings\);\s*(?:\/\/[^\n]*\n\s*)*this\.settings\.keyBindings = sanitizeBindings\(this\.settings\.keyBindings\);/);
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

// QA B8 (and B1): the key that skips a camera show also did its normal job: Escape opened the pause menu
describe('the key that ends a camera show does not reach the scene', () => {
  class Controls implements ShowControls {
    enabled = true;
    target = { x: 100, z: 200 };
    distance = 900;
    yawAngle = 0;
    tiltAngle = 0.8;
    setView(x: number, z: number, d: number): void { this.target.x = x; this.target.z = z; this.distance = d; }
  }

  function playing() {
    vi.stubGlobal('window', new EventTarget());
    const abort = new AbortController(), controls = new Controls();
    // (as CityScene's constructor: the show camera first, then the scene's own capture listener)
    const show = new ShowCamera(() => controls, abort.signal);
    const s = scene({});
    Object.assign(s, { pause: { isOpen: false, open: vi.fn() }, toolbar: { flyoutOpen: false }, topBar: { closePopover: () => false } });
    Object.assign(s.tools, { cancelDrag: () => false });
    Object.assign(s.panels, { closeTop: () => false });
    window.addEventListener('keydown', (e) => s.onKey(e as KeyboardEvent), { capture: true, signal: abort.signal });
    return { abort, show, controls, s };
  }

  it('Escape during a show ends it at the player\'s view and opens no pause menu; the next Escape does', () => {
    const t = playing();
    try {
      expect(t.show.begin({ cameraKey: (e) => e.code === 'KeyW' })).toBe(true);
      t.show.moveTo({ x: 500, z: 600, d: 360, tilt: 30, yaw: 0 }, 2);
      t.show.frame(1);
      const skip = key('Escape', 'Escape');
      window.dispatchEvent(skip);
      expect(t.show.active).toBe(false);
      expect(t.controls.target).toEqual({ x: 100, z: 200 });
      expect(skip.defaultPrevented).toBe(true);
      expect(t.s.pause.open).not.toHaveBeenCalled();
      window.dispatchEvent(key('Escape', 'Escape'));
      expect(t.s.pause.open).toHaveBeenCalledOnce();
    } finally { t.abort.abort(); }
  });

  it('Space, a tool key and H only end the show; Ctrl+S still saves', () => {
    const t = playing();
    try {
      for (const [code, char] of [['Space', ' '], ['KeyB', 'b'], ['KeyH', 'h']]) {
        expect(t.show.begin({ cameraKey: (e) => e.code === 'KeyW' })).toBe(true);
        window.dispatchEvent(key(code, char));
        window.dispatchEvent(Object.assign(new Event('keyup'), { code, key: char }));
        expect(t.show.active, code).toBe(false);
      }
      expect(t.s.host.setSpeed).not.toHaveBeenCalled();
      expect(t.s.tools.select).not.toHaveBeenCalled();
      expect(t.s.photo.enter).not.toHaveBeenCalled();
      expect(t.show.begin()).toBe(true);
      window.dispatchEvent(key('KeyS', 's', { ctrlKey: true }));
      expect(t.show.active).toBe(false);
      expect(t.s.save).toHaveBeenCalledExactlyOnceWith(false);
    } finally { t.abort.abort(); }
  });

  it('CityScene registers its key listener after the show camera\'s (capture listeners run in that order)', () => {
    const src = readFileSync(new URL('../../src/game/CityScene.ts', import.meta.url), 'utf8');
    const camera = src.indexOf('this.showCamera = new ShowCamera('), keys = src.indexOf("window.addEventListener('keydown', kd, { capture: true");
    expect(camera).toBeGreaterThan(0);
    expect(keys).toBeGreaterThan(camera);
  });
});

// QA B11: the toolbar's key badges, the tips and the pause menu kept the default keys after a rebinding
describe('hints outside Help follow the bindings', () => {
  it('a catalog hotkey shows the key its action is on now', () => {
    expect(hotkeyLabel('B')).toBe('B');
    expect(hotkeyLabel('B', { bulldoze: 'KeyX' })).toBe('X');
    expect(hotkeyLabel('O', { dataviews: 'KeyZ' })).toBe('Z');
    expect(hotkeyLabel('K', { terraform: 'Digit7' })).toBe('7');
    expect(hotkeyLabel('B', { bulldoze: '' })).toBe('');
    // (a key the catalog does not know is shown as it is)
    expect(hotkeyLabel('Z', { bulldoze: 'KeyZ' })).toBe('Z');
    // every key the toolbar shows has its action
    for (const c of CATEGORIES) for (const k of (c.hotkey ?? '').split(' ').filter(Boolean)) expect(hotkeyLabel(k, { residential: 'F2', commercial: 'F2', industrial: 'F2', roads: 'F2', power: 'F2', terraform: 'F2', bulldoze: 'F2', query: 'F2', dataviews: 'F2' }), c.id).toBe('F2');
  });

  it('a tool card\'s tip names the bound hotkey and the bound rotate key', () => {
    const def = { id: 'civ_clinic' } as ToolSpec['def'];
    expect(specTipFooter({ id: 'bulldoze', hotkey: 'B' }, { bulldoze: 'KeyX' })).toBe('<div class="rt-key">Hotkey <kbd>X</kbd> (press again to cycle)</div>');
    expect(specTipFooter({ id: 'bulldoze', hotkey: 'B' }, { bulldoze: '' })).toBe('');
    expect(specTipFooter({ id: 'plop:civ_clinic', def }, { rotateBuilding: 'KeyJ' })).toBe('<div class="rt-key">Click to select · <kbd>J</kbd> rotates while placing</div>');
    expect(specTipFooter({ id: 'plop:civ_clinic', def }, { rotateBuilding: '' })).toBe('<div class="rt-key">Click to select</div>');
    expect(specTipFooter({ id: 'plop:civ_clinic', def })).toBe('<div class="rt-key">Click to select · <kbd>R</kbd> rotates while placing</div>');
  });

  function toolbar(bindings: Record<string, string>) {
    const listeners = new Map<string, (() => void)[]>();
    const settings = { ...DEFAULT_SETTINGS, keyBindings: bindings };
    const ctx = {
      settings, signal: new AbortController().signal, sound: vi.fn(), overlay: 0, sandbox: () => false,
      state: { config: { disasters: false } },
      ui: { on: (type: string, f: () => void) => { listeners.set(type, [...listeners.get(type) ?? [], f]); return () => undefined; } },
      tools: { activeId: null, select: () => true }, panels: { isOpen: () => false },
    } as unknown as GameContext;
    const parent = new FEl('div');
    const bar = new Toolbar(ctx, parent as unknown as HTMLElement);
    const badge = (label: string) => parent.querySelectorAll('.tb-btn').find((b) => textOf(b.querySelector('.tb-l')!) === label)!.querySelector('.tb-k')!;
    const emit = (type: string) => { for (const f of listeners.get(type) ?? []) f(); };
    return { bar, parent, settings, badge, emit };
  }

  it('the toolbar badges show the bound keys, follow a rebinding and go when an action has no key', () => {
    const t = toolbar({ bulldoze: 'KeyX', dezone: 'KeyB' });
    expect(textOf(t.badge('Bulldoze'))).toBe('X');
    expect(textOf(t.badge('Zones'))).toBe('R');
    expect(textOf(t.badge('Data'))).toBe('O');
    t.settings.keyBindings = { residential: '', dataviews: 'KeyZ', query: '' };
    t.emit('settings');
    expect(textOf(t.badge('Bulldoze'))).toBe('B');
    // (the Zones badge moves on to its next bound key)
    expect(textOf(t.badge('Zones'))).toBe('C');
    expect(textOf(t.badge('Data'))).toBe('Z');
    expect(t.badge('Query').style.display).toBe('none');
    expect(t.badge('Data').style.display).toBe('');
  });

  it('the pause menu shows the bound Save and Help keys', () => {
    vi.stubGlobal('window', new EventTarget());
    const menu = (bindings: Record<string, string>) => {
      const parent = new FEl('div');
      const ctx = {
        settings: { ...DEFAULT_SETTINGS, keyBindings: bindings }, signal: new AbortController().signal, sound: vi.fn(),
        state: { day: 0, config: { name: 'Queensbury', startYear: 2000 }, stats: { population: 0 } }, host: { setSpeed: vi.fn(), resume: vi.fn() },
      } as unknown as GameContext;
      new PauseMenu(ctx, parent as unknown as HTMLElement, { onSettings: vi.fn(), onHelp: vi.fn() }).open();
      return parent.querySelectorAll('button').map(textOf);
    };
    expect(menu({})).toEqual(['ResumeEsc', 'Save cityCtrl S', 'Save & exit to region', 'Settings', 'Help & shortcutsF1']);
    expect(menu({ save: 'KeyJ', help: 'F2' })).toEqual(['ResumeEsc', 'Save cityCtrl J', 'Save & exit to region', 'Settings', 'Help & shortcutsF2']);
    expect(menu({ help: '' })).toEqual(['ResumeEsc', 'Save cityCtrl S', 'Save & exit to region', 'Settings', 'Help & shortcuts']);
  });
});
