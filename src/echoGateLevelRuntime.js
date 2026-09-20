import { walkPath, faceCamera } from './character.js';
import { createGhost } from './ghost.js';

const ROUTES = ['relay', 'blue', 'exit'];
const ROUTE_NAMES = { relay: 'Relay', blue: 'Blue plate', exit: 'Exit' };

export function createEchoGateLevelRuntime({ built, camera, ui, hasNextLevel, getGeneration, bumpGeneration, dragControls }) {
  const { group, nodes, paths } = built;
  const player = createGhost();
  const character = player.group;
  const echo = createGhost({ color: 0x9edee0 });
  const echoMaterials = new Set();
  echo.group.traverse((object) => {
    object.castShadow = false;
    for (const material of [object.material].flat().filter(Boolean)) echoMaterials.add(material);
  });
  for (const material of echoMaterials) {
    material.transparent = true;
    material.opacity = 0.27;
    material.depthWrite = false;
  }
  group.add(character, echo.group);

  let location = 'start';
  let echoLocation = null;
  let relayLatched = false;
  let routeIndex = 0;
  let history = [];
  let phase = 'idle';
  let showHint = false;
  let activeSignal = null;
  const gateAmounts = { amber: 0, blue: 0 };
  const isPlate = (node) => node === 'amber' || node === 'blue';

  function gateTargets(occupant = location) {
    return {
      amber: relayLatched || occupant === 'amber' || echoLocation === 'amber' ? 1 : 0,
      blue: relayLatched && (occupant === 'blue' || echoLocation === 'blue') ? 1 : 0,
    };
  }

  function forwardDestination() {
    if (location === 'start') return 'amber';
    if (location === 'amber') return 'hub';
    if (location === 'hub') return ROUTES[routeIndex];
    return null;
  }
  function canTraverse(from, to) {
    if (!to) return false;
    if ((from === 'hub' && to === 'relay') || (from === 'relay' && to === 'hub')) return gateAmounts.amber > 0.999;
    if ((from === 'hub' && to === 'exit') || (from === 'exit' && to === 'hub')) return gateAmounts.blue > 0.999;
    return Boolean(paths[`${from}:${to}`] || paths[`${to}:${from}`]);
  }

  function puzzleHint() {
    if (!relayLatched) {
      if (echoLocation !== 'amber') return location === 'amber'
        ? 'Leave an echo here (F). It will hold the amber plate when you walk away.'
        : 'The amber plate near the start needs an echo. Use Back (B) to retrace your steps.';
      return location === 'hub'
        ? 'Choose the Relay path (Q/E), then Move through the amber gate.'
        : 'Your echo is holding the first gate. Reach the relay beyond it.';
    }
    if (echoLocation !== 'blue') return location === 'blue'
      ? 'Leave your echo on the blue plate (F). The relay now keeps the first gate open.'
      : 'Return to the fork and choose Blue plate. Your single echo can move there now.';
    return location === 'hub'
      ? 'Choose the Exit path (Q/E). Your echo is holding its gate open.'
      : 'Leave the echo here, return to the fork, and take the Exit path.';
  }

  function idleHint() {
    if (showHint) return location === 'start'
      ? 'Press Move to reach the amber plate. An echo can keep it pressed.' : puzzleHint();
    if (location === 'start') return 'A memory can hold what you leave behind.';
    if (location === 'amber') return 'Amber wakes the first gate. Only one echo can remain.';
    if (location === 'relay') return 'The relay holds the amber gate. The blue circuit is awake.';
    if (location === 'blue') return relayLatched
      ? 'The blue plate answers the far gate.' : 'This plate needs power from the relay.';
    if (location === 'hub') {
      const destination = forwardDestination();
      if (destination === 'relay' && !canTraverse(location, destination)) return 'The amber gate is closed. What could hold its plate?';
      if (destination === 'exit' && !relayLatched) return 'The blue circuit is asleep. Find its source.';
      if (destination === 'exit' && !canTraverse(location, destination)) return 'The blue gate is closed. Its plate needs a presence.';
      return `Path selected: ${ROUTE_NAMES[destination]}. Move to follow it.`;
    }
    return '';
  }

  function updateUI() {
    const idle = phase === 'idle';
    ui.moveBtn.disabled = !idle || !canTraverse(location, forwardDestination());
    ui.routeBtn.disabled = !idle || location !== 'hub';
    ui.routeBtn.textContent = `Path: ${ROUTE_NAMES[ROUTES[routeIndex]]} ↻`;
    ui.echoBtn.disabled = !idle || (!isPlate(location) && !echoLocation);
    ui.echoBtn.textContent = !echoLocation || (isPlate(location) && echoLocation !== location) ? 'Leave echo' : 'Recall echo';
    ui.backBtn.disabled = !idle || !canTraverse(location, history.at(-1));
    ui.hintBtn.disabled = !idle;
    ui.hintBtn.setAttribute?.('aria-pressed', String(showHint));
    ui.mechanicStatus.textContent = `Echo · ${echoLocation ?? 'free'}    /    Relay · ${relayLatched ? 'awake' : 'asleep'}`;
    ui.nextBtn.hidden = !(phase === 'complete' && hasNextLevel());
    ui.winBanner.classList.toggle('hidden', phase !== 'complete');
    ui.hint.textContent = phase === 'walking' ? 'Walking…'
      : phase === 'echoing' ? 'A memory settles. The gates answer…'
        : phase === 'celebrating' ? 'No one crosses alone.'
          : phase === 'complete' ? 'Solved. A memory made a path.' : idleHint();
    built.setSelectedRoute(location === 'hub' ? ROUTES[routeIndex] : null);
  }

  async function syncGates(occupant, signal, generation) {
    const targets = gateTargets(occupant);
    for (const plate of ['amber', 'blue']) built.setPlateActive(plate, occupant === plate || echoLocation === plate);
    built.setRelayActive(relayLatched);
    const from = { ...gateAmounts };
    if (Object.keys(targets).every((gate) => Math.abs(targets[gate] - from[gate]) < 0.001)) return;
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const duration = reduced ? 120 : 440;
    await new Promise((resolve) => {
      const started = performance.now();
      function frame() {
        if (signal.cancelled || getGeneration() !== generation) return resolve();
        const t = Math.min((performance.now() - started) / duration, 1);
        const eased = t * t * (3 - 2 * t);
        for (const gate of ['amber', 'blue']) {
          gateAmounts[gate] = from[gate] + (targets[gate] - from[gate]) * eased;
          built.setGateOpen(gate, gateAmounts[gate]);
        }
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });
  }

  async function travel(destination, backwards = false) {
    if (phase !== 'idle' || !canTraverse(location, destination)) return;
    const generation = getGeneration();
    const signal = { cancelled: false };
    activeSignal = signal;
    const from = location;
    const direct = paths[`${from}:${destination}`];
    const path = direct ?? [...paths[`${destination}:${from}`]].reverse();
    showHint = false;
    phase = 'walking';
    updateUI();
    // A live ghost releases a plate before leaving; only an echo can
    // keep a remote gate open. Inputs stay locked until arrival.
    await syncGates(null, signal, generation);
    if (signal.cancelled || getGeneration() !== generation) return;
    await walkPath(character, path, 2.8, { signal });
    if (signal.cancelled || getGeneration() !== generation) return;
    if (backwards) history.pop();
    else history.push(from);
    location = destination;
    if (location === 'relay') relayLatched = true;
    await syncGates(location, signal, generation);
    if (signal.cancelled || getGeneration() !== generation) return;
    if (location === 'exit') {
      phase = 'celebrating';
      updateUI();
      await faceCamera(character, camera, 500, { signal });
      if (signal.cancelled || getGeneration() !== generation) return;
      phase = 'complete';
    } else phase = 'idle';
    activeSignal = null;
    updateUI();
  }
  function doMove() { return travel(forwardDestination()); }
  function doBack() { return travel(history.at(-1), true); }
  function doRoute(direction = 1) {
    if (phase !== 'idle' || location !== 'hub' || ![1, -1].includes(direction)) return;
    routeIndex = (routeIndex + direction + ROUTES.length) % ROUTES.length;
    showHint = false;
    updateUI();
  }
  async function doEcho() {
    if (phase !== 'idle' || (!isPlate(location) && !echoLocation)) return;
    const generation = getGeneration();
    const signal = { cancelled: false };
    activeSignal = signal;
    echoLocation = isPlate(location) && echoLocation !== location ? location : null;
    echo.group.visible = Boolean(echoLocation);
    if (echoLocation) {
      echo.group.position.copy(nodes[echoLocation]);
      echo.group.rotation.copy(character.rotation);
    }
    showHint = false;
    phase = 'echoing';
    updateUI();
    await syncGates(location, signal, generation);
    if (signal.cancelled || getGeneration() !== generation) return;
    activeSignal = null;
    phase = 'idle';
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
    location = 'start';
    echoLocation = null;
    relayLatched = false;
    routeIndex = 0;
    history = [];
    phase = 'idle';
    showHint = false;
    character.position.copy(nodes.start);
    character.rotation.set(0, 0, 0);
    echo.group.visible = false;
    for (const gate of ['amber', 'blue']) {
      gateAmounts[gate] = 0;
      built.setGateOpen(gate, 0);
      built.setPlateActive(gate, false);
    }
    built.setRelayActive(false);
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
    const actions = { Space: doMove, KeyQ: () => doRoute(-1), KeyE: () => doRoute(1), KeyF: doEcho, KeyB: doBack, KeyH: doHint };
    const action = actions[e.code];
    if (action) { e.preventDefault(); action(); }
  }
  dragControls.lock();
  reset();
  return {
    character, echo,
    ghost: { group: character, update(time, moving) { player.update(time, moving); if (echo.group.visible) echo.update(time + 1.3, false); } },
    doMove, doBack, doRoute, doEcho, doHint, restart, cancelActiveWalk, handleKeydown,
    isMoving: () => phase === 'walking',
    updateCrossReadiness: () => {},
  };
}
