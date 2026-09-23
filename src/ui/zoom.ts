/** Current UI zoom factor (CSS `zoom` on the .mp-ui root). Coordinates from events must be divided by it. */
let current = 1;
export function uiZoom(): number {
  return current;
}
export function setUiZoom(z: number): void {
  current = z;
}
/**
 * Automatic scale for the viewport (≈1.0 at 1760x990, 0.8 at 1280x720, ~2.2 at 4K), times the user's preference.
 * The layout is designed to fit an effective width of >= 1600 css px.
 */
export function computeUiZoom(w: number, h: number, pref: number): number {
  const auto = Math.max(0.8, Math.min(2.2, Math.min(w / 1760, h / 990)));
  const z = Math.max(0.6, Math.min(3, auto * pref));
  // never make the effective layout narrower than 1280 css px
  const maxZ = Math.max(0.6, w / 1280);
  return Math.round(Math.min(z, maxZ) * 100) / 100;
}
