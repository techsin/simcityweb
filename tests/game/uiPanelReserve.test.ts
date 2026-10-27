/**
 * Close-out c2 item 7 (playtest c2 finding 4): the minimap's "Unsaved changes" / "Saved" chip (region/ui/SaveStatus.ts,
 * mounted 8 px above the minimap: region/ui/meta.css .save-status) showed through the translucent bottom of the tall
 * right-docked panels at 1280x720 — the inspector's last rows, the last Advisors card. A docked panel (top 72, its
 * max-height `calc(100% - Npx)`, hud.css .panel) ended N − 72 px above the layer's bottom, but the minimap block with
 * the chip reaches higher. This pins the reserve against the CSS geometry: the minimap (bottom offset, padding, head row,
 * canvas) plus the chip (gap and height) must stay below a docked panel's bottom. (The head row's height is its padding
 * plus one 18 px line of the "MAP" label and its 24 px buttons' row, whichever is taller.) Browser-checked at 1280x720.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const hud = strip(readFileSync(new URL('../../src/ui/hud.css', import.meta.url), 'utf8'));
const meta = strip(readFileSync(new URL('../../src/region/ui/meta.css', import.meta.url), 'utf8'));

/** the declarations of the rule whose selector list is exactly `sel` */
function bodyOf(css: string, sel: string): string {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (norm(m[1]) === norm(sel)) return m[2];
  throw new Error(`no rule ${sel}`);
}
const px = (body: string, prop: string, re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*(-?\\d+)px`)) => {
  const m = re.exec(body);
  if (!m) throw new Error(`no ${prop} in ${body}`);
  return Number(m[1]);
};

describe('docked panels end above the minimap block and its save chip (close-out c2 item 7)', () => {
  it('the .panel max-height reserve covers the minimap, its head row and the save indicator above it', () => {
    const panel = bodyOf(hud, '.panel');
    const reserve = Number(/max-height:\s*calc\(100% - (\d+)px\)/.exec(panel)?.[1]);
    const mm = bodyOf(hud, '.minimap');
    const head = bodyOf(hud, '.minimap .mm-head');
    const canvas = bodyOf(hud, '.minimap canvas');
    const chip = bodyOf(meta, '.save-status');
    const [hpTop, , hpBottom] = (/padding:\s*(\d+)px (\d+)px (\d+)px/.exec(head) ?? []).slice(1).map(Number);
    const headH = hpTop + Math.max(18, 24) + hpBottom;
    const minimapTop = px(mm, 'bottom') + 2 * px(mm, 'padding') + headH + px(canvas, 'height');
    const chipGap = Number(/bottom:\s*calc\(100% \+ (\d+)px\)/.exec(chip)?.[1]);
    const chipTop = minimapTop + chipGap + px(chip, 'height');
    // a docked panel opens at y 72 (Panel.defaultPos): its bottom is (reserve − 72) px above the layer's bottom
    const panelBottom = reserve - 72;
    expect(chipTop).toBeGreaterThan(minimapTop);
    expect(panelBottom).toBeGreaterThanOrEqual(chipTop + 4);
  });
});
