import * as THREE from 'three';
import './style.css';
import { createStaircase, createMarker } from './geometry.js';
import { solveConnectorPosition, normalizeAngle, nearestEquivalentAngle, edgesMatchOnScreen } from './align.js';
import { attachDragRotate } from './controls.js';
import { walkPath } from './character.js';
import { createGhost } from './ghost.js';

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
      <button id="restartBtn">Restart</button>
    </div>
  </div>
  <div id="winBanner" class="hidden">Solved.</div>
`;

const canvas = document.querySelector('#scene');
const hint = document.querySelector('#hint');
const moveBtn = document.querySelector('#moveBtn');
const crossBtn = document.querySelector('#crossBtn');
const restartBtn = document.querySelector('#restartBtn');
const winBanner = document.querySelector('#winBanner');

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

function initGame(renderer) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;

  // ---------- scene ----------
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

  // ---------- world (the turntable everything rotates with) ----------
  const world = new THREE.Group();
  scene.add(world);

  const STAIR_WIDTH = 2.2;

  // Staircase A: fixed at the origin of the world group. Its first
  // tread (the puzzle's starting platform) is enlarged; its last tread
  // is the connector to B and stays standard-sized so the illusion
  // math isn't disturbed.
  const A = createStaircase({ steps: 5, rise: 0.6, run: 1.0, width: STAIR_WIDTH, color: 0xe4dccb, enlargeLast: false });
  world.add(A.group);

  // Staircase B: position solved so its entrance edge lines up with A's
  // exit edge, on screen only, at TARGET_ANGLE — while sitting
  // DEPTH_OFFSET further from the camera in true 3D space. The two
  // staircases' real 3D positions never change; only the world's
  // rotation does.
  const TARGET_ANGLE = THREE.MathUtils.degToRad(42);
  const DEPTH_OFFSET = 6.5;
  // How close the world has to be, live, before Cross is offered at
  // all — deliberately tight ("very very close"), since the actual
  // snap-to-exact happens only once the player commits by pressing
  // Cross, not while they're still searching.
  const NEAR_TOLERANCE = THREE.MathUtils.degToRad(2);
  const PIXEL_TOLERANCE = 1.5;

  // Same color and orientation as A: at the solved angle this makes the
  // whole connecting edge coincide (not just its center point), so the
  // seam between the two pieces disappears completely rather than
  // leaving a sliver of one poking through the other. Its first tread
  // is the connector from A and stays standard-sized; its last tread
  // (the puzzle's ending platform) is enlarged.
  const B = createStaircase({ steps: 4, rise: 0.6, run: 1.0, width: STAIR_WIDTH, color: 0xe4dccb, enlargeFirst: false });
  const bInner = new THREE.Group();
  bInner.add(B.group);

  const connectorWorldLocal = solveConnectorPosition(A.exitLocal, camera, TARGET_ANGLE, DEPTH_OFFSET);
  const bGroup = new THREE.Group();
  bGroup.position.set(connectorWorldLocal.x, connectorWorldLocal.y - B.height, connectorWorldLocal.z);
  bGroup.add(bInner);
  world.add(bGroup);

  // B's own geometry is defined in its own local frame; everything
  // about it that the puzzle logic needs is converted into
  // world-group-local space up front, using its complete transform
  // (bInner's rotation, then bGroup's position) — the same space A's
  // own points already live in, and the space the character's parent
  // (A.group, which has no transform of its own) uses.
  const bTransform = new THREE.Matrix4().makeRotationY(bInner.rotation.y).setPosition(bGroup.position);
  const toWorldLocal = (p) => p.clone().applyMatrix4(bTransform);

  const bPathInWorldLocal = B.pathLocal.map(toWorldLocal);
  const bEntryEdgeInWorldLocal = { a: toWorldLocal(B.entryEdge.a), b: toWorldLocal(B.entryEdge.b) };
  const goalLocal = toWorldLocal(B.exitLocal);

  // Markers
  const startMarker = createMarker(0x6bd08a);
  startMarker.position.copy(A.entryLocal).add(new THREE.Vector3(0, 0.4, 0));
  world.add(startMarker);

  const goalMarker = createMarker(0xf2c14e);
  goalMarker.position.copy(goalLocal).add(new THREE.Vector3(0, 0.4, 0));
  world.add(goalMarker);

  // A subtle glowing bar at A's exit edge — invisible until the world is
  // exactly aligned, at which point it visually sits right on the seam.
  const highlight = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.05, STAIR_WIDTH * 0.92),
    new THREE.MeshBasicMaterial({ color: 0xf2c14e, transparent: true, opacity: 0.85 })
  );
  highlight.position.copy(A.exitLocal);
  highlight.visible = false;
  A.group.add(highlight);

  // Ground void so disconnected platforms read as floating.
  const voidPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: 0x14161f })
  );
  voidPlane.rotation.x = -Math.PI / 2;
  voidPlane.position.y = -6;
  voidPlane.receiveShadow = true;
  scene.add(voidPlane);

  // ---------- character ----------
  const ghost = createGhost();
  const character = ghost.group;
  A.group.add(character);

  function resetCharacter() {
    character.position.copy(A.entryLocal);
    character.rotation.y = 0;
  }
  resetCharacter();

  // ---------- state machine ----------
  // starting -> movingA -> waitingAtJoin -> snapping -> movingB -> complete
  //
  // `crossReady` is a live flag, not a state of its own: it's
  // recomputed on every rotation change while waiting at the join, so
  // dragging away from the solution immediately disables Cross again
  // instead of it staying enabled from an earlier, now-stale position.
  // The exact alignment (the snap) only happens once the player commits
  // by pressing Cross — not while they're still searching — so a click
  // can never fire against a rotation that merely *looked* close.
  let state = 'starting';
  let crossReady = false;
  let generation = 0; // bumped by Restart to invalidate any in-flight async work
  let activeSignal = null; // cancellation flag for the walkPath currently running, if any

  function setState(next) {
    state = next;
    updateUI();
  }

  function updateUI() {
    moveBtn.disabled = state !== 'starting';
    crossBtn.disabled = !(state === 'waitingAtJoin' && crossReady);
    highlight.visible = state === 'waitingAtJoin' && crossReady;
    winBanner.classList.toggle('hidden', state !== 'complete');
    hint.textContent = {
      starting: 'Press Move to walk to the edge.',
      movingA: 'Walking…',
      waitingAtJoin: crossReady
        ? 'The path looks whole. Press Cross.'
        : 'Turn the world — drag, or ←/→ — until the stairs meet.',
      snapping: 'Aligning…',
      movingB: 'Crossing…',
      complete: 'Solved.',
    }[state];
  }

  // ---------- rotation / exact alignment ----------
  function updateCrossReadiness() {
    if (state !== 'waitingAtJoin') return;
    const diff = Math.abs(normalizeAngle(world.rotation.y - TARGET_ANGLE));
    const ready = diff < NEAR_TOLERANCE;
    if (ready !== crossReady) {
      crossReady = ready;
      updateUI();
    }
  }

  // Animates world.rotation.y smoothly from `from` to `to`, resolving
  // once it arrives (or immediately, without finishing, if Restart
  // bumps `generation` mid-animation).
  function animateRotationTo(from, to, duration, myGeneration) {
    return new Promise((resolve) => {
      const startTime = performance.now();
      function step() {
        if (myGeneration !== generation) {
          resolve();
          return;
        }
        const t = Math.min((performance.now() - startTime) / duration, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        world.rotation.y = from + (to - from) * eased;
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      }
      requestAnimationFrame(step);
    });
  }

  const ROTATE_STEP = THREE.MathUtils.degToRad(1);
  function nudgeRotation(delta) {
    if (state !== 'waitingAtJoin') return;
    world.rotation.y += delta;
    updateCrossReadiness();
  }

  const dragControls = attachDragRotate(canvas, world, {
    onChange: updateCrossReadiness,
    onRelease: updateCrossReadiness,
  });
  dragControls.lock(); // rotation only matters once the ghost has reached the join

  // Checking both `code` and `key` isn't just defensive — some input
  // paths (older browsers, certain virtual keyboards/automation) only
  // populate one of the two reliably.
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      if (state === 'starting') doMove();
      else if (state === 'waitingAtJoin' && crossReady) doCross();
    } else if (e.code === 'ArrowLeft' || e.key === 'ArrowLeft') {
      e.preventDefault();
      nudgeRotation(-ROTATE_STEP);
    } else if (e.code === 'ArrowRight' || e.key === 'ArrowRight') {
      e.preventDefault();
      nudgeRotation(ROTATE_STEP);
    }
  });

  // ---------- movement ----------
  const NORMAL_SPEED = 2.2;

  async function doMove() {
    if (state !== 'starting') return;
    const myGeneration = generation;
    setState('movingA');

    const signal = { cancelled: false };
    activeSignal = signal;
    await walkPath(character, A.pathLocal, NORMAL_SPEED, { signal });
    if (myGeneration !== generation || signal.cancelled) return;

    dragControls.unlock();
    setState('waitingAtJoin');
    updateCrossReadiness();
  }

  async function doCross() {
    if (state !== 'waitingAtJoin' || !crossReady) return;
    const myGeneration = generation;
    setState('snapping');
    dragControls.lock();

    // Smoothly finish what the player's rough positioning started: ease
    // the world the rest of the way to the exact solved angle, then
    // flow straight into the crossing — one continuous motion rather
    // than a separate "align" step and a separate "walk" step.
    const from = world.rotation.y;
    const to = nearestEquivalentAngle(from, TARGET_ANGLE);
    await animateRotationTo(from, to, 280, myGeneration);
    if (myGeneration !== generation) return;
    world.rotation.y = to;

    // The real, pixel-space confirmation: both endpoints of A's exit
    // edge against both endpoints of B's entrance edge, not just their
    // center points, and their on-screen directions must agree.
    const ok = edgesMatchOnScreen({
      world,
      camera,
      canvasEl: canvas,
      edgeA: A.exitEdge,
      edgeB: bEntryEdgeInWorldLocal,
      pixelTolerance: PIXEL_TOLERANCE,
    });
    if (!ok) {
      // Shouldn't happen given the solved geometry, but stay safe:
      // don't move the ghost, and re-open the search.
      dragControls.unlock();
      setState('waitingAtJoin');
      updateCrossReadiness();
      return;
    }

    setState('movingB');

    // Instantaneous transfer: the exactly-aligned angle makes A's exit
    // edge and B's entrance edge coincide on screen, so the ghost's
    // position is simply reassigned in a single step — no interpolated
    // frames, so there's nothing to visibly jump across, pause on, or
    // turn to face. Its rotation, hover animation, and everything else
    // about it are left untouched.
    character.position.copy(bPathInWorldLocal[0]);

    const signal = { cancelled: false };
    activeSignal = signal;
    await walkPath(character, bPathInWorldLocal, NORMAL_SPEED, { signal });
    if (myGeneration !== generation || signal.cancelled) return;

    setState('complete');
  }

  function restart() {
    generation += 1;
    if (activeSignal) activeSignal.cancelled = true;
    activeSignal = null;

    dragControls.lock();
    world.rotation.y = 0;
    crossReady = false;
    resetCharacter();
    setState('starting');
  }

  moveBtn.addEventListener('click', doMove);
  crossBtn.addEventListener('click', doCross);
  restartBtn.addEventListener('click', restart);

  updateUI();

  // ---------- resize ----------
  // The world only ever rotates about Y through the origin, so the
  // farthest any level geometry gets from the origin is a rotation-
  // invariant bound on how much the camera needs to see — sized once,
  // not re-derived per frame or per angle.
  const levelPoints = [A.entryLocal, A.exitLocal, ...bPathInWorldLocal, goalLocal];
  const LEVEL_RADIUS = Math.max(...levelPoints.map((p) => p.length())) + 1.2;
  const MIN_FRUSTUM = 6;

  // The directional light's shadow camera defaults to a small fixed
  // frustum (±5 units) — too small for this level, which shows up as a
  // hard rectangular seam on the ground plane where shadow coverage
  // cuts off. Size it to the same rotation-invariant level radius.
  sun.shadow.camera.left = -LEVEL_RADIUS;
  sun.shadow.camera.right = LEVEL_RADIUS;
  sun.shadow.camera.top = LEVEL_RADIUS;
  sun.shadow.camera.bottom = -LEVEL_RADIUS;
  sun.shadow.camera.far = LEVEL_RADIUS * 4;
  sun.shadow.camera.updateProjectionMatrix();

  function onResize() {
    aspect = window.innerWidth / window.innerHeight;
    // Extra vertical margin leaves room for the title and hint/button
    // bars, which overlay the canvas rather than resizing it.
    const verticalNeeded = LEVEL_RADIUS * 1.35;
    const horizontalNeeded = LEVEL_RADIUS / Math.max(aspect, 0.001);
    const FRUSTUM = Math.max(MIN_FRUSTUM, verticalNeeded, horizontalNeeded);

    // Only the projection's extents change here — camera.position and
    // camera.lookAt (its viewing direction) are never touched, so
    // resizing reframes the shot without re-aiming it.
    camera.left = -FRUSTUM * aspect;
    camera.right = FRUSTUM * aspect;
    camera.top = FRUSTUM;
    camera.bottom = -FRUSTUM;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', onResize);
  onResize();

  // ---------- render loop ----------
  const clock = new THREE.Clock();
  function render() {
    ghost.update(clock.getElapsedTime(), state === 'movingA' || state === 'movingB');
    renderer.render(scene, camera);
    requestAnimationFrame(render);
  }
  render();
}
