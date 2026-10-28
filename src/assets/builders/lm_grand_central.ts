/**
 * Grand Central Station (4x3): arched stone headhouse, clock, glazed train sheds,
 * platforms, bus shelter and metro entrance. Single vault / twin vault variants.
 * Full model <= 8000 tris; distant LOD uses the renderer's existing massing proxy.
 */
import { ModelBuilder, type Paint } from '../ModelBuilder';
import type { ModelBuilders } from '../registry';
import { Surf } from '../../core/types';
import type { RNG } from '../../core/rng';
import { lotModels, lamp, parkBench, person, rect, rectPoly, type P2, type V3 } from './park_lib';
import { archFrameZ, openingZ, polyZ, roundArch, surface } from './lm_lib';

const TAU = Math.PI * 2;
const P = (color: number, surf: Surf = Surf.Plain, pattern = 0, floor = 3.3): Paint => ({ color, surf, pattern, floor });

/** Clock on a local +Z face; fixed hands keep the model independent of wall-clock time. */
function stationClock(b: ModelBuilder, y: number, z: number, r: number): void {
  const circle = (rr: number): P2[] => Array.from({ length: 24 }, (_, i) => [Math.cos(i * TAU / 24) * rr, y + Math.sin(i * TAU / 24) * rr]);
  b.paint(0xb59b61, Surf.Metal);
  polyZ(b, circle(r + 0.25), z, 1, [circle(r)]);
  b.paint(0xddd3b1, Surf.Emissive, 10);
  polyZ(b, circle(r), z - 0.01);
  b.paint(0x303638, Surf.Metal);
  for (let i = 0; i < 12; i++) {
    const a = i * TAU / 12;
    b.beam([Math.cos(a) * r * 0.78, y + Math.sin(a) * r * 0.78, z + 0.04], [Math.cos(a) * r * 0.92, y + Math.sin(a) * r * 0.92, z + 0.04], 0.1);
  }
  b.beam([0, y, z + 0.08], [-r * 0.45, y + r * 0.28, z + 0.08], 0.16);
  b.beam([0, y, z + 0.1], [r * 0.62, y + r * 0.48, z + 0.1], 0.1);
}

function trainShed(b: ModelBuilder, cx: number, r: number, rise: number, roof: number): void {
  const seg = 16, y0 = 10.8;
  const at = (u: number, z: number, lift = 0): V3 => [cx - Math.cos(u * Math.PI) * r, y0 + Math.sin(u * Math.PI) * rise + lift, z];
  /** point `d` m off the vault glass along its outward normal (a y lift alone runs along the glass at the feet) */
  const off = (u: number, z: number, d: number): V3 => {
    const nx = -Math.cos(u * Math.PI) * rise, ny = Math.sin(u * Math.PI) * r, l = Math.hypot(nx, ny);
    const p = at(u, z);
    return [p[0] + (nx / l) * d, p[1] + (ny / l) * d, z];
  };
  // Pavilion glass carries a quiet warm concourse glow at night, including the roof.
  b.paint(0x829e9d, Surf.GlassPlain, 2);
  surface(b, (u, v) => at(u, -22 + v * 19), seg, 1, [cx, 5, -12]);
  const end: P2[] = Array.from({ length: seg + 1 }, (_, i) => [at(i / seg, -22)[0], at(i / seg, -22)[1]]);
  polyZ(b, end, -22, -1);
  polyZ(b, end, -3, 1);
  b.paint(roof, Surf.Metal, 3);
  for (const z of [-22, -17.25, -12.5, -7.75, -3]) {
    for (let i = 0; i < seg; i++) b.beam(at(i / seg, z, 0.12), at((i + 1) / seg, z, 0.12), 0.22);
    for (const s of [-1, 1]) b.box(cx + s * r - 0.18, 0.6, z - 0.18, cx + s * r + 0.18, y0, z + 0.18);
  }
  for (const u of [0, 0.25, 0.5, 0.75, 1]) b.beam(at(u, -22, 0.12), at(u, -3, 0.12), 0.2);
  // Solid lower roof strips give each vault a legible edge in the oblique city view.
  for (const lo of [0, 0.875]) {
    b.paint(roof, Surf.Metal, 3);
    surface(b, (u, v) => off(lo + u * 0.125, -22 + v * 19, 0.05), 2, 1, [cx, 5, -12]);
  }
}

function grandCentral(b: ModelBuilder, v: number, rng: RNG): void {
  const stone = v === 0 ? 0xd2c5ac : 0xbebbb1, trim = v === 0 ? 0xe4d7bc : 0xdedbd0;
  const roof = v === 0 ? 0x4e655c : 0x546e7a, pave = 0xc3bdae;
  const lit = P(stone, Surf.Stone, 1, 28), edge = P(trim, Surf.Stone, 1, 28);
  b.paint(pave, Surf.Pavement).slab(-32, -24, 32, 24, 0.1);
  b.paint(0x706d65, Surf.Pavement).slab(-24.5, -24, 24.5, -3, 0.06, 0.1);
  const tracks = v === 0 ? [-16, 0, 16] : [-18, -6, 6, 18];
  const platforms = v === 0 ? [-8, 8] : [-12, 0, 12];
  for (const x of tracks) {
    b.paint(0x544c41, Surf.Wood);
    for (let z = -23.2; z < -3.6; z += 1.4) b.box(x - 1.3, 0.16, z - 0.12, x + 1.3, 0.28, z + 0.12);
    b.paint(0x979b9c, Surf.Metal);
    for (const dx of [-0.72, 0.72]) b.box(x + dx - 0.06, 0.28, -24, x + dx + 0.06, 0.4, -3.2);
  }
  for (const x of platforms) {
    b.paint(0xb9b7ad, Surf.Pavement).box(x - 2.2, 0.16, -23.4, x + 2.2, 0.85, -3);
    b.paint(0xd2b75a, Surf.Plain);
    rect(b, x - 2.1, -23.2, x - 1.85, -3.1, 0.87);
    rect(b, x + 1.85, -23.2, x + 2.1, -3.1, 0.87);
    b.paint(0x384f59, Surf.Metal).box(x - 0.9, 3.8, -19, x + 0.9, 4.5, -18.8);
    b.box(x - 0.05, 0.85, -18.95, x + 0.05, 3.8, -18.85);
  }
  if (v === 0) trainShed(b, 0, 23.5, 9, roof);
  else for (const x of [-11.75, 11.75]) trainShed(b, x, 11.75, 12, roof);
  // One waiting train visible through the open rear portals.
  const tx = tracks[0];
  b.paint(0x333a3a, Surf.Metal);
  for (const z of [-18.5, -8.3]) b.box(tx - 1.1, 0.32, z - 0.9, tx + 1.1, 0.75, z + 0.9);
  b.paint(0xa8b0b1, Surf.Metal).box(tx - 1.35, 0.65, -20.8, tx + 1.35, 3.5, -6);
  b.paint(0x35566d, Surf.Metal).box(tx - 1.4, 1.3, -20.84, tx + 1.4, 1.75, -5.96);
  b.paint(0x253740, Surf.GlassPlain, 1).box(tx - 1.37, 2, -20.84, tx + 1.37, 3.05, -5.96, { top: null });
  b.paint(0xcbd0cd, Surf.Metal);
  for (let z = -20; z < -6; z += 2) b.box(tx - 1.4, 1.75, z - 0.08, tx + 1.4, 3.45, z + 0.08);
  // Main concourse and taller corner pavilions; front arches face the street (+Z).
  b.paint(lit).box(-28.8, 0.1, -3.2, 28.8, 1.2, 13.6);
  b.box(-22.4, 1.2, -3.2, 22.4, 20.8, 12.8, { top: P(roof, Surf.RoofFlat) });
  b.paint(edge).box(-22.8, 20.8, -3.6, 22.8, 21.8, 13.2);
  for (const s of [-1, 1]) {
    b.paint(stone, Surf.WallWindows, 7, 4.4).box(s * 22.4, 4.4, -3.2, s * 28.8, 22, 12.8, { top: null });
    b.paint(lit).box(s * 22.4, 1.2, -3.2, s * 28.8, 4.4, 12.8);
    b.paint(edge).box(s * 25.6 - 3.6, 22, -3.6, s * 25.6 + 3.6, 22.8, 13.2);
    b.paint(roof, Surf.Metal, 3).hipRoof(s * 25.6, 4.8, 7.2, 16.8, 22.8, v === 0 ? 3.5 : 5, 0.15);
  }
  for (const x of [-14.4, 0, 14.4]) {
    const arch = roundArch(x, 9.2, 11.7, 12, 1.2);
    openingZ(b, arch, 12.8, 1, 0x58757b, Surf.GlassPlain, 2);
    archFrameZ(b, arch, 12.8, 1, 0.7, 0.5, edge);
    b.paint(0x786d50, Surf.Metal);
    for (const dx of [-2.3, 0, 2.3]) b.box(x + dx - 0.09, 1.2, 12.85, x + dx + 0.09, 15.6, 13.05);
    for (const y of [5.2, 9.2]) b.box(x - 4.5, y, 12.85, x + 4.5, y + 0.18, 13.05);
    b.paint(roof, Surf.Metal, 3).box(x - 5, 5, 13.1, x + 5, 5.35, 15.2);
  }
  for (const x of [-21, -7.2, 7.2, 21]) {
    b.paint(edge).box(x - 0.85, 1.2, 12.8, x + 0.85, 17.8, 13.7);
    b.box(x - 1.1, 17.8, 12.6, x + 1.1, 18.5, 14);
  }
  for (let i = 0; i < 4; i++) b.paint(trim, Surf.Stone).box(-22.8, 0.1, 13.6 + i * 0.6, 22.8, 1.2 - i * 0.26, 14.2 + i * 0.6, { nz: null });
  // A broad clock pediment or a four-faced clock tower changes the skyline.
  if (v === 0) {
    b.paint(trim, Surf.Stone).gableRoof(0, 8.2, 22, 9.6, 21.8, 6.4, 'z', 0.15, edge);
    stationClock(b, 24.7, 13.18, 2.1);
    b.paint(0x69816c, Surf.Metal, 3).box(-0.6, 28.2, 7.6, 0.6, 30.8, 8.8);
    for (const s of [-1, 1]) {
      b.quad2([0, 29.4, 8.2], [s * 4.3, 31.3, 8.2], [s * 2.9, 29.3, 8.2], [0, 28.8, 8.2]);
    }
  } else {
    b.paint(edge).box(-4.8, 21.8, 3.2, 4.8, 35.2, 12.8);
    for (let k = 0; k < 4; k++) {
      b.push().translate(0, 0, 8).rotateY(k * Math.PI / 2);
      stationClock(b, 30.5, 4.84, 2.7);
      b.pop();
    }
    b.paint(trim, Surf.Stone).box(-5.2, 35.2, 2.8, 5.2, 36, 13.2);
    b.paint(roof, Surf.Metal, 3).pyramid(0, 8, 10.4, 10.4, 36, 4.8);
    b.paint(0xb69c61, Surf.Metal).cylinder(0, 8, 40.8, 1.2, 0.12, 0.04, 6);
  }
  // Bus shelter, subway stair enclosure and a parking portal make the interchange readable.
  b.paint(0x829b9f, Surf.GlassPlain, 2).box(-28.5, 0.1, 17.5, -18.5, 3.2, 19.7, { pz: null, top: null });
  b.paint(roof, Surf.Metal).box(-28.8, 3.2, 17.2, -18.2, 3.5, 20);
  for (const x of [-28.4, -23.5, -18.6]) b.box(x - 0.08, 0.1, 17.6, x + 0.08, 3.2, 17.76);
  parkBench(b, -23.5, 18.7);
  b.paint(0x2b3538, Surf.Plain).slab(24, 17, 28, 21.8, 0.12);
  for (let i = 0; i < 6; i++) {
    b.paint(0x888a85, Surf.Stone).box(24.2, 0.12, 21.1 - i * 0.6, 27.8, 0.18 + i * 0.08, 21.5 - i * 0.6);
  }
  b.paint(0x53695e, Surf.Metal);
  for (const x of [23.9, 28.1]) b.box(x - 0.09, 0.1, 16.8, x + 0.09, 1.3, 22);
  b.box(23.8, 3.4, 16.8, 28.2, 4.4, 17.1);
  for (const x of [24, 28]) b.box(x - 0.07, 0.1, 16.9, x + 0.07, 3.4, 17.05);
  b.paint(0xc5d8b1, Surf.Emissive, 10);
  for (const s of [-1, 1]) {
    b.beam([26 + s * 0.7, 3.6, 17.15], [26 + s * 0.7, 4.2, 17.15], 0.1);
    b.beam([26 + s * 0.7, 4.2, 17.15], [26, 3.7, 17.15], 0.1);
  }
  b.paint(0x606a69, Surf.Stone).box(25.2, 0.1, -19.5, 30.2, 4.8, -8.5);
  b.paint(0x273a43, Surf.GlassPlain, 2).box(25.6, 0.1, -8.48, 29.8, 3.8, -8.4, { top: null });
  b.paint(0x4f7288, Surf.Metal).box(26.3, 4.8, -8.6, 29.1, 6.3, -8.3);
  b.paint(0xe4e1cc, Surf.Emissive, 10);
  b.box(27, 5, -8.28, 27.2, 6.1, -8.22).box(27.2, 5.9, -8.28, 28.2, 6.1, -8.22);
  b.box(28, 5.5, -8.28, 28.2, 5.9, -8.22).box(27.2, 5.4, -8.28, 28.2, 5.6, -8.22);
  for (const x of [-14, 14]) lamp(b, x, 21, 4.5, 0, [{ color: pave, y: 0.1, clip: [rectPoly(-17, 16.1, 21.5, 24)] }]);
  for (const [x, z] of [[-10, 18], [-3, 20], [4, 17.5], [9, 22], [20, 19.5], [-30, 18]] as P2[]) person(b, rng, x, z, 0.1, rng.range(0, TAU));
}

export const models: ModelBuilders = lotModels({ lm_grand_central: grandCentral });
