/** Title screen / main menu overlay on top of the animated MenuBackground. */
import { audio } from '../../audio';
import { MenuBackground } from '../render/MenuBackground';
import type { QualityLevel } from '../../render/contracts';
import { h, icon, withSounds } from './dom';
import { MusicPlayer } from '../../ui/MusicPlayer';
import { EMBLEM_SVG } from './emblem';

export interface TitleScreenOptions {
  continueInfo?: { title: string; sub: string } | null;
  onContinue?: () => void;
  onNewRegion: () => void;
  onLoadRegion: () => void;
  onSettings: () => void;
  onCredits: () => void;
  quality?: QualityLevel;
}

export class TitleScreen {
  readonly el: HTMLElement;
  private bg: MenuBackground | null = null;
  private bgHost: HTMLElement;
  private player: MusicPlayer;
  readonly ready: Promise<void>;

  constructor(root: HTMLElement, o: TitleScreenOptions) {
    this.bgHost = h('div', { class: 'meta-layer' });
    root.appendChild(this.bgHost);
    let resolveReady!: () => void;
    this.ready = new Promise((r) => (resolveReady = r));
    try {
      this.bg = new MenuBackground(this.bgHost, { quality: o.quality === 'low' ? 'low' : undefined });
      this.bg.onFirstFrame = () => resolveReady();
      this.bg.start();
    } catch (e) {
      console.warn('[title] 3D background unavailable', e);
      this.bgHost.style.background = 'radial-gradient(ellipse at 70% 30%, #ffb27a 0%, #6a4a6e 35%, #121a2c 75%)';
      resolveReady();
    }

    const item = (label: string, ic: string, onClick: (() => void) | undefined, opts: { sub?: string; primary?: boolean; delay: number }) => {
      const b = h(
        'button',
        { class: `menu-item ${opts.primary ? 'primary' : ''}`, type: 'button', disabled: !onClick, style: `animation-delay:${opts.delay}s` },
        icon(ic, opts.primary ? 24 : 20),
        h('span', { class: 'mi-text' }, h('span', {}, label), opts.sub ? h('span', { class: 'mi-sub' }, opts.sub) : null),
      ) as HTMLButtonElement;
      // Continue jumps straight into a save: confirm chime. The others open a dialog (its own sound) or fall back to
      // the delegated generic click feedback.
      if (opts.primary && label === 'Continue') withSounds(b, 'confirm');
      b.addEventListener('click', () => {
        audio.init();
        onClick?.();
      });
      return b;
    };
    const ci = o.continueInfo;
    const menu = h(
      'nav',
      { class: 'menu-list' },
      item('Continue', 'play', ci ? o.onContinue : undefined, { sub: ci ? `${ci.title} · ${ci.sub}` : 'No saved region yet', primary: !!ci, delay: 0.35 }),
      item('New Region', 'sparkles', o.onNewRegion, { primary: !ci, delay: 0.43 }),
      item('Load Region', 'folder', o.onLoadRegion, { delay: 0.51 }),
      h('div', { class: 'menu-sep', style: 'animation: fadein 1s .6s both' }),
      item('Settings', 'settings', o.onSettings, { delay: 0.59 }),
      item('Credits', 'info', o.onCredits, { delay: 0.67 }),
    );
    const logo = h(
      'div',
      { class: 'logo' },
      h('div', { class: 'logo-mark' }, h('div', { class: 'logo-emblem', html: EMBLEM_SVG })),
      h('div', { class: 'logo-word' }, 'METROPOLIS'),
      h('div', { class: 'logo-tag' }, 'Build the city of your dreams'),
    );
    // now-playing pill: track title + mood, prev / play-pause / next, shuffle, track list popover
    this.player = new MusicPlayer(audio, { variant: 'pill', popover: 'up' });
    const fsBtn = h('button', { class: 'icon-btn', title: 'Toggle fullscreen' }, icon('expand', 17)) as HTMLButtonElement;
    fsBtn.addEventListener('click', () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.().catch(() => undefined);
    });
    this.el = h(
      'div',
      { class: 'title-screen' },
      h('div', { class: 'title-shade' }),
      h('div', { class: 'title-grain' }),
      h('div', { class: 'title-main' }, logo, menu),
      h('div', { class: 'title-footer' }, h('span', {}, 'v0.1 · Early Access  ·  Best with headphones'), h('div', { class: 'tf-right' }, this.player.el, fsBtn)),
    );
    root.appendChild(this.el);
  }

  dispose(): void {
    this.player.dispose();
    this.bg?.dispose();
    this.bg = null;
    this.el.remove();
    this.bgHost.remove();
  }
}
