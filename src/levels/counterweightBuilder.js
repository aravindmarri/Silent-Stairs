import * as THREE from 'three';
import { createMarker, createStaircase } from '../geometry.js';
import { stairDimensions, stairViewRadius } from './stairDimensions.js';

export const LIFT_HEIGHTS = [1.36, 3.4, 5.44];

// Both lift origins are the middle of their walkable top surface. A rider
// can therefore stay at (0, 0, 0) in a lift group as its height changes.
export function buildCounterweightLevel() {
  const group = new THREE.Group();
  const { rise, run, width } = stairDimensions;
  const [LOW, MID, HIGH] = LIFT_HEIGHTS;
  const TRAVEL = MID - LOW;
  const DECK_THICKNESS = 0.34;
  const BACK = -width / 2 - 0.28;
  const WHEEL_Y = HIGH + 1.48;
  const WHEEL_RADIUS = 0.37;

  const stone = new THREE.MeshStandardMaterial({ color: 0xe4dccb, roughness: 0.85, metalness: 0.05 });
  const supportStone = new THREE.MeshStandardMaterial({ color: 0xa39f95, roughness: 0.95, metalness: 0.02 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x69747c, roughness: 0.58, metalness: 0.45 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x343d47, roughness: 0.7, metalness: 0.35 });
  const cableMaterial = new THREE.MeshStandardMaterial({ color: 0xb9b8aa, roughness: 0.9, metalness: 0.15 });
  const blue = new THREE.MeshStandardMaterial({ color: 0x92b5c7, roughness: 0.6, metalness: 0.2 });
  const warm = new THREE.MeshStandardMaterial({ color: 0xc7b58e, roughness: 0.6, metalness: 0.2 });

  function box(parent, x, y, z, sx, sy, sz, material = stone) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function platform(x, top, length) {
    return box(group, x, top - DECK_THICKNESS / 2, 0, length, DECK_THICKNESS, width);
  }

  // Every adjacent edge meets exactly when its lift is docked: a small
  // blue inlay on each platform makes the lift pair easy to distinguish.
  platform(-5.75, LOW, width);
  platform(5.75, HIGH, width);
  box(group, -5.75, LOW - 0.43, 0, 1.9, 0.18, 1.9, supportStone);
  box(group, 5.75, HIGH - 0.43, 0, 1.9, 0.18, 1.9, supportStone);
  const middleStairs = createStaircase({
    ...stairDimensions,
    steps: 4,
    color: 0xe4dccb,
    enlargeFirst: false,
    enlargeLast: false,
  });
  middleStairs.group.position.set(-width, rise, 0);
  group.add(middleStairs.group);

  function lift(x, accent) {
    const liftGroup = new THREE.Group();
    liftGroup.position.x = x;
    group.add(liftGroup);
    box(liftGroup, 0, -DECK_THICKNESS / 2, 0, width, DECK_THICKNESS, width);
    box(liftGroup, 0, -DECK_THICKNESS - 0.07, 0, width - 0.24, 0.14, width - 0.24, metal);
    // A fine strip on the front edge stays visible without obscuring feet.
    box(liftGroup, 0, -0.14, width / 2 + 0.012, width - 0.3, 0.075, 0.025, accent);
    // The small rear yoke carries the rope and visibly follows the deck.
    box(liftGroup, 0, 0.11, BACK, 1.96, 0.13, 0.14, metal);
    for (const side of [-1, 1]) {
      box(liftGroup, side * 0.95, -0.1, BACK + 0.12, 0.12, 0.3, 0.5, metal);
      box(liftGroup, side * 0.95, 0.11, BACK, 0.18, 0.43, 0.2, darkMetal);
    }
    return { group: liftGroup };
  }

  const lifts = { A: lift(-3.45, blue), B: lift(3.45, warm) };

  // Thin paired rails sit behind the walkable route, with a shared beam
  // and connecting rope that explain the opposite movement of the lifts.
  for (const x of [-3.45, 3.45]) {
    for (const side of [-1, 1]) {
      const railX = x + side * 0.95;
      box(group, railX, WHEEL_Y / 2, BACK, 0.085, WHEEL_Y, 0.085, metal);
      box(group, railX, 0.14, BACK, 0.36, 0.28, 0.4, supportStone);
    }
    box(group, x, WHEEL_Y - 0.17, BACK, width + 0.14, 0.18, 0.26, metal);
  }
  box(group, 0, WHEEL_Y - 0.17, BACK - 0.13, 6.9, 0.16, 0.18, darkMetal);
  box(group, 0, WHEEL_Y + WHEEL_RADIUS, BACK + 0.03, 6.9, 0.035, 0.035, cableMaterial);

  function wheel(x, accent) {
    const wheelGroup = new THREE.Group();
    wheelGroup.position.set(x, WHEEL_Y, BACK + 0.03);
    group.add(wheelGroup);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_RADIUS, 0.057, 8, 24), metal);
    ring.castShadow = true;
    wheelGroup.add(ring);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.17, 16), darkMetal);
    hub.rotation.x = Math.PI / 2;
    wheelGroup.add(hub);
    for (let i = 0; i < 3; i++) {
      const spoke = box(wheelGroup, 0, 0, 0, 0.045, WHEEL_RADIUS * 1.8, 0.07, metal);
      spoke.rotation.z = i * Math.PI / 3;
    }
    // This pale rim dot provides an unambiguous rotation cue.
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), accent);
    dot.position.set(0, WHEEL_RADIUS, 0.07);
    wheelGroup.add(dot);
    return wheelGroup;
  }
  const wheelA = wheel(-3.45, blue);
  const wheelB = wheel(3.45, warm);

  function rope(x) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 8), cableMaterial);
    mesh.position.x = x;
    mesh.position.z = BACK + 0.03;
    group.add(mesh);
    return mesh;
  }
  const ropeA = rope(-3.45 - WHEEL_RADIUS);
  const ropeB = rope(3.45 + WHEEL_RADIUS);

  // Finish with two familiar treads. Vertical segments in the path clear
  // each riser before the ghost crosses the horizontal tread surface.
  const stairStart = 6.9;
  const goalPath = [new THREE.Vector3(5.75, HIGH, 0), new THREE.Vector3(stairStart, HIGH, 0)];
  for (let i = 0; i < 2; i++) {
    const left = stairStart + i * run;
    const top = HIGH + (i + 1) * rise;
    const bottom = HIGH - DECK_THICKNESS;
    box(group, left + run / 2, (top + bottom) / 2, 0, run, top - bottom, width);
    goalPath.push(new THREE.Vector3(left, top, 0));
    goalPath.push(new THREE.Vector3(left + (i === 1 ? run / 2 : run), top, 0));
  }
  const startLocal = new THREE.Vector3(-5.75, LOW, 0);
  const middleLocal = new THREE.Vector3(-width + run / 2, MID, 0);
  const middleToRightPath = [
    middleLocal.clone(),
    ...middleStairs.pathLocal.slice(1).map((point) => point.clone().add(middleStairs.group.position)),
  ];
  const goalLocal = goalPath[goalPath.length - 1].clone();

  const safeStop = new THREE.Mesh(
    new THREE.RingGeometry(0.22, 0.27, 24),
    new THREE.MeshBasicMaterial({ color: 0xb6ced4, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
  );
  safeStop.rotation.x = -Math.PI / 2;
  safeStop.position.copy(middleLocal).add(new THREE.Vector3(0, 0.015, 0));
  group.add(safeStop);

  const startMarker = createMarker(0x6bd08a);
  startMarker.position.copy(startLocal).add(new THREE.Vector3(0, 0.4, 0));
  group.add(startMarker);
  const goalMarker = createMarker(0xf2c14e);
  goalMarker.position.copy(goalLocal).add(new THREE.Vector3(0, 0.4, 0));
  group.add(goalMarker);
  const glowRing = new THREE.Mesh(
    new THREE.RingGeometry(0.32, 0.46, 32),
    new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
  );
  glowRing.rotation.x = -Math.PI / 2;
  glowRing.position.copy(goalLocal).add(new THREE.Vector3(0, 0.018, 0));
  group.add(glowRing);
  const glowLight = new THREE.PointLight(0xffe9a8, 1.1, 4, 2);
  glowLight.position.copy(goalLocal).add(new THREE.Vector3(0, 0.6, 0));
  group.add(glowLight);

  function setBalance(value) {
    const balance = THREE.MathUtils.clamp(value, 0, 2);
    lifts.A.group.position.y = LOW + TRAVEL * balance;
    lifts.B.group.position.y = HIGH - TRAVEL * balance;
    for (const [liftGroup, cable] of [[lifts.A.group, ropeA], [lifts.B.group, ropeB]]) {
      const bottom = liftGroup.position.y + 0.2;
      const top = WHEEL_Y;
      cable.scale.y = top - bottom;
      cable.position.y = (top + bottom) / 2;
    }
    wheelA.rotation.z = -balance * TRAVEL / WHEEL_RADIUS;
    wheelB.rotation.z = balance * TRAVEL / WHEEL_RADIUS;
  }
  setBalance(0);

  const levelRadius = Math.max(
    stairViewRadius,
    new THREE.Vector3(stairStart + 2 * run, HIGH + 2 * rise + 1.6, width / 2).length() + 0.5,
    new THREE.Vector3(4.6, WHEEL_Y + WHEEL_RADIUS, BACK).length() + 0.5,
  );
  return { group, lifts, startLocal, middleLocal, middleToRightPath, goalPath, goalLocal, levelRadius, viewRadius: stairViewRadius, setBalance };
}
