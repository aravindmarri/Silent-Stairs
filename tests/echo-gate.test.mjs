import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildEchoGateLevel } from '../src/levels/echoGateBuilder.js';
import { createEchoGateLevelRuntime } from '../src/echoGateLevelRuntime.js';

// Exercise the real walking and gate animations without wall-clock delays.
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
    disabled: false,
    hidden: false,
    textContent: '',
    setAttribute: (name, value) => attributes.set(name, String(value)),
    getAttribute: (name) => attributes.get(name) ?? null,
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
  const built = buildEchoGateLevel();
  const gates = { amber: 0, blue: 0 };
  const setGateOpen = built.setGateOpen.bind(built);
  built.setGateOpen = (name, value) => {
    gates[name] = value;
    return setGateOpen(name, value);
  };
  const camera = new THREE.OrthographicCamera(-12, 12, 9, -9, 0.1, 100);
  camera.position.set(9, 8, 11);
  camera.lookAt(0, 2, 0);
  const ui = Object.fromEntries(['moveBtn', 'routeBtn', 'echoBtn', 'backBtn', 'hintBtn', 'mechanicStatus', 'hint', 'nextBtn', 'winBanner']
    .map((key) => [key, element()]));
  let generation = 0;
  let dragLocked = false;
  const runtime = createEchoGateLevelRuntime({
    built, camera, ui,
    hasNextLevel: () => hasNextLevel,
    getGeneration: () => generation,
    bumpGeneration: () => ++generation,
    dragControls: { lock() { dragLocked = true; }, unlock() { dragLocked = false; } },
  });
  assert.equal(dragLocked, true, 'the echo puzzle uses fixed routes rather than world rotation');
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
  return { built, runtime, ui, gates, ...clock };
}

function positionEquals(actual, expected, description) {
  assert.ok(actual.distanceTo(expected) < 1e-7, `${description}: expected ${expected.toArray()}, got ${actual.toArray()}`);
}

function atNode(context, name) {
  positionEquals(context.runtime.character.position, context.built.nodes[name], `ghost at ${name}`);
}

async function activateRelay(context) {
  const { runtime, finish } = context;
  await finish(runtime.doMove());
  await finish(runtime.doEcho());
  await finish(runtime.doMove());
  await finish(runtime.doMove());
  atNode(context, 'relay');
}

async function prepareExit(context) {
  const { runtime, finish } = context;
  await activateRelay(context);
  await finish(runtime.doBack());
  runtime.doRoute(1);
  await finish(runtime.doMove());
  atNode(context, 'blue');
  await finish(runtime.doEcho());
  await finish(runtime.doBack());
  runtime.doRoute(1);
}

async function assertBlockedMove(context, description) {
  const { runtime, ui, finish } = context;
  const position = runtime.character.position.clone();
  assert.equal(ui.moveBtn.disabled, true, description);
  await finish(runtime.doMove());
  positionEquals(runtime.character.position, position, description);
}

test('one echo opens the relay route, then relocates to power the exit', async (t) => {
  const context = setup(t);
  const { built, runtime, ui, gates, finish } = context;
  const echoGroup = runtime.echo.group;
  atNode(context, 'start');
  assert.equal(echoGroup.visible, false);
  assert.equal(ui.backBtn.disabled, true);
  assert.equal(gates.amber, 0);
  assert.equal(gates.blue, 0);

  await activateRelay(context);
  assert.equal(gates.amber, 1);
  assert.equal(gates.blue, 0);
  assert.equal(echoGroup.visible, true);
  positionEquals(echoGroup.position, built.nodes.amber, 'echo holds the amber plate');

  await finish(runtime.doBack());
  runtime.doRoute(1);
  await finish(runtime.doMove());
  atNode(context, 'blue');
  await finish(runtime.doEcho());
  assert.equal(runtime.echo.group, echoGroup, 'relocation reuses the same echo');
  positionEquals(echoGroup.position, built.nodes.blue, 'echo now holds the blue plate');
  assert.equal(gates.amber, 1, 'relay permanently latches the amber gate');
  assert.equal(gates.blue, 1);

  await finish(runtime.doBack());
  atNode(context, 'hub');
  assert.equal(gates.blue, 1, 'the echo keeps the exit powered after the player leaves');
  runtime.doRoute(1);
  await finish(runtime.doMove());
  atNode(context, 'exit');
  assert.equal(ui.winBanner.classList.contains('hidden'), false);
  assert.match(ui.hint.textContent, /solved/i);
  assert.equal(ui.nextBtn.hidden, true);
  for (const key of ['moveBtn', 'routeBtn', 'echoBtn', 'backBtn']) assert.equal(ui[key].disabled, true, `${key} is locked on completion`);
});

test('neither reaching the hub without an echo nor using blue first bypasses the relay', async (t) => {
  const context = setup(t);
  const { runtime, gates, finish } = context;
  await finish(runtime.doMove());
  await finish(runtime.doMove());
  atNode(context, 'hub');
  await assertBlockedMove(context, 'the amber gate blocks the relay route without a held plate');
  assert.equal(gates.amber, 0);

  runtime.doRoute(1);
  await finish(runtime.doMove());
  atNode(context, 'blue');
  await finish(runtime.doEcho());
  await finish(runtime.doBack());
  atNode(context, 'hub');
  runtime.doRoute(1);
  assert.equal(gates.blue, 0, 'a blue echo cannot power an inactive circuit');
  await assertBlockedMove(context, 'the relay must be activated before the exit opens');
});

test('recalling an echo does not trap the player, and a latched relay survives recall', async (t) => {
  const context = setup(t);
  const { runtime, gates, finish } = context;
  await finish(runtime.doMove());
  await finish(runtime.doEcho());
  await finish(runtime.doMove());
  await finish(runtime.doEcho());
  assert.equal(runtime.echo.group.visible, false, 'Echo away from a plate recalls the existing echo');
  await assertBlockedMove(context, 'recalling amber before the relay closes its gate');
  await finish(runtime.doBack());
  atNode(context, 'amber');
  await finish(runtime.doEcho());
  await finish(runtime.doMove());
  await finish(runtime.doMove());
  atNode(context, 'relay');
  await finish(runtime.doEcho());
  assert.equal(runtime.echo.group.visible, false);
  assert.equal(gates.amber, 1, 'the activated relay does not depend on an amber echo');

  await finish(runtime.doBack());
  runtime.doRoute(1);
  await finish(runtime.doMove());
  await finish(runtime.doEcho());
  await finish(runtime.doBack());
  await finish(runtime.doEcho());
  runtime.doRoute(1);
  await assertBlockedMove(context, 'recalling blue closes the exit');
  runtime.doRoute(-1);
  await finish(runtime.doMove());
  atNode(context, 'blue');
  await finish(runtime.doEcho());
  await finish(runtime.doBack());
  runtime.doRoute(1);
  await finish(runtime.doMove());
  atNode(context, 'exit');
});

test('Echo on the same plate recalls rather than creating another ghost', async (t) => {
  const context = setup(t);
  const { runtime, built, finish } = context;
  const echoGroup = runtime.echo.group;
  const objectCount = () => {
    let total = 0;
    built.group.traverse(() => total++);
    return total;
  };
  await finish(runtime.doMove());
  await finish(runtime.doEcho());
  const countWithEcho = objectCount();
  await finish(runtime.doEcho());
  assert.equal(echoGroup.visible, false);
  await finish(runtime.doEcho());
  assert.equal(echoGroup.visible, true);
  assert.equal(runtime.echo.group, echoGroup);
  assert.equal(objectCount(), countWithEcho, 'repeated placement does not accumulate extra echo meshes');
});

test('walking and gate animations lock conflicting commands instead of queuing them', async (t) => {
  const context = setup(t);
  const { runtime, ui, gates, finish, tick } = context;
  const walking = runtime.doMove();
  await tick(100);
  for (const key of ['moveBtn', 'routeBtn', 'echoBtn', 'backBtn']) assert.equal(ui[key].disabled, true);
  await runtime.doMove();
  await runtime.doBack();
  await runtime.doEcho();
  runtime.doRoute(1);
  await finish(walking);
  atNode(context, 'amber');
  assert.equal(runtime.echo.group.visible, false);

  await finish(runtime.doEcho());
  await finish(runtime.doMove());
  const closing = runtime.doEcho();
  await tick(50);
  assert.ok(gates.amber > 0 && gates.amber < 1, 'recalling at the hub starts closing the amber gate');
  for (const key of ['moveBtn', 'routeBtn', 'echoBtn', 'backBtn']) assert.equal(ui[key].disabled, true);
  await runtime.doMove();
  await runtime.doBack();
  await runtime.doEcho();
  runtime.doRoute(1);
  await finish(closing);
  await tick(2_000);
  atNode(context, 'hub');
  assert.equal(gates.amber, 0);
  assert.equal(runtime.echo.group.visible, false);
  await assertBlockedMove(context, 'ignored Route did not switch away from the closed relay route');
});

test('Restart during walking cancels the stale route while a new walk remains usable', async (t) => {
  const context = setup(t);
  const { runtime, gates, finish, tick } = context;
  const oldWalk = runtime.doMove();
  await tick(100);
  runtime.restart();
  atNode(context, 'start');
  assert.equal(gates.amber, 0);
  assert.equal(gates.blue, 0);
  assert.equal(runtime.echo.group.visible, false);
  const newWalk = runtime.doMove();
  await tick(20);
  assert.equal(runtime.isMoving(), true, 'stale cancellation does not clear a new walk');
  await finish(oldWalk);
  await finish(newWalk);
  atNode(context, 'amber');
});

test('Restart during gate travel clears the echo and prevents stale gate writes', async (t) => {
  const context = setup(t);
  const { runtime, ui, gates, finish, tick } = context;
  await finish(runtime.doMove());
  await finish(runtime.doEcho());
  await finish(runtime.doMove());
  const oldGateTravel = runtime.doEcho();
  await tick(50);
  assert.ok(gates.amber > 0 && gates.amber < 1);
  runtime.restart();
  await finish(oldGateTravel);
  await tick(1_000);
  atNode(context, 'start');
  assert.equal(gates.amber, 0);
  assert.equal(gates.blue, 0);
  assert.equal(runtime.echo.group.visible, false);
  assert.equal(ui.moveBtn.disabled, false);
  assert.equal(ui.backBtn.disabled, true);
  await finish(runtime.doMove());
  await finish(runtime.doMove());
  await assertBlockedMove(context, 'the fresh relay route still requires an amber echo');
});

test('Restart during celebration clears completion and cancels the final turn', async (t) => {
  const context = setup(t, { hasNextLevel: true });
  const { runtime, ui, gates, finish, tick } = context;
  await prepareExit(context);
  const finishing = runtime.doMove();
  for (let frame = 0; runtime.isMoving() && frame < 1_000; frame++) await tick();
  atNode(context, 'exit');
  assert.equal(ui.winBanner.classList.contains('hidden'), true, 'the final facing animation has not completed');
  runtime.restart();
  await finish(finishing);
  await tick(1_000);
  atNode(context, 'start');
  assert.equal(runtime.character.rotation.y, 0);
  assert.equal(gates.amber, 0);
  assert.equal(gates.blue, 0);
  assert.equal(runtime.echo.group.visible, false);
  assert.equal(ui.winBanner.classList.contains('hidden'), true);
  assert.equal(ui.nextBtn.hidden, true);
  assert.equal(ui.moveBtn.disabled, false);
  assert.doesNotMatch(ui.hint.textContent, /solved/i);
  await finish(runtime.doMove());
  await finish(runtime.doMove());
  await assertBlockedMove(context, 'restart clears the previously activated relay');
});
