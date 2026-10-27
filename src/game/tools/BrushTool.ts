/** Brush tools: terraform (raise / lower / level / smooth) and tree planting. Hold the button to apply continuously. */
import { CELL_SIZE } from '../../core/constants';
import type { ActionResult, TerraformKind } from '../../sim/actions';
import type { GameContext } from '../context';
import { h, slider } from '../../ui/dom';
import { FAIL, resultTip, safe, Tool, type ToolPointer } from './Tool';

/** brush settings shared by all brush tools */
export const brush = { radius: 3, strength: 0.5 };

const TERRA_LABELS: Record<TerraformKind, string> = { raise: 'Raise terrain', lower: 'Lower terrain', level: 'Level terrain', smooth: 'Smooth terrain' };

export class BrushTool extends Tool {
  readonly id: string;
  readonly label: string;
  private acc = 0;
  private stroke = { spent: 0, failed: false };
  /** hold-to-apply feedback: seconds since the last soft brush sound */
  private sndAcc = 0;
  private preview: ActionResult | null = null;
  private lastKey = '';

  constructor(ctx: GameContext, private kind: TerraformKind | 'trees', icon: string) {
    super(ctx);
    this.id = kind === 'trees' ? 'trees' : 'terra:' + kind;
    this.label = kind === 'trees' ? 'Plant trees' : TERRA_LABELS[kind];
    this.icon = icon;
    this.wantsGrid = kind !== 'trees';
  }

  private apply(p: ToolPointer, previewOnly: boolean): ActionResult {
    const hit = p.hit!;
    // brush is centered on the hovered cell (cx, cz are integer cell coords, like CityActions expects)
    const cx = hit.x, cz = hit.z;
    const r = brush.radius;
    const stroke = this.stroke;
    const feedback = {
      ok: () => {},
      fail: () => {}, // a held brush stays quiet on failure; release reports the whole stroke
      ack: (result: ActionResult) => {
        if (result.ok) stroke.spent += result.cost;
        else stroke.failed = true;
      },
    };
    if (this.kind === 'trees') {
      const rect = { x0: cx - r + 1, z0: cz - r + 1, x1: cx + r, z1: cz + r };
      return previewOnly ? safe(() => this.ctx.actions.plantTrees(rect, true), FAIL) : this.commit('plantTrees', [rect], feedback).predicted ?? FAIL;
    }
    const k = this.kind;
    return previewOnly ? safe(() => this.ctx.actions.terraform(k, cx, cz, r, brush.strength, true), FAIL) : this.commit('terraform', [k, cx, cz, r, brush.strength], feedback).predicted ?? FAIL;
  }

  private showBrush(p: ToolPointer | null): void {
    if (!p?.hit) {
      this.ctx.world.setBrush(null, 0);
      return;
    }
    this.ctx.world.setBrush({ x: (p.hit.x + 0.5) * CELL_SIZE, z: (p.hit.z + 0.5) * CELL_SIZE }, brush.radius);
  }

  override move(p: ToolPointer): void {
    this.showBrush(p);
    if (!p.hit) {
      this.ctx.tip.hide();
      return;
    }
    const key = `${p.hit.x},${p.hit.z},${brush.radius},${brush.strength},${this.ctx.host.pending?.revision ?? 0}`;
    if (key !== this.lastKey && !p.down) {
      this.lastKey = key;
      this.preview = this.apply(p, true);
    }
    const t = resultTip(this.label, p.down ? { ok: true, cost: this.stroke.spent } : this.preview, p.down ? 'Applying…' : `Radius ${brush.radius} · hold to apply`);
    this.ctx.tip.show(t.html, t.kind);
  }
  override down(p: ToolPointer): void {
    this.stroke = { spent: 0, failed: false };
    this.sndAcc = 0;
    this.acc = 1; // apply immediately
    this.frame(0, p);
  }
  override up(): void {
    this.lastKey = '';
    const stroke = this.stroke;
    void (this.gesture?.settled ?? Promise.resolve()).then(() => {
      if (this.ctx.signal.aborted) return;
      if (stroke.spent > 0) this.ctx.sound(this.kind === 'trees' ? 'trees' : 'terraform');
      // nothing could be applied during the whole hold (no money, under roads / buildings, no room for trees)
      else if (stroke.failed) this.ctx.sound('error');
    });
  }
  override frame(dt: number, p: ToolPointer | null): void {
    if (!p || !p.down || !p.hit) return;
    this.acc += dt;
    this.sndAcc += dt;
    const interval = this.kind === 'trees' ? 0.12 : 0.07;
    if (this.acc < interval) return;
    this.acc = 0;
    const r = this.apply(p, false);
    // Soft hold sounds follow predictions; only the final stroke sound waits for acknowledgements.
    if (r.ok && this.sndAcc >= 0.3) {
      this.sndAcc = 0;
      this.ctx.sound(this.kind === 'trees' ? 'trees' : 'terraform', { volume: 0.5, intensity: 0.2 });
    }
    this.showBrush(p);
  }
  override deactivate(): void {
    this.ctx.world.setBrush(null, 0);
    this.ctx.tip.hide();
  }
  override leave(): void {
    this.ctx.world.setBrush(null, 0);
    this.ctx.tip.hide();
  }
  override key(e: KeyboardEvent, p: ToolPointer | null): boolean {
    if (e.type !== 'keydown') return false;
    if (e.key === '[' || e.key === ']') {
      const before = brush.radius;
      brush.radius = Math.max(1, Math.min(10, brush.radius + (e.key === ']' ? 1 : -1)));
      // detent tick pitched like the size slider (bigger = higher); a dull tap at the limits
      if (brush.radius !== before) this.ctx.sound('tick', { pitch: 0.84 + 0.42 * ((brush.radius - 1) / 9) });
      else if (!e.repeat) this.ctx.sound('tap', { pitch: 0.6 });
      this.lastKey = '';
      if (p) this.move(p);
      this.syncOptions();
      return true;
    }
    return false;
  }
  private opts: { r: HTMLInputElement; s: HTMLInputElement; rv: HTMLElement; sv: HTMLElement } | null = null;
  private syncOptions(): void {
    if (!this.opts) return;
    this.opts.r.value = String(brush.radius);
    (this.opts.r as any).__paint?.();
    this.opts.rv.textContent = String(brush.radius);
  }
  override options(): HTMLElement {
    const rv = h('span', { class: 'opt-val' }, String(brush.radius));
    const sv = h('span', { class: 'opt-val' }, Math.round(brush.strength * 100) + '%');
    const r = slider({ signal: this.ctx.signal, min: 1, max: 10, value: brush.radius, oninput: (v) => { brush.radius = v; rv.textContent = String(v); this.lastKey = ''; } });
    const s = slider({ signal: this.ctx.signal, min: 0.1, max: 1, step: 0.05, value: brush.strength, oninput: (v) => { brush.strength = v; sv.textContent = Math.round(v * 100) + '%'; this.lastKey = ''; } });
    this.opts = { r, s, rv, sv };
    const row = h('div', { class: 'tool-opts' },
      h('label', null, 'Size', r, rv),
      this.kind === 'trees' ? null : h('label', null, 'Strength', s, sv),
    );
    return row;
  }
  override hints(): string[] {
    return ['Hold to apply', '[ ] brush size'];
  }
}
