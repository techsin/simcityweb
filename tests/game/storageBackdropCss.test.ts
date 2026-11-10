/**
 * T089 O1: the storage dialogs' backdrop ("Storage full", "City could not be saved", Manage storage) stacks above the
 * city's HUD. Its element carries both `modal-back` and `storage-back`, and `.modal-back` is styled by two later sheets
 * (src/region/ui/meta.css, z 40, and src/ui/hud.css `:where(.mp-ui) .modal-back`, z 60) with the same specificity as a
 * bare `.storage-back`, so source order decided and the toolbar drew over the dialog and took its clicks. The rule must
 * name both classes. Read from the sheets, as tests/game/storageNoticeCss.test.ts does: the tests have no layout engine.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8');

/** the declarations of every rule whose selector list has exactly `selector`, merged in source order */
function rule(sheet: string, selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const block of sheet.replace(/\/\*[\s\S]*?\*\//g, '').split('}')) {
    const [selectors, body] = block.split('{');
    if (!body || !selectors.split(',').some((s) => s.trim().replace(/\s+/g, ' ') === selector)) continue;
    for (const decl of body.split(';')) {
      const colon = decl.indexOf(':');
      if (colon > 0) out[decl.slice(0, colon).trim()] = decl.slice(colon + 1).trim();
    }
  }
  return out;
}

describe('T089 O1: the storage dialog backdrop', () => {
  const storage = read('ui/storage.css');

  it('names both classes, so it outranks every `.modal-back` rule whatever the sheet order', () => {
    expect(rule(storage, '.modal-back.storage-back')['z-index']).toBe('130');
    // a bare `.storage-back` z-index would tie with `.modal-back` and lose to the later sheets again
    expect(rule(storage, '.storage-back')['z-index']).toBeUndefined();
  });

  it('stacks above both `.modal-back` rules and the HUD layers', () => {
    const z = Number(rule(storage, '.modal-back.storage-back')['z-index']);
    expect(z).toBeGreaterThan(Number(rule(read('region/ui/meta.css'), '.modal-back')['z-index']));
    expect(z).toBeGreaterThan(Number(rule(read('ui/hud.css'), ':where(.mp-ui) .modal-back')['z-index']));
    for (const selector of ['.hud-bottom', '.hud-top', '.hud-tl', '.panel-layer']) {
      expect(Number(rule(read('ui/hud.css'), selector)['z-index'] ?? 0), selector).toBeLessThan(z);
    }
  });
});
