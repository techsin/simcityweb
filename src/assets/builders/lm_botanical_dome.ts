/** Botanical Dome: a three-house conservatory or two unequal palm houses. 4x4 lot, <= 8000 tris. */
import { ModelBuilder } from '../ModelBuilder';
import type { ModelBuilders } from '../registry';
import { Surf } from '../../core/types';
import type { RNG } from '../../core/rng';
import {
  type V3, annulus, cross, cylWall, dot, flowerBed, lamp, lotModels, nrm, parkBench, person, rect, rectPoly, tree,
} from './park_lib';

const TAU = Math.PI * 2;

/**
 * Triangular glazing with a steel border in the same plane: no overlapping glass / lattice faces. Glass and frame take
 * the shell's smooth normal (`shell`), so the sun's highlight glides across the dome as a spot instead of flashing one
 * flat pane (or its frame) white.
 */
function pane(b: ModelBuilder, a: V3, c: V3, d: V3, frame: number, pattern: number, shell: (p: V3) => V3): void {
  const mid: V3 = [(a[0] + c[0] + d[0]) / 3, (a[1] + c[1] + d[1]) / 3, (a[2] + c[2] + d[2]) / 3];
  const inset = (p: V3): V3 => [p[0] + (mid[0] - p[0]) * 0.07, p[1] + (mid[1] - p[1]) * 0.07, p[2] + (mid[2] - p[2]) * 0.07];
  const ia = inset(a), ic = inset(c), id = inset(d);
  const out: V3 = [mid[0], mid[1] - 3.2, mid[2]];
  const tri = (p: V3, q: V3, r: V3): void => {
    if (dot(cross([q[0] - p[0], q[1] - p[1], q[2] - p[2]], [r[0] - p[0], r[1] - p[1], r[2] - p[2]]), out) >= 0) b.triN(p, q, r, shell(p), shell(q), shell(r));
    else b.triN(p, r, q, shell(p), shell(r), shell(q));
  };
  b.paint(0x88aaa5, Surf.GlassPlain, pattern);
  tri(ia, ic, id);
  b.paint(frame, Surf.Metal);
  for (const [p, q, iq, ip] of [[a, c, ic, ia], [c, d, id, ic], [d, a, ia, id]]) {
    tri(p, q, iq);
    tri(p, iq, ip);
  }
}

function conservatory(b: ModelBuilder, x: number, z: number, rx: number, rz: number, h: number, seg: number, rows: number, frame: number, pattern = 2): void {
  b.push().translate(x, 0, z);
  // Elliptical perimeter walk, stone sill, glazed drum and continuous eave gutter.
  b.push().scale(1, 1, rz / rx);
  b.paint(0xc6bba5, Surf.Pavement);
  annulus(b, 0, 0, 0.12, rx + 0.35, rx + 2, seg);
  b.paint(0xb8b09c, Surf.Stone).cylinder(0, 0, 0.1, 0.55, rx + 0.2, rx + 0.2, seg, { top: false });
  b.paint(0xb8b09c, Surf.Stone);
  annulus(b, 0, 0, 0.65, rx, rx + 0.2, seg);
  b.paint(0x88aaa5, Surf.GlassPlain, pattern);
  cylWall(b, 0, 0, 0.65, 3.2, rx, rx, seg);
  b.paint(frame, Surf.Metal);
  cylWall(b, 0, 0, 3.05, 3.35, rx + 0.12, rx + 0.12, seg);
  annulus(b, 0, 0, 3.35, rx - 0.12, rx + 0.12, seg);
  b.pop();
  // Staggered latitude rings give the shell a triangular space-frame rhythm; the apex is a single fan.
  const shell = (p: V3): V3 => nrm([p[0] / (rx * rx), (p[1] - 3.2) / (h * h), p[2] / (rz * rz)]);
  const at = (j: number, i: number): V3 => {
    const e = (j / rows) * Math.PI / 2, a = ((i + (j % 2) * 0.5) / seg) * TAU;
    return [Math.cos(a) * Math.cos(e) * rx, 3.2 + Math.sin(e) * h, Math.sin(a) * Math.cos(e) * rz];
  };
  for (let j = 0; j < rows; j++) for (let i = 0; i < seg; i++) {
    const a = at(j, i), c = at(j, i + 1);
    if (j === rows - 1) pane(b, a, c, [0, 3.2 + h, 0], frame, pattern, shell);
    else {
      const d = at(j + 1, i + 1), e = at(j + 1, i);
      pane(b, a, c, d, frame, pattern, shell);
      pane(b, a, d, e, frame, pattern, shell);
    }
  }
  b.paint(frame, Surf.Metal);
  for (let i = 0; i < seg; i += 2) {
    const a = (i / seg) * TAU, px = Math.cos(a) * rx, pz = Math.sin(a) * rz;
    b.box(px - 0.12, 0.65, pz - 0.12, px + 0.12, 3.35, pz + 0.12);
  }
  // Vent lantern at the summit; pavilion glass carries the shared warm night glow on sloping panes too.
  const top = h + 3.2;
  b.paint(frame, Surf.Metal).cylinder(0, 0, top - 0.4, 0.35, 1.1, 1.1, 8);
  b.paint(0x88aaa5, Surf.GlassPlain, 2).cylinder(0, 0, top - 0.05, 0.9, 0.8, 0.8, 8);
  b.paint(frame, Surf.Metal).cone(0, 0, top + 0.85, 0.7, 1.15, 8, false);
  b.pop();
}

function botanicalDome(b: ModelBuilder, v: number, rng: RNG): void {
  const E = 32, frame = v === 0 ? 0xd0d5c8 : 0x73958a, pave = 0xcfc4ae;
  // lawn up to the street forecourt; the paving covers the rest of the lot (no shared lot-edge faces)
  b.paint(0x6e8a47, Surf.Foliage).slab(-E, -E, E, 18.5, 0.08);
  b.paint(pave, Surf.Pavement).slab(-E, 18.5, E, E, 0.1);
  if (v === 0) {
    conservatory(b, 0, -6, 18, 18, 22, 24, 6, frame);
    for (const s of [-1, 1]) conservatory(b, s * 21, 9, 7.5, 7.5, 10, 16, 4, frame, 3);
  } else {
    conservatory(b, -9, -7, 16, 19, 26, 24, 7, frame);
    conservatory(b, 15, 7, 12, 10, 16, 20, 5, frame, 3);
  }
  // Low glazed links and the street-facing entrance hall, with a broad pitched canopy.
  const linkX0 = v === 0 ? -21 : -9, linkX1 = v === 0 ? 21 : 15;
  b.paint(0x88aaa5, Surf.GlassPlain, 2).box(linkX0, 0.15, 7, linkX1, 4.8, 11, { bottom: null });
  b.paint(frame, Surf.Metal).box(linkX0 - 0.2, 4.8, 6.8, linkX1 + 0.2, 5.05, 11.2);
  b.paint(0x88aaa5, Surf.GlassPlain, 2).box(-8, 0.15, 10.5, 8, 4.8, 22, { top: null });
  b.paint(0x88aaa5, Surf.GlassPlain, 2).gableRoof(0, 16.25, 16, 11.5, 4.8, 2.4, 'z', 0.35, { color: 0x88aaa5, surf: Surf.GlassPlain, pattern: 2 });
  b.paint(frame, Surf.Metal);
  for (const z of [12, 17, 22.35]) {
    b.beam([-8.35, 4.8, z], [0, 7.2, z], 0.24).beam([0, 7.2, z], [8.35, 4.8, z], 0.24);
  }
  for (const x of [-7.8, -4, 0, 4, 7.8]) b.box(x - 0.12, 0.15, 22, x + 0.12, 4.8, 22.2);
  b.paint(0xb8b09c, Surf.Stone).box(-8.5, 0.1, 21.8, 8.5, 0.28, 23.2);
  b.paint(0x3d6751, Surf.Metal).box(-3.2, 3.7, 22.2, 3.2, 4.45, 22.35);
  // Leaf emblem over the doors (geometry, so it stays crisp without a text texture).
  b.paint(0xc6d7a1, Surf.Plain).quad2([-0.9, 4.05, 22.37], [0, 4.35, 22.37], [0.9, 4.05, 22.37], [0, 3.8, 22.37]);
  for (const s of [-1, 1]) {
    const x = s * 17;
    b.paint(0xaaa18d, Surf.Stone).box(x - 6, 0.1, 19.4, x + 6, 0.5, 22.8, { top: null });
    rect(b, x - 6, 19.4, x + 6, 19.75, 0.5);
    rect(b, x - 6, 22.45, x + 6, 22.8, 0.5);
    rect(b, x - 6, 19.75, x - 5.65, 22.45, 0.5);
    rect(b, x + 5.65, 19.75, x + 6, 22.45, 0.5);
    b.paint(0x356974, Surf.Water);
    rect(b, x - 5.65, 19.75, x + 5.65, 22.45, 0.38);
    b.paint(0x527742, Surf.Foliage, 4);
    for (let i = 0; i < 4; i++) {
      const px = x - 4.2 + i * 2.8;
      b.cylinder(px, 21.1 + (i % 2) * 0.5, 0.385, 0.025, 0.35, 0.35, 6);
    }
    flowerBed(b, rng, x - 7, 25, x + 7, 28, { spacing: 1.25, colors: v === 0 ? [0xd6b65d, 0xd88378, 0xb89acb] : [0xeee2ba, 0x9a91bb, 0xb2bf6f] });
    parkBench(b, s * 7, 27, s > 0 ? -Math.PI / 2 : Math.PI / 2);
    lamp(b, s * 4.8, 29, 3.8, 1, [{ color: pave, y: 0.1, dy: 0.02, clip: [rectPoly(-E, 18.5, E, E)] }]);
    tree(b, rng, s * 28, -27.5, 0.8, 'cone');
    tree(b, rng, s * 28.5, -16, 0.6, 'cone');
  }
  for (let i = 0; i < 4; i++) person(b, rng, rng.range(-3.5, 3.5), rng.range(24, 30.5), 0.1, rng.range(0, TAU));
}

// Full detail here; the renderer builds the same distant massing proxy used by the other landmarks.
export const models: ModelBuilders = lotModels({ lm_botanical_dome: botanicalDome });
