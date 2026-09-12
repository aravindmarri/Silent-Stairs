import * as THREE from 'three';
import './style.css';
import { levels, getLevelById, getNextLevel } from './levels/index.js';
import { attachDragRotate } from './controls.js';
import { createLevelRuntime } from './levelRuntime.js';
import { createTowerLevelRuntime } from './towerLevelRuntime.js';
import { animateLevelTransition } from './transition.js';
import { createDevToolbar } from './devToolbar.js';

const app = document.querySelector('#app');
app.innerHTML = `
  <canvas id="scene"></canvas>
  <header id="title">
    <h1>Silent Stairs</h1>
    <p id="subtitle">A puzzle of perspective</p>
  </header>
  <div id="hintBar">
    <p id="hint"></p>
    <div id="controls">
      <button id="moveBtn">Move</button>
      <button id="crossBtn" disabled>Cross</button>
      <button id="rotateLeftBtn" hidden>⟲ Rotate</button>
      <button id="rotateRightBtn" hidden>Rotate ⟳</button>
      <button id="restartBtn">Restart</button>
      <button id="nextBtn" hidden>Next Level</button>
    </div>
  </div>
  <div id="winBanner" class="hidden">Solved.</div>
`;

const canvas = document.querySelector('#scene');
const subtitle = document.querySelector('#subtitle');
const ui = {
  hint: document.querySelector('#hint'),
  moveBtn: document.querySelector('#moveBtn'),
  crossBtn: document.querySelector('#crossBtn'),
  rotateLeftBtn: document.querySelector('#rotateLeftBtn'),
  rotateRightBtn: document.querySelector('#rotateRightBtn'),
  restartBtn: document.querySelector('#restartBtn'),
  nextBtn: document.querySelector('#nextBtn'),
  winBanner: document.querySelector('#winBanner'),
};

function createRenderer() {
  try {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    if (!renderer.getContext()) return null;
    return renderer;
  } catch {
    return null;
  }
}

const renderer = createRenderer();
if (!renderer) {
  app.innerHTML = `<div id="webglFallback">This puzzle needs WebGL, which isn't available in this browser.</div>`;
} else {
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    app.innerHTML = `<div id="webglFallback">The 3D display was lost. Reloading the page should fix it.</div>`;
  });
  initGame(renderer);
}

function disposeObject(root) {
  root.traverse((obj) => {
    obj.geometry?.dispose();
    const mat = obj.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
}

function initGame(renderer) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;

  // ---------- shared scene (reused across every level) ----------
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b1f2a);
  scene.fog = new THREE.Fog(0x1b1f2a, 20, 40);

  let aspect = window.innerWidth / window.innerHeight;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.set(9, 8, 11);
  camera.lookAt(0, 2, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(6, 12, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun);

  // Ground void so disconnected platforms read as floating. Shared and
  // sized generously enough for any registered level.
  const voidPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({ color: 0x14161f })
  );
  voidPlane.rotation.x = -Math.PI / 2;
  voidPlane.position.y = -6;
  voidPlane.receiveShadow = true;
  scene.add(voidPlane);

  // ---------- shared, persistent input plumbing ----------
  // One set of listeners for the whole game's lifetime: the drag target
  // is a getter (so it can point at whichever level's "world" group is
  // currently active without re-attaching anything), and keydown simply
  // delegates to whatever runtime is active right now.
  let activeWorld = null;
  let activeRuntime = null;
  let isTransitioning = false;

  const dragControls = attachDragRotate(canvas, () => activeWorld, {
    onChange: () => activeRuntime?.updateCrossReadiness(),
    onRelease: () => activeRuntime?.updateCrossReadiness(),
  });
  dragControls.lock();

  window.addEventListener('keydown', (e) => {
    if (isTransitioning) return;
    activeRuntime?.handleKeydown(e);
  });

  // ---------- level loading (with an animated transition between levels) ----------
  let generation = 0; // shared by every cancellable action: restart, level switch, and the transitions/animations they interrupt
  const getGeneration = () => generation;
  const bumpGeneration = () => {
    generation += 1;
  };

  let activeRoot = null; // the transition target: a plain group directly in `scene`
  let activeLevelId = null;
  let activeLevelRadius = 8;

  function sizeShadowCamera(radius) {
    // The directional light's shadow camera defaults to a small fixed
    // frustum (±5 units) — too small for these levels, which shows up
    // as a hard rectangular seam on the ground plane where shadow
    // coverage cuts off.
    sun.shadow.camera.left = -radius;
    sun.shadow.camera.right = radius;
    sun.shadow.camera.top = radius;
    sun.shadow.camera.bottom = -radius;
    sun.shadow.camera.far = radius * 4;
    sun.shadow.camera.updateProjectionMatrix();
  }

  function onResize() {
    aspect = window.innerWidth / window.innerHeight;
    // Extra vertical margin leaves room for the title and hint/button
    // bars, which overlay the canvas rather than resizing it.
    const verticalNeeded = activeLevelRadius * 1.35;
    const horizontalNeeded = activeLevelRadius / Math.max(aspect, 0.001);
    const FRUSTUM = Math.max(6, verticalNeeded, horizontalNeeded);

    // Only the projection's extents change here — camera.position and
    // camera.lookAt (its viewing direction) are never touched, so
    // resizing reframes the shot without re-aiming it, which is what
    // keeps the illusion's solved angles valid at any window size.
    camera.left = -FRUSTUM * aspect;
    camera.right = FRUSTUM * aspect;
    camera.top = FRUSTUM;
    camera.bottom = -FRUSTUM;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', onResize);

  function devParamPresent() {
    return new URLSearchParams(window.location.search).get('dev') === '1';
  }
  const devMode = Boolean(import.meta.env?.DEV) || devParamPresent();

  function updateUrlLevelParam(levelId) {
    const url = new URL(window.location.href);
    url.searchParams.set('level', String(levelId));
    if (devParamPresent()) url.searchParams.set('dev', '1');
    window.history.replaceState(null, '', url);
  }

  async function loadLevel(levelId, { skipTransition = false } = {}) {
    const descriptor = getLevelById(levelId) ?? levels[0];

    activeRuntime?.cancelActiveWalk();
    bumpGeneration();
    const myGeneration = getGeneration();

    // Freeze whatever's currently on screen immediately — before the
    // new level's (potentially slow) geometry construction even starts.
    isTransitioning = true;
    dragControls.lock();
    ui.moveBtn.disabled = true;
    ui.crossBtn.disabled = true;
    ui.rotateLeftBtn.disabled = true;
    ui.rotateRightBtn.disabled = true;
    ui.nextBtn.hidden = true;

    // Each level declares which optional controls it uses — Cross for
    // the illusion mechanic, Rotate Left/Right for the tower mechanic.
    // Move and Restart are universal.
    const controls = new Set(descriptor.controls ?? ['move', 'cross', 'restart']);
    ui.crossBtn.hidden = !controls.has('cross');
    ui.rotateLeftBtn.hidden = !controls.has('rotate');
    ui.rotateRightBtn.hidden = !controls.has('rotate');

    const built = descriptor.build(camera);
    const newWorld = new THREE.Group();
    newWorld.add(built.group);
    const newRoot = new THREE.Group();
    newRoot.add(newWorld);
    scene.add(newRoot);

    const outgoingRoot = activeRoot;

    if (!skipTransition && outgoingRoot) {
      await animateLevelTransition({
        outgoingRoot,
        incomingRoot: newRoot,
        duration: 1000,
        shouldContinue: () => getGeneration() === myGeneration,
      });
    }
    isTransitioning = false;

    if (getGeneration() !== myGeneration) {
      // Superseded by a later load while this one was mid-flight (e.g.
      // rapid dev level-switching) — dispose only this attempt and
      // leave whatever superseded it alone.
      scene.remove(newRoot);
      disposeObject(newRoot);
      return;
    }

    if (outgoingRoot) {
      scene.remove(outgoingRoot);
      disposeObject(outgoingRoot);
    }

    activeRoot = newRoot;
    activeWorld = newWorld;
    activeLevelId = descriptor.id;
    activeLevelRadius = built.levelRadius;
    sizeShadowCamera(activeLevelRadius);
    onResize();

    const runtimeArgs = {
      built,
      camera,
      canvas,
      world: newWorld,
      ui,
      hasNextLevel: () => getNextLevel(descriptor.id) !== null,
      getGeneration,
      bumpGeneration,
      dragControls,
    };
    activeRuntime = descriptor.type === 'tower' ? createTowerLevelRuntime(runtimeArgs) : createLevelRuntime(runtimeArgs);

    subtitle.textContent = `Level ${descriptor.id} · ${descriptor.name}`;
    devToolbar?.setCurrentLevel(descriptor.id);
    updateUrlLevelParam(descriptor.id);
  }

  ui.moveBtn.addEventListener('click', () => activeRuntime?.doMove());
  ui.crossBtn.addEventListener('click', () => activeRuntime?.doCross());
  ui.rotateLeftBtn.addEventListener('click', () => activeRuntime?.doRotate?.(-1));
  ui.rotateRightBtn.addEventListener('click', () => activeRuntime?.doRotate?.(1));
  ui.restartBtn.addEventListener('click', () => activeRuntime?.restart());
  ui.nextBtn.addEventListener('click', () => {
    if (!activeLevelId) return;
    const next = getNextLevel(activeLevelId);
    if (next) loadLevel(next.id);
  });

  // ---------- dev toolbar ----------
  let devToolbar = null;
  if (devMode) {
    devToolbar = createDevToolbar({
      container: app,
      levels,
      currentLevelId: 1,
      onLoad: (id) => loadLevel(id),
      onRestart: () => activeRuntime?.restart(),
    });
  }

  // ---------- initial load ----------
  const params = new URLSearchParams(window.location.search);
  const requestedLevelId = parseInt(params.get('level'), 10);
  const initialLevelId = getLevelById(requestedLevelId) ? requestedLevelId : levels[0].id;
  loadLevel(initialLevelId, { skipTransition: true });

  // ---------- render loop ----------
  const clock = new THREE.Clock();
  function render() {
    if (activeRuntime) {
      activeRuntime.ghost.update(clock.getElapsedTime(), activeRuntime.isMoving());
    }
    renderer.render(scene, camera);
    requestAnimationFrame(render);
  }
  render();
}
