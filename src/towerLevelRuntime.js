import * as THREE from 'three';
import { walkPath, faceCamera } from './character.js';
import { createGhost } from './ghost.js';

const NORMAL_SPEED = 2.2;
const ROTATE_DURATION = 500; // ~0.5s per quarter turn
const FACE_CAMERA_DURATION = 500;
const DOCK_POSITION_TOLERANCE = 0.08;
const DOCK_DIRECTION_TOLERANCE = 0.995; // cos(~5.7°)

// Drives the Turning Tower puzzle: the ghost's location (A / B / C) and
// the current animation phase are tracked explicitly, and are the only
// things that gate input — there is no inherited "aligned" or
// "complete" flag from any other level, and nothing here is reused
// across a level switch (a fresh runtime is created per load).
//
// Docking is checked physically: the arm's actual exit position and
// outward direction (read from its live world matrix) against each
// island's fixed connector point and approach direction. A screen-space
// overlap alone can't authorize anything here, unlike the illusion
// levels — this mechanic has no camera trick to exploit in the first
// place, since the whole assembly is real, rigid 3D geometry.
export function createTowerLevelRuntime({ built, camera, ui, hasNextLevel, getGeneration, bumpGeneration, dragControls }) {
  const { collarGroup, arm, islands } = built;

  const ghost = createGhost();
  const character = ghost.group;

  let location = 'A'; // 'A' | 'B' | 'C'
  let phase = 'idle'; // 'idle' | 'rotating' | 'walking' | 'celebrating' | 'complete'
  let rotationStep = 0; // 0..3 quarter turns from the initial (empty) orientation
  let activeSignal = null;
  let moving = false;

  function resetCharacter() {
    if (character.parent !== islands.A.group) islands.A.group.add(character);
    character.position.copy(islands.A.startLocal);
    character.rotation.y = 0;
    collarGroup.rotation.y = 0;
    rotationStep = 0;
    location = 'A';
  }
  resetCharacter();

  // Preserves world position (and facing) across a reparent, so moving
  // the ghost from a fixed island onto the rotating collar — or back
  // off it — never produces a visible jump or snap-turn.
  function reparentPreservingWorldTransform(obj, newParent) {
    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    obj.getWorldPosition(worldPos);
    obj.getWorldQuaternion(worldQuat);

    newParent.add(obj);
    newParent.updateMatrixWorld(true);

    obj.position.copy(newParent.worldToLocal(worldPos.clone()));

    const parentWorldQuat = new THREE.Quaternion();
    newParent.getWorldQuaternion(parentWorldQuat);
    const localQuat = parentWorldQuat.clone().invert().multiply(worldQuat);
    obj.rotation.y = new THREE.Euler().setFromQuaternion(localQuat, 'YXZ').y;
  }

  function isDockedWith(islandKey) {
    collarGroup.updateMatrixWorld(true);
    const armExitWorld = arm.exitLocal.clone().applyMatrix4(collarGroup.matrixWorld);
    const armDirWorld = new THREE.Vector3(1, 0, 0).transformDirection(collarGroup.matrixWorld);

    const island = islands[islandKey];
    const posOk = armExitWorld.distanceTo(island.connectorWorld) < DOCK_POSITION_TOLERANCE;
    const dirOk = armDirWorld.dot(island.approachDir) > DOCK_DIRECTION_TOLERANCE;
    return posOk && dirOk;
  }

  function updateUI() {
    const dockedWithA = phase === 'idle' && location === 'A' && isDockedWith('A');
    const dockedWithC = phase === 'idle' && location === 'B' && isDockedWith('C');

    ui.moveBtn.disabled = !(dockedWithA || dockedWithC);
    if (ui.rotateLeftBtn) ui.rotateLeftBtn.disabled = !(phase === 'idle' && (location === 'A' || location === 'B'));
    if (ui.rotateRightBtn) ui.rotateRightBtn.disabled = ui.rotateLeftBtn?.disabled ?? false;
    ui.nextBtn.hidden = !(phase === 'complete' && hasNextLevel());
    ui.winBanner.classList.toggle('hidden', phase !== 'complete');

    ui.hint.textContent = {
      idle: location === 'A'
        ? (dockedWithA ? 'The staircase is docked. Press Move to climb.' : 'Rotate the staircase (Q/E) until it docks with your island.')
        : location === 'B'
          ? (dockedWithC ? 'The staircase is docked. Press Move to descend.' : 'Rotate the staircase (Q/E) toward the glowing exit.')
          : '',
      rotating: 'Turning the staircase…',
      walking: 'Walking…',
      celebrating: '',
      complete: hasNextLevel() ? 'Solved.' : 'Solved. That was the last level.',
    }[phase];
  }

  function setPhase(next) {
    phase = next;
    updateUI();
  }

  function animateRotationTo(from, to, myGeneration) {
    return new Promise((resolve) => {
      const startTime = performance.now();
      function step() {
        if (getGeneration() !== myGeneration) {
          resolve();
          return;
        }
        const t = Math.min((performance.now() - startTime) / ROTATE_DURATION, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        collarGroup.rotation.y = from + (to - from) * eased;
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      }
      requestAnimationFrame(step);
    });
  }

  async function doRotate(direction) {
    if (phase !== 'idle' || (location !== 'A' && location !== 'B')) return;
    const myGeneration = getGeneration();
    setPhase('rotating');

    rotationStep = (rotationStep + direction + 4) % 4;
    const from = collarGroup.rotation.y;
    const to = from + direction * (Math.PI / 2);
    await animateRotationTo(from, to, myGeneration);
    if (getGeneration() !== myGeneration) return;
    collarGroup.rotation.y = to;

    setPhase('idle'); // recomputes docking-dependent button state in updateUI()
  }

  async function celebrate(myGeneration) {
    setPhase('celebrating');
    await faceCamera(character, camera, FACE_CAMERA_DURATION);
    if (getGeneration() !== myGeneration) return;
    setPhase('complete');
  }

  async function doMove() {
    if (phase !== 'idle') return;

    if (location === 'A') {
      if (!isDockedWith('A')) return;
      const myGeneration = getGeneration();
      setPhase('walking');
      moving = true;

      // The arm's own path lives in collarGroup-local space; since
      // rotation is locked for the whole walk, its current world
      // transform is static, so it can be converted once into A's
      // local frame (A is fixed, so this is exactly the frame the
      // ghost is already walking in) and appended after the short
      // walk across the island to the connector. Ascending means
      // walking the arm from its exit (bottom) to its entry (top), the
      // reverse of its natural top-to-bottom order.
      collarGroup.updateMatrixWorld(true);
      islands.A.group.updateMatrixWorld(true);
      const collarToA = new THREE.Matrix4()
        .copy(islands.A.group.matrixWorld)
        .invert()
        .multiply(collarGroup.matrixWorld);
      const armPathInA = arm.pathLocal.map((p) => p.clone().applyMatrix4(collarToA));
      const ascendPath = [islands.A.startLocal.clone(), islands.A.connectorLocal.clone(), ...[...armPathInA].reverse().slice(1)];

      const signal = { cancelled: false };
      activeSignal = signal;
      await walkPath(character, ascendPath, NORMAL_SPEED, { signal });
      moving = false;
      if (getGeneration() !== myGeneration || signal.cancelled) return;

      reparentPreservingWorldTransform(character, collarGroup);
      location = 'B';
      setPhase('idle');
      return;
    }

    if (location === 'B') {
      if (!isDockedWith('C')) return;
      const myGeneration = getGeneration();
      setPhase('walking');
      moving = true;

      // The ghost is already parented to the collar, so the arm's path
      // is walked directly; the island-crossing segment into C is
      // converted into collar-local space the same way, using the
      // current (locked) transforms.
      collarGroup.updateMatrixWorld(true);
      islands.C.group.updateMatrixWorld(true);
      const cToCollar = new THREE.Matrix4()
        .copy(collarGroup.matrixWorld)
        .invert()
        .multiply(islands.C.group.matrixWorld);
      const goalInCollar = islands.C.goalLocal.clone().applyMatrix4(cToCollar);
      const descendPath = [...arm.pathLocal, goalInCollar];

      const signal = { cancelled: false };
      activeSignal = signal;
      await walkPath(character, descendPath, NORMAL_SPEED, { signal });
      moving = false;
      if (getGeneration() !== myGeneration || signal.cancelled) return;

      reparentPreservingWorldTransform(character, islands.C.group);
      location = 'C';
      await celebrate(myGeneration);
    }
  }

  function cancelActiveWalk() {
    if (activeSignal) activeSignal.cancelled = true;
    activeSignal = null;
  }

  function restart() {
    bumpGeneration();
    cancelActiveWalk();
    dragControls.lock(); // this mechanic never uses world-drag rotation at all
    resetCharacter();
    setPhase('idle');
  }

  function handleKeydown(e) {
    if (e.repeat) return; // OS auto-repeat must not queue/spam commands
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      doMove();
    } else if (e.code === 'KeyQ' || e.key === 'q' || e.key === 'Q') {
      e.preventDefault();
      doRotate(-1);
    } else if (e.code === 'KeyE' || e.key === 'e' || e.key === 'E') {
      e.preventDefault();
      doRotate(1);
    }
  }

  dragControls.lock(); // no world-drag rotation in this level
  updateUI();

  return {
    ghost,
    character,
    doMove,
    doRotate,
    restart,
    handleKeydown,
    updateCrossReadiness: () => {}, // no-op: this mechanic has nothing analogous to drag-driven alignment
    cancelActiveWalk,
    isMoving: () => moving,
  };
}
