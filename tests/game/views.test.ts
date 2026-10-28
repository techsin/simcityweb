/** W0.5: news revisions survive the retained-log cap; utility events refresh the Power mini-map. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Overlay, Zone } from '../../src/core/types';
import type { GameContext } from '../../src/game/context';
import { MiniMap } from '../../src/ui/MiniMap';
import { NewsTicker } from '../../src/ui/Notifications';
import { AdvisorsPanel } from '../../src/ui/panels/AdvisorsPanel';
import { LocalSimHost } from '../../src/worker/SimHost';
import { newState } from '../infra/cityGen';
import { FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();
afterEach(() => vi.restoreAllMocks());

function city() {
  const abort = new AbortController();
  const host = new LocalSimHost(newState(16), { signal: abort.signal });
  const ctx = {
    host, get state() { return host.state; }, sim: host.sim, signal: abort.signal,
    overlay: Overlay.Power, world: {}, focusCell: () => {}, panels: { open: () => {} },
  } as unknown as GameContext;
  return { ctx, host, abort };
}

describe('W0.5 news sequence', () => {
  it('the ticker and Advisors news gate keep counting and displaying new items past 200', async () => {
    const { ctx, host, abort } = city();
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const ticker = new NewsTicker(ctx, new FEl('div') as unknown as HTMLElement);
    const panel = new AdvisorsPanel(ctx);
    panel.mount(() => {}, () => {}, () => {});
    panel.showTab('news');
    const track = (ticker.el as unknown as FEl).querySelector('.tk-track')!;
    const body = panel.body as unknown as FEl;
    try {
      for (let n = 1; n <= 225; n++) {
        host.sim.notify(`Headline ${n}`, 'info');
        expect(host.newsSeq).toBe(n);
        expect(host.state.news).toHaveLength(Math.min(n, 200));
        now += 1100;
        ticker.frame(1 / 60);
        panel.update();
        expect(textOf(track.children[0])).toContain(`Headline ${n}`);
        expect(textOf(body.querySelector('.news-row')!)).toContain(`Headline ${n}`);
      }
      expect(textOf(track)).not.toContain('Headline 200');
      expect(body.querySelectorAll('.news-row')).toHaveLength(150);
      // The sequence itself invalidates both views, even when the newest object's identity is unchanged.
      const shown = track.children[0], seen = body.querySelector('.news-row');
      host.events.emit('news', host.state.news.at(-1)!);
      now += 1100;
      ticker.frame(0);
      panel.update();
      expect(host.newsSeq).toBe(226);
      expect(track.children[0]).not.toBe(shown);
      expect(body.querySelector('.news-row')).not.toBe(seen);
    } finally {
      abort.abort('dispose');
      await host.dispose();
    }
  });

  it('starts at a saved log, observes news before HUD listeners, and unsubscribes on city abort and host dispose', async () => {
    const st = newState(16);
    for (let n = 0; n < 200; n++) st.notify(`Saved ${n}`);
    const abort = new AbortController();
    const host = new LocalSimHost(st, { signal: abort.signal });
    const seen: number[] = [];
    const off = host.events.on('news', () => seen.push(host.newsSeq));
    try {
      expect(host.newsSeq).toBe(200);
      host.sim.notify('After load');
      expect(seen).toEqual([201]);
      host.sim.replaceState(newState(16));
      expect(host.newsSeq).toBe(202);
      abort.abort('dispose');
      host.sim.notify('After abort');
      expect(host.newsSeq).toBe(202);
    } finally {
      off();
      await host.dispose();
    }
    const standalone = new LocalSimHost(newState(16));
    standalone.sim.notify('Before dispose');
    await standalone.dispose();
    standalone.sim.notify('After dispose');
    expect(standalone.newsSeq).toBe(1);
  });
});

describe('W0.5 MiniMap utilities invalidation', () => {
  it('layerUpdated(utilities) marks the map dirty, repaints Power, and stops listening on city abort', async () => {
    const { ctx, host, abort } = city();
    const painted: Uint8ClampedArray[] = [];
    const g = {
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: (img: ImageData) => painted.push(img.data.slice()),
      clearRect: () => {}, drawImage: () => {}, imageSmoothingEnabled: false,
    };
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = new FEl(tag);
      return tag === 'canvas' ? Object.assign(el, { getContext: () => g }) : el;
    }) as typeof document.createElement);
    host.state.zone[0] = Zone.ResLow;
    const map = new MiniMap(ctx, new FEl('div') as unknown as HTMLElement);
    try {
      map.frame(0);
      expect(painted).toHaveLength(1);
      expect([...painted[0].slice(0, 4)]).toEqual([80, 70, 70, 255]);
      host.state.powered[0] = 1;
      host.events.emit('layerUpdated', 'traffic');
      map.frame(1);
      expect(painted).toHaveLength(1);
      host.events.emit('layerUpdated', 'utilities');
      map.frame(0);
      expect(painted).toHaveLength(2);
      expect([...painted[1].slice(0, 4)]).toEqual([250, 215, 80, 255]);
      abort.abort('dispose');
      host.events.emit('layerUpdated', 'utilities');
      map.frame(1);
      expect(painted).toHaveLength(2);
    } finally {
      abort.abort('dispose');
      map.dispose();
      await host.dispose();
    }
  });
});
