/** App entry — owned by the region/meta agent (menu -> region -> city flow). TEMP render test */
import '../src/ui/theme.css';
import { MenuBackground } from './region/render/MenuBackground';
const app = document.getElementById('app')!;
const t0 = performance.now();
const q = new URLSearchParams(location.search);
const bg = new MenuBackground(app, { preset: (q.get('bgpreset') as any) ?? undefined, seed: q.get('bgseed') ? +q.get('bgseed')! : undefined });
console.log('[main] menu bg built in', (performance.now() - t0).toFixed(0), 'ms');
bg.onFirstFrame = () => { console.log('[main] first frame', (performance.now() - t0).toFixed(0)); requestAnimationFrame(() => ((window as any).__ready = true)); };
bg.start();
