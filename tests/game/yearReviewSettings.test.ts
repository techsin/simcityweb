/** LG-21: the in-city Settings switch uses the existing persisted setting and native button behaviour. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameContext } from '../../src/game/context';
import { DEFAULT_SETTINGS, type GameSettings } from '../../src/game/settings';
import { SettingsPanel } from '../../src/ui/panels/SettingsPanel';
import { FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();
const aborts: AbortController[] = [];
afterEach(() => {
  for (const abort of aborts.splice(0)) abort.abort();
});

function panel(yearReview: boolean) {
  const abort = new AbortController(); aborts.push(abort);
  const settings = { ...DEFAULT_SETTINGS, yearReview };
  const applySettings = vi.fn((patch: Partial<GameSettings>) => Object.assign(settings, patch));
  const ctx = { settings, applySettings, signal: abort.signal, mods: {} } as unknown as GameContext;
  const panel = new SettingsPanel(ctx);
  panel.mount(() => {}, () => {}, () => {});
  const body = panel.body as unknown as FEl;
  const row = body.querySelectorAll('.set-row').find((row) => textOf(row.querySelector('.sr-l')!) === 'Year in review');
  if (!row) throw new Error('Year in review row is missing');
  return { abort, settings, applySettings, body, row, sw: row.querySelector('.ui-switch')! };
}

describe('Year in review Settings switch', () => {
  it.each([true, false])('reads the stored value %s without writing it', (on) => {
    const f = panel(on);
    expect(f.sw.classList.contains('on')).toBe(on);
    expect(f.sw.getAttribute('aria-checked')).toBe(String(on));
    expect(f.applySettings).not.toHaveBeenCalled();
    const labels = f.body.querySelectorAll('.sr-l').map(textOf);
    expect(labels.indexOf('Year in review')).toBe(labels.indexOf('New Year show camera') + 1);
  });

  it('writes only yearReview through applySettings and keeps the existing native switch behaviour', () => {
    const f = panel(true), blur = vi.spyOn(f.sw, 'blur');
    // Native buttons provide Enter/Space activation; the shared toggle keeps the panel's click-and-blur behaviour.
    expect(f.sw.tagName).toBe('button');
    expect(f.sw.getAttribute('type')).toBe('button');
    expect(f.sw.getAttribute('role')).toBe('switch');
    f.sw.click();
    expect(f.applySettings).toHaveBeenLastCalledWith({ yearReview: false });
    expect(f.settings.yearReview).toBe(false);
    expect(f.sw.getAttribute('aria-checked')).toBe('false');
    expect(blur).toHaveBeenCalledOnce();
    f.sw.click();
    expect(f.applySettings).toHaveBeenLastCalledWith({ yearReview: true });
    expect(f.sw.getAttribute('aria-checked')).toBe('true');
    expect(f.applySettings).toHaveBeenCalledTimes(2);
  });

  it('releases the switch listener with the city lifetime', () => {
    const f = panel(true);
    f.abort.abort();
    f.sw.click();
    expect(f.applySettings).not.toHaveBeenCalled();
  });
});
