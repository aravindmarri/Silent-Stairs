import * as THREE from 'three';
import { normalizeAngle, nearestEquivalentAngle, edgesMatchOnScreen } from './align.js';
import { walkPath, faceCamera } from './character.js';
import { createGhost } from './ghost.js';

const NORMAL_SPEED = 2.2;
// How close the world has to be, live, before Cross is offered at all —
// deliberately tight ("very very close"), since the actual snap-to-
// exact happens only once the player commits by pressing Cross, not
// while they're still searching.
const NEAR_TOLERANCE = THREE.MathUtils.degToRad(2);
const PIXEL_TOLERANCE = 1.5;
const ROTATE_STEP = THREE.MathUtils.degToRad(1);
const SNAP_DURATION = 280;
const FACE_CAMERA_DURATION = 500;

// Drives one level's play-through: starting -> walking -> waitingAtJoin
// -> snapping -> walking -> ... (once per connection) -> celebrating ->
// complete. Generalizes the single-connection flow to any number of
// staircases/connections a level's `built` descriptor provides.
//
// `getGeneration`/`bumpGeneration` share ONE counter across the whole
// game (owned by main.js) — every async step captures the generation it
// started with and checks it after every await/frame, so a Restart or a
// level switch invalidates in-flight work here exactly the same way it
// invalidates an in-flight transition, with no special-casing needed.
export function createLevelRuntime({ built, camera, canvas, world, ui, hasNextLevel, getGeneration, bumpGeneration, dragControls }) {
  const { stairs, connections, startLocal } = built;

  const ghost = createGhost();
  const character = ghost.group;
  built.group.add(character);

  function resetCharacter() {
    character.position.copy(startLocal);
    character.rotation.y = 0;
  }
  resetCharacter();

  let state = 'starting';
  let crossReady = false;
  let pendingConnection = 0;
  let activeSignal = null;
  let moving = false;

  function updateUI() {
    ui.moveBtn.disabled = state !== 'starting';
    ui.crossBtn.disabled = !(state === 'waitingAtJoin' && crossReady);
    ui.nextBtn.hidden = !(state === 'complete' && hasNextLevel());
    ui.winBanner.classList.toggle('hidden', state !== 'complete');

    for (const conn of connections) conn.highlight.visible = false;
    if (state === 'waitingAtJoin' && crossReady) connections[pendingConnection].highlight.visible = true;

    const progress = connections.length > 1 ? `Connection ${pendingConnection + 1} of ${connections.length}: ` : '';
    ui.hint.textContent = {
      starting: 'Press Move to walk to the edge.',
      walking: 'Walking…',
      waitingAtJoin: progress + (crossReady ? 'The path looks whole. Press Cross.' : 'Turn the world — drag, or ←/→ — until the stairs meet.'),
      snapping: 'Aligning…',
      celebrating: '',
      complete: hasNextLevel() ? 'Solved.' : 'Solved. That was the last level.',
    }[state];
  }

  function setState(next) {
    state = next;
    updateUI();
  }

  function updateCrossReadiness() {
    if (state !== 'waitingAtJoin') return;
    const target = connections[pendingConnection].targetAngle;
    const diff = Math.abs(normalizeAngle(world.rotation.y - target));
    const ready = diff < NEAR_TOLERANCE;
    if (ready !== crossReady) {
      crossReady = ready;
      updateUI();
    }
  }

  function nudgeRotation(delta) {
    if (state !== 'waitingAtJoin') return;
    world.rotation.y += delta;
    updateCrossReadiness();
  }

  // Animates world.rotation.y smoothly from `from` to `to`, resolving
  // once it arrives (or immediately, without finishing, if superseded
  // by a Restart or level switch mid-animation).
  function animateRotationTo(from, to, duration, myGeneration) {
    return new Promise((resolve) => {
      const startTime = performance.now();
      function step() {
        if (getGeneration() !== myGeneration) {
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

  async function walkStair(stairIndex, myGeneration) {
    moving = true;
    const signal = { cancelled: false };
    activeSignal = signal;
    await walkPath(character, stairs[stairIndex].pathLocal, NORMAL_SPEED, { signal });
    moving = false;
    return getGeneration() === myGeneration && !signal.cancelled;
  }

  async function afterReachingStairEnd(myGeneration) {
    if (pendingConnection >= connections.length) {
      await celebrate(myGeneration);
      return;
    }
    dragControls.unlock(); // only now does rotation matter — not while celebrating
    setState('waitingAtJoin');
    updateCrossReadiness();
  }

  async function doMove() {
    if (state !== 'starting') return;
    const myGeneration = getGeneration();
    setState('walking');

    const ok = await walkStair(0, myGeneration);
    if (!ok) return;

    await afterReachingStairEnd(myGeneration);
  }

  async function doCross() {
    if (state !== 'waitingAtJoin' || !crossReady) return;
    const myGeneration = getGeneration();
    const conn = connections[pendingConnection];
    setState('snapping');
    dragControls.lock();

    // Smoothly finish what the player's rough positioning started: ease
    // the world the rest of the way to the exact solved angle, then
    // flow straight into the crossing — one continuous motion rather
    // than a separate "align" step and a separate "walk" step.
    const from = world.rotation.y;
    const to = nearestEquivalentAngle(from, conn.targetAngle);
    await animateRotationTo(from, to, SNAP_DURATION, myGeneration);
    if (getGeneration() !== myGeneration) return;
    world.rotation.y = to;

    // The real, pixel-space confirmation: both endpoints of the exit
    // edge against both endpoints of the entrance edge, not just their
    // center points, and their on-screen directions must agree.
    const ok = edgesMatchOnScreen({
      world,
      camera,
      canvasEl: canvas,
      edgeA: conn.fromExitEdge,
      edgeB: conn.toEntryEdge,
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

    setState('walking');

    // Instantaneous transfer: the exactly-aligned angle makes the exit
    // edge and entrance edge coincide on screen, so the ghost's position
    // is simply reassigned in a single step — no interpolated frames,
    // so there's nothing to visibly jump across, pause on, or turn to
    // face. Its rotation, hover animation, and everything else about it
    // are left untouched.
    const nextStair = pendingConnection + 1;
    character.position.copy(stairs[nextStair].pathLocal[0]);

    const ok2 = await walkStair(nextStair, myGeneration);
    if (!ok2) return;

    pendingConnection += 1;
    await afterReachingStairEnd(myGeneration);
  }

  async function celebrate(myGeneration) {
    setState('celebrating');
    await faceCamera(character, camera, FACE_CAMERA_DURATION);
    if (getGeneration() !== myGeneration) return;
    setState('complete');
  }

  function cancelActiveWalk() {
    if (activeSignal) activeSignal.cancelled = true;
    activeSignal = null;
  }

  function restart() {
    bumpGeneration();
    cancelActiveWalk();

    dragControls.lock();
    world.rotation.y = 0;
    crossReady = false;
    pendingConnection = 0;
    resetCharacter();
    setState('starting');
  }

  function handleKeydown(e) {
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
  }

  dragControls.lock(); // rotation only matters once the ghost has reached a join
  updateUI();

  return {
    ghost,
    character,
    doMove,
    doCross,
    restart,
    handleKeydown,
    updateCrossReadiness,
    cancelActiveWalk,
    isMoving: () => moving,
  };
}
