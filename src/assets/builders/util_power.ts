/**
 * Utility / POWER models: coal, gas, oil, nuclear plants, wind turbine, solar farm, hydro station, power pylon.
 */
import type { ModelBuilders } from '../registry';
import type { ModelBuilder, ColorLike } from '../ModelBuilder';
import { Surf } from '../../core/types';
import type { RNG } from '../../core/rng';
import {
  type V3, flat, ground, wallQuad, wallRow, tube, disc, cone, dome, lathe, hCyl, strut, lattice, pipeRun, conveyor,
  orientedBox, tank, sphereTank, smokestack, carLow, fenceRect, floodLight, roofUnit, officeBlock, heap, solarRow,
  emitSteam, parking, CAR_COLORS2, lights,
  lightDot, pool, poolRect, poolRing, securityLights, Y_OVER, Y_POOL, Y_MARK, RESET_PAINT,
} from './ind_kit';

const CONCRETE = 0xa39e94;
const GRAVEL = 0x9c958a;

// ------------------------------------------------------------------------------------------------ shared electrical bits
/** Power transformer: tank + radiator fins + 3 bushings (~46 tris). */
function transformer(b: ModelBuilder, x: number, z: number, s = 1, rotX = false): void {
  const w = (rotX ? 2.4 : 3.6) * s, d = (rotX ? 3.6 : 2.4) * s;
  b.paint(0x9a9c8a, Surf.Pavement).boxC(x, z, w + 1.6, d + 1.6, 0, 0.3);
  b.paint(0x6f7a6c, Surf.Metal).boxC(x, z, w, d, 0.3, 3.0 * s);
  b.paint(0x5f6a5c, Surf.Metal).boxC(x, z + (rotX ? 0 : d / 2 + 0.35 * s), rotX ? w + 0.7 * s : w * 0.9, rotX ? d * 0.9 : 0.7 * s, 0.6, 2.4 * s);
  b.paint(0xb8651d, Surf.Plain);
  for (let i = -1; i <= 1; i++) {
    const bx = rotX ? x : x + i * w * 0.3, bz = rotX ? z + i * d * 0.3 : z;
    strut(b, [bx, 3.3 * s, bz], [bx, 4.8 * s, bz], 0.22 * s);
  }
}

/** Switchyard gantry: two lattice posts + lattice beam along X (~130 tris). */
function gantry(b: ModelBuilder, x0: number, x1: number, z: number, h: number, color: ColorLike = 0x9aa0a6): void {
  b.paint(color, Surf.Metal);
  for (const x of [x0, x1]) lattice(b, x, z, 0, h, 0.7, 0.45, 0.7, 0.45, 1, 0.14, { rings: false });
  lattice(b, (x0 + x1) / 2, z, h - 1.0, h, (x1 - x0) / 2, (x1 - x0) / 2, 0.45, 0.45, 1, 0.12, { rings: false, faces: ['pz', 'nz'] });
  b.paint(0x5a5550, Surf.Plain);
  const n = 3;
  for (let i = 0; i < n; i++) {
    const x = x0 + ((x1 - x0) * (i + 0.5)) / n;
    strut(b, [x, h - 1.0, z], [x, h - 2.4, z], 0.18);
  }
}

/** Gravel switchyard with transformers and gantries. */
function switchyard(b: ModelBuilder, x0: number, z0: number, x1: number, z1: number, nT: number, nG: number): void {
  b.paint(GRAVEL, Surf.Pavement);
  flat(b, x0, z0, x1, z1, 0.07);
  for (let i = 0; i < nT; i++) transformer(b, x0 + ((x1 - x0) * (i + 0.5)) / nT, z0 + 3.2);
  for (let i = 0; i < nG; i++) gantry(b, x0 + 1, x1 - 1, z0 + 8 + i * ((z1 - z0 - 9) / Math.max(1, nG - 1 || 1)), 12);
  fenceRect(b, x0, z0, x1, z1, 2.2, 0x8a9096, undefined, 8, 1);
}

// ------------------------------------------------------------------------------------------------ util_coal_plant
function coalPlant(b: ModelBuilder, rng: RNG): void {
  const H = 32;
  ground(b, -H, -H, H, H, CONCRETE, Surf.Pavement, 0.05);
  b.paint(0x3e3b38, Surf.Pavement);
  flat(b, 5, 2, 31.5, 31.5, 0.06);
  // turbine hall
  b.paint(0xc5c9cc, Surf.Corrugated).box(-30, 0, -20, -6, 22, -4);
  b.paint(0x8e9296, Surf.Metal).gableRoof(-18, -12, 24, 16, 22, 1.6, 'x', 0.3, { color: 0xc5c9cc, surf: Surf.Corrugated });
  b.paint(0x9fb4c0, Surf.GlassPlain);
  wallQuad(b, 'pz', -4, -29, -7, 15, 20);
  wallRow(b, 'nx', -30, -19, -5, 4, 12, 3, 3);
  b.paint(0x2e6fb5, Surf.Plain);
  wallQuad(b, 'pz', -4, -30, -6, 12.6, 13.6);
  // boiler house (tall)
  b.paint(0x8a96a2, Surf.Corrugated).box(-6, 0, -22, 12, 46, -2, { top: { color: 0x6a6e72, surf: Surf.RoofFlat } });
  b.paint(0x6f7b87, Surf.Corrugated);
  wallQuad(b, 'pz', -2, -6, 12, 0, 8);
  b.paint(0x9fb4c0, Surf.GlassPlain);
  for (const y of [14, 26, 38]) wallQuad(b, 'pz', -2, -5, 11, y, y + 2.2);
  for (const y of [14, 26, 38]) wallQuad(b, 'px', 12, -21, -3, y, y + 2.2);
  roofUnit(b, 0, 46, -12, 4, 5, 2.4, 0x9aa0a6);
  lights(b, [[12.4, 10, -2.4], [12.4, 22, -2.4], [12.4, 34, -2.4], [-6.4, 22, -2.4], [-6.4, 34, -2.4], [12.4, 46.4, -21.6], [-6.4, 46.4, -2.4], [23.9, 26.4, -8.2], [-30.3, 22.4, -3.7]]);
  // precipitator on columns + hoppers
  b.paint(0x6a6e72, Surf.Metal);
  for (const [px, pz] of [[14, -19], [23, -19], [14, -9], [23, -9]] as [number, number][]) strut(b, [px, 0, pz], [px, 10, pz], 0.8);
  b.paint(0xb8bcc0, Surf.Corrugated).box(13.5, 10, -19.5, 23.5, 26, -8.5);
  b.paint(0x8e9296, Surf.Metal);
  for (const [hx, hz] of [[16, -16.5], [21, -16.5], [16, -11.5], [21, -11.5]] as [number, number][]) {
    b.tri([hx - 2.2, 10, hz + 2.2], [hx + 2.2, 10, hz + 2.2], [hx, 6.5, hz]);
    b.tri([hx + 2.2, 10, hz + 2.2], [hx + 2.2, 10, hz - 2.2], [hx, 6.5, hz]);
  }
  // ducts: boiler -> precipitator -> stacks
  b.paint(0x7f8388, Surf.Metal);
  b.box(12, 22, -17, 13.5, 26, -11);
  orientedBox(b, [18.5, 14, -19.5], [18.5, 12, -25], 4, 3.5);
  b.box(15, 12, -27.5, 27, 15.5, -24.5);
  smokestack(b, 16, -27.5, 92, 3.2, 2.3, 'redwhite', 14);
  smokestack(b, 26.5, -27.5, 86, 3.0, 2.2, 'concrete', 14);
  // coal piles + stacker-reclaimer on rails
  heap(b, rng, 12, 17, 8.5, 8.5, 0x252321, Surf.Plain, 10, 1.1, 1.2);
  heap(b, rng, 24.6, 8.5, 5.4, 6.0, 0x2a2826, Surf.Plain, 9, 0.75, 1.1);
  heap(b, rng, 24.6, 25, 5.0, 5.2, 0x2a2826, Surf.Plain, 9, 0.75, 1.1);
  b.paint(0x55595e, Surf.Metal);
  strut(b, [19.5, 0.15, 3], [19.5, 0.15, 31], 0.3);
  strut(b, [21.5, 0.15, 3], [21.5, 0.15, 31], 0.3);
  b.paint(0xe6a817, Surf.Metal).box(18.8, 0.3, 14, 22.2, 4.5, 20);
  b.paint(0xe6a817, Surf.Metal).box(19.5, 4.5, 15.5, 21.5, 9, 18.5);
  strut(b, [20.5, 9, 17], [20.5, 13, 17], 0.4);
  orientedBox(b, [20.5, 7, 17], [10, 9.5, 12], 1.2, 1.2);
  strut(b, [20.5, 13, 17], [10.5, 10.5, 12.2], 0.12);
  strut(b, [20.5, 13, 17], [28, 5, 20], 0.12);
  b.paint(0x2a2d30, Surf.Metal);
  b.push().translate(9.6, 9.8, 11.8).rotateY(Math.atan2(-10.5, -5)).rotateX(Math.PI / 2);
  b.cylinder(0, 0, -0.5, 1.0, 2.2, 2.2, 8, { top: true, bottom: true });
  b.pop();
  // crusher house + conveyors to the boiler top
  b.paint(0x8a96a2, Surf.Corrugated).box(3, 0, 1, 9, 11, 7);
  conveyor(b, [6, 11, 3], [3, 40, -3.5], 2.6, 0x9aa0a6, 0x55595e, 3);
  conveyor(b, [21, 0.5, 5], [9, 7, 4], 2.2, 0x9aa0a6, 0x55595e, 1);
  // rail siding with coal hoppers
  b.paint(0x5a5550, Surf.Metal);
  flat(b, 28.8, -6, 31.2, 31.5, 0.09);
  for (let i = 0; i < 3; i++) {
    const z = -6 + i * 12.4;
    b.paint(0x4a3a2e, Surf.Metal).box(28.6, 0.9, z, 31.4, 3.6, z + 11.5, { top: { color: 0x242322, surf: Surf.Plain } });
    b.paint(0x1c1c1c, Surf.Metal).box(28.9, 0.1, z + 0.5, 31.1, 0.9, z + 11, { top: null });
  }
  // ash silo + water tank + admin
  tank(b, -2, 5, 3.6, 18, 0xc5c1b8, { roof: 'cone', seg: 12, stair: false, surf: Surf.Plain });
  b.paint(0x8e8b84, Surf.Metal);
  lattice(b, -2, 5, 0, 3, 3, 3, 3, 3, 1, 0.3, { rings: false, diag: false });
  tank(b, -12, 2, 5, 8, 0xe8e8e2, { roof: 'cone', seg: 14, rim: 0x9aa0a6 });
  switchyard(b, -31, 8, -8, 24, 3, 2);
  officeBlock(b, -30, 25, -14, 29.5, 8, 0xdedad2, 2, 3.6);
  for (let i = 0; i < 4; i++) carLow(b, -11 + i * 2.8, 28.5, 0, rng.pick(CAR_COLORS2));
  floodLight(b, 4, 30, 14);
  floodLight(b, 31, -30, 14);
}

// ------------------------------------------------------------------------------------------------ util_gas_plant
function gasPlant(b: ModelBuilder, rng: RNG): void {
  const H = 24;
  ground(b, -H, -H, H, H, CONCRETE, Surf.Pavement, 0.05);
  // gas turbine hall
  b.paint(0xeceeee, Surf.Corrugated).box(-22.5, 0, -15, -2, 17, 1);
  b.paint(0xa9adb0, Surf.Metal).gableRoof(-12.25, -7, 20.5, 16, 17, 1.4, 'x', 0.3, { color: 0xeceeee, surf: Surf.Corrugated });
  b.paint(0x1f5fa8, Surf.Plain);
  wallQuad(b, 'pz', 1, -22.5, -2, 12.5, 14);
  wallQuad(b, 'nx', -22.5, -15, 1, 12.5, 14);
  b.paint(0x9fb4c0, Surf.GlassPlain);
  wallRow(b, 'pz', 1, -22, -2.5, 4, 10, 4, 3);
  b.paint(0x55595e, Surf.Corrugated);
  wallQuad(b, 'pz', 1, -8, -3.5, 0, 6);
  // two HRSGs with stacks
  for (const hx of [5, 16]) {
    b.paint(0xb9bec2, Surf.Corrugated).box(hx - 4, 0, -18, hx + 4, 25, -3, { top: { color: 0x8e9296, surf: Surf.RoofFlat } });
    b.paint(0x8e9296, Surf.Metal).box(hx - 4.3, 25, -18.3, hx + 4.3, 26, -2.7, { bottom: null });
    b.paint(0x9aa0a6, Surf.Corrugated).box(hx - 2.5, 3, -3, hx + 2.5, 9, 1.5);
    strut(b, [hx, 0, 1], [hx, 3, 1], 0.6);
    smokestack(b, hx, -20.5, 46, 2.1, 1.9, 'white', 12);
    b.paint(0x8e9296, Surf.Metal);
    orientedBox(b, [hx, 20, -18], [hx, 20, -19.5], 3, 3.2);
    b.paint(0x55595e, Surf.Metal);
    for (const y of [15, 30]) tube(b, hx, -20.5, y, 0.4, 2.8, 2.8, 12);
  }
  lights(b, [[-2.3, 17.4, 1.3], [-22.8, 17.4, 1.3], [9.3, 25.4, -2.7], [20.3, 25.4, -2.7]], 0.45);
  // spherical gas tanks
  sphereTank(b, -16, 14, 5.4, 0xeef0f0, 0x6a6e72, 12, 7);
  sphereTank(b, -4, 16, 5.4, 0xeef0f0, 0x6a6e72, 12, 7);
  // gas pressure station + pipes
  b.paint(0xd9a324, Surf.Metal);
  pipeRun(b, [[-16, 1.2, 8], [-16, 1.2, 4.5], [-4, 1.2, 4.5], [-4, 1.2, 9.5]], 0.45, 6);
  pipeRun(b, [[-10, 1.2, 4.5], [-10, 1.2, 2], [-10, 4, 1.2]], 0.45, 6);
  b.paint(0xd8d8d2, Surf.Plain).box(-23, 0, 4, -19, 3.2, 8);
  // switchyard
  switchyard(b, 4, 5, 23, 22.5, 2, 1);
  floodLight(b, -23, 23, 12);
  fenceRect(b, -23.6, -23.6, 23.6, 23.6, 2.2, 0x8a9096, [-12, 3.5], 12, 1);
}

// ------------------------------------------------------------------------------------------------ util_oil_plant
function oilPlant(b: ModelBuilder, rng: RNG): void {
  const HX = 24, HZ = 32;
  ground(b, -HX, -HZ, HX, HZ, CONCRETE, Surf.Pavement, 0.05);
  // tank farm in a bund
  b.paint(0x9c978c, Surf.Pavement).box(-23, 0, -31, 23, 1.0, -11, { bottom: null });
  b.paint(0x8a857c, Surf.Pavement);
  flat(b, -22.5, -30.5, 22.5, -11.5, 0.6);
  tank(b, -15, -22, 6.3, 12, 0xe8e8e2, { y0: 0.6, roof: 'cone', rim: 0x9aa0a6, stair: true, seg: 14 });
  tank(b, 0, -22, 6.3, 12, 0xdedcd4, { y0: 0.6, roof: 'cone', rim: 0x9aa0a6, seg: 14 });
  tank(b, 15, -24, 5.4, 11, 0xe8e8e2, { y0: 0.6, roof: 'cone', rim: 0x9aa0a6, seg: 14 });
  tank(b, 18, -14.5, 2.6, 7, 0x4f5f4f, { y0: 0.6, roof: 'cone', seg: 10 });
  b.paint(0x55595e, Surf.Metal);
  pipeRun(b, [[-15, 1.6, -15.5], [-15, 1.6, -8], [-4, 1.6, -8], [-4, 8, -6]], 0.5, 6, true);
  pipeRun(b, [[0, 1.6, -15.5], [0, 1.6, -8]], 0.5, 6);
  // boiler building + turbine hall
  b.paint(0xc8b8a0, Surf.Plain).box(-22, 0, -6, 6, 32, 10, { top: { color: 0x7a7670, surf: Surf.RoofFlat } });
  b.paint(0x9fb4c0, Surf.GlassPlain);
  for (const y of [8, 17, 25]) { wallQuad(b, 'pz', 10, -21, 5, y, y + 2.4); wallQuad(b, 'px', 6, -5, 9, y, y + 2.4); }
  b.paint(0xb4a48c, Surf.Plain);
  for (let x = -18; x < 6; x += 6) wallQuad(b, 'pz', 10, x, x + 0.8, 0, 32, 0.05);
  b.paint(0x9c5a3a, Surf.Plain);
  wallQuad(b, 'pz', 10, -22, 6, 29, 31);
  wallQuad(b, 'px', 6, -6, 10, 29, 31);
  roofUnit(b, -10, 32, 2, 4, 4, 2.2, 0x9aa0a6);
  b.paint(0xd8ccb4, Surf.WallWindows, 7, 8).box(-22, 0, 10, 4, 16, 20);
  b.paint(0x7a4a36, Surf.Metal).gableRoof(-9, 15, 26, 10, 16, 1.6, 'x', 0.3, { color: 0xd8ccb4, surf: Surf.Plain });
  lights(b, [[6.3, 32.4, 10.3], [-22.3, 32.4, 10.3], [6.3, 16.4, 20.3], [-22.3, 16.4, 20.3]], 0.45);
  // stacks + ducts
  smokestack(b, 12, -5, 58, 2.8, 2.0, 'redwhite', 14);
  smokestack(b, 19.5, -3, 50, 2.4, 1.8, 'concrete', 12);
  b.paint(0x7f8388, Surf.Metal);
  b.box(6, 20, -3, 12, 24, 1);
  b.box(12, 12, -4.5, 19.5, 15, -1.5);
  // rail tank cars (fuel unloading) + pump house
  b.paint(0x5a5550, Surf.Metal);
  flat(b, 20.5, -8, 23, 31.5, 0.09);
  for (let i = 0; i < 3; i++) {
    const z = 2 + i * 9.5;
    b.paint(0x2b2d31, Surf.Metal);
    hCyl(b, 21.75, 2.6, z + 4, 8.4, 1.35, 'z', 8);
    b.paint(0x1c1c1c, Surf.Metal).box(20.8, 0.1, z, 22.7, 1.2, z + 8.5, { top: null });
  }
  b.paint(0xd8d8d2, Surf.Plain).box(14, 0, 3, 19, 4, 8);
  b.paint(0x55595e, Surf.Metal);
  pipeRun(b, [[20.4, 1.2, 6], [19, 1.2, 6]], 0.35, 6);
  // switchyard + admin + parking
  switchyard(b, 6, 11, 19.5, 27, 2, 1);
  officeBlock(b, -22.5, 21.5, -8, 29.5, 7, 0xdedad2, 2, 3.5);
  parking(b, rng, -7, 22.5, 4.5, 31, 0.6, 5);
  floodLight(b, -23, -9, 14);
  floodLight(b, 23, 31, 12);
  fenceRect(b, -23.6, -31.6, 23.6, 31.6, 2.2, 0x8a9096, [5, 20], 14, 1);
}

// ------------------------------------------------------------------------------------------------ util_nuclear_plant
/** Hyperboloid natural-draft cooling tower. Registers a steam emitter at the top. */
function coolingTower(b: ModelBuilder, x: number, z: number, H: number, R0: number, Rw: number, seg = 18): void {
  const yw = H * 0.78;
  const c = yw / Math.sqrt((R0 / Rw) ** 2 - 1);
  const r = (y: number) => Rw * Math.sqrt(1 + ((y - yw) / c) ** 2);
  const lip = 7; // air inlet height (shell starts here)
  const ys = [lip, 0.2 * H, 0.38 * H, 0.54 * H, 0.66 * H, yw, 0.88 * H, H];
  const prof: [number, number][] = ys.map((y) => [r(y), y]);
  b.paint(0xd6d3cc, Surf.Plain);
  lathe(b, x, z, prof, seg);
  // inside shell (visible through the top): darker, upper part only
  b.paint(0x77746e, Surf.Plain);
  lathe(b, x, z, prof.slice(5), seg, { outside: false, inside: true });
  // weathering band near the top + lip ring
  b.paint(0xb8b4ac, Surf.Plain);
  lathe(b, x, z, [[r(H - 3) + 0.05, H - 3], [r(H) + 0.05, H]], seg);
  // dark inlet interior + basin water
  b.paint(0x2a2c2e, Surf.Plain);
  lathe(b, x, z, [[r(lip) - 0.6, 0], [r(lip) - 0.8, lip + 0.1]], seg, { outside: false, inside: true });
  b.paint(0x33485a, Surf.Water);
  disc(b, x, z, 0.6, r(lip) - 0.5, seg);
  b.paint(0x9a978f, Surf.Plain);
  lathe(b, x, z, [[r(lip) + 1.2, 0.05], [r(lip) + 1.0, 0.9], [r(lip) - 0.5, 0.9]], seg);
  // diagonal support columns (V pairs)
  b.paint(0xc8c4bc, Surf.Plain);
  const nc = 14;
  const rb = r(lip) - 0.3;
  for (let i = 0; i < nc; i++) {
    const a = (i / nc) * Math.PI * 2, a2 = ((i + 0.5) / nc) * Math.PI * 2, a3 = ((i + 1) / nc) * Math.PI * 2;
    const g: V3 = [x + Math.cos(a2) * rb, 0.6, z + Math.sin(a2) * rb];
    strut(b, g, [x + Math.cos(a) * rb, lip + 0.2, z + Math.sin(a) * rb], 0.7);
    strut(b, g, [x + Math.cos(a3) * rb, lip + 0.2, z + Math.sin(a3) * rb], 0.7);
  }
  const rt = r(H) + 0.25;
  lights(b, [[x + rt, H - 0.8, z], [x - rt * 0.5, H - 0.8, z + rt * 0.87], [x - rt * 0.5, H - 0.8, z - rt * 0.87]], 0.5, 0xff2a1a);
  emitSteam([x, H + 2, z]);
}

function containment(b: ModelBuilder, x: number, z: number, r: number, h: number, color: ColorLike = 0xe4e2dc): void {
  b.paint(0xb8b5ad, Surf.Plain);
  lathe(b, x, z, [[r + 0.8, 0.05], [r + 0.8, 1.2], [r, 1.2]], 16);
  b.paint(color, Surf.Plain);
  tube(b, x, z, 1.2, h - 1.2, r, r, 16);
  b.paint(0xd8d6d0, Surf.Plain);
  dome(b, x, z, h, r, r * 0.62, 16, 3);
  b.paint(0x9aa0a6, Surf.Plain);
  tube(b, x, z, h - 3.2, 0.9, r + 0.1, r + 0.1, 16);
}

function nuclearPlant(b: ModelBuilder, rng: RNG): void {
  const H = 48;
  ground(b, -H, -H, H, H, 0x7d9a4a, Surf.Foliage, 0.04);
  b.paint(CONCRETE, Surf.Pavement);
  flat(b, -46.5, -46.5, 46.5, 30, 0.06);
  // cooling towers at the back
  coolingTower(b, -23.5, -24, 98, 21, 12.5);
  coolingTower(b, 23.5, -24, 98, 21, 12.5);
  // cooling water pipes to the towers
  b.paint(0x55595e, Surf.Metal);
  pipeRun(b, [[18, 1.8, 4], [18, 1.8, -2], [8, 1.8, -8]], 1.1, 6);
  pipeRun(b, [[12, 1.8, 4], [-8, 1.8, -6]], 1.1, 6);
  // reactors + auxiliary buildings
  containment(b, -27, 12, 10.5, 30);
  containment(b, -4, 12, 10.5, 30);
  b.paint(0xd2cec6, Surf.WallWindows, 4, 4.5).box(-41, 0, 19, 9, 15, 27, { top: { color: 0x8e8b84, surf: Surf.RoofFlat } });
  b.paint(0xd2cec6, Surf.Plain).box(-16.5, 0, 4, -14.5, 20, 20, { top: { color: 0x8e8b84, surf: Surf.RoofFlat } });
  b.paint(0x1f5fa8, Surf.Plain);
  wallQuad(b, 'pz', 27, -41, 9, 12.4, 13.4);
  // vent stack on lattice
  b.paint(0xe8e8e4, Surf.Plain);
  tube(b, -15.5, 1.5, 0, 66, 1.3, 1.1, 10);
  b.paint(0xc0392b, Surf.Plain);
  tube(b, -15.5, 1.5, 62, 4, 1.15, 1.1, 10);
  b.paint(0x9aa0a6, Surf.Metal);
  lattice(b, -15.5, 1.5, 0, 60, 3.2, 1.6, 3.2, 1.6, 4, 0.26, { rings: false });
  b.paint(0xff2a1a, Surf.Emissive).boxC(-14.2, 1.5, 0.4, 0.4, 65, 0.4);
  // turbine hall (two lines)
  b.paint(0xdfe1e2, Surf.Corrugated).box(10, 0, 3, 45, 26, 21);
  b.paint(0x9ea3a8, Surf.Metal).gableRoof(27.5, 12, 35, 18, 26, 1.8, 'x', 0.3, { color: 0xdfe1e2, surf: Surf.Corrugated });
  b.paint(0x1f5fa8, Surf.Plain);
  wallQuad(b, 'pz', 21, 10, 45, 20, 22);
  wallQuad(b, 'px', 45, 3, 21, 20, 22);
  b.paint(0x9fb4c0, Surf.GlassPlain);
  wallRow(b, 'pz', 21, 11, 44, 8, 17, 6, 4);
  b.paint(0x55595e, Surf.Corrugated);
  wallQuad(b, 'px', 45, 8, 16, 0, 9);
  for (let i = 0; i < 3; i++) roofUnit(b, 16 + i * 11, 26.9, 12, 3, 4, 1.6);
  lights(b, [[10.2, 24, 21.3], [27.5, 24, 21.3], [45.3, 24, 21.3], [45.3, 24, 3.2], [-27, 37, 12], [-4, 37, 12], [-41.3, 15.4, 27.3], [9.3, 15.4, 27.3]], 0.5);
  // connecting bridge reactors -> turbine hall
  b.paint(0xd2cec6, Surf.Plain).box(5, 6, 9, 10, 12, 15, { top: { color: 0x8e8b84, surf: Surf.RoofFlat } });
  // tanks (condensate / demin water)
  tank(b, 3.5, -4, 3.6, 12, 0xe8e8e2, { roof: 'dome', seg: 12 });
  // switchyard (front right)
  b.paint(GRAVEL, Surf.Pavement);
  flat(b, 12, 26, 46.5, 46.5, 0.07);
  for (let i = 0; i < 3; i++) transformer(b, 17 + i * 6.5, 28.5, 1.1);
  gantry(b, 14, 45, 39, 14);
  fenceRect(b, 12, 26, 46.5, 46.5, 2.2, 0x8a9096, undefined, 10, 1);
  // admin, visitor center, parking, security
  officeBlock(b, -46, 32, -26, 40, 11, 0xe6e4de, 2, 3.7);
  b.paint(0x2a3440, Surf.GlassCurtain, 5, 3.6).box(-24, 0, 36, -14, 6, 44, { top: { color: 0xd8d8d4, surf: Surf.Plain } });
  parking(b, rng, -12, 32, 4, 46.5, 0.55, 7);
  b.paint(0x6f9a45, Surf.Foliage);
  flat(b, -46, 41, -26, 46.5, 0.07);
  b.paint(0xe6e8e8, Surf.Plain).box(6, 0, 31, 10, 3.2, 35);
  b.paint(0x2a3440, Surf.GlassPlain);
  wallRow(b, 'pz', 35, 6.3, 9.7, 1.2, 2.6, 2, 1.4);
  fenceRect(b, -46.8, -46.8, 46.8, 30.5, 3.0, 0x8a9096, [4, 12], 24, 1, true);
  for (const [lx, lz] of [[-46, 29], [46, 29], [0, -46]] as [number, number][]) floodLight(b, lx, lz, 14);
}

// ------------------------------------------------------------------------------------------------ util_wind_turbine
/** Tapered, twisted blade from the hub along local +Y in rotor space (18 tris). Chord along X, thickness along Z. */
function blade(b: ModelBuilder, L: number, rootR: number, cRoot: number, cMax: number, cTip: number): void {
  const q = (y: number, c: number, t: number, tw: number): V3[] => {
    const cs = Math.cos(tw), sn = Math.sin(tw);
    const lead = -c * 0.3, trail = c * 0.7;
    return [[lead * cs, y, lead * sn - t / 2], [trail * cs, y, trail * sn - t / 2], [trail * cs, y, trail * sn + t / 2], [lead * cs, y, lead * sn + t / 2]];
  };
  const A = q(rootR, cRoot, cRoot * 0.45, 0.0), M = q(rootR + L * 0.22, cMax, cMax * 0.28, 0.14), B = q(rootR + L, cTip, 0.12, 0.32);
  for (const [P, Q] of [[A, M], [M, B]] as [V3[], V3[]][]) {
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      b.quad(P[k], P[k2], Q[k2], Q[k]);
    }
  }
  b.quad(B[3], B[2], B[1], B[0]);
}

function windTurbine(b: ModelBuilder): void {
  ground(b, -8, -8, 8, 8, 0x7d9a4a, Surf.Foliage, 0.04);
  b.paint(GRAVEL, Surf.Pavement);
  flat(b, -5.5, -5.5, 5.5, 5.5, Y_OVER);
  flat(b, -1.6, 5.5, 1.6, 8, Y_OVER);
  // rotor axis faces the front-right diagonal (prevailing wind); the rotor may overhang neighbouring cells
  const yaw = Math.PI / 4;
  const hubH = 58;
  // foundation plinth + tapered tower with a green base band
  b.paint(0xb8b5ad, Surf.Plain);
  lathe(b, 0, 0, [[3.4, 0.05], [3.4, 0.8], [2.2, 0.8]], 14);
  b.paint(0x5a8a6a, Surf.Plain);
  tube(b, 0, 0, 0.8, 3, 2.1, 2.06, 14);
  b.paint(0xf2f2ef, Surf.Plain);
  lathe(b, 0, 0, [[2.06, 3.8], [1.62, hubH * 0.5], [1.2, hubH - 1.6]], 14);
  // door + small transformer kiosk
  b.paint(0x8a9096, Surf.Metal);
  wallQuad(b, 'pz', 2.02, -0.5, 0.5, 0.8, 3.0, 0.05);
  b.paint(0xd8dadc, Surf.Plain).box(3.6, 0, 2.8, 5.4, 2.3, 4.4);
  lightDot(b, 0, 3.4, 2.4, 0.2, 0xe8f0ff);
  // nacelle (3.2 x 3.4 x 9 m), spinner (r 1.4, L 2.6) and blades in rotor space
  b.push().translate(0, hubH, 0).rotateY(yaw);
  b.paint(0xf2f2ef, Surf.Plain).box(-1.6, -1.6, -5.6, 1.6, 1.8, 3.4);
  b.paint(0xdcdcd8, Surf.Plain).box(-1.2, 1.8, -5.2, 1.2, 2.1, -3.0, { bottom: null });
  b.paint(0xe6e6e2, Surf.Plain);
  b.push().translate(0, 0, 3.4).rotateX(Math.PI / 2);
  lathe(b, 0, 0, [[1.4, 0], [1.25, 1.1], [0.7, 2.1], [0, 2.6]], 10);
  b.pop();
  b.paint(0xff2a1a, Surf.Emissive, 6).boxC(0, -4.8, 0.4, 0.4, 2.1, 0.4);
  b.paint(0xf6f6f3, Surf.Plain);
  for (let i = 0; i < 3; i++) {
    b.push().translate(0, 0, 4.4).rotateZ((i / 3) * Math.PI * 2);
    blade(b, 22, 1.1, 1.8, 2.3, 0.4);
    b.pop();
  }
  b.pop();
  b.paint(RESET_PAINT, Surf.Metal);
}

// ------------------------------------------------------------------------------------------------ util_solar_farm
function solarFarm(b: ModelBuilder, rng: RNG): void {
  const H = 32;
  ground(b, -H, -H, H, H, 0x8f9a6a, Surf.Foliage, 0.04);
  b.paint(0xa8a292, Surf.Pavement);
  flat(b, -31, -31, 31, 31, 0.05);
  // access roads
  b.paint(0xc2bba8, Surf.Pavement);
  flat(b, -2, -31, 2, 32, 0.07);
  flat(b, -31, 25, 31, 28.5, 0.07);
  const pitch = 7.2;
  for (let r = 0; r < 8; r++) {
    const z = -27.5 + r * pitch;
    for (const [cx, w] of [[-16.5, 28], [16.5, 28]] as [number, number][]) {
      solarRow(b, cx, z, w, 4.2, 0.44, 0.7, 0x1e2d4c, Surf.GlassCurtain, 3, true);
      b.paint(0xb8c4d4, Surf.Plain);
      // module seams (light lines across the panel, cheap)
      const dz = Math.cos(0.44) * 2.1, dy = Math.sin(0.44) * 2.1;
      const yc = 0.7 + dy + 0.03;
      b.quad([cx - w / 2, yc, z + 0.06], [cx + w / 2, yc, z + 0.06], [cx + w / 2, yc + 0.03, z - 0.06], [cx - w / 2, yc + 0.03, z - 0.06]);
      void dz;
    }
  }
  // inverter stations
  for (const [x, z] of [[0, -14], [0, 8]] as [number, number][]) {
    b.paint(0xe6e8e8, Surf.Corrugated).box(x - 1.3, 0, z - 3, x + 1.3, 2.9, z + 3);
    b.paint(0x6f7a6c, Surf.Metal).boxC(x, z + 4.4, 1.8, 1.4, 0, 2.0);
  }
  // substation at the front
  b.paint(GRAVEL, Surf.Pavement);
  flat(b, 8, 28.8, 30, 31.5, 0.08);
  transformer(b, 14, 30.2, 0.7, false);
  b.paint(0xd8d8d2, Surf.Plain).box(20, 0, 29, 26, 3.2, 31.3);
  fenceRect(b, -31.6, -31.6, 31.6, 31.6, 2.0, 0x8a9096, [-3, 3], 14, 1);
}

// ------------------------------------------------------------------------------------------------ util_hydro_dam
function hydroStation(b: ModelBuilder, rng: RNG): void {
  const HX = 24, HZ = 16;
  ground(b, -HX, -HZ, HX, HZ, CONCRETE, Surf.Pavement, 0.05);
  // gravity dam at the back (reservoir side = -Z): vertical upstream face, sloped downstream face, spillway chute
  const zU = -16, zC = -12, zT = -1.5, yC = 24, dx0 = -23.5, dx1 = 23.5;
  b.paint(0xb2ada3, Surf.Stone);
  b.quad([dx1, 0, zU], [dx0, 0, zU], [dx0, yC, zU], [dx1, yC, zU]);
  b.quad([dx0, yC, zC], [dx1, yC, zC], [dx1, yC, zU], [dx0, yC, zU]);
  b.paint(0xa8a398, Surf.Plain);
  b.quad([dx0, 0, zT], [dx1, 0, zT], [dx1, yC, zC], [dx0, yC, zC]);
  b.paint(0x9e998e, Surf.Stone);
  for (const [xx, sgn] of [[dx0, -1], [dx1, 1]] as [number, number][]) {
    const pts: V3[] = [[xx, 0, zU], [xx, 0, zT], [xx, yC, zC], [xx, yC, zU]];
    if (sgn > 0) { b.tri(pts[0], pts[2], pts[1]); b.tri(pts[0], pts[3], pts[2]); }
    else { b.tri(pts[0], pts[1], pts[2]); b.tri(pts[0], pts[2], pts[3]); }
  }
  // spillway chute with white water on the right part of the slope
  const sp0 = 9, sp1 = 19;
  b.paint(0xe8f0f2, Surf.Water);
  b.quad([sp0, 0.15, zT + 0.2], [sp1, 0.15, zT + 0.2], [sp1, yC + 0.05, zC - 0.1], [sp0, yC + 0.05, zC - 0.1]);
  b.paint(0x8e8a82, Surf.Plain);
  for (const xx of [sp0 - 0.6, sp1]) b.box(xx, yC - 0.2, zU, xx + 0.6, yC + 3.0, zC);
  // crest: gate piers, road railing, intake gantry crane, reservoir water edge
  b.paint(0x9e998e, Surf.Plain);
  for (let i = 0; i < 4; i++) b.box(sp0 + 0.4 + i * 2.5, yC, zU + 0.2, sp0 + 0.9 + i * 2.5, yC + 3.0, zC - 0.2, { bottom: null });
  b.paint(0x55595e, Surf.Metal);
  b.box(sp0, yC + 3.0, zU, sp1, yC + 3.5, zC, { bottom: null });
  strut(b, [dx0, yC + 1.0, zC + 0.1], [sp0 - 0.7, yC + 1.0, zC + 0.1], 0.1);
  b.paint(0x3f7ea6, Surf.Water);
  flat(b, dx0, -16, dx1, -15.4, yC - 1.0);
  b.paint(0xe6a817, Surf.Metal);
  for (const x of [-14, -4]) {
    strut(b, [x, yC, -15.3], [x, yC + 7, -15.3], 0.6);
    strut(b, [x, yC, -12.6], [x, yC + 7, -12.6], 0.6);
  }
  b.box(-14.5, yC + 7, -15.8, -3.5, yC + 8.2, -12.1);
  b.paint(0x55595e, Surf.Metal);
  for (const x of [-12, -6, 0]) b.boxC(x, -14, 3.2, 3.0, yC, 1.6);
  // penstocks laid on the downstream face, down into the powerhouse
  b.paint(0x4f6a5a, Surf.Metal);
  const slope = (yC - 0) / (zT - zC);
  for (const x of [-12, -6, 0]) {
    const zA = zC + 1.5, yA = yC - slope * 1.5 + 1.3;
    b.pipe([x, yA, zA], [x, 5.5, 0.3], 1.2, 10);
    b.paint(0x8e8a82, Surf.Plain).boxC(x, zC + 2, 3.2, 1.6, yC - slope * 2 - 0.6, 2.4);
    b.paint(0x4f6a5a, Surf.Metal);
  }
  // powerhouse with tall windows
  b.paint(0xd8d0bc, Surf.WallWindows, 7, 9).box(-17, 0, 0, 5, 17, 11, { top: { color: 0x7a7670, surf: Surf.RoofFlat } });
  b.paint(0x7a4a36, Surf.Plain).box(-17.2, 17, -0.2, 5.2, 18, 11.2, { bottom: null });
  roofUnit(b, -12, 17, 5, 3, 3, 1.4);
  b.paint(0x55595e, Surf.Corrugated);
  wallQuad(b, 'px', 5, 3, 8, 0, 6);
  // tailrace channel to the side (+X)
  b.paint(0x8e8b84, Surf.Pavement).box(-16, 0, 11, 23.5, 0.5, 15.5, { bottom: null });
  b.paint(0x3f7ea6, Surf.Water);
  flat(b, -15.5, 11.5, 23.5, 15, 0.45);
  b.paint(0xeef4f6, Surf.Water);
  flat(b, -15.5, 11.5, -10, 15, 0.47);
  // surge tank + transformers + outgoing line gantry
  tank(b, 12, -4, 3.2, 14, 0xa9a59c, { roof: 'dome', seg: 12, surf: Surf.Plain });
  transformer(b, 9, 5, 0.9, true);
  transformer(b, 15, 5, 0.9, true);
  gantry(b, 7, 21, 9, 11);
  b.paint(0xd8d8d2, Surf.Plain).box(17, 0, -8.5, 23.5, 4, -3);
  for (let i = 0; i < 2; i++) carLow(b, 19 + i * 2.8, -1, Math.PI * 0.5 * 0, rng.pick(CAR_COLORS2));
  floodLight(b, -22, 10, 10);
}

// ------------------------------------------------------------------------------------------------ util_power_pylon
/** Arm-tip (insulator bottom) positions in model space. Wires run along Z between consecutive pylons. */
export const PYLON_ARMS: [number, number][] = [[6.6, 14.2], [5.4, 18.6], [3.6, 22.4]]; // [half span x, insulator bottom y]

function powerPylon(b: ModelBuilder): void {
  b.paint(0x8a7a62, Surf.Pavement);
  flat(b, -3.8, -3.8, 3.8, 3.8, 0.05);
  const col = 0x9aa0a6;
  b.paint(0xa9a59c, Surf.Plain);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.boxC(sx * 2.7, sz * 2.7, 0.8, 0.8, 0, 0.5);
  b.paint(col, Surf.Metal);
  lattice(b, 0, 0, 0, 15.2, 2.7, 0.95, 2.7, 0.95, 3, 0.2, { rings: false });
  lattice(b, 0, 0, 15.2, 24.2, 0.95, 0.55, 0.95, 0.55, 2, 0.17, { rings: false });
  const ring = (y: number, hw: number) => {
    strut(b, [-hw, y, -hw], [hw, y, -hw], 0.14);
    strut(b, [-hw, y, hw], [hw, y, hw], 0.14);
  };
  // arms (triangular trusses along X), insulators hang from the tips
  const armY = [15.4, 19.8, 23.6];
  for (let k = 0; k < 3; k++) {
    const [span, yIns] = PYLON_ARMS[k];
    const y = armY[k];
    const f = (y - 15.2) / 9;
    const hw = y < 15.2 ? 0.95 : 0.95 + (0.55 - 0.95) * f;
    ring(y, hw);
    for (const s of [-1, 1]) {
      const tip: V3 = [s * span, y, 0];
      strut(b, [s * hw, y, -hw], tip, 0.16);
      strut(b, [s * hw, y, hw], tip, 0.16);
      strut(b, [s * hw, y + 1.4, 0], tip, 0.12);
      b.paint(0x3a3d40, Surf.Metal);
      strut(b, [s * span, y, 0], [s * span, yIns + 0.1, 0], 0.18);
      b.paint(0x6a5a4a, Surf.Plain).boxC(s * span, 0, 0.36, 0.36, yIns, 1.0);
      b.paint(col, Surf.Metal);
    }
  }
  // earth-wire peak
  strut(b, [-0.55, 24.2, 0], [0, 25.6, 0], 0.14);
  strut(b, [0.55, 24.2, 0], [0, 25.6, 0], 0.14);
}

export const pylonWireAttach: [number, number, number][] = PYLON_ARMS.flatMap(([s, y]) => [[-s, y, 0], [s, y, 0]] as [number, number, number][]);


export const powerModels: ModelBuilders = {
  util_coal_plant: (b, _v, rng) => coalPlant(b, rng),
  util_gas_plant: (b, _v, rng) => gasPlant(b, rng),
  util_oil_plant: (b, _v, rng) => oilPlant(b, rng),
  util_nuclear_plant: (b, _v, rng) => nuclearPlant(b, rng),
  util_wind_turbine: (b) => windTurbine(b),
  util_solar_farm: (b, _v, rng) => solarFarm(b, rng),
  util_hydro_dam: (b, _v, rng) => hydroStation(b, rng),
  util_power_pylon: (b) => powerPylon(b),
};
