import * as THREE from 'three';

/**
 * a geometry object of its own over a shared (registry) geometry's attribute buffers (no copy): three.js hangs a dispose
 * listener — a closure over the renderer and its canvas — on every geometry and material a renderer draws, so a renderer
 * that is disposed while the page lives on (the toolbar / inspector thumbnails, the fallback view) must not draw the
 * shared ones, or their listeners keep it reachable (close-out c2: 7 thumbnail renderers after one UI session; c4: the
 * fallback view). Dispose the view with its renderer; the shared geometry stays.
 */
export function viewOf(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setIndex(src.index);
  for (const k of Object.keys(src.attributes)) g.setAttribute(k, src.attributes[k]);
  for (const k of Object.keys(src.morphAttributes) as (keyof THREE.BufferGeometry['morphAttributes'])[]) g.morphAttributes[k] = src.morphAttributes[k];
  g.morphTargetsRelative = src.morphTargetsRelative;
  for (const gr of src.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
  g.setDrawRange(src.drawRange.start, src.drawRange.count);
  g.boundingBox = src.boundingBox;
  g.boundingSphere = src.boundingSphere;
  return g;
}
