/**
 * Asset gallery / contact sheet renderer used for visual review of procedural models.
 *
 * URL params:
 *   group=<AssetGroup>      all models of a group (every variant unless variants=first)
 *   model=<id>[,<id>...]    specific models (all variants)
 *   variant=<n>             only that variant
 *   variants=first          only variant 0 of each model
 *   night=1                 night lighting (windows lit)
 *   view=iso|front|top|back|close   camera direction (default iso = front-right, like the game camera)
 *   cols=<n> tile=<px>      layout (default cols 4, tile 360)
 *   ctx=1                   show neighbouring road + lot outline context
 * Sets window.__ready = true after rendering; window.__stats holds per-model tri counts + bound checks.
 */
import * as THREE from 'three';
import { registerAllModels } from '../assets/builders';
import { getModelGeometry } from '../assets/registry';
import { MANIFEST, MANIFEST_BY_ID, type ManifestEntry } from '../assets/manifest';
import { getBuildingMaterial, sharedUniforms } from '../assets/materials';
import { CELL_SIZE } from '../core/constants';

registerAllModels();

const params = new URLSearchParams(location.search);
const night = params.get('night') === '1';
const view = params.get('view') ?? 'iso';
const cols = parseInt(params.get('cols') ?? '4', 10);
const tile = parseInt(params.get('tile') ?? '360', 10);
const showCtx = params.get('ctx') !== '0';

interface Item { entry: ManifestEntry; variant: number; }
const items: Item[] = [];
let entries: ManifestEntry[] = [];
if (params.get('model')) entries = params.get('model')!.split(',').map((id) => MANIFEST_BY_ID[id]).filter(Boolean);
else if (params.get('group')) entries = MANIFEST.filter((e) => e.group === params.get('group'));
else entries = MANIFEST.slice(0, 8);
for (const e of entries) {
  if (params.get('variant') != null) items.push({ entry: e, variant: parseInt(params.get('variant')!, 10) });
  else if (params.get('variants') === 'first') items.push({ entry: e, variant: 0 });
  else for (let v = 0; v < e.variants; v++) items.push({ entry: e, variant: v });
}

const rows = Math.max(1, Math.ceil(items.length / cols));
const W = Math.min(cols, items.length || 1) * tile;
const H = rows * tile;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = night ? 1.0 : 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setScissorTest(true);

const scene = new THREE.Scene();

// --- environment: gradient sky
function makeSkyEnv(): THREE.Texture {
  const envScene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(100, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { night: { value: night ? 1 : 0 } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
    fragmentShader: `varying vec3 vP; uniform float night;
      void main(){ float h = vP.y;
        vec3 dayTop = vec3(0.32,0.52,0.85), dayHor = vec3(0.78,0.85,0.92), ground = vec3(0.32,0.30,0.27);
        vec3 nTop = vec3(0.01,0.015,0.04), nHor = vec3(0.05,0.06,0.1), nGround = vec3(0.01,0.01,0.012);
        vec3 top = mix(dayTop, nTop, night), hor = mix(dayHor, nHor, night), gr = mix(ground, nGround, night);
        vec3 c = h > 0.0 ? mix(hor, top, pow(h, 0.6)) : mix(hor, gr, pow(-h, 0.4));
        gl_FragColor = vec4(c * (night > 0.5 ? 1.0 : 1.4), 1.0); }`,
  });
  envScene.add(new THREE.Mesh(geo, mat));
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(envScene, 0.02);
  return rt.texture;
}
scene.environment = makeSkyEnv();
scene.environmentIntensity = night ? 0.25 : 0.9;
scene.background = new THREE.Color(night ? 0x0b0f1a : 0x9fb7cc);

const sun = new THREE.DirectionalLight(night ? 0x8fa6ff : 0xfff1dc, night ? 0.25 : 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(night ? 0x223355 : 0xbcd6ff, night ? 0x050505 : 0x5a5040, night ? 0.15 : 0.5);
scene.add(hemi);
sharedUniforms.uNight.value = night ? 1 : 0;

const mat = getBuildingMaterial();
const groundMat = new THREE.MeshStandardMaterial({ color: 0x7a8f5a, roughness: 1 });
const roadMat = new THREE.MeshStandardMaterial({ color: 0x3a3b3e, roughness: 0.9 });
const waterMat = new THREE.MeshStandardMaterial({ color: 0x2f6f96, roughness: 0.08, metalness: 0.3 });
const lineMat = new THREE.LineBasicMaterial({ color: 0xffee88 });

const stats: any[] = [];
(window as any).__stats = stats;

const labels = document.getElementById('labels')!;
const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 5000);

let idx = 0;
for (const it of items) {
  const { entry, variant } = it;
  const col = idx % cols, row = Math.floor(idx / cols);
  idx++;
  const group = new THREE.Group();
  scene.add(group);
  const geo = getModelGeometry(entry.id, variant);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  const fw = entry.footprint[0] * CELL_SIZE, fd = entry.footprint[1] * CELL_SIZE;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(fw * 3 + 60, fd * 3 + 60), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  group.add(ground);
  if (showCtx && entry.group !== 'vehicle' && entry.group !== 'nature' && entry.group !== 'prop') {
    const road = entry.waterfront
      ? new THREE.Mesh(new THREE.PlaneGeometry(fw * 3 + 60, fd * 1.5 + 30), waterMat)
      : new THREE.Mesh(new THREE.PlaneGeometry(fw + 32, CELL_SIZE), roadMat);
    road.rotation.x = -Math.PI / 2;
    if (entry.waterfront) road.position.set(0, 0.02, fd / 2 + (fd * 1.5 + 30) / 2);
    else road.position.set(0, -0.01, fd / 2 + CELL_SIZE / 2);
    road.receiveShadow = true;
    group.add(road);
    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-fw / 2, 0.2, -fd / 2), new THREE.Vector3(fw / 2, 0.2, -fd / 2),
        new THREE.Vector3(fw / 2, 0.2, fd / 2), new THREE.Vector3(-fw / 2, 0.2, fd / 2),
      ]),
      lineMat,
    );
    group.add(outline);
  }
  // stats / bounds check
  const bb = geo.boundingBox!;
  const tris = (geo.attributes.position.count / 3) | 0;
  const tol = 0.6;
  const outOfBounds = entry.group !== 'vehicle' && entry.group !== 'nature' && entry.group !== 'prop' && (bb.min.x < -fw / 2 - tol || bb.max.x > fw / 2 + tol || bb.min.z < -fd / 2 - tol || bb.max.z > fd / 2 + tol);
  const height = bb.max.y;
  const heightBad = height > entry.height[1] * 1.25 || height < entry.height[0] * 0.6;
  const budget = entry.budget ?? (entry.group === 'nature' ? 120 : entry.group === 'vehicle' ? 250 : entry.group === 'prop' ? 200 : entry.group === 'landmark' ? 8000 : ['civic', 'utility', 'park', 'reward', 'transport'].includes(entry.group) ? 3000 : 1500);
  const overBudget = tris > budget;
  stats.push({ id: entry.id, variant, tris, budget, height: +height.toFixed(1), expected: entry.height, bbox: [bb.min.toArray().map((v) => +v.toFixed(1)), bb.max.toArray().map((v) => +v.toFixed(1))], outOfBounds, heightBad, overBudget });

  // camera framing
  const sphere = new THREE.Sphere();
  new THREE.Box3().copy(bb).union(new THREE.Box3(new THREE.Vector3(-fw / 2, 0, -fd / 2), new THREE.Vector3(fw / 2, 0, fd / 2))).getBoundingSphere(sphere);
  const dir = new THREE.Vector3();
  switch (view) {
    case 'front': dir.set(0, 0.35, 1); break;
    case 'back': dir.set(-0.6, 0.6, -1); break;
    case 'top': dir.set(0.0001, 1, 0.12); break;
    case 'close': dir.set(0.8, 0.35, 1); break;
    default: dir.set(0.85, 0.95, 1.25);
  }
  dir.normalize();
  const dist = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * (view === 'close' ? 0.62 : 1.02);
  camera.position.copy(sphere.center).addScaledVector(dir, dist);
  camera.lookAt(sphere.center);
  camera.near = Math.max(0.1, dist - sphere.radius * 3);
  camera.far = dist + sphere.radius * 4;
  camera.updateProjectionMatrix();
  // sun
  const sunDir = new THREE.Vector3(0.55, 0.9, 0.35).normalize();
  sun.position.copy(sphere.center).addScaledVector(sunDir, sphere.radius * 3);
  sun.target.position.copy(sphere.center);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  const r = sphere.radius * 1.6;
  sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 0.1; sc.far = sphere.radius * 8;
  sc.updateProjectionMatrix();
  sun.shadow.needsUpdate = true;
  // hide others
  for (const c of scene.children) if (c instanceof THREE.Group) c.visible = c === group;
  const x = col * tile, y = H - (row + 1) * tile;
  renderer.setViewport(x, y, tile, tile);
  renderer.setScissor(x, y, tile, tile);
  camera.aspect = 1;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);

  const lbl = document.createElement('div');
  const bad = outOfBounds || overBudget || heightBad;
  lbl.className = 'lbl' + (bad ? ' bad' : '');
  lbl.style.left = col * tile + 4 + 'px';
  lbl.style.top = row * tile + 4 + 'px';
  lbl.innerHTML = `${entry.id} #${variant} <small>${tris} tris, h=${height.toFixed(0)}m${outOfBounds ? ' OUT-OF-LOT' : ''}${overBudget ? ' OVER-BUDGET' : ''}${heightBad ? ` HEIGHT(${entry.height.join('-')})` : ''}</small>`;
  labels.appendChild(lbl);
}
const info = document.getElementById('info')!;
info.textContent = `${items.length} items`;
console.log('GALLERY_STATS ' + JSON.stringify(stats));
(window as any).__ready = true;
