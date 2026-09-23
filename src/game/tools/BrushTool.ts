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
  private spent = 0;
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
    const cx = hit.point.x / CELL_SIZE, cz = hit.point.z / CELL_SIZE;
    const r = brush.radius;
    if (this.kind === 'trees') {
      const rect = { x0: Math.floor(cx - r + 0.5), z0: Math.floor(cz - r + 0.5), x1: Math.floor(cx + r + 0.5), z1: Math.floor(cz + r + 0.5) };
      return safe(() => this.ctx.actions.plantTrees(rect, previewOnly), FAIL);
    }
    const k = this.kind;
    return safe(() => this.ctx.actions.terraform(k, cx, cz, r, brush.strength, previewOnly), FAIL);
  }

  private showBrush(p: ToolPointer | null): void {
    if (!p?.hit) {
      this.ctx.world.setBrush(null, 0);
      return;
    }
    this.ctx.world.setBrush({ x: p.hit.point.x, z: p.hit.point.z }, brush.radius);
  }

  override move(p: ToolPointer): void {
    this.showBrush(p);
    if (!p.hit) {
      this.ctx.tip.hide();
      return;
    }
    const key = `${p.hit.x},${p.hit.z},${brush.radius},${brush.strength}`;
    if (key !== this.lastKey && !p.down) {
      this.lastKey = key;
      this.preview = this.apply(p, true);
    }
    const t = resultTip(this.label, p.down ? { ok: true, cost: this.spent } : this.preview, p.down ? 'Applying…' : `Radius ${brush.radius} · hold to apply`);
    this.ctx.tip.show(t.html, t.kind);
  }
  override down(p: ToolPointer): void {
    this.spent = 0;
    this.acc = 1; // apply immediately
    this.frame(0, p);
  }
  override up(): void {
    this.lastKey = '';
    if (this.spent > 0) this.ctx.sound(this.kind === 'trees' ? 'trees' : 'terraform');
  }
  override frame(dt: number, p: ToolPointer | null): void {
    if (!p || !p.down || !p.hit) return;
    this.acc += dt;
    const interval = this.kind === 'trees' ? 0.12 : 0.07;
    if (this.acc < interval) return;
    this.acc = 0;
    const r = this.apply(p, false);
    if (r.ok) this.spent += r.cost;
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
      brush.radius = Math.max(1, Math.min(10, brush.radius + (e.key === ']' ? 1 : -1)));
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
    const r = slider({ min: 1, max: 10, value: brush.radius, oninput: (v) => { brush.radius = v; rv.textContent = String(v); this.lastKey = ''; } });
    const s = slider({ min: 0.1, max: 1, step: 0.05, value: brush.strength, oninput: (v) => { brush.strength = v; sv.textContent = Math.round(v * 100) + '%'; this.lastKey = ''; } });
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
