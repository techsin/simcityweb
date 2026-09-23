/**
 * In-city save indicator ("Unsaved changes" / "Saved ✓"), owned by main.ts. Complements CityScene's transient
 * SavePill (which announces each save); this one shows the persistent state and saves on click when dirty.
 * Mounted just above the minimap when it exists (follows its size / collapse / UI zoom), else bottom-right.
 */
import { h, icon, timeAgo } from './dom';

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

export class SaveStatus {
  readonly el: HTMLButtonElement;
  private label: HTMLSpanElement;
  private mark: HTMLSpanElement;
  private state: SaveState | null = null;
  private lastSave = 0;
  private fadeT = 0;

  constructor(private onSaveNow: () => void) {
    this.mark = h('span', { class: 'ss-mark' });
    this.label = h('span', { class: 'ss-label' });
    this.el = h('button', { class: 'save-status', type: 'button', 'data-sfx': 'none' }, this.mark, this.label) as HTMLButtonElement;
    this.el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.state === 'dirty' || this.state === 'error') this.onSaveNow();
    });
    // keep canvas tools from treating a click here as a map click
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.set('saved');
  }

  /** attach above the minimap (preferred) or into `fallback` */
  mount(scope: HTMLElement): void {
    const mm = scope.querySelector<HTMLElement>('.minimap');
    this.el.classList.toggle('floating', !mm);
    (mm ?? scope).appendChild(this.el);
  }

  set(state: SaveState, lastSave?: number): void {
    if (lastSave) this.lastSave = lastSave;
    if (state === this.state) {
      if (state === 'saved') this.el.title = this.savedTitle();
      return;
    }
    this.state = state;
    clearTimeout(this.fadeT);
    this.el.dataset.state = state;
    this.el.classList.remove('idle');
    if (state === 'saved') {
      this.mark.replaceChildren(icon('check', 12));
      this.label.textContent = 'Saved';
      this.el.title = this.savedTitle();
      // settle to a quiet state after a moment
      this.fadeT = window.setTimeout(() => this.el.classList.add('idle'), 3500);
    } else if (state === 'dirty') {
      this.mark.replaceChildren(h('i', { class: 'ss-dot' }));
      this.label.textContent = 'Unsaved changes';
      this.el.title = 'Changes since the last save — click to save now';
    } else if (state === 'saving') {
      this.mark.replaceChildren(h('i', { class: 'ss-spin' }));
      this.label.textContent = 'Saving…';
      this.el.title = 'Saving the city…';
    } else {
      this.mark.replaceChildren(h('i', { class: 'ss-dot' }));
      this.label.textContent = 'Save failed — retry';
      this.el.title = 'The last save failed — click to try again';
    }
  }

  private savedTitle(): string {
    return this.lastSave ? `All changes saved (${timeAgo(this.lastSave)})` : 'All changes saved';
  }

  dispose(): void {
    clearTimeout(this.fadeT);
    this.el.remove();
  }
}
