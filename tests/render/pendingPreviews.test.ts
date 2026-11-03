/** Pending ghosts need no WebGL context to verify geometry, independent lifetime and disposal. */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { WorldView } from '../../src/render/world/WorldView';

function fixture() {
  const noop = { dispose: vi.fn() };
  const terrain = { ...noop, material: new THREE.MeshBasicMaterial(), worldHeight: (x: number, z: number) => x * 0.1 + z * 0.2, setHighlight: vi.fn(), setHighlightRect: vi.fn(), setBrush: vi.fn() };
  const view = Object.assign(Object.create(WorldView.prototype) as object, {
    state: { size: 32 }, scene: new THREE.Scene(), terrain, _disposed: false,
    pendingPreviews: new Map(), unsub: [], cameraController: noop, water: noop, trees: noop, sky: noop, post: noop,
    sun: { dirShadow: {}, cascadeShadow: {} },
    renderer: { properties: { get: () => ({}) }, dispose: vi.fn(), forceContextLoss: vi.fn() },
  }) as unknown as WorldView;
  const ghost = (seq: number) => view.scene.getObjectByName(`pending:${seq}`) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | undefined;
  return { view, terrain, ghost };
}

describe('WorldView pending previews', () => {
  it('keeps committed geometry in a neutral layer while hover previews are changed or cleared', () => {
    const { view, ghost } = fixture();
    view.setPendingPreview(1, { kind: 'rect', rect: { x0: 2, z0: 3, x1: 4, z1: 5 } });
    const mesh = ghost(1)!;
    expect(mesh.geometry.getAttribute('position').count).toBe(24);
    expect(mesh.material.opacity).toBeGreaterThan(0);
    expect(mesh.material.opacity).toBeLessThan(1);
    expect(mesh.material.depthWrite).toBe(false);
    view.setHighlight([{ x: 9, z: 9, ok: false }]);
    view.setHighlightRect(null, 0);
    view.setHighlight(null);
    view.setBrush(null, 0);
    expect(ghost(1)).toBe(mesh);
    const geoDispose = vi.spyOn(mesh.geometry, 'dispose'), matDispose = vi.spyOn(mesh.material, 'dispose');
    view.setPendingPreview(1, null);
    expect(ghost(1)).toBeUndefined();
    expect(geoDispose).toHaveBeenCalledOnce();
    expect(matDispose).toHaveBeenCalledOnce();
    view.dispose();
  });

  it('owns each sequence separately and copies only the occupied cells of a path', () => {
    const { view, ghost } = fixture();
    const path = [{ x: 3, z: 3 }, { x: 4, z: 3 }, { x: 4, z: 4 }, { x: 4, z: 4 }, { x: -1, z: 2 }];
    view.setPendingPreview(1, { kind: 'path', path });
    view.setPendingPreview(2, { kind: 'brush', x: 10.5, z: 10.5, radius: 2 });
    expect(ghost(1)!.geometry.getAttribute('position').count).toBe(18);
    const position = ghost(1)!.geometry.getAttribute('position');
    path[0].x = 25;
    expect(position.getX(0)).toBe(3 * 16);
    view.setPendingPreview(1, null);
    expect(ghost(2)).toBeDefined();
    view.dispose();
  });

  it('disposes all retained geometry on city teardown and ignores late previews', () => {
    const { view, ghost } = fixture();
    view.setPendingPreview(1, { kind: 'rect', rect: { x0: -3, z0: -2, x1: 2, z1: 2 } });
    const mesh = ghost(1)!;
    expect(mesh.geometry.getAttribute('position').count).toBe(24);
    const geoDispose = vi.spyOn(mesh.geometry, 'dispose'), matDispose = vi.spyOn(mesh.material, 'dispose');
    view.dispose();
    expect(view.scene.children).toHaveLength(0);
    expect(geoDispose).toHaveBeenCalledOnce();
    expect(matDispose).toHaveBeenCalledOnce();
    view.setPendingPreview(2, { kind: 'path', path: [{ x: 1, z: 1 }] });
    expect(view.scene.children).toHaveLength(0);
    view.dispose();
    expect(geoDispose).toHaveBeenCalledOnce();
  });
});
