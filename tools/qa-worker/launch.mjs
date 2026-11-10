/**
 * Chromium's GPU flags and the renderer check, shared by the acceptance harness (run.mjs, checks.mjs) and by T034's
 * tools/qa-worker.mjs (`--gpu`). No imports: both tools read it before Vite or Playwright.
 */

/** `--gpu` (the harness's default): the machine's real GPU, as the desktop's acceptance runs use it. */
export const GPU = ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=default'];
/** `--swiftshader`: WORKER_DESIGN §5.4's cloud flags. Function only, never a real-GPU result. */
export const SWIFTSHADER = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'];

const SOFTWARE = /swiftshader|llvmpipe|software|Microsoft Basic Render Driver|\bWARP\b/i;

/**
 * Page side (page.evaluate): the renderer behind the city's own WebGL context, unmasked where
 * WEBGL_debug_renderer_info exists. Without a city scene it reads a scratch context of the same GPU process.
 */
export function pageRenderer() {
  const app = window.__metropolis?.city?.scene?.ctx?.world?.renderer?.getContext?.();
  const gl = app ?? document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
  if (!gl) return { renderer: null, unmasked: false, source: 'none' };
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return { renderer: String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)), unmasked: !!ext, source: app ? 'city' : 'scratch' };
}

/**
 * Why `graphics` (pageRenderer's result) cannot stand for a real-GPU run, or null when it can. A masked renderer string
 * ("WebKit WebGL") names no GPU, so it fails too: only WEBGL_debug_renderer_info shows SwiftShader is absent.
 */
export function realGpuProblem(graphics) {
  if (typeof graphics?.renderer !== 'string' || !graphics.renderer) return 'no WebGL renderer could be read';
  if (!graphics.unmasked) return `WEBGL_debug_renderer_info is unavailable (renderer reads ${JSON.stringify(graphics.renderer)}), so the GPU cannot be established`;
  return SOFTWARE.test(graphics.renderer) ? `real-GPU run got software renderer: ${graphics.renderer}` : null;
}
