/** Completion plaques and optional gardens for the twelve city honours (LG-20). */
import type { ModelBuilder } from '../ModelBuilder';
import type { ModelBuilders } from '../registry';
import { Surf } from '../../core/types';

function bench(b: ModelBuilder, x: number, z: number): void {
  b.paint(0x6a5140).boxC(x, z, 3.6, 0.9, 0.7, 0.2);
  b.boxC(x, z - 0.35, 3.6, 0.14, 0.9, 0.65);
  b.paint(0x454b49, Surf.Metal);
  for (const dx of [-1.35, 1.35]) b.boxC(x + dx, z, 0.16, 0.7, 0.12, 0.6);
}

function planter(b: ModelBuilder, x: number, z: number): void {
  b.paint(0xb5b4a6, Surf.Pavement).boxC(x, z, 4.2, 4.2, 0.1, 0.55);
  b.paint(0x486d38, Surf.Foliage).boxC(x, z, 3.7, 3.7, 0.65, 0.6);
}

export const models: ModelBuilders = {
  rw_honour_completion_plaque: (b) => {
    b.paint(0xc6c2b4, Surf.Pavement).slab(-7, -7, 7, 7, 0.08);
    b.paint(0x526f42, Surf.Foliage);
    b.slab(-6.5, -6.5, -3, 6.5, 0.12);
    b.slab(3, -6.5, 6.5, 6.5, 0.12);
    b.paint(0x616a69).boxC(0, -1, 4.4, 2.2, 0.08, 0.42);
    b.boxC(0, -1, 3.5, 1.5, 0.5, 1.5);
    b.paint(0xb39957, Surf.Metal).boxC(0, -0.22, 3.1, 0.08, 0.85, 0.95);
    b.paint(0x6e603d).boxC(0, -0.17, 2.7, 0.03, 0.98, 0.7);
    b.push().translate(0, 1.4, -0.13).rotateX(Math.PI / 2);
    b.paint(0xdac381, Surf.Metal).cylinder(0, 0, 0, 0.04, 0.24, 0.24, 8);
    b.pop();
    b.paint(0xdac381, Surf.Metal);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const x = side * (0.5 + i * 0.15), y = 1.23 + i * 0.14;
        b.quad2([x, y, -0.12], [x + side * 0.2, y + 0.02, -0.12], [x + side * 0.12, y + 0.18, -0.12], [x, y + 0.12, -0.12]);
      }
    }
  },
  rw_eco_plaza: (b) => {
    b.paint(0xbab8a7, Surf.Pavement).slab(-15, -15, 15, 15, 0.1);
    b.paint(0xd8d2bd, Surf.Pavement).slab(-3, -15, 3, 15, 0.12);
    b.slab(-15, -3, 15, 3, 0.12);
    for (const x of [-9, 9]) for (const z of [-8, 8]) planter(b, x, z);
    b.paint(0x6a5140).cylinder(0, -3, 0.1, 2.6, 0.38, 0.26, 6);
    b.paint(0x729957, Surf.Foliage).blob(0, 4.3, -3, 2.6, 1.7, 2.6);
    b.paint(0x2c6758, Surf.Metal).ring(0, 3.5, 0, 2.1, 0.18, 16, 'xy');
    b.paint(0x9aab78, Surf.Metal).beam([-1.5, 2, 0], [1.5, 5, 0], 0.2);
    b.paint(0x5c7654).boxC(0, 0, 4.6, 2.2, 0.12, 0.6);
    bench(b, -7, 3.7);
    bench(b, 7, 3.7);
    b.paint(0x6c7773, Surf.Metal);
    for (const x of [-4.6, 4.6]) b.boxC(x, -11, 0.18, 0.18, 0.1, 2.5);
    b.paint(0x334b60, Surf.Metal).boxC(0, -11, 10.8, 3.2, 2.6, 0.12);
    b.paint(0xa7bbc1, Surf.Metal);
    for (const x of [-3.5, 0, 3.5]) b.boxC(x, -11, 0.04, 3.2, 2.72, 0.02);
  },
  rw_firefighters_memorial: (b) => {
    b.paint(0xb9b5ac, Surf.Pavement).slab(-15, -15, 15, 15, 0.1);
    b.paint(0x696e6d).boxC(0, -2, 13, 10, 0.1, 0.3);
    b.paint(0x92958c).boxC(0, -2, 10, 7, 0.4, 0.3);
    b.paint(0x354343).boxC(0, -2, 3.4, 2.4, 0.7, 5.1);
    b.paint(0x9d8450, Surf.Metal).boxC(0, -0.77, 2.6, 0.05, 1.4, 1.2);
    b.paint(0x8a643b, Surf.Metal);
    b.beam([-0.8, 5.7, -2], [0.5, 7, -2], 0.7);
    b.beam([0.5, 7, -2], [0.15, 8, -2], 0.45);
    b.beam([0.15, 5.7, -2], [-0.6, 6.8, -2], 0.42);
    b.paint(0x8d483d).boxC(-4.3, -2, 0.6, 2.2, 0.7, 2.8);
    b.boxC(4.3, -2, 0.6, 2.2, 0.7, 2.8);
    b.paint(0x617c86, Surf.Water).slab(-6.5, 5.5, 6.5, 7.5, 0.12);
    for (const x of [-11, 11]) {
      planter(b, x, -9);
      bench(b, x, 2);
    }
  },
};
