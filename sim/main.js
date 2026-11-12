import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {commandFromKeys} from './core.js';

const $ = id => document.getElementById(id);
const canvas = $('canvas'), viewport = $('viewport');
const keys = new Set();
let worker, renderer, scene, camera, orbit, geometry = [], state, running = false, ready = false;
let dragging = null, parentVisible = true, initializing = false, fault = false;
let forceArrow, pullLine, geometryCache = new Map(), animationFrame;
const raycaster = new THREE.Raycaster(), mouse = new THREE.Vector2(), rotation = new THREE.Matrix4();
const followTarget = new THREE.Vector3(0, 0, 0.65);
const send = message => worker?.postMessage(message);
const visible = () => !document.hidden && parentVisible;
function status(text) { if ($('status').textContent !== text) $('status').textContent = text; }

function updateKeys() {
  document.querySelectorAll('[data-key]').forEach(el => el.classList.toggle('active', keys.has(el.dataset.key)));
}
function releaseDrag() {
  if (dragging && canvas.hasPointerCapture(dragging.pointer)) canvas.releasePointerCapture(dragging.pointer);
  dragging = null;
  if (orbit) orbit.enabled = true;
  canvas.style.cursor = '';
  send({type: 'drag', drag: null});
  if (forceArrow) forceArrow.visible = false;
  if (pullLine) pullLine.visible = false;
}
function clearInput() {
  keys.clear(); updateKeys(); releaseDrag(); send({type: 'clear'});
}
function pause() { clearInput(); send({type: 'pause'}); }

function setupScene() {
  if (!window.Worker || !window.WebAssembly) throw new Error('This browser needs WebAssembly and Web Worker support. Please use a current desktop browser.');
  try { renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: true}); }
  catch { throw new Error('WebGL 2 graphics could not be initialized. Enable hardware acceleration or try another desktop browser.'); }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xeaf3f5, 12, 32);
  camera = new THREE.PerspectiveCamera(40, 1, 0.05, 100);
  camera.up.set(0, 0, 1);
  camera.position.set(2.0, -2.5, 1.6);
  orbit = new OrbitControls(camera, canvas);
  orbit.target.copy(followTarget);
  orbit.enableDamping = true;
  orbit.enablePan = false;
  orbit.minDistance = 1.3; orbit.maxDistance = 9;
  orbit.maxPolarAngle = Math.PI / 2 - 0.03;
  orbit.update();
  scene.add(new THREE.HemisphereLight(0xf0f8ff, 0x899b90, 1.8));
  const sun = new THREE.DirectionalLight(0xfff5e7, 2.0);
  sun.position.set(3, -4, 7); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = -4; sun.shadow.camera.right = 4;
  sun.shadow.camera.top = 4; sun.shadow.camera.bottom = -4; sun.shadow.normalBias = 0.015;
  scene.add(sun); scene.add(sun.target);
  scene.userData.sun = sun;
  const tile = document.createElement('canvas'); tile.width = tile.height = 256;
  const paint = tile.getContext('2d');
  paint.fillStyle = '#e8f0f1'; paint.fillRect(0, 0, 256, 256);
  paint.fillStyle = '#dce7e9'; paint.fillRect(0, 0, 128, 128); paint.fillRect(128, 128, 128, 128);
  const groundMap = new THREE.CanvasTexture(tile);
  groundMap.colorSpace = THREE.SRGBColorSpace;
  groundMap.wrapS = groundMap.wrapT = THREE.RepeatWrapping; groundMap.repeat.set(200, 200);
  groundMap.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({map: groundMap, roughness: 1}));
  ground.receiveShadow = true; ground.position.z = -0.002; scene.add(ground);
  forceArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 0.4, 0xe39757, 0.09, 0.045);
  forceArrow.visible = false; scene.add(forceArrow);
  pullLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({color: 0xe39757, dashSize: 0.04, gapSize: 0.025, transparent: true, opacity: 0.7}));
  pullLine.visible = false; scene.add(pullLine);
  const resize = () => {
    const {width, height} = viewport.getBoundingClientRect();
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(viewport); resize();
  function draw() {
    animationFrame = requestAnimationFrame(draw);
    if (!visible()) return;
    if (!dragging) orbit.update();
    renderer.render(scene, camera);
  }
  draw();
}

function loadGeometry(description) {
  for (const [id, mesh] of Object.entries(description.meshes)) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.vertices, 3));
    g.setIndex(new THREE.BufferAttribute(mesh.faces, 1));
    g.computeVertexNormals();
    geometryCache.set(Number(id), g);
  }
  geometry = description.geoms.map(info => {
    let g = geometryCache.get(info.mesh);
    if (info.type !== 7) {
      if (info.type === 2) g = new THREE.SphereGeometry(info.size[0], 16, 12);
      else if (info.type === 6) g = new THREE.BoxGeometry(...info.size.map(x => 2 * x));
      else return null;
    }
    const material = new THREE.MeshStandardMaterial({color: new THREE.Color(...info.color.slice(0, 3)), roughness: 0.65, metalness: 0.16});
    const mesh = new THREE.Mesh(g, material);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData = info;
    scene.add(mesh);
    return mesh;
  }).filter(Boolean);
}

function renderState(next) {
  state = next;
  for (const mesh of geometry) {
    const i = mesh.userData.id, r = next.rotations, a = i * 9;
    mesh.position.fromArray(next.positions, i * 3);
    rotation.set(r[a], r[a + 1], r[a + 2], 0, r[a + 3], r[a + 4], r[a + 5], 0, r[a + 6], r[a + 7], r[a + 8], 0, 0, 0, 0, 1);
    mesh.quaternion.setFromRotationMatrix(rotation);
  }
  if (!dragging) {
    const target = new THREE.Vector3(next.root[0], next.root[1], 0.65);
    const delta = target.clone().sub(followTarget);
    camera.position.add(delta); orbit.target.add(delta); followTarget.copy(target);
  }
  const sun = scene.userData.sun;
  sun.position.set(next.root[0] + 3, next.root[1] - 4, 7);
  sun.target.position.set(next.root[0], next.root[1], 0);
  const force = new THREE.Vector3(...next.force.force), magnitude = force.length();
  $('force-value').textContent = magnitude.toFixed(1);
  $('force-meter').style.width = `${Math.min(100, magnitude / 40 * 100)}%`;
  $('grab-name').textContent = dragging ? dragging.name.replaceAll('_', ' ').replace(' link', '') : 'Drag the upper body';
  forceArrow.visible = magnitude > 0.05 && Boolean(dragging);
  if (forceArrow.visible) {
    forceArrow.position.fromArray(next.force.point);
    forceArrow.setDirection(force.normalize());
    forceArrow.setLength(Math.max(0.04, magnitude / 65), 0.07, 0.035);
  }
  pullLine.visible = Boolean(dragging);
  if (dragging) {
    const positions = pullLine.geometry.attributes.position;
    positions.setXYZ(0, ...next.force.point); positions.setXYZ(1, ...dragging.target);
    positions.needsUpdate = true; pullLine.computeLineDistances(); pullLine.geometry.computeBoundingSphere();
  }
  $('command').textContent = next.command.map(v => v.toFixed(1)).join(' · ');
  $('sim-time').textContent = `${next.time.toFixed(1)} s`;
  $('applied').textContent = `Active: α ${next.alpha.toFixed(2)} · β ${next.beta.toFixed(2)}`;
}

function setRay(event) {
  const rect = canvas.getBoundingClientRect();
  mouse.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
  raycaster.setFromCamera(mouse, camera);
}
canvas.addEventListener('pointerdown', event => {
  canvas.focus({preventScroll: true});
  if (!ready || !running || event.button !== 0) return;
  setRay(event); scene.updateMatrixWorld(true);
  const hit = raycaster.intersectObjects(geometry, false)[0];
  if (!hit?.object.userData.draggable) return;
  event.preventDefault(); event.stopImmediatePropagation();
  const {body, name} = hit.object.userData;
  const p = new THREE.Vector3().fromArray(state.bodyPositions, body * 3);
  const q = state.bodyQuaternions;
  const orientation = new THREE.Quaternion(q[body * 4 + 1], q[body * 4 + 2], q[body * 4 + 3], q[body * 4]);
  dragging = {body, name, pointer: event.pointerId, local: hit.point.clone().sub(p).applyQuaternion(orientation.invert()).toArray(),
    target: hit.point.toArray(), plane: new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), hit.point)};
  orbit.enabled = false; canvas.setPointerCapture(event.pointerId); canvas.style.cursor = 'grabbing';
  send({type: 'drag', drag: {body, local: dragging.local, target: dragging.target}});
}, {capture: true});
canvas.addEventListener('pointermove', event => {
  if (!ready) return;
  setRay(event);
  if (!dragging) {
    const hit = raycaster.intersectObjects(geometry, false)[0];
    canvas.style.cursor = hit?.object.userData.draggable && running ? 'grab' : '';
    return;
  }
  event.preventDefault(); event.stopImmediatePropagation();
  const point = raycaster.ray.intersectPlane(dragging.plane, new THREE.Vector3());
  if (!point) return;
  dragging.target = point.toArray();
  send({type: 'drag', drag: {body: dragging.body, local: dragging.local, target: dragging.target}});
}, {capture: true});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, () => { if (dragging) releaseDrag(); });
canvas.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('webglcontextlost', event => {
  event.preventDefault(); pause(); showError('WebGL graphics were interrupted. Reload the demo to restart.');
});
canvas.addEventListener('keydown', event => {
  if (!running || !['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].includes(event.code)) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  event.preventDefault(); keys.add(event.code); updateKeys(); send({type: 'command', command: commandFromKeys(keys)});
});
canvas.addEventListener('keyup', event => {
  if (!keys.has(event.code)) return;
  event.preventDefault(); keys.delete(event.code); updateKeys(); send({type: 'command', command: commandFromKeys(keys)});
});
canvas.addEventListener('focus', () => { $('canvas-hint').textContent = 'WASD to walk · Q/E to turn · drag the upper body to pull'; });
canvas.addEventListener('blur', () => { clearInput(); $('canvas-hint').textContent = 'Click the scene to use your keyboard'; });
window.addEventListener('blur', clearInput);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== parent || event.data?.type !== 'soft-walker-visibility') return;
  parentVisible = Boolean(event.data.visible);
  if (!parentVisible) pause();
});

function showError(message, recoverable = false) {
  running = false; fault = true; clearInput();
  status(message); $('status-dot').classList.remove('running');
  $('pause').disabled = true;
  if (recoverable) { $('reset').disabled = false; return; }
  $('overlay').hidden = false;
  $('overlay').querySelector('h1').textContent = 'Unable to start';
  $('overlay').querySelector('.start-card > p').textContent = message;
  $('start').disabled = false; $('start').textContent = 'Reload & retry';
  $('start').onclick = () => location.reload();
  worker?.terminate();
}

$('start').onclick = () => {
  if (initializing) return;
  initializing = true; $('start').disabled = true; $('start').textContent = 'Loading…';
  try {
    setupScene();
    worker = new Worker(new URL('worker.js', import.meta.url), {type: 'module'});
    worker.onmessage = ({data: message}) => {
      if (message.type === 'loading') { status(message.message); $('start').textContent = 'Loading…'; }
      if (message.type === 'ready') {
        loadGeometry(message.geometry); renderState(message.state); ready = true; fault = false;
        $('overlay').hidden = true;
        for (const id of ['pause', 'reset', 'apply']) $(id).disabled = false;
        if (visible()) { send({type: 'resume'}); canvas.focus({preventScroll: true}); }
      }
      if (message.type === 'state') {
        running = message.running;
        renderState(message.state);
        $('pause').textContent = running ? 'Pause' : 'Resume';
        $('status-dot').classList.toggle('running', running);
        $('rate').textContent = running ? `${message.rate.toFixed(2)}× real time` : 'Paused';
        if (!fault) status(running ? 'Live · pull gently, release freely' : 'Paused · press Resume to continue');
      }
      if (message.type === 'error') showError(message.message, message.recoverable);
    };
    worker.onerror = event => showError(event.message || 'The simulation worker could not start. Check that all demo assets are available.');
    send({type: 'init'});
  } catch (error) { showError(error.message); }
};
$('pause').onclick = () => {
  if (running) pause();
  else if (visible()) { send({type: 'resume'}); canvas.focus({preventScroll: true}); }
};
function reset(apply = false) {
  clearInput(); fault = false; $('pause').disabled = false;
  const alpha = apply ? Number($('alpha').value) : state.alpha;
  const beta = apply ? Number($('beta').value) : state.beta;
  send({type: 'reset', alpha, beta, run: visible()});
  camera.position.set(2.0, -2.5, 1.6); orbit.target.set(0, 0, 0.65); followTarget.set(0, 0, 0.65); orbit.update();
  canvas.focus({preventScroll: true});
}
$('reset').onclick = () => reset();
$('apply').onclick = () => reset(true);
for (const name of ['alpha', 'beta']) $(name).addEventListener('input', () => { $(`${name}-value`).textContent = Number($(name).value).toFixed(2); });
$('fullscreen').onclick = async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('demo').requestFullscreen(); }
  catch { status('Full screen is unavailable here. Open the standalone demo to use it.'); }
};
window.addEventListener('pagehide', () => { worker?.terminate(); cancelAnimationFrame(animationFrame); renderer?.dispose(); });
// Read-only diagnostics used by the browser acceptance suite.
if (new URLSearchParams(location.search).has('test')) {
  window.softWalkerTest = {get state() { return state; }, get running() { return running; },
    grabPosition(bodyName) {
      const mesh = geometry.find(m => m.userData.name === bodyName);
      if (!mesh) return null;
      mesh.geometry.computeBoundingBox();
      const point = mesh.geometry.boundingBox.getCenter(new THREE.Vector3());
      mesh.localToWorld(point); point.project(camera);
      const box = canvas.getBoundingClientRect();
      return {x: box.left + (point.x + 1) * box.width / 2, y: box.top + (1 - point.y) * box.height / 2};
    }};
}
