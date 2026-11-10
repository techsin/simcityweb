/** tools/qa-nightfall.mjs's page-side probe and its verdicts (T084). */
export interface NightfallState {
  tod: number;
  lit: boolean;
  rigIntensity: number;
  night: number;
  sunVisible: boolean;
  sunIntensity: number;
  castShadow: boolean;
  shadowMapEnabled: boolean;
  programs: number;
}
export interface NightfallWindow {
  name: string;
  from: number;
  to: number;
  timeScale?: number;
  maxFrameMs?: number;
  timeoutS?: number;
}
export interface NightfallSpan {
  frames: number;
  first: number | null;
  last: number | null;
}
export interface NightfallReport {
  name: string;
  from: number;
  to: number;
  timeScale: number;
  maxFrameMs: number;
  before: NightfallState;
  after: NightfallState | null;
  timedOut: boolean;
  seconds: number;
  frames: number;
  ms: number[];
  tod: number[];
  maxMs: number;
  maxAt: number | null;
  maxStep: number;
  longFrames: number;
  long: { ms: number; tod: number; lit: boolean; sunVisible: boolean; programs: [number, number] }[];
  programs: { start: number; end: number; changes: { tod: number; from: number; to: number; ms: number }[] };
  light: {
    litAtStart: boolean | null;
    litAtEnd: boolean | null;
    changes: { tod: number; what: string; to: boolean; ms: number }[];
    unlit: NightfallSpan;
    hidden: NightfallSpan;
    onWhileOff: number;
  };
}
export interface NightfallCheck {
  name: string;
  ok: boolean;
  skipped?: boolean;
  detail: unknown;
}
export function hhmm(h: number): string;
export function parseWindows(text: string): { name: string; from: number; to: number }[];
export function installNightfallProbe(): NightfallState;
export function describeWindow(w: NightfallReport): string;
export function nightfallChecks(run: { windows: NightfallReport[]; before: NightfallState; after: NightfallState }, opts?: { maxFrameMs?: number; enforceFrames?: boolean }): NightfallCheck[];
