/** Rebind profile shortcuts; edits stay in a draft until every conflict is resolved. */
import { BINDINGS, bindingConflicts, bindingLabel, changedBindings, validBindingCode, type KeyBindings } from '../../game/bindings';
import { confirmDialog } from '../Modals';
import { Panel } from '../Panel';
import { clear, h } from '../dom';

/** conflict lines the footer shows before "and N more" */
const FOOT_LINES = 2;

export class KeyBindingsPanel extends Panel {
  readonly id = 'keybindings';
  readonly title = 'Key bindings';
  override icon = 'keyboard';
  override width = 540;
  override center = true;
  private draft: KeyBindings = {};
  private inputs = new Map<string, HTMLInputElement>();
  private notes = new Map<string, HTMLElement>();
  private warnings!: HTMLDivElement;
  private apply!: HTMLButtonElement;
  private status = '';
  /** the next open keeps the draft (the question on closing was answered "Keep editing") */
  private keepDraft = false;

  protected build(): void {
    this.draft = { ...this.ctx.settings.keyBindings };
    this.body.classList.add('keybindings-body');
    this.body.appendChild(h('div', { class: 'dim', style: 'font-size:12px;margin-bottom:12px' }, 'Focus a key box, then press a key. Escape cancels; Tab moves to the next control. Save always uses Ctrl or Command. Arrow and numpad alternatives stay available. R rotates a building while placing one and selects homes otherwise. Clear leaves an action without a key, its alternatives included (Delete and Backspace for Bulldoze, the arrows and numpad keys for the camera).'));
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
          this.status = 'Choose a single key. Escape, Tab, Enter, the brush keys [ ] and modifier keys stay reserved; Save adds Ctrl / Command automatically.';
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
      // (QA B7) what a conflicting row shares its key with, on the row itself
      const note = h('div', { class: 'sr-d', style: 'display:none;color:var(--bad)' });
      this.notes.set(b.id, note);
      this.body.appendChild(h('div', { class: 'set-row' }, h('div', null, h('div', { class: 'sr-l' }, b.label), note), h('div', { class: 'sr-c' }, input, unset)));
    }
    this.warnings = h('div', { role: 'status', 'aria-live': 'polite', style: 'flex:1;min-width:0;font-size:12px;line-height:1.4' });
    const reset = h('button', { type: 'button', class: 'btn' }, 'Reset defaults');
    reset.addEventListener('click', () => {
      this.draft = {};
      this.status = '';
      this.refresh();
    }, { signal: this.ctx.signal });
    this.apply = h('button', { type: 'button', class: 'btn primary' }, 'Apply');
    this.apply.addEventListener('click', () => {
      if (bindingConflicts(this.draft).length) return;
      this.commit(this.draft);
      this.refresh();
    }, { signal: this.ctx.signal });
    // QA B7: the conflict line and the buttons stay in sight, in a footer under the scrolling list (they were the last
    // rows of a 2,388 px scroller with 678 px on screen). (el: the panel's shell; a bare body takes them itself.)
    (this.el ?? this.body).appendChild(h('div', { class: 'panel-foot' }, this.warnings, reset, this.apply));
    this.refresh();
  }

  override onOpen(): void {
    if (!this.keepDraft) this.draft = { ...this.ctx.settings.keyBindings };
    this.keepDraft = false;
    this.status = '';
    this.refresh();
  }

  /**
   * QA B7: closing with unapplied changes no longer drops them without a word. A draft that can be applied is kept
   * (applied, with a toast that says so). While two actions share a key it cannot be: the panel asks, and Escape, the
   * dialog's cancel, goes back to the editor with the draft as it was.
   */
  override onClose(): void {
    const draft = { ...this.draft };
    const n = changedBindings(draft, this.ctx.settings.keyBindings).length;
    if (this.ctx.signal.aborted || !n) return;
    const conflicts = bindingConflicts(draft);
    if (!conflicts.length) {
      this.commit(draft, true);
      this.ctx.toast(`${n === 1 ? 'Your key change is' : `Your ${n} key changes are`} saved for this profile.`, 'info', undefined, 'Key bindings');
      return;
    }
    void confirmDialog(this.ctx, {
      title: 'Discard key changes?', icon: 'keyboard', confirm: 'Discard', cancel: 'Keep editing',
      message: `${conflicts[0].message} Two actions cannot share a key, so these changes cannot be applied.`,
    }).then((discard) => {
      if (this.ctx.signal.aborted) return;
      if (discard) return this.drop();
      this.draft = draft;
      this.keepDraft = true;
      this.ctx.panels.open(this.id);
    });
  }

  private drop(): void {
    this.draft = { ...this.ctx.settings.keyBindings };
  }

  /** the scene, before it closes every panel to leave the city: nothing waits for the question's answer there, so a
   *  draft that cannot be applied goes (one that can is kept by the close itself) */
  leave(): void {
    if (bindingConflicts(this.draft).length) this.drop();
  }

  private commit(draft: KeyBindings, quiet = false): void {
    this.ctx.applySettings({ keyBindings: { ...draft } });
    this.draft = { ...draft };
    this.status = 'Key bindings saved for this profile.';
    if (!quiet) this.ctx.sound('confirm');
  }

  private refresh(): void {
    for (const [id, input] of this.inputs) input.value = bindingLabel(id, this.draft);
    if (!this.warnings) return;
    const conflicts = bindingConflicts(this.draft);
    // the rows in conflict: a red key box, and under the action's name what it shares the key with
    const shared = new Map<string, string[]>();
    for (const c of conflicts) {
      for (const id of c.ids) {
        const others = c.ids.filter((o) => o !== id).map((o) => BINDINGS.find((b) => b.id === o)?.label ?? o);
        shared.set(id, [...shared.get(id) ?? [], ...(others.length ? others.map((o) => `Same key as ${o}`) : ['Reserved key'])]);
      }
    }
    for (const [id, input] of this.inputs) {
      const lines = [...new Set(shared.get(id) ?? [])], note = this.notes.get(id);
      input.setAttribute('aria-invalid', lines.length ? 'true' : 'false');
      input.style.borderColor = lines.length ? 'var(--bad)' : '';
      if (note) {
        note.textContent = lines.join(' · ');
        note.style.display = lines.length ? '' : 'none';
      }
    }
    clear(this.warnings);
    for (const c of conflicts.slice(0, FOOT_LINES)) this.warnings.appendChild(h('div', { style: 'color:var(--bad)' }, c.message));
    if (conflicts.length > FOOT_LINES) this.warnings.appendChild(h('div', { style: 'color:var(--bad)' }, `and ${conflicts.length - FOOT_LINES} more: the rows in red`));
    const pending = changedBindings(this.draft, this.ctx.settings.keyBindings).length;
    if (this.status) this.warnings.appendChild(h('div', null, this.status));
    else if (!conflicts.length) this.warnings.appendChild(h('div', pending ? { style: 'color:var(--warn)' } : null, pending ? `${pending === 1 ? '1 change' : `${pending} changes`} not applied yet.` : 'No key conflicts.'));
    this.apply.disabled = conflicts.length > 0;
  }
}
