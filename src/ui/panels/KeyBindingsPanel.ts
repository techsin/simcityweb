/** Rebind profile shortcuts; edits stay in a draft until every conflict is resolved. */
import { BINDINGS, bindingConflicts, bindingLabel, validBindingCode, type KeyBindings } from '../../game/bindings';
import { Panel } from '../Panel';
import { clear, h, setText } from '../dom';

export class KeyBindingsPanel extends Panel {
  readonly id = 'keybindings';
  readonly title = 'Key bindings';
  override icon = 'keyboard';
  override width = 540;
  override center = true;
  private draft: KeyBindings = {};
  private inputs = new Map<string, HTMLInputElement>();
  private warnings!: HTMLDivElement;
  private apply!: HTMLButtonElement;
  private status = '';

  protected build(): void {
    this.draft = { ...this.ctx.settings.keyBindings };
    this.body.classList.add('keybindings-body');
    this.body.appendChild(h('div', { class: 'dim', style: 'font-size:12px;margin-bottom:12px' }, 'Focus a key box, then press a key. Escape cancels; Tab moves to the next control. Save always uses Ctrl or Command. Arrow and numpad alternatives stay available. R rotates a building while placing one and selects homes otherwise.'));
    let group = '';
    for (const b of BINDINGS) {
      if (group !== b.group) {
        group = b.group;
        this.body.appendChild(h('div', { class: 'sec-title' }, group));
      }
      const input = h('input', { type: 'text', readonly: true, value: bindingLabel(b.id, this.draft), 'aria-label': `${b.label} key`, title: 'Focus, then press a key', style: 'width:124px;min-width:0;text-align:center' });
      this.inputs.set(b.id, input);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') return;
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') {
          this.status = '';
          input.blur();
          this.refresh();
          return;
        }
        if (e.repeat) return;
        if (e.altKey || e.ctrlKey || e.metaKey || !validBindingCode(e.code)) {
          this.status = 'Choose a single key. Escape, Tab and modifier keys stay reserved; Save adds Ctrl / Command automatically.';
          this.refresh();
          return;
        }
        this.draft[b.id] = e.code;
        this.status = '';
        this.refresh();
      }, { signal: this.ctx.signal });
      const unset = h('button', { type: 'button', class: 'btn sm', 'aria-label': `Unbind ${b.label}` }, 'Clear');
      unset.addEventListener('click', () => {
        this.draft[b.id] = '';
        this.status = '';
        this.refresh();
      }, { signal: this.ctx.signal });
      this.body.appendChild(h('div', { class: 'set-row' }, h('div', { class: 'sr-l' }, b.label), h('div', { class: 'sr-c' }, input, unset)));
    }
    this.warnings = h('div', { role: 'status', 'aria-live': 'polite', style: 'font-size:12px;margin:12px 0' });
    const reset = h('button', { type: 'button', class: 'btn' }, 'Reset defaults');
    reset.addEventListener('click', () => {
      this.draft = {};
      this.status = '';
      this.refresh();
    }, { signal: this.ctx.signal });
    this.apply = h('button', { type: 'button', class: 'btn primary' }, 'Apply');
    this.apply.addEventListener('click', () => {
      if (bindingConflicts(this.draft).length) return;
      this.ctx.applySettings({ keyBindings: { ...this.draft } });
      this.status = 'Key bindings saved for this profile.';
      this.ctx.sound('confirm');
      this.refresh();
    }, { signal: this.ctx.signal });
    this.body.append(this.warnings, h('div', { style: 'display:flex;justify-content:space-between;gap:8px' }, reset, this.apply));
    this.refresh();
  }

  override onOpen(): void {
    this.draft = { ...this.ctx.settings.keyBindings };
    this.status = '';
    this.refresh();
  }

  private refresh(): void {
    for (const [id, input] of this.inputs) input.value = bindingLabel(id, this.draft);
    if (!this.warnings) return;
    const conflicts = bindingConflicts(this.draft);
    clear(this.warnings);
    for (const c of conflicts) this.warnings.appendChild(h('div', { class: 'bad' }, c.message));
    if (this.status) this.warnings.appendChild(h('div', null, this.status));
    else if (!conflicts.length) setText(this.warnings, 'No key conflicts.');
    this.apply.disabled = conflicts.length > 0;
  }
}
