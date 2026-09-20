import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildCounterweightLevel, LIFT_HEIGHTS } from '../src/levels/counterweightBuilder.js';
import { createCounterweightLevelRuntime } from '../src/counterweightLevelRuntime.js';

// Use the production animation code with a deterministic clock. No renderer,
// timers, or DOM implementation is needed for the puzzle's state transitions.
function installAnimationClock(t) {
  const descriptors = new Map(['performance', 'requestAnimationFrame', 'cancelAnimationFrame']
    .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let now = 0;
  let nextId = 1;
  const callbacks = new Map();
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } });
  globalThis.requestAnimationFrame = (callback) => {
    const id = nextId++;
    callbacks.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => callbacks.delete(id);
  t.after(() => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });

  async function tick(milliseconds = 20) {
    now += milliseconds;
    const frame = [...callbacks.values()];
    callbacks.clear();
    for (const callback of frame) callback(now);
    // Let awaited animation completions schedule their next phase.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  async function finish(promise) {
    let settled = false;
    let failure;
    Promise.resolve(promise).then(() => { settled = true; }, (error) => { failure = error; settled = true; });
    for (let frame = 0; !settled && frame < 3_000; frame++) await tick();
    assert.ok(settled, 'the command must finish within 60 seconds of simulated time');
    if (failure) throw failure;
  }

  return { tick, finish };
}

function element() {
  const classes = new Set();
  return {
    disabled: false,
    hidden: false,
    textContent: '',
    classList: {
      toggle(name, force) {
        const enabled = force ?? !classes.has(name);
        if (enabled) classes.add(name);
        else classes.delete(name);
        return enabled;
      },
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
    },
  };
}

function setup(t, { hasNextLevel = false } = {}) {
  const clock = installAnimationClock(t);
  const built = buildCounterweightLevel();
  const camera = new THREE.OrthographicCamera(-12, 12, 9, -9, 0.1, 100);
  camera.position.set(9, 8, 11);
  camera.lookAt(0, 2, 0);
  const ui = Object.fromEntries(['moveBtn', 'balanceLeftBtn', 'balanceRightBtn', 'nextBtn', 'winBanner', 'hint', 'mechanicStatus']
    .map((key) => [key, element()]));
  let generation = 0;
  let dragLocked = false;
  const runtime = createCounterweightLevelRuntime({
    built,
    camera,
    ui,
    hasNextLevel: () => hasNextLevel,
    getGeneration: () => generation,
    bumpGeneration: () => ++generation,
    dragControls: { lock() { dragLocked = true; }, unlock() { dragLocked = false; } },
  });
  assert.equal(dragLocked, true, 'the counterweight puzzle does not rotate the entire world');
  t.after(() => {
    runtime.cancelActiveWalk();
    const geometries = new Set();
    const materials = new Set();
    built.group.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) for (const material of [object.material].flat()) materials.add(material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  });
  return { built, runtime, ui, ...clock };
}

function close(actual, expected, description) {
  assert.ok(Math.abs(actual - expected) < 1e-7, `${description}: expected ${expected}, got ${actual}`);
}

function positionEquals(actual, expected, description) {
  assert.ok(actual.distanceTo(expected) < 1e-7, `${description}: expected ${expected.toArray()}, got ${actual.toArray()}`);
}

function liftHeights(built, leftIndex) {
  close(built.lifts.A.group.position.y, LIFT_HEIGHTS[leftIndex], 'left lift deck height');
  close(built.lifts.B.group.position.y, LIFT_HEIGHTS[2 - leftIndex], 'right lift deck height');
}

test('the full route requires both lifts and the central staircase, then reaches the exit', async (t) => {
  const { built, runtime, ui, finish, tick } = setup(t);
  liftHeights(built, 0);
  positionEquals(runtime.character.position, built.startLocal, 'initial ghost position');
  assert.equal(ui.moveBtn.disabled, false);

  await finish(runtime.doMove());
  assert.equal(runtime.character.parent, built.lifts.A.group, 'boarding attaches the ghost to the left lift');
  assert.equal(ui.moveBtn.disabled, true, 'a low lift cannot reach the central landing');

  const localPosition = runtime.character.position.clone();
  const initialWorldPosition = runtime.character.getWorldPosition(new THREE.Vector3());
  const rising = runtime.doBalance(1);
  await tick(100);
  const risingWorldPosition = runtime.character.getWorldPosition(new THREE.Vector3());
  assert.ok(risingWorldPosition.y > initialWorldPosition.y, 'the ghost rises with the animated deck');
  positionEquals(runtime.character.position, localPosition, 'riding preserves the ghost position on its deck');
  close(risingWorldPosition.y - initialWorldPosition.y, built.lifts.A.group.position.y - LIFT_HEIGHTS[0], 'ghost and lift move the same distance');
  await finish(rising);
  liftHeights(built, 1);

  await finish(runtime.doMove());
  assert.equal(runtime.character.parent, built.group, 'the ghost leaves the lift for the fixed center');
  positionEquals(runtime.character.position, built.middleLocal, 'the center landing');
  const centerPosition = runtime.character.getWorldPosition(new THREE.Vector3());
  await finish(runtime.doBalance(1));
  liftHeights(built, 2);
  positionEquals(runtime.character.getWorldPosition(new THREE.Vector3()), centerPosition, 'moving the lifts does not move a ghost on fixed stone');

  await finish(runtime.doMove());
  assert.equal(runtime.character.parent, built.lifts.B.group, 'descending the stairs boards the right lift');
  await finish(runtime.doBalance(-1));
  liftHeights(built, 1);
  assert.equal(ui.moveBtn.disabled, true, 'the exit is higher than the middle lift stop');
  await finish(runtime.doBalance(-1));
  liftHeights(built, 0);
  await finish(runtime.doMove());

  assert.equal(runtime.character.parent, built.group);
  positionEquals(runtime.character.position, built.goalLocal, 'completed route reaches the goal');
  assert.equal(ui.winBanner.classList.contains('hidden'), false);
  assert.match(ui.hint.textContent, /solved/i);
  assert.equal(ui.nextBtn.hidden, true, 'no nonexistent next level is offered');
  assert.equal(ui.moveBtn.disabled, true);
  assert.equal(ui.balanceLeftBtn.disabled, true);
  assert.equal(ui.balanceRightBtn.disabled, true);
  assert.equal(runtime.isMoving(), false);
});

test('Move never crosses a gap when the adjacent lift has the wrong height', async (t) => {
  const { built, runtime, ui, finish } = setup(t);
  async function blockedMove(description) {
    const parent = runtime.character.parent;
    const position = runtime.character.position.clone();
    assert.equal(ui.moveBtn.disabled, true, description);
    await finish(runtime.doMove());
    assert.equal(runtime.character.parent, parent, description);
    positionEquals(runtime.character.position, position, description);
  }

  await finish(runtime.doBalance(1));
  await blockedMove('the start cannot board a raised left lift');
  runtime.restart();
  await finish(runtime.doMove());
  await blockedMove('a low left lift cannot exit to the center');
  await finish(runtime.doBalance(1));
  await finish(runtime.doBalance(1));
  await blockedMove('a high left lift cannot exit to the center either');
  await finish(runtime.doBalance(-1));
  await finish(runtime.doMove());
  await blockedMove('the central stairs cannot reach a raised right lift');
  await finish(runtime.doBalance(1));
  await finish(runtime.doMove());
  await blockedMove('the low right lift cannot reach the exit');
  await finish(runtime.doBalance(-1));
  await blockedMove('the middle right lift cannot reach the exit');
  await finish(runtime.doBalance(-1));
  assert.equal(ui.moveBtn.disabled, false);
  liftHeights(built, 0);
});

test('repeated or conflicting commands during animations do not queue extra moves', async (t) => {
  const { built, runtime, ui, finish, tick } = setup(t);
  const boarding = runtime.doMove();
  assert.equal(runtime.isMoving(), true);
  assert.equal(ui.moveBtn.disabled, true);
  assert.equal(ui.balanceLeftBtn.disabled, true);
  assert.equal(ui.balanceRightBtn.disabled, true);
  await runtime.doMove();
  await runtime.doBalance(1);
  await finish(boarding);
  assert.equal(runtime.character.parent, built.lifts.A.group);
  liftHeights(built, 0);

  const raising = runtime.doBalance(1);
  await tick(100);
  assert.equal(ui.moveBtn.disabled, true);
  assert.equal(ui.balanceLeftBtn.disabled, true);
  assert.equal(ui.balanceRightBtn.disabled, true);
  await runtime.doBalance(1);
  await runtime.doBalance(-1);
  await runtime.doMove();
  await finish(raising);
  await tick(2_000);
  liftHeights(built, 1);
  assert.equal(runtime.character.parent, built.lifts.A.group, 'ignored Move does not run later');
  assert.equal(ui.moveBtn.disabled, false);
});

test('Restart during a walk cancels the old route and allows a new walk immediately', async (t) => {
  const { built, runtime, ui, finish, tick } = setup(t);
  const oldWalk = runtime.doMove();
  await tick(100);
  runtime.restart();
  positionEquals(runtime.character.position, built.startLocal, 'restart resets the ghost');
  liftHeights(built, 0);
  assert.equal(runtime.isMoving(), false);
  assert.equal(ui.moveBtn.disabled, false);
  const newWalk = runtime.doMove();
  await tick(20);
  assert.equal(runtime.isMoving(), true, 'cancelled callbacks cannot clear the new walk state');
  await finish(oldWalk);
  await finish(newWalk);
  assert.equal(runtime.character.parent, built.lifts.A.group);
  liftHeights(built, 0);
});

test('Restart during lift travel resets both decks and prevents stale animation writes', async (t) => {
  const { built, runtime, ui, finish, tick } = setup(t);
  await finish(runtime.doMove());
  const oldLiftTravel = runtime.doBalance(1);
  await tick(100);
  assert.ok(built.lifts.A.group.position.y > LIFT_HEIGHTS[0]);
  runtime.restart();
  positionEquals(runtime.character.position, built.startLocal, 'restart puts the ghost back on the start');
  liftHeights(built, 0);
  assert.equal(runtime.isMoving(), false);
  assert.equal(ui.moveBtn.disabled, false);
  await finish(oldLiftTravel);
  await tick(2_000);
  liftHeights(built, 0);
  positionEquals(runtime.character.position, built.startLocal, 'the cancelled lift cannot carry the reset ghost away');
  await finish(runtime.doMove());
  assert.equal(runtime.character.parent, built.lifts.A.group);
});

test('lift controls stop at the highest and lowest positions without drifting', async (t) => {
  const { built, runtime, ui, finish } = setup(t);
  await finish(runtime.doBalance(-1));
  liftHeights(built, 0);
  assert.equal(ui.balanceRightBtn.disabled, true);
  await finish(runtime.doBalance(1));
  await finish(runtime.doBalance(1));
  for (let i = 0; i < 3; i++) await finish(runtime.doBalance(1));
  liftHeights(built, 2);
  assert.equal(ui.balanceLeftBtn.disabled, true);
  await finish(runtime.doBalance(-1));
  await finish(runtime.doBalance(-1));
  for (let i = 0; i < 3; i++) await finish(runtime.doBalance(-1));
  liftHeights(built, 0);
  positionEquals(runtime.character.position, built.startLocal, 'operating the lifts does not move a ghost standing on the start');
});

test('Restart during the final turn cancels celebration without changing the reset ghost', async (t) => {
  const { built, runtime, ui, finish, tick } = setup(t, { hasNextLevel: true });
  await finish(runtime.doMove());
  await finish(runtime.doBalance(1));
  await finish(runtime.doMove());
  await finish(runtime.doBalance(1));
  await finish(runtime.doMove());
  await finish(runtime.doBalance(-1));
  await finish(runtime.doBalance(-1));

  const finishing = runtime.doMove();
  for (let frame = 0; runtime.isMoving() && frame < 1_000; frame++) await tick();
  assert.equal(runtime.isMoving(), false, 'the final walk finishes');
  positionEquals(runtime.character.position, built.goalLocal, 'celebration starts at the goal');
  assert.equal(ui.winBanner.classList.contains('hidden'), true, 'the final turn is still in progress');
  runtime.restart();
  await finish(finishing);
  await tick(1_000);
  positionEquals(runtime.character.position, built.startLocal, 'the reset ghost remains on the start');
  close(runtime.character.rotation.y, 0, 'a cancelled turn cannot rotate the reset ghost');
  liftHeights(built, 0);
  assert.equal(ui.moveBtn.disabled, false);
  assert.equal(ui.nextBtn.hidden, true);
  assert.equal(ui.winBanner.classList.contains('hidden'), true);
  assert.doesNotMatch(ui.hint.textContent, /solved/i);
});
