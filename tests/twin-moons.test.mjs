import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildTwinMoonsLevel } from '../src/levels/twinMoonsBuilder.js';
import { createTwinMoonsLevelRuntime } from '../src/twinMoonsLevelRuntime.js';

// Run the production walking, rotation, and gate animations deterministically.
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
    for (let i = 0; i < 5; i++) await Promise.resolve();
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
  const attributes = new Map();
  return {
    disabled: false, hidden: false, textContent: '',
    setAttribute: (name, value) => attributes.set(name, String(value)),
    getAttribute: (name) => attributes.get(name) ?? null,
    classList: {
      toggle(name, force) {
        const enabled = force ?? !classes.has(name);
        if (enabled) classes.add(name);
        else classes.delete(name);
        return enabled;
      },
      contains: (name) => classes.has(name),
    },
  };
}

function setup(t, { hasNextLevel = false } = {}) {
  const clock = installAnimationClock(t);
  const built = buildTwinMoonsLevel();
  const state = { seals: { amber: false, blue: false }, exitOpen: 0 };
  const setSealCollected = built.setSealCollected.bind(built);
  built.setSealCollected = (name, value) => {
    state.seals[name] = value;
    return setSealCollected(name, value);
  };
  const setExitOpen = built.setExitOpen.bind(built);
  built.setExitOpen = (value) => {
    state.exitOpen = value;
    return setExitOpen(value);
  };
  const camera = new THREE.OrthographicCamera(-12, 12, 9, -9, 0.1, 100);
  camera.position.set(9, 8, 11);
  camera.lookAt(0, 2, 0);
  const ui = Object.fromEntries(['moveBtn', 'selectBridgeBtn', 'rotateLeftBtn', 'rotateRightBtn', 'hintBtn', 'mechanicStatus', 'hint', 'nextBtn', 'winBanner']
    .map((key) => [key, element()]));
  let generation = 0;
  let dragLocked = false;
  const runtime = createTwinMoonsLevelRuntime({
    built, camera, ui,
    hasNextLevel: () => hasNextLevel,
    getGeneration: () => generation,
    bumpGeneration: () => ++generation,
    dragControls: { lock() { dragLocked = true; }, unlock() { dragLocked = false; } },
  });
  assert.equal(dragLocked, true, 'the two bridges rotate independently of the world');
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
  return { built, runtime, ui, state, ...clock };
}

function positionEquals(actual, expected, description) {
  assert.ok(actual.distanceTo(expected) < 1e-7, `${description}: expected ${expected.toArray()}, got ${actual.toArray()}`);
}
function close(actual, expected, description) {
  assert.ok(Math.abs(actual - expected) < 1e-7, `${description}: expected ${expected}, got ${actual}`);
}
function atIsland({ runtime, built }, name) {
  assert.equal(runtime.character.parent, built.group, `ghost stands on fixed ${name} island`);
  positionEquals(runtime.character.position, built.islands[name].center, `ghost at ${name}`);
}
function atMoon({ runtime, built }, name) {
  assert.equal(runtime.character.parent, built.bridges[name].group, `ghost rides the ${name} bridge`);
  positionEquals(runtime.character.position, built.bridges[name].pathLocal[0], `ghost at ${name} moon`);
}
async function blockedMove({ runtime, ui, finish }, description) {
  const parent = runtime.character.parent;
  const position = runtime.character.position.clone();
  assert.equal(ui.moveBtn.disabled, true, description);
  await finish(runtime.doMove());
  assert.equal(runtime.character.parent, parent, description);
  positionEquals(runtime.character.position, position, description);
}
async function boardLeft(context) {
  const { runtime, finish } = context;
  await finish(runtime.doRotate(1)); // north -> west, docking at start
  await finish(runtime.doMove());
  atMoon(context, 'left');
}
async function collectAmber(context) {
  const { runtime, finish } = context;
  await boardLeft(context);
  await finish(runtime.doRotate(-1)); // west -> north
  await finish(runtime.doMove());
  atIsland(context, 'amber');
  await finish(runtime.doMove());
  atMoon(context, 'left');
}
async function connectRight(context) {
  const { runtime, finish } = context;
  runtime.doSelectBridge();
  await finish(runtime.doRotate(1));
  await finish(runtime.doRotate(1)); // right faces west; left already faces east
  await finish(runtime.doMove());
  atMoon(context, 'right');
}
async function prepareSecondSeal(context) {
  const { runtime, finish } = context;
  await collectAmber(context);
  await finish(runtime.doRotate(-1)); // north -> east
  await connectRight(context);
  await finish(runtime.doRotate(1)); // west -> south, docking at blue
}
async function prepareExit(context) {
  const { runtime, finish } = context;
  await prepareSecondSeal(context);
  await finish(runtime.doMove());
  atIsland(context, 'blue');
  await finish(runtime.doMove());
  atMoon(context, 'right');
  await finish(runtime.doRotate(1)); // south -> east
}
function assertReset(context) {
  const { runtime, built, ui, state } = context;
  atIsland(context, 'start');
  close(runtime.character.rotation.y, 0, 'restart resets the ghost orientation');
  close(built.bridges.left.group.rotation.y, Math.PI / 2, 'left bridge resets north');
  close(built.bridges.right.group.rotation.y, 0, 'right bridge resets east');
  assert.deepEqual(state.seals, { amber: false, blue: false });
  assert.equal(state.exitOpen, 0);
  assert.equal(ui.moveBtn.disabled, true);
  assert.equal(ui.selectBridgeBtn.textContent, 'Bridge: Left');
  assert.equal(ui.rotateLeftBtn.disabled, false);
  assert.equal(ui.nextBtn.hidden, true);
  assert.equal(ui.winBanner.classList.contains('hidden'), true);
  assert.doesNotMatch(ui.hint.textContent, /solved/i);
}

test('the complete route collects both seals and crosses the aligned moons to the exit', async (t) => {
  const context = setup(t);
  const { runtime, ui, state, finish } = context;
  atIsland(context, 'start');
  await blockedMove(context, 'the starting island cannot board an undocked stair');
  await prepareExit(context);
  assert.deepEqual(state.seals, { amber: true, blue: true });
  assert.equal(state.exitOpen, 1);
  assert.match(ui.mechanicStatus.textContent, /Amber · found.*Blue · found/);
  await finish(runtime.doMove());
  atIsland(context, 'exit');
  assert.equal(ui.winBanner.classList.contains('hidden'), false);
  assert.match(ui.hint.textContent, /solved/i);
  assert.equal(ui.nextBtn.hidden, true);
  for (const key of ['moveBtn', 'selectBridgeBtn', 'rotateLeftBtn', 'rotateRightBtn', 'hintBtn']) assert.equal(ui[key].disabled, true, `${key} is locked on completion`);
});

test('one inward-facing stair cannot bridge the gap until both tips meet', async (t) => {
  const context = setup(t);
  const { runtime, built, ui, finish } = context;
  await boardLeft(context);
  await finish(runtime.doRotate(-1));
  await finish(runtime.doRotate(-1)); // left now east, right still east
  await blockedMove(context, 'the far moon cannot be reached through empty air');
  runtime.doSelectBridge();
  await finish(runtime.doRotate(1));
  await blockedMove(context, 'a perpendicular far stair is not a connection');
  await finish(runtime.doRotate(1));
  built.group.updateWorldMatrix(true, true);
  const leftTip = built.bridges.left.group.localToWorld(built.bridges.left.exitLocal.clone());
  const rightTip = built.bridges.right.group.localToWorld(built.bridges.right.exitLocal.clone());
  positionEquals(leftTip, rightTip, 'both low stair ends physically coincide');
  assert.equal(ui.moveBtn.disabled, false);
  await finish(runtime.doMove());
  atMoon(context, 'right');
  assert.equal(ui.selectBridgeBtn.textContent, 'Bridge: Right', 'arrival selects the bridge being ridden');
});

test('the exit rejects zero seals and blue alone, but collecting blue before amber remains solvable', async (t) => {
  const context = setup(t);
  const { runtime, state, finish } = context;
  await boardLeft(context);
  await finish(runtime.doRotate(-1));
  await finish(runtime.doRotate(-1));
  await connectRight(context);
  await finish(runtime.doRotate(1));
  await finish(runtime.doRotate(1)); // east toward exit
  await blockedMove(context, 'an aligned exit still requires both seals');
  assert.equal(state.exitOpen, 0);
  await finish(runtime.doRotate(-1)); // south
  await finish(runtime.doMove());
  atIsland(context, 'blue');
  await finish(runtime.doMove());
  await finish(runtime.doRotate(1)); // east
  assert.deepEqual(state.seals, { amber: false, blue: true });
  assert.equal(state.exitOpen, 0);
  await blockedMove(context, 'blue alone cannot open the exit');
  await finish(runtime.doRotate(1));
  await finish(runtime.doRotate(1)); // west
  await finish(runtime.doMove());
  atMoon(context, 'left');
  await finish(runtime.doRotate(1)); // east -> north
  await finish(runtime.doMove());
  atIsland(context, 'amber');
  assert.deepEqual(state.seals, { amber: true, blue: true });
  assert.equal(state.exitOpen, 1);
  await finish(runtime.doMove());
  await finish(runtime.doRotate(-1)); // north -> east
  await finish(runtime.doMove());
  atMoon(context, 'right');
  await finish(runtime.doRotate(1));
  await finish(runtime.doRotate(1)); // west -> east
  await finish(runtime.doMove());
  atIsland(context, 'exit');
});

test('amber alone cannot open the exit and a collected seal survives revisiting its island', async (t) => {
  const context = setup(t);
  const { runtime, state, finish } = context;
  await collectAmber(context);
  await finish(runtime.doMove()); // revisit amber
  atIsland(context, 'amber');
  await finish(runtime.doMove());
  await finish(runtime.doRotate(-1));
  await connectRight(context);
  await finish(runtime.doRotate(1));
  await finish(runtime.doRotate(1));
  assert.deepEqual(state.seals, { amber: true, blue: false });
  assert.equal(state.exitOpen, 0);
  await blockedMove(context, 'revisiting amber cannot count as collecting blue');
});

test('riders remain attached during a turn and island occupants remain on fixed stone', async (t) => {
  const context = setup(t);
  const { runtime, built, finish, tick } = context;
  await boardLeft(context);
  const localPosition = runtime.character.position.clone();
  const before = runtime.character.getWorldQuaternion(new THREE.Quaternion());
  const turning = runtime.doRotate(-1);
  await tick(200);
  assert.equal(runtime.character.parent, built.bridges.left.group);
  positionEquals(runtime.character.position, localPosition, 'riding does not slip over the landing');
  const during = runtime.character.getWorldQuaternion(new THREE.Quaternion());
  assert.ok(before.angleTo(during) > 0.01, 'the attached ghost turns with the moon');
  const expected = built.bridges.left.group.localToWorld(localPosition.clone());
  positionEquals(runtime.character.getWorldPosition(new THREE.Vector3()), expected, 'rider transform follows the animated bridge');
  await finish(turning);
  await finish(runtime.doMove());
  atIsland(context, 'amber');
  const fixedPosition = runtime.character.getWorldPosition(new THREE.Vector3());
  await finish(runtime.doRotate(1));
  positionEquals(runtime.character.getWorldPosition(new THREE.Vector3()), fixedPosition, 'turning a detached bridge leaves the ghost on its island');
  await blockedMove(context, 'the island cannot board a bridge that has turned away');
  await finish(runtime.doRotate(-1));
  await finish(runtime.doMove());
  atMoon(context, 'left');
});

test('walking and rotation lock conflicting commands rather than queueing them', async (t) => {
  const context = setup(t);
  const { runtime, built, ui, finish, tick } = context;
  await finish(runtime.doRotate(1));
  const walking = runtime.doMove();
  await tick(100);
  for (const key of ['moveBtn', 'selectBridgeBtn', 'rotateLeftBtn', 'rotateRightBtn', 'hintBtn']) assert.equal(ui[key].disabled, true);
  await runtime.doMove();
  await runtime.doRotate(-1);
  runtime.doSelectBridge();
  runtime.doHint();
  await finish(walking);
  atMoon(context, 'left');
  close(built.bridges.left.group.rotation.y, Math.PI, 'ignored turn did not run');
  assert.equal(ui.selectBridgeBtn.textContent, 'Bridge: Left');
  const rotating = runtime.doRotate(-1);
  await tick(100);
  for (const key of ['moveBtn', 'selectBridgeBtn', 'rotateLeftBtn', 'rotateRightBtn', 'hintBtn']) assert.equal(ui[key].disabled, true);
  await runtime.doRotate(-1);
  await runtime.doMove();
  runtime.doSelectBridge();
  runtime.doHint();
  await finish(rotating);
  await tick(2_000);
  atMoon(context, 'left');
  close(built.bridges.left.group.rotation.y, Math.PI / 2, 'only the requested quarter turn ran');
  close(built.bridges.right.group.rotation.y, 0, 'the other bridge did not turn');
  assert.equal(ui.selectBridgeBtn.textContent, 'Bridge: Left');
  assert.equal(ui.hintBtn.getAttribute('aria-pressed'), 'false');
});

test('Restart during walking cancels the old route while a new walk remains usable', async (t) => {
  const context = setup(t);
  const { runtime, finish, tick } = context;
  await finish(runtime.doRotate(1));
  const oldWalk = runtime.doMove();
  await tick(100);
  runtime.restart();
  assertReset(context);
  await finish(runtime.doRotate(1));
  const newWalk = runtime.doMove();
  await tick(20);
  assert.equal(runtime.isMoving(), true);
  await finish(oldWalk);
  await finish(newWalk);
  atMoon(context, 'left');
});

test('Restart during a ridden rotation clears attachment and prevents stale turns', async (t) => {
  const context = setup(t);
  const { runtime, finish, tick } = context;
  await boardLeft(context);
  const oldTurn = runtime.doRotate(-1);
  await tick(100);
  runtime.restart();
  assertReset(context);
  await finish(oldTurn);
  await tick(2_000);
  assertReset(context);
  await boardLeft(context);
});

test('Restart while the second seal unlocks the gate clears seals and cancels stale gate writes', async (t) => {
  const context = setup(t);
  const { runtime, ui, state, finish, tick } = context;
  await prepareSecondSeal(context);
  const arrival = runtime.doMove();
  for (let frame = 0; !/exit opens/.test(ui.hint.textContent) && frame < 1_000; frame++) await tick();
  assert.match(ui.hint.textContent, /exit opens/);
  await tick(150);
  assert.ok(state.exitOpen > 0 && state.exitOpen < 1, 'the opening animation is in progress');
  runtime.restart();
  assertReset(context);
  await finish(arrival);
  await tick(1_000);
  assertReset(context);
  await boardLeft(context);
});

test('Restart during celebration prevents a stale completion banner or next-level button', async (t) => {
  const context = setup(t, { hasNextLevel: true });
  const { runtime, ui, finish, tick } = context;
  await prepareExit(context);
  const finishing = runtime.doMove();
  for (let frame = 0; runtime.isMoving() && frame < 1_000; frame++) await tick();
  atIsland(context, 'exit');
  assert.match(ui.hint.textContent, /One way home/);
  assert.equal(ui.winBanner.classList.contains('hidden'), true);
  runtime.restart();
  assertReset(context);
  await finish(finishing);
  await tick(1_000);
  assertReset(context);
  await boardLeft(context);
});
