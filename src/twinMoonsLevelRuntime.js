import * as THREE from 'three';
import { walkPath, faceCamera } from './character.js';
import { createGhost } from './ghost.js';

const QUARTER_TURN = Math.PI / 2;
const DOCK_TOLERANCE = 0.025;
const NAMES = { start: 'the starting island', left: 'the left moon', right: 'the right moon', amber: 'the amber seal', blue: 'the blue seal', exit: 'the exit' };

// Both stair tips must physically meet before the crossing is walkable.
// Collecting a seal is permanent until restart, allowing either route order.
export function createTwinMoonsLevelRuntime({ built, camera, ui, hasNextLevel, getGeneration, bumpGeneration, dragControls }) {
  const { group, bridges, islands } = built;
  const ghost = createGhost();
  const character = ghost.group;
  const seals = new Set();
  let selectedBridge = 'left';
  let location = 'start';
  let phase = 'idle';
  let showHint = false;
  let activeSignal = null;

  function bridgeMatrix(key) {
    group.updateWorldMatrix(true, true);
    return group.matrixWorld.clone().invert().multiply(bridges[key].group.matrixWorld);
  }
  function bridgeTip(key) { return bridges[key].exitLocal.clone().applyMatrix4(bridgeMatrix(key)); }
  function bridgeDirection(key) { return new THREE.Vector3(1, 0, 0).transformDirection(bridgeMatrix(key)); }
  function isDockedWithIsland(name) {
    const island = islands[name];
    return bridgeTip(island.bridge).distanceTo(island.connector) < DOCK_TOLERANCE
      && bridgeDirection(island.bridge).dot(island.direction) > 0.999;
  }
  function bridgesMeet() {
    return bridgeTip('left').distanceTo(bridgeTip('right')) < DOCK_TOLERANCE
      && bridgeDirection('left').dot(bridgeDirection('right')) < -0.999;
  }
  function destination() {
    if (islands[location]) return isDockedWithIsland(location) ? islands[location].bridge : null;
    for (const [name, island] of Object.entries(islands)) {
      if (island.bridge === location && isDockedWithIsland(name)) return name;
    }
    return bridgesMeet() ? (location === 'left' ? 'right' : 'left') : null;
  }
  function canMove() {
    const target = destination();
    return phase === 'idle' && Boolean(target) && (target !== 'exit' || seals.size === 2);
  }

  function puzzleHint() {
    if (islands[location]) {
      const key = islands[location].bridge;
      return isDockedWithIsland(location)
        ? 'The stair is docked. Move onto its moon; you can turn it while standing there.'
        : `Select the ${key} bridge (C), then turn it (Q/E) until its low end meets your island.`;
    }
    if (location === 'left' && !seals.has('amber')) return 'Turn the left stair toward the amber island behind its moon. Move out to collect the seal, then return.';
    if (location === 'right' && !seals.has('blue')) return 'Turn the right stair toward the blue island in front of its moon. Collect the seal and return.';
    if (location === 'right' && seals.size === 2) return 'Turn the right stair east, toward the gold exit. Both seals have opened its gate.';
    return 'Face both stairs inward: left toward the right moon, right toward the left. Move only when their low ends meet.';
  }
  function idleHint() {
    if (showHint) return puzzleHint();
    if (location === 'amber' || location === 'blue') return `${location === 'amber' ? 'Amber' : 'Blue'} seal collected. Find your way back to the moons.`;
    if (destination() === 'exit' && seals.size < 2) return 'The exit asks for both seals. A path alone is not enough.';
    if (canMove()) return `A path reaches ${NAMES[destination()]}. Press Move.`;
    if (location === 'start') return 'Two moons. Two seals. Turn a stair to reach your island.';
    return 'The path is incomplete. Both stair ends must meet to cross between moons.';
  }
  function updateUI() {
    const idle = phase === 'idle';
    ui.moveBtn.disabled = !canMove();
    ui.selectBridgeBtn.disabled = !idle;
    ui.selectBridgeBtn.textContent = `Bridge: ${selectedBridge === 'left' ? 'Left' : 'Right'}`;
    ui.rotateLeftBtn.disabled = !idle;
    ui.rotateRightBtn.disabled = !idle;
    ui.hintBtn.disabled = !idle;
    ui.hintBtn.setAttribute?.('aria-pressed', String(showHint));
    ui.mechanicStatus.textContent = `Amber · ${seals.has('amber') ? 'found' : 'missing'}    /    Blue · ${seals.has('blue') ? 'found' : 'missing'}`;
    ui.nextBtn.hidden = !(phase === 'complete' && hasNextLevel());
    ui.winBanner.classList.toggle('hidden', phase !== 'complete');
    ui.hint.textContent = phase === 'walking' ? 'Walking…'
      : phase === 'rotating' ? `Turning the ${selectedBridge} bridge…`
        : phase === 'unlocking' ? 'Both seals answer. The exit opens…'
          : phase === 'celebrating' ? 'Two moons. One way home.'
            : phase === 'complete' ? 'Solved. The moons are in harmony.' : idleHint();
    built.setSelectedBridge(selectedBridge);
  }

  async function animate(duration, signal, generation, apply) {
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const time = reduced ? Math.min(duration, 150) : duration;
    await new Promise((resolve) => {
      const started = performance.now();
      function frame() {
        if (signal.cancelled || getGeneration() !== generation) return resolve();
        const t = Math.min((performance.now() - started) / time, 1);
        apply(t * t * (3 - 2 * t));
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });
  }
  function doSelectBridge() {
    if (phase !== 'idle') return;
    selectedBridge = selectedBridge === 'left' ? 'right' : 'left';
    showHint = false;
    updateUI();
  }
  async function doRotate(direction) {
    if (phase !== 'idle' || ![-1, 1].includes(direction)) return;
    const generation = getGeneration();
    const signal = { cancelled: false };
    activeSignal = signal;
    const key = selectedBridge;
    const from = bridges[key].group.rotation.y;
    const to = from + direction * QUARTER_TURN;
    phase = 'rotating';
    showHint = false;
    updateUI();
    await animate(650, signal, generation, (t) => built.setBridgeAngle(key, from + (to - from) * t));
    if (signal.cancelled || getGeneration() !== generation) return;
    built.setBridgeAngle(key, to);
    activeSignal = null;
    phase = 'idle';
    updateUI();
  }
  function pathInLevel(key) {
    const matrix = bridgeMatrix(key);
    return bridges[key].pathLocal.map((point) => point.clone().applyMatrix4(matrix));
  }
  async function doMove() {
    if (!canMove()) return;
    const target = destination();
    const generation = getGeneration();
    const signal = { cancelled: false };
    activeSignal = signal;
    group.updateWorldMatrix(true, true);
    group.attach(character);
    let path;
    if (islands[location]) {
      path = [character.position.clone(), islands[location].connector.clone(), ...pathInLevel(target).reverse().slice(1)];
    } else if (islands[target]) {
      path = [...pathInLevel(location), islands[target].center.clone()];
    } else {
      path = [...pathInLevel(location), ...pathInLevel(target).reverse().slice(1)];
    }
    phase = 'walking';
    showHint = false;
    updateUI();
    await walkPath(character, path, 2.8, { signal });
    if (signal.cancelled || getGeneration() !== generation) return;
    location = target;
    if (bridges[target]) {
      group.updateWorldMatrix(true, true);
      bridges[target].group.attach(character);
      selectedBridge = target;
    }
    if ((target === 'amber' || target === 'blue') && !seals.has(target)) {
      seals.add(target);
      built.setSealCollected(target, true);
      if (seals.size === 2) {
        phase = 'unlocking';
        updateUI();
        await animate(700, signal, generation, (t) => built.setExitOpen(t));
        if (signal.cancelled || getGeneration() !== generation) return;
      }
    }
    if (target === 'exit') {
      phase = 'celebrating';
      updateUI();
      await faceCamera(character, camera, 500, { signal });
      if (signal.cancelled || getGeneration() !== generation) return;
      phase = 'complete';
    } else phase = 'idle';
    activeSignal = null;
    updateUI();
  }
  function doHint() {
    if (phase !== 'idle') return;
    showHint = !showHint;
    updateUI();
  }
  function cancelActiveWalk() {
    if (activeSignal) activeSignal.cancelled = true;
    activeSignal = null;
  }
  function reset() {
    group.add(character);
    character.position.copy(islands.start.center);
    character.rotation.set(0, 0, 0);
    location = 'start';
    selectedBridge = 'left';
    phase = 'idle';
    showHint = false;
    seals.clear();
    built.setBridgeAngle('left', QUARTER_TURN);
    built.setBridgeAngle('right', 0);
    built.setSealCollected('amber', false);
    built.setSealCollected('blue', false);
    built.setExitOpen(0);
    updateUI();
  }
  function restart() {
    bumpGeneration();
    cancelActiveWalk();
    dragControls.lock();
    reset();
  }
  function handleKeydown(e) {
    if (e.repeat) return;
    const actions = { Space: doMove, KeyC: doSelectBridge, KeyQ: () => doRotate(-1), KeyE: () => doRotate(1), KeyH: doHint };
    const action = actions[e.code];
    if (action) { e.preventDefault(); action(); }
  }
  dragControls.lock();
  reset();
  return { ghost, character, doMove, doRotate, doSelectBridge, doHint, restart, handleKeydown, cancelActiveWalk,
    isMoving: () => phase === 'walking', updateCrossReadiness: () => {} };
}
