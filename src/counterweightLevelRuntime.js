import * as THREE from 'three';
import { walkPath, faceCamera } from './character.js';
import { createGhost } from './ghost.js';
import { LIFT_HEIGHTS } from './levels/counterweightBuilder.js';

const LIFT_DURATION = 1050;
const DOCK_TOLERANCE = 0.01;

// The central staircase is a safe place to stand while changing the
// balance. Its top docks with the left lift at MID; its bottom docks
// with the right lift at LOW. A rider is a child of the moving deck.
export function createCounterweightLevelRuntime({ built, camera, ui, hasNextLevel, getGeneration, bumpGeneration, dragControls }) {
  const { group, lifts, startLocal, middleLocal, middleToRightPath, goalPath } = built;
  const ghost = createGhost();
  const character = ghost.group;
  let location = 'start';
  let phase = 'idle';
  let balance = 0;
  let activeSignal = null;

  const isDocked = (lift, height) => Math.abs(lifts[lift].group.position.y - height) < DOCK_TOLERANCE;
  function canMove() {
    if (phase !== 'idle') return false;
    if (location === 'start') return isDocked('A', LIFT_HEIGHTS[0]);
    if (location === 'left') return isDocked('A', LIFT_HEIGHTS[1]);
    if (location === 'middle') return isDocked('B', LIFT_HEIGHTS[0]);
    if (location === 'right') return isDocked('B', LIFT_HEIGHTS[2]);
    return false;
  }

  function updateUI() {
    const idle = phase === 'idle';
    ui.moveBtn.disabled = !canMove();
    ui.balanceLeftBtn.disabled = !idle || balance === 2;
    ui.balanceRightBtn.disabled = !idle || balance === 0;
    ui.nextBtn.hidden = !(phase === 'complete' && hasNextLevel());
    ui.winBanner.classList.toggle('hidden', phase !== 'complete');
    const names = ['low', 'middle', 'high'];
    ui.mechanicStatus.textContent = phase === 'balancing'
      ? 'One rises. One falls.'
      : `Left · ${names[balance]}    /    Right · ${names[2 - balance]}`;

    const hints = {
      start: canMove()
        ? 'Step onto the left lift. Press Move.'
        : 'Lower the left lift to your island. Press Right ↑ (E).',
      left: canMove()
        ? 'The top stair is within reach. Press Move to step off.'
        : balance === 0
          ? 'Ride to the top stair. Press Left ↑ (Q).'
          : 'A little too high. Press Right ↑ (E) to lower your lift.',
      middle: canMove()
        ? 'The right lift meets the bottom stair. Press Move.'
        : 'Stay on the stairs. Press Left ↑ (Q) to lower the right lift.',
      right: canMove()
        ? 'The exit is within reach. Press Move.'
        : 'Ride the right lift to the exit. Press Right ↑ (E).',
    };
    ui.hint.textContent = phase === 'walking' ? 'Walking…'
      : phase === 'balancing' ? 'The counterweights are moving…'
        : phase === 'celebrating' ? 'A quiet balance.'
          : phase === 'complete' ? 'Solved. A perfect balance.'
            : hints[location];
  }

  function reset() {
    group.add(character);
    character.position.copy(startLocal);
    character.rotation.set(0, 0, 0);
    location = 'start';
    phase = 'idle';
    balance = 0;
    built.setBalance(0);
  }

  async function doBalance(direction) {
    if (phase !== 'idle' || (direction !== 1 && direction !== -1)) return;
    const target = balance + direction;
    if (target < 0 || target > 2) return;
    const myGeneration = getGeneration();
    const signal = { cancelled: false };
    activeSignal = signal;
    phase = 'balancing';
    updateUI();
    const from = balance;
    const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const duration = reduceMotion ? 180 : LIFT_DURATION;
    await new Promise((resolve) => {
      const started = performance.now();
      function step() {
        if (signal.cancelled || getGeneration() !== myGeneration) return resolve();
        const t = Math.min((performance.now() - started) / duration, 1);
        const eased = t * t * (3 - 2 * t);
        built.setBalance(from + (target - from) * eased);
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      }
      requestAnimationFrame(step);
    });
    if (signal.cancelled || getGeneration() !== myGeneration) return;
    balance = target;
    built.setBalance(balance);
    activeSignal = null;
    phase = 'idle';
    updateUI();
  }

  async function doMove() {
    if (!canMove()) return;
    const myGeneration = getGeneration();
    const signal = { cancelled: false };
    activeSignal = signal;
    // Walk in the fixed level's coordinates; only attach to a deck
    // once the ghost is fully aboard and that deck is stationary.
    group.updateWorldMatrix(true, true);
    group.attach(character);
    const path = [character.position.clone()];
    let destination;
    if (location === 'start') {
      path.push(lifts.A.group.position.clone());
      destination = 'left';
    } else if (location === 'left') {
      path.push(middleLocal.clone());
      destination = 'middle';
    } else if (location === 'middle') {
      path.push(...middleToRightPath.slice(1).map((p) => p.clone()), lifts.B.group.position.clone());
      destination = 'right';
    } else {
      path.push(...goalPath.map((p) => p.clone()));
      destination = 'goal';
    }
    phase = 'walking';
    updateUI();
    await walkPath(character, path, 2.2, { signal });
    if (signal.cancelled || getGeneration() !== myGeneration) return;
    location = destination;
    if (destination === 'left' || destination === 'right') {
      const deck = lifts[destination === 'left' ? 'A' : 'B'].group;
      group.updateWorldMatrix(true, true);
      deck.attach(character);
    }
    if (destination === 'goal') {
      phase = 'celebrating';
      updateUI();
      await faceCamera(character, camera, 500, { signal });
      if (signal.cancelled || getGeneration() !== myGeneration) return;
      phase = 'complete';
    } else {
      phase = 'idle';
    }
    activeSignal = null;
    updateUI();
  }

  function cancelActiveWalk() {
    if (activeSignal) activeSignal.cancelled = true;
    activeSignal = null;
  }
  function restart() {
    bumpGeneration();
    cancelActiveWalk();
    dragControls.lock();
    reset();
    updateUI();
  }
  function handleKeydown(e) {
    if (e.repeat) return;
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      doMove();
    } else if (e.code === 'KeyQ' || e.key?.toLowerCase() === 'q') {
      e.preventDefault();
      doBalance(1);
    } else if (e.code === 'KeyE' || e.key?.toLowerCase() === 'e') {
      e.preventDefault();
      doBalance(-1);
    }
  }

  reset();
  dragControls.lock();
  updateUI();
  return {
    ghost, character, doMove, doBalance, restart, handleKeydown, cancelActiveWalk,
    isMoving: () => phase === 'walking',
    updateCrossReadiness: () => {},
  };
}
