/** Settings: graphics quality, time of day, camera, interface, audio, gameplay. Persisted via ctx.applySettings. */
import type { QualityLevel } from '../../render/contracts';
import type { GameContext } from '../../game/context';
import type { GameSettings, NewYearMode } from '../../game/settings';
import { Panel } from '../Panel';
import { h, segmented, setSlider, setToggle, slider, toggle } from '../dom';
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
    this.body.append(
      h('div', { class: 'sec-title' }, 'Graphics'),
      this.row('Quality', 'Shadows, post effects and draw distance', quality),
      this.row('Day / night cycle', 'Time of day follows the calendar', this.autoSw),
      this.hourRow,
      h('div', { class: 'sec-title' }, 'Camera & controls'),
      this.row('Edge scrolling', 'Move the camera when the mouse touches the screen edge', this.sw('edgeScroll')),
      this.row('Show grid while building', null, this.sw('showGrid')),
      h('div', { class: 'sec-title' }, 'Interface'),
      this.row('UI scale', 'On top of automatic resolution scaling', this.range('uiScale', 0.7, 1.5, 0.05, pctf)),
      this.row('Notifications', 'Pop-up toasts for important events', this.sw('toasts')),
      this.row('Show FPS', null, this.sw('showFps')),
      h('div', { class: 'sec-title' }, 'Audio'),
      this.row('Master volume', null, this.range('masterVolume', 0, 1, 0.05, pctf)),
      this.row('Music', null, this.range('musicVolume', 0, 1, 0.05, pctf)),
      this.row('Effects', null, this.range('sfxVolume', 0, 1, 0.05, pctf)),
      this.row('Ambience', null, this.range('ambienceVolume', 0, 1, 0.05, pctf)),
      h('div', { class: 'sec-title' }, 'Gameplay'),
      this.row('Autosave', 'Saves every N game months', autosave),
      this.row('Pause when hidden', 'Pause the simulation when the tab is in the background', this.sw('pauseWhenHidden')),
      this.row('New Year celebration', 'Fireworks every January 1st — Cinematic switches to night first', newYear),
    );
  }

  override update(): void {
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
