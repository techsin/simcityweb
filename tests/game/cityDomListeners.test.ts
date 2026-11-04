// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/events';
import { Overlay } from '../../src/core/types';
import type { GameContext, UIEvents } from '../../src/game/context';
import { DEFAULT_SETTINGS } from '../../src/game/settings';
import { Toolbar } from '../../src/ui/Toolbar';
import { Panel, PanelManager } from '../../src/ui/Panel';
import { NewsTicker } from '../../src/ui/Notifications';
import { MusicPlayer, type MusicAudio } from '../../src/ui/MusicPlayer';
import { SettingsPanel } from '../../src/ui/panels/SettingsPanel';
import { h, segmented, slider, stepButtons, toggle } from '../../src/ui/dom';

const controllers: AbortController[] = [];

function city() {
  const abort = new window.AbortController();
  controllers.push(abort);
  const root = h('div');
  document.body.appendChild(root);
  const ctx = {
    root, signal: abort.signal, ui: new Emitter<UIEvents>(), overlay: Overlay.None,
    tools: { activeId: null, select: vi.fn(() => true) },
    panels: { isOpen: () => false, toggle: vi.fn(), open: vi.fn() },
    sound: vi.fn(), applySettings: vi.fn(),
    settings: { ...DEFAULT_SETTINGS }, mods: {}, world: { timeOfDay: 12 },
    state: { news: [], day: 0, config: { name: 'Test city', startYear: 2000 } },
  } as unknown as GameContext;
  return { ctx, abort };
}

afterEach(() => {
  for (const controller of controllers) controller.abort();
  controllers.length = 0;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

class TestPanel extends Panel {
  readonly id = 'test';
  readonly title = 'Test';
  protected build(): void {}
}

describe('city DOM listeners', () => {
  it('a retained toolbar button stops reaching the city after abort; the next city still works', () => {
    const { ctx, abort } = city();
    const toolbar = new Toolbar(ctx, ctx.root);
    const query = [...toolbar.el.querySelectorAll<HTMLButtonElement>('.tb-btn')].find((b) => b.textContent?.includes('Query'))!;
    query.click();
    expect(ctx.tools.select).toHaveBeenCalledWith('query');
    expect(ctx.tools.select).toHaveBeenCalledTimes(1);

    abort.abort();
    ctx.root.remove();
    query.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(ctx.tools.select).toHaveBeenCalledTimes(1);

    const next = city();
    const nextToolbar = new Toolbar(next.ctx, next.ctx.root);
    const nextQuery = [...nextToolbar.el.querySelectorAll<HTMLButtonElement>('.tb-btn')].find((b) => b.textContent?.includes('Query'))!;
    nextQuery.click();
    expect(next.ctx.tools.select).toHaveBeenCalledWith('query');
  });

  it('aborting a panel mid-drag removes close, focus and dynamically installed drag listeners', () => {
    const { ctx, abort } = city();
    const panel = new TestPanel(ctx);
    const close = vi.fn(), focus = vi.fn(), dragEnd = vi.fn();
    panel.mount(close, focus, dragEnd);
    ctx.root.appendChild(panel.el);
    const head = panel.el.querySelector<HTMLElement>('.panel-head')!;
    head.setPointerCapture = vi.fn();
    const button = head.querySelector<HTMLButtonElement>('button')!;
    const move = vi.spyOn(panel, 'setPos');
    const pointer = (type: string, x = 0) => head.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: x }));
    button.click();
    pointer('pointerdown');
    pointer('pointermove', 10);
    expect(close).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(move).toHaveBeenCalledTimes(1);

    abort.abort();
    ctx.root.remove();
    button.click();
    pointer('pointermove', 20);
    pointer('pointerup', 20);
    pointer('pointerdown');
    expect(close).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(move).toHaveBeenCalledTimes(1);
    expect(dragEnd).not.toHaveBeenCalled();
  });

  it('binds helper callbacks and step buttons, and clears the slider paint closure', () => {
    const { ctx, abort } = city();
    const click = vi.fn(), change = vi.fn(), choose = vi.fn(), input = vi.fn(), commit = vi.fn();
    // signal after onclick also works: attribute iteration order must not matter.
    const button = h('button', { onclick: click, signal: ctx.signal });
    const sw = toggle(false, change, false, ctx.signal);
    const seg = segmented([{ value: 1, label: 'One' }, { value: 2, label: 'Two' }], 1, choose, ctx.signal);
    const range = slider({ min: 0, max: 10, value: 2, oninput: input, onchange: commit, signal: ctx.signal });
    const [down, up] = stepButtons(range, 'test', undefined, ctx.signal);
    ctx.root.append(button, sw, seg, range, down, up);
    button.click();
    sw.click();
    seg.querySelectorAll('button')[1].click();
    up.click();
    expect(click).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenCalledWith(true);
    expect(choose).toHaveBeenCalledWith(2);
    expect(input).toHaveBeenCalledWith(3);
    expect(commit).toHaveBeenCalledWith(3);
    expect(button.hasAttribute('signal')).toBe(false);
    expect(range).toHaveProperty('__paint');

    abort.abort();
    ctx.root.remove();
    button.click();
    sw.click();
    seg.querySelectorAll('button')[0].click();
    down.click();
    up.click();
    range.dispatchEvent(new Event('input'));
    range.dispatchEvent(new Event('change'));
    expect(click).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenCalledTimes(1);
    expect(choose).toHaveBeenCalledTimes(1);
    expect(input).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(range.value).toBe('3');
    expect(range).not.toHaveProperty('__paint');
    expect(up.dispatchEvent(new MouseEvent('pointerdown', { cancelable: true }))).toBe(true);
  });

  it('removes a focused slider’s document listener and does not install listeners for an aborted signal', () => {
    const { ctx, abort } = city();
    const input = vi.fn();
    const range = slider({ min: 0, max: 10, value: 2, oninput: input, signal: ctx.signal });
    ctx.root.appendChild(range);
    range.focus();
    const blur = vi.spyOn(range, 'blur');
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(blur).toHaveBeenCalledTimes(1);
    range.focus();
    abort.abort();
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    range.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
    range.dispatchEvent(new KeyboardEvent('keyup', { key: 'w' }));
    expect(blur).toHaveBeenCalledTimes(1);

    const late = slider({ min: 0, max: 10, value: 2, oninput: input, signal: ctx.signal });
    late.dispatchEvent(new Event('input'));
    expect(input).not.toHaveBeenCalled();
    expect(late).not.toHaveProperty('__paint');
  });

  it('keeps helper callers without a signal working', () => {
    const click = vi.fn(), change = vi.fn(), choose = vi.fn(), input = vi.fn();
    h('button', { onclick: click }).click();
    toggle(false, change).click();
    segmented([{ value: 'a', label: 'A' }], 'a', choose).querySelector('button')!.click();
    const range = slider({ min: 0, max: 10, value: 2, oninput: input });
    stepButtons(range, 'test')[1].click();
    expect(click).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenCalledWith(true);
    expect(choose).toHaveBeenCalledWith('a');
    expect(input).toHaveBeenCalledWith(3);
  });

  it('disconnects ticker and panel observers on abort', () => {
    const observers: { disconnect: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal('ResizeObserver', class {
      disconnect = vi.fn();
      observe = vi.fn();
      constructor() { observers.push(this); }
    });
    const { ctx, abort } = city();
    new NewsTicker(ctx, ctx.root);
    new PanelManager(ctx, ctx.root);
    expect(observers).toHaveLength(2);
    abort.abort();
    for (const observer of observers) expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });

  it('binds the Settings music player while a region player keeps working after city abort', () => {
    vi.useFakeTimers();
    const off = vi.fn();
    const audio: MusicAudio = {
      musicEnabled: true, setMusicEnabled: vi.fn(), onChange: () => off,
      music: {
        nowPlaying: null, list: () => [], next: vi.fn(), prev: vi.fn(), select: vi.fn(),
        shuffle: false, setShuffle: vi.fn(), isEnabled: () => true, setEnabled: vi.fn(), onChange: () => () => {},
      },
    };
    const { ctx, abort } = city();
    ctx.mods.audio = audio as unknown as NonNullable<GameContext['mods']['audio']>;
    const settings = new SettingsPanel(ctx);
    settings.mount(() => {}, () => {}, () => {});
    ctx.root.appendChild(settings.el);
    settings.update();
    const cityNext = settings.el.querySelector<HTMLButtonElement>('.mpl-btn.next')!;
    const region = new MusicPlayer(audio, { variant: 'pill' });
    document.body.appendChild(region.el);
    try {
      const regionNext = region.el.querySelector<HTMLButtonElement>('.mpl-btn.next')!;
      cityNext.click();
      regionNext.click();
      expect(audio.music.next).toHaveBeenCalledTimes(2);
      abort.abort();
      ctx.root.remove();
      expect(off).toHaveBeenCalledTimes(1);
      cityNext.click();
      expect(audio.music.next).toHaveBeenCalledTimes(2);
      regionNext.click();
      expect(audio.music.next).toHaveBeenCalledTimes(3);
    } finally {
      region.dispose();
    }
  });
});
