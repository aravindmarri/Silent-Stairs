import * as THREE from 'three';
import './style.css';
import { createStaircase, createMarker } from './geometry.js';
import { solveConnectorPosition, normalizeAngle } from './align.js';
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
    <p id="hint">Drag to turn the world.</p>
    <p id="hintSecondary">Find the angle where the stairs meet.</p>
  </div>
  <div id="winBanner" class="hidden">Solved.</div>
`;

const canvas = document.querySelector('#scene');
const hint = document.querySelector('#hint');
const hintSecondary = document.querySelector('#hintSecondary');
const winBanner = document.querySelector('#winBanner');

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1f2a);
scene.fog = new THREE.Fog(0x1b1f2a, 20, 40);

const FRUSTUM = 9;
let aspect = window.innerWidth / window.innerHeight;
const camera = new THREE.OrthographicCamera(
  -FRUSTUM * aspect, FRUSTUM * aspect, FRUSTUM, -FRUSTUM, 0.1, 100
);
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

// Staircase A: fixed at the origin of the world group. Its first tread
// (the puzzle's starting platform) is enlarged; its last tread is the
// connector to B and stays standard-sized so the illusion math isn't
// disturbed.
const A = createStaircase({ steps: 5, rise: 0.6, run: 1.0, width: 2.2, color: 0xe4dccb, enlargeLast: false });
world.add(A.group);

// Staircase B: position solved so its entry lines up with A's exit,
// on screen only, at TARGET_ANGLE — while sitting DEPTH_OFFSET further
// from the camera in true 3D space.
const TARGET_ANGLE = THREE.MathUtils.degToRad(42);
const DEPTH_OFFSET = 6.5;

// Same color and orientation as A: at the solved angle this makes the
// whole connecting edge coincide (not just the single connector point),
// so the seam between the two pieces disappears completely rather than
// leaving a sliver of one poking through the other. Its first tread is
// the connector from A and stays standard-sized; its last tread (the
// puzzle's ending platform) is enlarged.
const B = createStaircase({ steps: 4, rise: 0.6, run: 1.0, width: 2.2, color: 0xe4dccb, enlargeFirst: false });
const bInner = new THREE.Group();
bInner.add(B.group);

const connectorWorldLocal = solveConnectorPosition(A.exitLocal, camera, TARGET_ANGLE, DEPTH_OFFSET);
const bGroup = new THREE.Group();
bGroup.position.set(connectorWorldLocal.x, connectorWorldLocal.y - B.height, connectorWorldLocal.z);
bGroup.add(bInner);
world.add(bGroup);

// Markers
const startMarker = createMarker(0x6bd08a);
startMarker.position.copy(A.entryLocal).add(new THREE.Vector3(0, 0.4, 0));
world.add(startMarker);

const goalLocal = B.exitLocal.clone().applyMatrix4(new THREE.Matrix4().makeRotationY(bInner.rotation.y)).add(bGroup.position);
const goalMarker = createMarker(0xf2c14e);
goalMarker.position.copy(goalLocal).add(new THREE.Vector3(0, 0.4, 0));
world.add(goalMarker);

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
character.position.copy(A.entryLocal);

// ---------- controls / win detection ----------
let aligned = false;
let solved = false;
const TOLERANCE = THREE.MathUtils.degToRad(3);

const dragControls = attachDragRotate(canvas, world, {
  onChange: (rotY) => {
    if (solved) return;
    const diff = Math.abs(normalizeAngle(rotY - TARGET_ANGLE));
    aligned = diff < TOLERANCE;
    hint.textContent = aligned ? 'The path is whole.' : 'Drag to turn the world.';
    hintSecondary.textContent = aligned ? 'Walk across (Space)' : 'Find the angle where the stairs meet.';
    hintSecondary.classList.toggle('walkable', aligned);
  },
});

let isWalking = false;
const NORMAL_SPEED = 2.2;
const CROSSING_SPEED = 22;

async function attemptWalk() {
  if (!aligned || solved) return;
  solved = true;
  dragControls.lock();

  // Both staircases' waypoints follow the actual tread/riser profile
  // (see geometry.js) rather than a single diagonal, so the ghost's
  // hover height stays flush with whichever step it's currently over
  // instead of cutting through the stair mass. B's path is defined in
  // its own local frame, so it's transformed into world-group-local
  // space the same way bGroup/bInner already place the staircase itself.
  const bRotation = new THREE.Matrix4().makeRotationY(bInner.rotation.y);
  const bPathInWorldLocal = B.pathLocal.map((p) => p.clone().applyMatrix4(bRotation).add(bGroup.position));

  const waypoints = [...A.pathLocal, ...bPathInWorldLocal];
  // The single segment crossing from A's last waypoint to B's first
  // only moves in depth — invisible on screen by construction — so it
  // runs much faster than the on-stair legs to avoid looking like the
  // ghost has frozen mid-crossing.
  const crossingSegment = A.pathLocal.length - 1;
  const speeds = waypoints.slice(0, -1).map((_, i) => (i === crossingSegment ? CROSSING_SPEED : NORMAL_SPEED));

  hint.textContent = '';
  hintSecondary.textContent = '';
  hintSecondary.classList.remove('walkable');
  isWalking = true;
  // The crossing segment's displacement is an arbitrary jump through
  // depth, not a walking direction — turning to face it makes the ghost
  // look like it stops and spins in place mid-crossing, so its rotation
  // is left untouched for that one segment.
  await walkPath(character, waypoints, speeds, [crossingSegment]);
  isWalking = false;
  winBanner.classList.remove('hidden');
}

hintSecondary.addEventListener('click', attemptWalk);
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') attemptWalk();
});

// ---------- render loop ----------
function onResize() {
  aspect = window.innerWidth / window.innerHeight;
  camera.left = -FRUSTUM * aspect;
  camera.right = FRUSTUM * aspect;
  camera.top = FRUSTUM;
  camera.bottom = -FRUSTUM;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);
onResize();

const clock = new THREE.Clock();
function render() {
  ghost.update(clock.getElapsedTime(), isWalking);
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}
render();
