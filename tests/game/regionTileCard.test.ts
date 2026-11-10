/**
 * T095: the recommended tile's card words its land from the tile's own shares. It said "mostly flat land with a little
 * water" for every recommended tile, also next to "0% water" (the recommended tile of many new regions has none).
 *  - the water words follow the rounded percentage the card shows: "no water" only for a tile without any, "almost no
 *    water" for a share that rounds to 0%, "a little water" from 1%
 *  - "mostly flat land" only when more than half of the tile is flat, dry land
 *  - the real card (RegionScreen.selectTile) reads both shares of the tile it shows; other tiles keep their texts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RegionScreen, recommendedTileLand } from '../../src/region/RegionScreen';
import { createRegionData, type RegionModel } from '../../src/region/RegionModel';
import type { RegionTile } from '../../src/region/types';
import { guideCopy } from '../../src/ui/guide/copy';
import { FEl, FNode, installFakeDom, textOf } from './fakeDom';

installFakeDom();
beforeEach(() => { vi.stubGlobal('Node', FNode); });
afterEach(() => { vi.unstubAllGlobals(); });

const WATER_WORDS = ['no water', 'almost no water', 'a little water', 'some water', 'a lot of water'];
const waterWords = (s: string) => s.slice(s.indexOf(' with ') + 6);

describe('T095: the recommended tile\'s land sentence', () => {
  it('words the water from the share the card shows', () => {
    const at = (water: number) => recommendedTileLand(water, 0.9);
    expect(at(0)).toBe('mostly flat land with no water');
    // one wet sample of the 16 x 16 grid: the card shows 0%
    expect(at(1 / 256)).toBe('mostly flat land with almost no water');
    expect(at(0.0049)).toBe('mostly flat land with almost no water');
    expect(at(0.005)).toBe('mostly flat land with a little water');
    expect(at(0.12)).toBe('mostly flat land with a little water');
    expect(at(0.194)).toBe('mostly flat land with a little water');
    expect(at(0.2)).toBe('mostly flat land with some water');
    expect(at(0.4)).toBe('mostly flat land with some water');
    expect(at(0.41)).toBe('mostly flat land with a lot of water');
    expect(at(1)).toBe('mostly flat land with a lot of water');
  });

  it('says "mostly flat" only when more than half of the tile is flat land', () => {
    const at = (flat: number) => recommendedTileLand(0.1, flat);
    expect(at(1)).toBe('mostly flat land with a little water');
    expect(at(0.51)).toBe('mostly flat land with a little water');
    expect(at(0.5)).toBe('some flat land with a little water');
    expect(at(0.25)).toBe('some flat land with a little water');
    expect(at(0.249)).toBe('little flat land with a little water');
    expect(at(0)).toBe('little flat land with a little water');
  });

  it('never contradicts the card\'s percentage, for every share the sample grid can give', () => {
    let last = 0;
    for (let k = 0; k <= 256; k++) {
      const water = k / 256, shown = Math.round(water * 100), words = waterWords(recommendedTileLand(water, 1 - water));
      const tier = WATER_WORDS.indexOf(words);
      expect(tier, `${k}/256: ${words}`).toBeGreaterThanOrEqual(0);
      // "no water" exactly for a dry tile; "a little water" and more only when the card shows at least 1%
      expect(tier === 0, `${k}/256`).toBe(k === 0);
      expect(tier >= 2, `${k}/256 shown as ${shown}%`).toBe(shown >= 1);
      expect(tier, `${k}/256`).toBeGreaterThanOrEqual(last);
      last = tier;
    }
    expect(last).toBe(WATER_WORDS.length - 1);
  });
});

type Shares = Pick<RegionModel, 'tileWaterFraction' | 'tileFlatFraction'> & { data: { id: string } };

/** the real selectTile on a screen without the region's WebGL view and unrelated HUD */
function card(model: Shares, tile: RegionTile, recommended: RegionTile | null): string {
  const screen = Object.assign(Object.create(RegionScreen.prototype), {
    view: { select: vi.fn(), selectedTile: tile, recommendedTile: recommended },
    model, el: new FEl('div'), tileCard: null, cb: {},
    renderList() {}, tilePreview: () => new FEl('canvas'),
  }) as { selectTile(tile: RegionTile | null): void; tileCard: FEl };
  screen.selectTile(tile);
  return textOf(screen.tileCard);
}

describe('T095: the selected tile\'s card', () => {
  const tile: RegionTile = { key: '6_8', x: 6, z: 8, size: 2 };
  const shares = (water: number, flat: number) => ({ tileWaterFraction: vi.fn(() => water), tileFlatFraction: vi.fn(() => flat), data: { id: 'r-t095' } });
  const lead = guideCopy.phaseA.A3Tile();

  it('describes the recommended tile by its own water and flat land', () => {
    const plains = shares(0, 0.98);
    const text = card(plains, tile, tile);
    expect(text).toContain(`${lead}: mostly flat land with no water.`);
    expect(text).toContain('0%water');
    expect(text).not.toContain('a little water');
    expect(plains.tileWaterFraction).toHaveBeenCalledWith(tile);
    expect(plains.tileFlatFraction).toHaveBeenCalledWith(tile);

    const river = card(shares(0.117, 0.86), tile, tile);
    expect(river).toContain(`${lead}: mostly flat land with a little water.`);
    expect(river).toContain('12%water');

    const islands = card(shares(0.46, 0.3), tile, tile);
    expect(islands).toContain(`${lead}: some flat land with a lot of water.`);
    expect(islands).toContain('46%water');
  });

  it('keeps the texts of the other tiles', () => {
    const other: RegionTile = { key: '0_0', x: 0, z: 0, size: 1 };
    const coast = shares(0.3, 0.6);
    const text = card(coast, other, tile);
    expect(text).toContain('Found a city here — its terrain will match the neighbouring tiles.');
    expect(text).toContain('30%water');
    expect(text).not.toContain(lead);
    expect(coast.tileFlatFraction).not.toHaveBeenCalled();

    const founded: RegionTile = { ...tile, city: { name: 'Riverton', mayor: 'Ada', difficulty: 'easy', population: 1200, r: 1200, c: 300, i: 200, funds: 5000, year: 2003, founded: 0, lastPlayed: Date.now() } };
    const city = card(shares(0, 0.98), founded, null);
    expect(city).toContain('Mayor Ada · easy difficulty');
    expect(city).not.toContain('flat land');
  });

  // the reported case: a region whose recommended tile samples no water (the first of these seeds that has one;
  // generated here, not in the test: terrain generation takes a second)
  const dry = (() => {
    for (const seed of [15851, 31689, 47527, 55446]) {
      const { model } = createRegionData({ seed, preset: 'greenvale', id: `t095-${seed}` });
      if (model.tileWaterFraction(model.recommendedTile()!) === 0) return model;
    }
    return undefined;
  })();

  it('a generated region: the recommended tile without water no longer promises "a little water"', () => {
    expect(dry, 'none of the seeds recommends a tile without water').toBeDefined();
    const rec = dry!.recommendedTile()!;
    const text = card(dry!, rec, rec);
    expect(text).toContain('0%water');
    expect(text).toContain(`${lead}: ${recommendedTileLand(0, dry!.tileFlatFraction(rec))}.`);
    expect(text).toContain('with no water.');
    expect(text).not.toContain('a little water');
  });
});
