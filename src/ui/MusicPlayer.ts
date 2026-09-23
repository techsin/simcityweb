/**
 * Music player UI for the procedural soundtrack (audio.music, src/audio/music/director.ts):
 *
 *   new MusicPlayer(audio, { variant: 'card', tracks: true })   in-game Settings: now-playing card (title, mood,
 *                                                                progress, shuffle / prev / play-pause / next) +
 *                                                                track list (click to play, per-track on/off)
 *   new MusicPlayer(audio, { variant: 'pill', popover: 'up' })   title screen / region view: compact glass pill with
 *                                                                equalizer, title · mood, prev / play-pause / next,
 *                                                                shuffle; the title opens a track-list popover
 *   watchTrackChanges(audio, (np) => toast(...))                 "Now playing" pop-ups (CityScene)
 *
 * Play / pause is the soundtrack's on/off switch (audio.setMusicEnabled, persisted). Self-contained styles in
 * musicPlayer.css (works outside the game HUD, e.g. on the title screen).
 */
import './musicPlayer.css';
import type { MusicControls, NowPlaying, TrackInfo } from '../audio';
import { icon } from './icons';

/** the parts of the audio engine the player needs (src/audio/AudioEngine.ts) */
export interface MusicAudio {
  readonly music: MusicControls;
  readonly musicEnabled: boolean;
  setMusicEnabled(on: boolean): void;
  init?(): boolean;
  startMusic?(): void;
  play?(name: string, opts?: { volume?: number; pitch?: number; pan?: number }): void;
  onChange(cb: () => void): () => void;
}

/** a usable MusicAudio or null (the optional audio module may be missing / older) */
export function asMusicAudio(a: unknown): MusicAudio | null {
  const m = a as Partial<MusicAudio> | null | undefined;
  return m && m.music && typeof m.music.list === 'function' && typeof m.onChange === 'function' && typeof m.setMusicEnabled === 'function' ? (m as MusicAudio) : null;
}

/** "Sunny bossa nova: nylon guitar, flute..." -> "Sunny bossa nova" */
export function shortMood(mood: string): string {
  const head = mood.split(/[:;—–(]/)[0].trim();
  return head.length > 38 ? head.slice(0, 36).trimEnd() + '…' : head;
}

function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

/** cover-art hues for the shipped soundtrack (distinct around the wheel, matched to each song's mood) */
const TRACK_HUES: Record<string, number> = {
  sunday_jazz: 0, avenida_bossa: 36, greenbelt_pastoral: 108, harbor_lights: 178, blueprint_ambient: 218, rush_hour_funk: 268, neon_skyline: 312,
};

/** stable per-track hue for the cover art (curated table, hash for tracks added later) */
function hueOf(id: string): number {
  if (id in TRACK_HUES) return TRACK_HUES[id];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function btn(cls: string, title: string, ico: string, size = 16): HTMLButtonElement {
  const b = el('button', 'mpl-btn ' + cls, icon(ico, size));
  b.type = 'button';
  b.title = title;
  b.setAttribute('aria-label', title);
  return b;
}

export interface MusicPlayerOptions {
  variant: 'card' | 'pill';
  /** card: show the track list below */
  tracks?: boolean;
  /** pill: which way the track-list popover opens */
  popover?: 'up' | 'down';
}

export class MusicPlayer {
  readonly el: HTMLElement;
  private titleEl: HTMLElement;
  private moodEl: HTMLElement;
  private art: HTMLElement;
  private playBtn: HTMLButtonElement;
  private shuffleBtn: HTMLButtonElement;
  private bar: HTMLElement | null = null;
  private fill: HTMLElement | null = null;
  private timeEl: HTMLElement | null = null;
  private list: HTMLElement | null = null;
  private pop: HTMLElement | null = null;
  private offs: (() => void)[] = [];
  private timer = 0;
  private lastId = '';
  private last: TrackInfo | null = null;
  private listSig = '';

  constructor(private audio: MusicAudio, private o: MusicPlayerOptions) {
    const pill = o.variant === 'pill';
    this.el = el('div', pill ? 'mplayer mplayer-pill' : 'mplayer mplayer-card');
    this.art = el('div', 'mpl-art', '<i></i><i></i><i></i><i></i>');
    this.titleEl = el('div', 'mpl-title');
    this.moodEl = el('div', 'mpl-mood');
    const prev = btn('prev', 'Previous track', 'prev', pill ? 13 : 15);
    const next = btn('next', 'Next track', 'next', pill ? 13 : 15);
    this.playBtn = btn('play', 'Play', 'playFill', pill ? 14 : 18);
    this.shuffleBtn = btn('shuffle', 'Shuffle', 'shuffle', pill ? 14 : 15);
    this.shuffleBtn.setAttribute('role', 'switch');
    prev.addEventListener('click', () => this.skip(-1));
    next.addEventListener('click', () => this.skip(1));
    this.playBtn.addEventListener('click', () => this.togglePlay());
    this.shuffleBtn.addEventListener('click', () => {
      const on = !this.audio.music.shuffle;
      this.audio.music.setShuffle(on);
      this.sound(on ? 'toggleOn' : 'toggleOff');
    });

    if (pill) {
      const meta = el('button', 'mpl-meta');
      meta.type = 'button';
      meta.title = 'Soundtrack — choose a track';
      meta.append(this.titleEl, this.moodEl);
      meta.addEventListener('click', (e) => {
        e.stopPropagation();
        this.togglePopover();
      });
      this.el.append(this.art, meta, el('span', 'mpl-sep'), prev, this.playBtn, next, this.shuffleBtn);
      this.el.classList.add(o.popover === 'down' ? 'pop-down' : 'pop-up');
      const outside = (e: PointerEvent) => {
        if (this.pop && !this.el.contains(e.target as Node)) this.togglePopover(false);
      };
      document.addEventListener('pointerdown', outside, true);
      this.offs.push(() => document.removeEventListener('pointerdown', outside, true));
    } else {
      const head = el('div', 'mpl-head');
      const meta = el('div', 'mpl-meta');
      meta.append(this.titleEl, this.moodEl);
      head.append(this.art, meta);
      this.bar = el('div', 'mpl-bar');
      this.fill = el('i');
      this.bar.appendChild(this.fill);
      this.timeEl = el('div', 'mpl-time');
      const prog = el('div', 'mpl-prog');
      prog.append(this.bar, this.timeEl);
      const ctrls = el('div', 'mpl-ctrls');
      ctrls.append(this.shuffleBtn, prev, this.playBtn, next, el('span', 'mpl-count'));
      this.el.append(head, prog, ctrls);
      if (o.tracks) {
        this.list = el('div', 'mpl-list');
        this.el.appendChild(this.list);
      }
    }
    this.offs.push(this.audio.onChange(() => this.render()));
    this.render();
    this.timer = window.setInterval(() => {
      if (!this.el.isConnected) return;
      this.render();
    }, 500);
  }

  dispose(): void {
    clearInterval(this.timer);
    for (const f of this.offs) f();
    this.offs = [];
    this.el.remove();
  }

  private sound(name: string): void {
    try {
      this.audio.play?.(name);
    } catch {
      /* ignore */
    }
  }

  private ensureStarted(): void {
    try {
      this.audio.init?.();
    } catch {
      /* ignore */
    }
  }

  private togglePlay(): void {
    this.ensureStarted();
    const playing = this.audio.musicEnabled;
    this.sound(playing ? 'pause' : 'speed1');
    this.audio.setMusicEnabled(!playing);
    if (!playing) this.audio.startMusic?.();
    this.render();
  }

  private skip(dir: 1 | -1): void {
    this.ensureStarted();
    this.sound('tap');
    const m = this.audio.music;
    if (!this.audio.musicEnabled) {
      // skipping while paused turns the music back on with the neighbouring track
      const tracks = m.list().filter((t) => t.enabled);
      const cur = this.last ? tracks.findIndex((t) => t.id === this.last!.id) : -1;
      const t = tracks[(cur + dir + tracks.length) % Math.max(1, tracks.length)];
      if (t) m.select(t.id);
      return;
    }
    if (dir > 0) m.next();
    else m.prev();
  }

  private togglePopover(open = !this.pop): void {
    if (!open) {
      if (this.pop) {
        this.pop.remove();
        this.pop = null;
        this.list = null;
        this.sound('flyoutClose');
      }
      return;
    }
    if (this.pop) return;
    this.pop = el('div', 'mpl-pop');
    this.pop.appendChild(el('div', 'mpl-pop-h', icon('music', 13) + '<span>Soundtrack</span>'));
    this.list = el('div', 'mpl-list');
    this.pop.appendChild(this.list);
    this.el.appendChild(this.pop);
    this.listSig = '';
    this.sound('flyout');
    this.render();
  }

  private renderList(np: NowPlaying | null): void {
    const list = this.list;
    if (!list) return;
    const m = this.audio.music;
    const tracks = m.list();
    const playingId = this.audio.musicEnabled ? np?.id ?? '' : '';
    const sig = tracks.map((t) => `${t.id}:${t.enabled}`).join('|') + '#' + playingId;
    if (sig === this.listSig) return;
    this.listSig = sig;
    list.replaceChildren();
    const enabledCount = tracks.filter((t) => t.enabled).length;
    for (const t of tracks) {
      const row = el('div', 'mpl-row' + (t.id === playingId ? ' on' : '') + (t.enabled ? '' : ' off'));
      row.style.setProperty('--h', String(hueOf(t.id)));
      const pick = el('button', 'mpl-pick');
      pick.type = 'button';
      pick.title = t.enabled ? `Play “${t.title}”` : `Play “${t.title}” (skipped by the playlist)`;
      pick.innerHTML = `<span class="mpl-dot">${t.id === playingId ? '<i></i><i></i><i></i>' : icon('playFill', 10)}</span><span class="mpl-rt"><b></b><small></small></span>`;
      (pick.querySelector('b') as HTMLElement).textContent = t.title;
      (pick.querySelector('small') as HTMLElement).textContent = shortMood(t.mood);
      pick.addEventListener('click', (e) => {
        e.stopPropagation();
        this.ensureStarted();
        this.sound('tab');
        m.select(t.id);
      });
      const sw = el('button', 'mpl-switch' + (t.enabled ? ' on' : ''), '<span></span>');
      sw.type = 'button';
      sw.setAttribute('role', 'switch');
      sw.setAttribute('aria-checked', String(t.enabled));
      const onlyOne = t.enabled && enabledCount <= 1;
      sw.disabled = onlyOne;
      sw.title = onlyOne ? 'At least one track stays in the playlist' : t.enabled ? 'In the playlist — click to skip this track' : 'Skipped — click to add back to the playlist';
      sw.addEventListener('click', (e) => {
        e.stopPropagation();
        // explicit: the list re-renders on change, so the delegated handler would read the stale switch state
        this.sound(t.enabled ? 'toggleOff' : 'toggleOn');
        m.setEnabled(t.id, !t.enabled);
      });
      row.append(pick, sw);
      list.appendChild(row);
    }
  }

  private render(): void {
    const a = this.audio;
    const m = a.music;
    let np: NowPlaying | null = null;
    try {
      np = m.nowPlaying;
    } catch {
      np = null;
    }
    if (np) this.last = np;
    const on = a.musicEnabled;
    const shown = np ?? this.last ?? m.list().find((t) => t.enabled) ?? null;
    const title = shown ? shown.title : 'Soundtrack';
    const mood = !on ? 'Music off — press play' : np ? shortMood(np.mood) : 'Starting…';
    if (this.titleEl.textContent !== title) this.titleEl.textContent = title;
    if (this.moodEl.textContent !== mood) this.moodEl.textContent = mood;
    this.el.classList.toggle('playing', on && !!np);
    this.el.classList.toggle('paused', !on);
    if (shown) this.el.style.setProperty('--h', String(hueOf(shown.id)));
    const playIco = on ? 'pauseFill' : 'playFill';
    if (this.playBtn.dataset.ico !== playIco) {
      this.playBtn.dataset.ico = playIco;
      this.playBtn.innerHTML = icon(playIco, this.o.variant === 'pill' ? 14 : 18);
      this.playBtn.title = on ? 'Pause music' : 'Play music';
      this.playBtn.setAttribute('aria-label', this.playBtn.title);
    }
    const sh = m.shuffle;
    this.shuffleBtn.classList.toggle('on', sh);
    this.shuffleBtn.setAttribute('aria-checked', String(sh));
    this.shuffleBtn.title = sh ? 'Shuffle on (context-aware)' : 'Shuffle off (playlist order)';
    // track change: flash the pill / card
    const id = np?.id ?? '';
    if (id && id !== this.lastId) {
      if (this.lastId) {
        this.el.classList.remove('changed');
        void this.el.offsetWidth;
        this.el.classList.add('changed');
      }
      this.lastId = id;
    }
    if (this.fill && this.timeEl) {
      const f = np && np.duration > 0 ? Math.min(1, np.elapsed / np.duration) : 0;
      this.fill.style.width = `${(f * 100).toFixed(2)}%`;
      const t = np ? `${fmtTime(np.elapsed)} / ${fmtTime(np.duration)}` : on ? '–:–– / –:––' : 'Paused';
      if (this.timeEl.textContent !== t) this.timeEl.textContent = t;
      const cnt = this.el.querySelector('.mpl-count');
      if (cnt) {
        const tracks = m.list();
        const txt = `${tracks.filter((x) => x.enabled).length} of ${tracks.length} tracks`;
        if (cnt.textContent !== txt) cnt.textContent = txt;
      }
    }
    this.renderList(np);
  }
}

/** call cb with the new song whenever the soundtrack moves on to a different track; returns unsubscribe */
export function watchTrackChanges(audio: MusicAudio, cb: (np: NowPlaying) => void): () => void {
  let last = '';
  try {
    last = audio.music.nowPlaying?.id ?? '';
  } catch {
    /* ignore */
  }
  const check = () => {
    let np: NowPlaying | null = null;
    try {
      np = audio.music.nowPlaying;
    } catch {
      return;
    }
    if (!np || np.id === last) return;
    const first = !last;
    last = np.id;
    if (!first || np.elapsed < 3) cb(np);
  };
  const off = audio.music.onChange(check);
  // the director reports song changes via onChange; poll as a fallback for automatic crossfades
  const t = window.setInterval(check, 2000);
  return () => {
    off();
    clearInterval(t);
  };
}
