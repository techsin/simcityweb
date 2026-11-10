// Frozen advisors.ts month scans (scanZones, scanOutages, scanRubble, lotFit, lotFitAny, lotFitAt) from a59f08f, the
// base of B3 A0; only import paths and names differ (zoneScanOriginal is advisorsSystem's zoneScan closure). Plus T037b's
// two counters in scanZones (FH-03 zonedFam, LG-05 free), applied at the merge exactly as that lane wrote them against
// this base, so the kernels are still compared field for field.
import { BF, type Building, type CityState } from '../../../src/sim/CityState';
import { DEV_TYPE_COUNT, DevType, Network, Zone, zoneDensity } from '../../../src/core/types';
import type { EconRuntime } from '../../../src/sim/economy/runtime';
import { ZONE_DEVTYPES, growablesForZone } from '../../../src/sim/catalog';
import type { BuildingDef } from '../../../src/sim/catalogTypes';
import { lotSlope } from '../../../src/sim/economy/buildings';
import { buildingPowered, buildingWatered } from '../../../src/sim/economy/population';
import { buildingList } from '../../../src/sim/infra/common';
import { GROW_MAX_SLOPE, GROW_MAX_SLOPE_PER_CELL, GROW_MIN_DESIR, WATER_REQUIRED_STAGE } from '../../../src/sim/economy/tuning';

const isRoadN = (v: number) => v >= Network.Street && v <= Network.Highway;
const R_ZONES = (1 << Zone.ResLow) | (1 << Zone.ResMed) | (1 << Zone.ResHigh);
const C_ZONES = (1 << Zone.ComLow) | (1 << Zone.ComMed) | (1 << Zone.ComHigh);
const I_ZONES = (1 << Zone.IndAg) | (1 << Zone.IndMed) | (1 << Zone.IndHigh);

/** zoned tiles a building can use (growable lots + empty zoned tiles facing a road) and their utilities */
export interface ZoneScan {
  /** zoned R/C/I tiles */
  zoned: number;
  /** usable tiles: growable lots + empty zoned tiles 4-adjacent to a road */
  front: number;
  /** usable tiles without power (utilities layer only), first one (cell index, -1 = none) */
  unpowered: number;
  unpoweredAt: number;
  /** usable medium / high density tiles (they need piped water), and those without water */
  needWater: number;
  unwatered: number;
  unwateredAt: number;
  /** the empty ones among the unpowered / unwatered tiles (no building on them yet: "nothing can grow there"; the
   *  occupied buildings are outP / outW). Optional: scans saved before final fixes N1 lack them */
  unpoweredLots?: number;
  unwateredLots?: number;
  /**
   * what the land can host (final fixes N4; optional: older saved scans lack them). Per picky DevType (R$$$, CO$$$,
   * I-HT): usable tiles of a zone that allows it (`host`), those where its desirability is above growth's floor
   * (GROW_MIN_DESIR) — `fit` — and the usable tile with its best desirability (`bestAt`, -1 = none); per DevType: the
   * empty ready lots a building can stand on (`lotOk`) that fit it (`fitEmpty`). Per family (0 R, 1 C, 2 I): the
   * empty ready lots (road, power, water where needed) and the first one; of those, the ones where a lot of the zone's
   * smallest building fits (`lotOk`), the tiles too small for one (`lotSmall`: odd tiles left between buildings, roads or
   * the zone's edge) and the ones only too steep for one (`lotSteep`), with the first of each (lotFit: growth's own
   * placement rules). Scans saved before lotOk: emptyReady counts as usable
   */
  host?: number[];
  fit?: number[];
  fitEmpty?: number[];
  bestAt?: number[];
  emptyReady?: [number, number, number];
  emptyReadyAt?: [number, number, number];
  lotOk?: [number, number, number];
  lotOkAt?: [number, number, number];
  lotSmall?: [number, number, number];
  lotSmallAt?: [number, number, number];
  /** lotSmall per zone (Zone index) and the first of each: the rule names the zone with the most */
  lotSmallZ?: number[];
  lotSmallZAt?: number[];
  lotSteep?: [number, number, number];
  lotSteepAt?: [number, number, number];
  /** usable tiles with everything a building needs (power, water where required), bitmask of their zones, first one */
  ready: number;
  readyZones: number;
  readyAt: number;
  /** zoned tiles in zone blocks without a single road-facing tile, first one */
  noAccess: number;
  noAccessAt: number;
  /** the same per family (0 R, 1 C, 2 I) and the first tile of each (-1 = none) */
  noAccessFam: [number, number, number];
  noAccessFamAt: [number, number, number];
  /** T037b FH-03: zoned tiles per family (0 R, 1 C, 2 I) */
  zonedFam?: [number, number, number];
  /** T037b LG-05: unzoned tiles without a building, network, water or power line */
  free?: number;
  /**
   * occupied growables (residents or jobs) without power / without the piped water they need, from the buildings' own
   * flags (what population reads), with their residents and jobs and the centre cell of the biggest one (-1 = none).
   * Optional: scans saved before final fixes N1 lack them (= 0)
   */
  outP?: number;
  outPRes?: number;
  outPJobs?: number;
  outPAt?: number;
  outW?: number;
  outWRes?: number;
  outWJobs?: number;
  outWAt?: number;
  /** of outP: the homes (residential growables) */
  outPHomes?: number;
  /**
   * final fixes SF-2: growable lots in rubble (BF.Burnt: burnt down, or flattened by a disaster) per family (0 R, 1 C,
   * 2 I, by the building's type), the centre cell of the first of each (-1 = none), and the rubble cells per zone (the
   * room a family gets back once its rubble is cleared — growth never rebuilds on rubble). Optional: scans saved
   * before lack them (= none)
   */
  rubbleLots?: [number, number, number];
  rubbleAt?: [number, number, number];
  rubbleZ?: number[];
}

/** growable lots in rubble (ZoneScan.rubbleLots / rubbleAt / rubbleZ): one pass over the buildings, a flag test each
 *  (the infra building snapshot, not the runtime's lists: their rebuild timing stays the population system's) */
function scanRubble(st: CityState, rt: EconRuntime, r: ZoneScan): void {
  const N = st.size;
  const lots: number[] = [0, 0, 0], at: number[] = [-1, -1, -1];
  const perZone: number[] = new Array(Zone.IndHigh + 1).fill(0);
  const list = buildingList(st);
  for (let k = 0; k < list.length; k++) {
    const b = list[k];
    if (!(b.flags & BF.Burnt) || b.flags & BF.Plopped) continue;
    const dev = rt.defOf(b)?.devType;
    const f = dev === undefined ? -1 : dev <= DevType.R3 ? 0 : dev <= DevType.CO3 ? 1 : 2;
    const i = Math.min(N - 1, b.z + (b.d >> 1)) * N + Math.min(N - 1, b.x + (b.w >> 1));
    if (f >= 0) {
      lots[f]++;
      if (at[f] < 0) at[f] = i;
    }
    // (rubble on land still zoned for growth: room once cleared)
    const zn = st.zone[i];
    if (zn >= Zone.ResLow && zn <= Zone.IndHigh) perZone[zn] += b.w * b.d;
  }
  r.rubbleLots = [lots[0], lots[1], lots[2]];
  r.rubbleAt = [at[0], at[1], at[2]];
  r.rubbleZ = perZone;
}

/** occupied growables without power / water (ZoneScan.outP ... outWAt): one pass over the growables */
function scanOutages(st: CityState, rt: EconRuntime, r: ZoneScan): void {
  const N = st.size;
  let pN = 0, pRes = 0, pJobs = 0, pAt = -1, pBig = 0, wN = 0, wRes = 0, wJobs = 0, wAt = -1, wBig = 0, pHomes = 0;
  rt.ensureLists();
  const list = rt.growables;
  for (let k = 0; k < list.length; k++) {
    const b = list[k];
    const people = b.pop + b.jobs;
    if (!(people > 0) || b.flags & (BF.Abandoned | BF.Burnt)) continue;
    const p = buildingPowered(st, b, true);
    let w = true;
    if (!(b.flags & BF.Watered)) {
      const def = rt.defOf(b);
      const needWater = (def?.stage ?? 1) >= WATER_REQUIRED_STAGE || zoneDensity(st.zone[b.z * N + b.x]) >= 2;
      w = !needWater || buildingWatered(st, b, true);
    }
    if (p && w) continue;
    const at = Math.min(N - 1, b.z + (b.d >> 1)) * N + Math.min(N - 1, b.x + (b.w >> 1));
    if (!p) {
      pN++; pRes += b.pop; pJobs += b.jobs;
      if (b.pop > 0) pHomes++;
      if (people > pBig) { pBig = people; pAt = at; }
    }
    if (!w) {
      wN++; wRes += b.pop; wJobs += b.jobs;
      if (people > wBig) { wBig = people; wAt = at; }
    }
  }
  r.outP = pN; r.outPRes = Math.round(pRes); r.outPJobs = Math.round(pJobs); r.outPAt = pAt;
  r.outW = wN; r.outWRes = Math.round(wRes); r.outWJobs = Math.round(wJobs); r.outWAt = wAt;
  r.outPHomes = pHomes;
}

/** the picky DevType a zone allows (R$$$, CO$$$, I-HT: they grow only where land value / education suit them), -1 */
const PICKY_OF_ZONE: readonly number[] = [-1, DevType.R3, DevType.R3, DevType.R3, -1, DevType.CO3, DevType.CO3, -1, -1, DevType.IHT, -1];

/** the shortest footprint side of a zone's growables (memo per catalog list: growth's defsOf rebuilds the same way) */
const lotSideMemo: { src: readonly BuildingDef[]; side: number }[] = [];
function minLotSide(zone: number): number {
  const src = growablesForZone(zone as Zone);
  let m = lotSideMemo[zone];
  if (!m || m.src !== src) {
    let side = Infinity;
    for (const d of src) side = Math.min(side, d.footprint[0], d.footprint[1]);
    m = lotSideMemo[zone] = { src, side: Number.isFinite(side) ? side : 1 };
  }
  return m.side;
}

const LOT_DX = [0, 1, 0, -1], LOT_DZ = [1, 0, -1, 0];
/** scanZones scratch: minLotSide per zone */
const lotSide = new Int32Array(Zone.IndHigh + 1);
/**
 * can a building of the zone's smallest size (an s × s lot) grow on empty road-facing tile (x, z)? Growth's own placement
 * rules (growth.ts fitNew): the tile on the lot's front row, every lot cell free (same zone, no building, network, water
 * or power line), the whole front edge on a road, slope ≤ GROW_MAX_SLOPE + GROW_MAX_SLOPE_PER_CELL × s. 0 = a lot fits,
 * 1 = no lot fits (too small: an odd tile between buildings, roads or the zone's edge), 2 = lots fit only on too steep
 * ground. Any bigger building needs such a lot too, so 1 / 2 mean no building can grow there. PERF: the first fitting
 * placement returns (typical open land: one try)
 */
function lotFit(st: CityState, x: number, z: number, zn: number, s: number): 0 | 1 | 2 {
  const N = st.size, net = st.network, zone = st.zone, bld = st.building, water = st.water, lines = st.powerLines;
  const maxSlope = GROW_MAX_SLOPE + GROW_MAX_SLOPE_PER_CELL * s;
  let steep = false;
  for (let rot = 0; rot < 4; rot++) {
    const nx = x + LOT_DX[rot], nz = z + LOT_DZ[rot];
    if (nx < 0 || nz < 0 || nx >= N || nz >= N || !isRoadN(net[nz * N + nx])) continue;
    for (let k = 0; k < s; k++) {
      let x0: number, z0: number;
      if (rot === 0) { z0 = z - s + 1; x0 = x - k; }
      else if (rot === 2) { z0 = z; x0 = x - k; }
      else if (rot === 1) { x0 = x - s + 1; z0 = z - k; }
      else { x0 = x; z0 = z - k; }
      if (x0 < 0 || z0 < 0 || x0 + s > N || z0 + s > N) continue;
      let ok = true;
      for (let zz = z0; zz < z0 + s && ok; zz++) {
        for (let xx = x0; xx < x0 + s; xx++) {
          const j = zz * N + xx;
          if (zone[j] !== zn || bld[j] >= 0 || net[j] !== Network.None || water[j] || lines[j]) { ok = false; break; }
        }
      }
      if (!ok) continue;
      // the whole front edge on a road
      if (rot === 0 || rot === 2) {
        const fz = rot === 0 ? z0 + s : z0 - 1;
        if (fz < 0 || fz >= N) continue;
        for (let xx = x0; xx < x0 + s && ok; xx++) if (!isRoadN(net[fz * N + xx])) ok = false;
      } else {
        const fx = rot === 1 ? x0 + s : x0 - 1;
        if (fx < 0 || fx >= N) continue;
        for (let zz = z0; zz < z0 + s && ok; zz++) if (!isRoadN(net[zz * N + fx])) ok = false;
      }
      if (!ok) continue;
      if (lotSlope(st, x0, z0, s, s) > maxSlope) { steep = true; continue; }
      return 0;
    }
  }
  return steep ? 2 : 1;
}

/**
 * lotFit, and when the tile is on no fitting lot's front row: every other s × s lot that includes it with a whole edge on
 * a road (the tile as a back cell of a lot fronting another road — growth builds those from that road's candidate). The
 * same 0 / 1 / 2 (final fixes SF-6: the lot inspector and the zone scan answer alike). PERF: lotFit first (open land
 * fits there at once); the wider search only for the odd tiles
 */
function lotFitAny(st: CityState, x: number, z: number, zn: number, s: number): 0 | 1 | 2 {
  const first = lotFit(st, x, z, zn, s);
  if (first === 0 || s <= 1) return first;
  const N = st.size, net = st.network, zone = st.zone, bld = st.building, water = st.water, lines = st.powerLines;
  const maxSlope = GROW_MAX_SLOPE + GROW_MAX_SLOPE_PER_CELL * s;
  const rd = (xx: number, zz: number) => xx >= 0 && zz >= 0 && xx < N && zz < N && isRoadN(net[zz * N + xx]);
  let steep = first === 2;
  for (let z0 = z - s + 1; z0 <= z; z0++) {
    for (let x0 = x - s + 1; x0 <= x; x0++) {
      if (x0 < 0 || z0 < 0 || x0 + s > N || z0 + s > N) continue;
      let ok = true;
      for (let zz = z0; zz < z0 + s && ok; zz++) {
        for (let xx = x0; xx < x0 + s; xx++) {
          const j = zz * N + xx;
          if (zone[j] !== zn || bld[j] >= 0 || net[j] !== Network.None || water[j] || lines[j]) { ok = false; break; }
        }
      }
      if (!ok) continue;
      // a whole edge on a road: north, south, west or east (the lot's front)
      let edge = false;
      for (let side = 0; side < 4 && !edge; side++) {
        let all = true;
        for (let k = 0; k < s && all; k++) {
          const ex = side === 2 ? x0 - 1 : side === 3 ? x0 + s : x0 + k;
          const ez = side === 0 ? z0 - 1 : side === 1 ? z0 + s : z0 + k;
          if (!rd(ex, ez)) all = false;
        }
        edge = all;
      }
      if (!edge) continue;
      if (lotSlope(st, x0, z0, s, s) > maxSlope) { steep = true; continue; }
      return 0;
    }
  }
  return steep ? 2 : 1;
}

/**
 * can a building grow on the empty zoned tile (x, z)? Final fixes SF-6 (the lot inspector, ui/zoneStatus.ts): lotFitAny
 * with the zone's smallest building (minLotSide) — 0 = a lot fits, 1 = no building fits (an odd tile between buildings,
 * roads or the zone's edge), 2 = lots fit only on too steep ground; -1 = not an empty tile of a growth zone. Meant for
 * road-front tiles: deeper ones fill as part of a bigger lot
 */
export function lotFitAtOriginal(st: CityState, x: number, z: number): -1 | 0 | 1 | 2 {
  if (!st.inBounds(x, z)) return -1;
  const i = z * st.size + x, zn = st.zone[i];
  if (zn < Zone.ResLow || zn > Zone.IndHigh || st.building[i] >= 0 || st.network[i] !== Network.None || st.water[i] || st.powerLines[i]) return -1;
  return lotFitAny(st, x, z, zn, minLotSide(zn));
}

/** one pass over the zoned tiles (4-connected blocks flood-filled for road access) */
function scanZones(st: CityState, util: boolean, visited: Uint8Array, stack: Int32Array, lots: Int32Array): ZoneScan {
  const N = st.size, C = st.cells;
  const zone = st.zone, net = st.network, bld = st.building, powered = st.powered, watered = st.watered;
  const r: ZoneScan = {
    zoned: 0, front: 0, unpowered: 0, unpoweredAt: -1, needWater: 0, unwatered: 0, unwateredAt: -1, ready: 0, readyZones: 0, readyAt: -1, noAccess: 0, noAccessAt: -1,
    noAccessFam: [0, 0, 0], noAccessFamAt: [-1, -1, -1], zonedFam: [0, 0, 0], unpoweredLots: 0, unwateredLots: 0,
    host: new Array(DEV_TYPE_COUNT).fill(0), fit: new Array(DEV_TYPE_COUNT).fill(0), fitEmpty: new Array(DEV_TYPE_COUNT).fill(0), bestAt: new Array(DEV_TYPE_COUNT).fill(-1),
    emptyReady: [0, 0, 0], emptyReadyAt: [-1, -1, -1],
    lotOk: [0, 0, 0], lotOkAt: [-1, -1, -1], lotSmall: [0, 0, 0], lotSmallAt: [-1, -1, -1], lotSteep: [0, 0, 0], lotSteepAt: [-1, -1, -1],
    lotSmallZ: new Array(Zone.IndHigh + 1).fill(0), lotSmallZAt: new Array(Zone.IndHigh + 1).fill(-1),
  };
  let lotsP = 0, lotsW = 0, nLots = 0;
  const des = st.desirability;
  const host = r.host!, fit = r.fit!, fitEmpty = r.fitEmpty!, bestAt = r.bestAt!, emptyReady = r.emptyReady!, emptyReadyAt = r.emptyReadyAt!;
  const lotOk = r.lotOk!, lotOkAt = r.lotOkAt!, lotSmall = r.lotSmall!, lotSmallAt = r.lotSmallAt!, lotSteep = r.lotSteep!, lotSteepAt = r.lotSteepAt!;
  const lotSmallZ = r.lotSmallZ!, lotSmallZAt = r.lotSmallZAt!;
  const bestDes = new Float32Array(DEV_TYPE_COUNT).fill(-Infinity);
  const isZ = (i: number) => zone[i] >= Zone.ResLow && zone[i] <= Zone.IndHigh;
  const water = st.water, lines = st.powerLines;
  // per block: tiles per family (0 R, 1 C, 2 I) and the first tile of each
  const fam = [0, 0, 0], famAt = [-1, -1, -1];
  let free = 0;
  visited.fill(0);
  for (let s = 0; s < C; s++) {
    if (visited[s]) continue;
    if (!isZ(s)) {
      if (zone[s] === Zone.None && bld[s] < 0 && net[s] === Network.None && !water[s] && !lines[s]) free++;
      continue;
    }
    let sp = 0, cells = 0, access = false;
    fam[0] = fam[1] = fam[2] = 0;
    famAt[0] = famAt[1] = famAt[2] = -1;
    stack[sp++] = s;
    visited[s] = 1;
    while (sp > 0) {
      const i = stack[--sp];
      const x = i % N;
      cells++;
      const zn = zone[i];
      const f = (1 << zn) & R_ZONES ? 0 : (1 << zn) & C_ZONES ? 1 : 2;
      fam[f]++;
      if (famAt[f] < 0) famAt[f] = i;
      const road = (x > 0 && isRoadN(net[i - 1])) || (x < N - 1 && isRoadN(net[i + 1])) || (i >= N && isRoadN(net[i - N])) || (i + N < C && isRoadN(net[i + N]));
      if (road) access = true;
      if (road || bld[i] >= 0) {
        r.front++;
        const p = !util || powered[i] === 1;
        if (!p) { r.unpowered++; if (r.unpoweredAt < 0) r.unpoweredAt = i; if (bld[i] < 0) lotsP++; }
        let w = true;
        if (zoneDensity(zn) >= 2) {
          r.needWater++;
          w = !util || watered[i] === 1;
          if (!w) { r.unwatered++; if (r.unwateredAt < 0) r.unwateredAt = i; if (bld[i] < 0) lotsW++; }
        }
        if (p && w) { r.ready++; r.readyZones |= 1 << zn; if (r.readyAt < 0) r.readyAt = i; }
        // what this tile can host (final fixes N4): the empty ready lots are judged after the fill (below); every
        // usable tile counts the zone's picky type (R$$$ / CO$$$ / I-HT: the rules ask where it fits at all). PERF: one
        // desirability read per built tile
        if (bld[i] < 0 && p && w) {
          emptyReady[f]++;
          if (emptyReadyAt[f] < 0) emptyReadyAt[f] = i;
          lots[nLots++] = i;
        }
        const pd = PICKY_OF_ZONE[zn];
        if (pd >= 0) {
          const v = des[pd][i];
          host[pd]++;
          if (v > bestDes[pd]) { bestDes[pd] = v; bestAt[pd] = i; }
          if (v > GROW_MIN_DESIR) fit[pd]++;
        }
      }
      if (x > 0 && !visited[i - 1] && isZ(i - 1)) { visited[i - 1] = 1; stack[sp++] = i - 1; }
      if (x < N - 1 && !visited[i + 1] && isZ(i + 1)) { visited[i + 1] = 1; stack[sp++] = i + 1; }
      if (i >= N && !visited[i - N] && isZ(i - N)) { visited[i - N] = 1; stack[sp++] = i - N; }
      if (i + N < C && !visited[i + N] && isZ(i + N)) { visited[i + N] = 1; stack[sp++] = i + N; }
    }
    r.zoned += cells;
    for (let f = 0; f < 3; f++) r.zonedFam![f] += fam[f];
    if (!access) {
      r.noAccess += cells;
      if (r.noAccessAt < 0) r.noAccessAt = s;
      for (let f = 0; f < 3; f++) {
        r.noAccessFam[f] += fam[f];
        if (r.noAccessFamAt[f] < 0) r.noAccessFamAt[f] = famAt[f];
      }
    }
  }
  // the empty ready lots, in the order found (PERF: kept out of the fill loop, which stays lean): can a building stand
  // there (lotFit: growth's placement rules for the zone's smallest building), and which DevTypes of its zone clear
  // growth's desirability floor there
  for (let z = Zone.ResLow; z <= Zone.IndHigh; z++) lotSide[z] = minLotSide(z);
  for (let k = 0; k < nLots; k++) {
    const i = lots[k], zn = zone[i];
    const f = (1 << zn) & R_ZONES ? 0 : (1 << zn) & C_ZONES ? 1 : 2;
    const lf = lotFitAny(st, i % N, (i / N) | 0, zn, lotSide[zn]);
    if (lf === 0) {
      lotOk[f]++;
      if (lotOkAt[f] < 0) lotOkAt[f] = i;
      const devs = ZONE_DEVTYPES[zn];
      for (let d = 0; d < devs.length; d++) if (des[devs[d]][i] > GROW_MIN_DESIR) fitEmpty[devs[d]]++;
    } else if (lf === 1) {
      lotSmall[f]++; if (lotSmallAt[f] < 0) lotSmallAt[f] = i;
      lotSmallZ[zn]++; if (lotSmallZAt[zn] < 0) lotSmallZAt[zn] = i;
    } else { lotSteep[f]++; if (lotSteepAt[f] < 0) lotSteepAt[f] = i; }
  }
  r.unpoweredLots = lotsP;
  r.unwateredLots = lotsW;
  r.free = free;
  return r;
}

/** advisorsSystem's zoneScan (a59f08f) */
export function zoneScanOriginal(st: CityState, rt: EconRuntime, util: boolean): ZoneScan {
  const visited = new Uint8Array(st.cells), stack = new Int32Array(st.cells), lots = new Int32Array(st.cells);
  const r = scanZones(st, util, visited, stack, lots);
  if (util) scanOutages(st, rt, r);
  scanRubble(st, rt, r);
  return r;
}
