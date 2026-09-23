/**
 * Quality presets for the world renderer. `low` targets integrated GPUs (no AO, no bloom, single cheap shadow map,
 * FXAA), `ultra` targets fast discrete GPUs (2x pixel ratio, MSAA + full-res GTAO, 2 x 3072 shadow cascades).
 */
import type { QualityLevel } from '../contracts';

export interface QualitySettings {
  level: QualityLevel;
  /** cap for devicePixelRatio */
  maxPixelRatio: number;
  /** MSAA samples of the HDR scene target (0 = off) */
  msaa: number;
  /** FXAA post pass (used when MSAA is off) */
  fxaa: boolean;
  /** shadow map size (per cascade) */
  shadowMapSize: number;
  /** 1 = single fitted map (DirectionalLightShadow), 2 = two cascades (SunLightShadow) */
  shadowCascades: 1 | 2;
  /** PCF blur radius in texels */
  shadowRadius: number;
  /** shadow range as a multiple of the camera distance */
  shadowRangeMul: number;
  /** terrain chunks cast shadows (mountain shadows at sunset) */
  terrainShadows: boolean;
  /** trees cast shadows */
  treeShadows: boolean;
  /** ambient occlusion: 0 off, 1 half resolution, 2 full resolution */
  ao: 0 | 1 | 2;
  aoSamples: number;
  bloom: boolean;
  bloomLevels: number;
  /** distance (m) at which trees switch from full models to cheap impostors */
  treeLodDistance: number;
  /** global tree density multiplier (instances per cell) */
  treeDensity: number;
  /** model variants used per tree species (more = more variety, more draw calls) */
  treeVariants: number;
  /** terrain shader detail: 0 low, 1 medium, 2 high (micro normals + triplanar rock) */
  terrainDetail: 0 | 1 | 2;
  /** water shader detail: 0 low (1 normal sample), 1 (2 samples + foam), 2 (3 samples + sparkles) */
  waterDetail: 0 | 1 | 2;
  /** sky-view LUT size */
  skyLut: [number, number];
  /** environment (PMREM) refresh interval in game minutes */
  envRefreshMinutes: number;
  /** equirect environment source size (width; height = width/2) */
  envSize: number;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualitySettings> = {
  low: {
    level: 'low',
    maxPixelRatio: 1,
    msaa: 0,
    fxaa: true,
    shadowMapSize: 2048,
    shadowCascades: 1,
    shadowRadius: 1,
    shadowRangeMul: 2.2,
    terrainShadows: false,
    treeShadows: false,
    ao: 0,
    aoSamples: 0,
    bloom: false,
    bloomLevels: 0,
    treeLodDistance: 420,
    treeDensity: 0.75,
    treeVariants: 2,
    terrainDetail: 0,
    waterDetail: 0,
    skyLut: [128, 64],
    envRefreshMinutes: 20,
    envSize: 128,
  },
  medium: {
    level: 'medium',
    maxPixelRatio: 1.25,
    msaa: 0,
    fxaa: true,
    shadowMapSize: 1536,
    shadowCascades: 2,
    shadowRadius: 1.5,
    shadowRangeMul: 3,
    terrainShadows: true,
    treeShadows: true,
    ao: 0,
    aoSamples: 0,
    bloom: true,
    bloomLevels: 4,
    treeLodDistance: 520,
    treeDensity: 0.9,
    treeVariants: 3,
    terrainDetail: 1,
    waterDetail: 1,
    skyLut: [192, 96],
    envRefreshMinutes: 10,
    envSize: 256,
  },
  high: {
    level: 'high',
    maxPixelRatio: 1.5,
    msaa: 4,
    fxaa: false,
    shadowMapSize: 2048,
    shadowCascades: 2,
    shadowRadius: 1.5,
    shadowRangeMul: 3.5,
    terrainShadows: true,
    treeShadows: true,
    ao: 1,
    aoSamples: 12,
    bloom: true,
    bloomLevels: 5,
    treeLodDistance: 700,
    treeDensity: 1,
    treeVariants: 3,
    terrainDetail: 2,
    waterDetail: 2,
    skyLut: [256, 128],
    envRefreshMinutes: 6,
    envSize: 256,
  },
  ultra: {
    level: 'ultra',
    maxPixelRatio: 2,
    msaa: 4,
    fxaa: false,
    shadowMapSize: 3072,
    shadowCascades: 2,
    shadowRadius: 1.5,
    shadowRangeMul: 4,
    terrainShadows: true,
    treeShadows: true,
    ao: 2,
    aoSamples: 16,
    bloom: true,
    bloomLevels: 6,
    treeLodDistance: 1000,
    treeDensity: 1,
    treeVariants: 4,
    terrainDetail: 2,
    waterDetail: 2,
    skyLut: [256, 128],
    envRefreshMinutes: 4,
    envSize: 512,
  },
};

/** Pick a sensible default for the current device (very rough heuristic). */
export function detectQuality(): QualityLevel {
  if (typeof navigator === 'undefined') return 'high';
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  if (mobile) return 'low';
  const cores = navigator.hardwareConcurrency ?? 4;
  return cores >= 8 ? 'high' : 'medium';
}
