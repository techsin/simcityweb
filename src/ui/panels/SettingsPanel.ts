/** Settings: graphics quality, time of day, camera, interface, audio, gameplay. Persisted via ctx.applySettings. */
import type { QualityLevel } from '../../render/contracts';
import type { GameContext } from '../../game/context';
import type { EmergencyPolicy, GameSettings, NewYearMode } from '../../game/settings';
import { Panel } from '../Panel';
import { h, segmented, setSlider, setToggle, slider, toggle } from '../dom';
import { asMusicAudio, MusicPlayer } from '../MusicPlayer';
import { hourLabel } from '../format';

export class SettingsPanel extends Panel {
  readonly id = 'settings';
  readonly title = 'Settings';
  override icon = 'settings';
  override width = 460;
  override center = true;
  private hourRow!: HTMLElement;
  private hourSlider!: HTMLInputElement;
  private hourVal!: HTMLElement;
  private autoSw!: HTMLElement;
  /** music player + sound toggles (filled once the optional audio module has loaded) */
  private musicHost!: HTMLElement;
  private player: MusicPlayer | null = null;

  override defaultPos(w: number, hh: number): { x: number; y: number } {
    return { x: Math.max(14, (w - this.width) / 2), y: Math.max(72, (hh - 620) / 2) };
  }

  private row(label: string, desc: string | null, control: HTMLElement): HTMLElement {
    return h('div', { class: 'set-row' }, h('div', null, h('div', { class: 'sr-l' }, label), desc ? h('div', { class: 'sr-d' }, desc) : null), h('div', { class: 'sr-c' }, control));
  }

  private range(key: keyof GameSettings, min: number, max: number, step: number, fmt: (v: number) => string): HTMLElement {
    const s = this.ctx.settings;
    const val = h('span', { class: 'opt-val' }, fmt(s[key] as number));
    const sl = slider({ min, max, step, value: s[key] as number, oninput: (v) => {
      val.textContent = fmt(v);
      this.ctx.applySettings({ [key]: v } as Partial<GameSettings>);
    } });
    return h('div', { class: 'sr-c' }, sl, val);
  }

  private sw(key: keyof GameSettings): HTMLElement {
    return toggle(!!this.ctx.settings[key], (v) => this.ctx.applySettings({ [key]: v } as Partial<GameSettings>));
  }

  protected build(): void {
    const s = this.ctx.settings;
    const pctf = (v: number) => Math.round(v * 100) + '%';
    const quality = segmented<QualityLevel>([{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'ultra', label: 'Ultra' }], s.quality, (q) => this.ctx.applySettings({ quality: q }));
    this.autoSw = toggle(s.autoTime, (v) => {
      this.ctx.applySettings({ autoTime: v });
      this.update();
    });
    this.hourVal = h('span', { class: 'opt-val' }, hourLabel(s.fixedHour));
    this.hourSlider = slider({ min: 0, max: 24, step: 0.25, value: s.fixedHour, oninput: (v) => {
      this.hourVal.textContent = hourLabel(v);
      this.ctx.applySettings({ fixedHour: v, autoTime: false });
      setToggle(this.autoSw, false);
    } });
    this.hourRow = this.row('Fixed time', 'Drag to set the hour (turns off the day cycle)', h('div', { class: 'sr-c' }, this.hourSlider, this.hourVal));
    const newYear = segmented<NewYearMode>([{ value: 'cinematic', label: 'Cinematic' }, { value: 'fireworks', label: 'Fireworks' }, { value: 'off', label: 'Off' }], s.newYear ?? 'cinematic', (v) => this.ctx.applySettings({ newYear: v }));
    const autosave = segmented<number>([{ value: 0, label: 'Off' }, { value: 3, label: '3 mo' }, { value: 6, label: '6 mo' }, { value: 12, label: '1 yr' }], s.autosaveMonths, (v) => this.ctx.applySettings({ autosaveMonths: v }));
    // sections (Gameplay — autosave / New Year — sits right under Graphics so it is reachable without scrolling far;
    // the long music player stays last). A sticky nav jumps to each section (the body scrolls at 720p).
    const sec = (id: string, title: string) => h('div', { class: 'sec-title', dataset: { sec: id } }, title);
    const nav = h('div', { class: 'set-nav' });
    for (const [id, label] of [['graphics', 'Graphics'], ['gameplay', 'Gameplay'], ['controls', 'Controls'], ['interface', 'Interface'], ['audio', 'Audio & music']]) {
      const b = h('button', { type: 'button' }, label);
      b.addEventListener('click', () => {
        this.showSection(id);
        this.ctx.sound('tab');
        b.blur();
      });
      nav.appendChild(b);
    }
    this.body.classList.add('settings-body');
    this.body.append(
      nav,
      sec('graphics', 'Graphics'),
      this.row('Quality', 'Shadows, post effects and draw distance', quality),
      this.row('Day / night cycle', 'Time of day follows the calendar', this.autoSw),
      this.hourRow,
      sec('gameplay', 'Gameplay'),
      this.row('Autosave', 'Saves every N game months', autosave),
      this.row('New Year celebration', 'Fireworks every January 1st — Cinematic switches to night first', newYear),
      this.row('New Year show camera', 'Cinematic: frame the show from the skyline, then return (any camera move takes over)', this.sw('newYearCamera')),
      this.row('Pause when hidden', 'Pause the simulation when the tab is in the background', this.sw('pauseWhenHidden')),
      // WP8 emergency dispatch
      this.row('Uncovered emergencies', 'When no station can answer an emergency: slow down to live speed, pause, or keep going', segmented<EmergencyPolicy>([{ value: 'live', label: 'Live speed' }, { value: 'pause', label: 'Pause' }, { value: 'ignore', label: 'Keep going' }], s.emergencyUncovered ?? 'live', (v) => this.ctx.applySettings({ emergencyUncovered: v }))),
      this.row('Emergency alerts', 'Banners for major incidents only, or for every incident that needs you', segmented<'major' | 'all'>([{ value: 'major', label: 'Major' }, { value: 'all', label: 'All' }], s.emergencyAlerts ?? 'major', (v) => this.ctx.applySettings({ emergencyAlerts: v }))),
      this.row('Live speed', 'How much 1x slows down while you handle an emergency', this.range('emergencyLiveSlowmo', 1, 5, 0.5, (v) => (v <= 1 ? 'Normal 1x' : `${v}x slower`))),
      sec('controls', 'Camera & controls'),
      this.row('Edge scrolling', 'Move the camera when the mouse touches the screen edge', this.sw('edgeScroll')),
      this.row('Show grid while building', null, this.sw('showGrid')),
      sec('interface', 'Interface'),
      this.row('UI scale', 'On top of automatic resolution scaling', this.range('uiScale', 0.7, 1.5, 0.05, pctf)),
      this.row('Notifications', 'Pop-up toasts for important events', this.sw('toasts')),
      this.row('Show FPS', null, this.sw('showFps')),
      sec('audio', 'Audio & music'),
      this.row('Master volume', null, this.range('masterVolume', 0, 1, 0.05, pctf)),
      this.row('Music', null, this.range('musicVolume', 0, 1, 0.05, pctf)),
      this.row('Effects', null, this.range('sfxVolume', 0, 1, 0.05, pctf)),
      this.row('Ambience', null, this.range('ambienceVolume', 0, 1, 0.05, pctf)),
      (this.musicHost = h('div', { class: 'set-music' })),
    );
  }

  /** scroll the body to a section ('graphics' | 'gameplay' | 'controls' | 'interface' | 'audio' | 'music') */
  showSection(id: string): void {
    this.buildAudioExtras();
    const t = this.body.querySelector(`.sec-title[data-sec="${id}"]`) as HTMLElement | null;
    if (!t) return;
    // (instant: offsets measured against the scrolling body; zoom cancels out in the ratio)
    const nav = this.body.querySelector('.set-nav') as HTMLElement | null;
    const z = this.body.getBoundingClientRect().height / (this.body.clientHeight || 1) || 1;
    const y = (t.getBoundingClientRect().top - this.body.getBoundingClientRect().top) / z + this.body.scrollTop;
    this.body.scrollTop = Math.max(0, y - (nav?.offsetHeight ?? 0) - 6);
  }

  /** Music section (now-playing card + track list) and the UI / hover / now-playing sound toggles */
  private buildAudioExtras(): void {
    if (this.player || !this.musicHost) return;
    const a = this.ctx.mods.audio as unknown as {
      uiSounds?: boolean; hoverSounds?: boolean; nowPlayingToasts?: boolean;
      setUiSounds?: (on: boolean) => void; setHoverSounds?: (on: boolean) => void; setNowPlayingToasts?: (on: boolean) => void;
    } | undefined;
    const ma = asMusicAudio(a);
    if (!a || !ma) return;
    const sw = (on: boolean | undefined, set: ((v: boolean) => void) | undefined) => toggle(on !== false, (v) => set?.call(a, v), !set);
    this.player = new MusicPlayer(ma, { variant: 'card', tracks: true });
    // the audio engine outlives the city: release the player's change listener + refresh timer with the scene
    this.ctx.signal.addEventListener('abort', () => this.player?.dispose(), { once: true });
    // switching interface sounds off still confirms with one last (explicit) switch sound before going quiet
    const uiSw = toggle(a.uiSounds !== false, (v) => {
      if (!v) this.ctx.sound('toggleOff');
      a.setUiSounds?.call(a, v);
    }, !a.setUiSounds);
    this.musicHost.append(
      this.row('Interface sounds', 'Clicks, panels, sliders and tool feedback', uiSw),
      this.row('Hover sounds', 'Soft ticks when pointing at menus and the toolbar', sw(a.hoverSounds, a.setHoverSounds)),
      h('div', { class: 'sec-title', dataset: { sec: 'music' } }, 'Music'),
      this.player.el,
      this.row('“Now playing” pop-ups', 'Show the track title when the soundtrack changes song', sw(a.nowPlayingToasts, a.setNowPlayingToasts)),
    );
  }

  override update(): void {
    this.buildAudioExtras();
    const s = this.ctx.settings;
    setToggle(this.autoSw, s.autoTime);
    this.hourRow.style.opacity = s.autoTime ? '0.55' : '1';
    let hr = s.fixedHour;
    if (s.autoTime) {
      try {
        hr = this.ctx.world.timeOfDay;
      } catch {
        /* ignore */
      }
    }
    setSlider(this.hourSlider, Math.round(hr * 4) / 4);
    this.hourVal.textContent = hourLabel(hr);
  }
}
