import * as THREE from 'three';
import { createStaircase, createMarker } from '../geometry.js';
import { stairDimensions, stairViewRadius } from './stairDimensions.js';

export function buildTwinMoonsLevel() {
  const group = new THREE.Group();
  const { rise, run, width } = stairDimensions;
  const armLength = 3 * run;
  const top = 4 * rise;
  const low = 2 * rise;
  const colors = { amber: 0xe8b964, blue: 0x88cfde };
  const stone = new THREE.MeshStandardMaterial({ color: 0xe4dccb, roughness: 0.87, metalness: 0.03 });
  const baseStone = new THREE.MeshStandardMaterial({ color: 0x9e9b91, roughness: 0.93 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x626e79, roughness: 0.65, metalness: 0.25 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x343e48, roughness: 0.7 });

  function mesh(parent, geometry, material, x, y, z) {
    const object = new THREE.Mesh(geometry, material);
    object.position.set(x, y, z);
    object.castShadow = true;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  }
  function box(parent, x, y, z, sx, sy, sz, material = stone) {
    return mesh(parent, new THREE.BoxGeometry(sx, sy, sz), material, x, y, z);
  }
  function ring(parent, x, y, z, inner, outer, color, opacity = 0.6) {
    const object = mesh(parent, new THREE.RingGeometry(inner, outer, 48),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }), x, y, z);
    object.rotation.x = -Math.PI / 2;
    object.castShadow = false;
    return object;
  }

  const selectedRings = {};
  function bridge(key, x, color) {
    mesh(group, new THREE.CylinderGeometry(1.2, 1.4, 0.45, 32), baseStone, x, 0.225, 0);
    mesh(group, new THREE.CylinderGeometry(0.65, 0.84, top - 0.84, 24), baseStone, x, (top - 0.84) / 2 + 0.45, 0);
    mesh(group, new THREE.CylinderGeometry(0.99, 1.02, 0.18, 32), metal, x, top - 0.37, 0);
    const rotating = new THREE.Group();
    rotating.position.set(x, top, 0);
    group.add(rotating);
    // Lift the overlapping cap slightly above the top tread to avoid
    // flickering coplanar faces as the bridge turns.
    mesh(rotating, new THREE.CylinderGeometry(1.18, 1.18, 0.28, 40), stone, 0, -0.125, 0);
    const raw = createStaircase({ ...stairDimensions, steps: 3, enlargeFirst: false, enlargeLast: false, color: 0xe4dccb });
    const offset = new THREE.Vector3(0, -3 * rise, 0);
    raw.group.position.copy(offset);
    rotating.add(raw.group);
    // The crescent remains attached to the turntable; the outer ring
    // identifies which bridge the controls will turn, even from an island.
    const crescent = mesh(rotating, new THREE.TorusGeometry(0.49, 0.038, 6, 32, Math.PI * 1.55),
      new THREE.MeshBasicMaterial({ color }), 0, 0.033, 0);
    crescent.rotation.x = -Math.PI / 2;
    crescent.castShadow = false;
    selectedRings[key] = ring(group, x, top + 0.027, 0, 1.19, 1.25, color, 0.22);
    // Small compass studs give the stair's quarter-turn positions a cue.
    for (let quarter = 0; quarter < 4; quarter++) {
      const angle = quarter * Math.PI / 2;
      mesh(group, new THREE.SphereGeometry(0.055, 8, 8), metal,
        x + Math.cos(angle) * 1.3, top - 0.07, Math.sin(angle) * 1.3);
    }
    return {
      group: rotating,
      pathLocal: raw.pathLocal.map((point) => point.clone().add(offset)),
      entryLocal: raw.entryLocal.clone().add(offset),
      exitLocal: raw.exitLocal.clone().add(offset),
    };
  }
  const bridges = {
    left: bridge('left', -armLength, colors.amber),
    right: bridge('right', armLength, colors.blue),
  };

  function island(bridgeKey, direction) {
    const connector = bridges[bridgeKey].group.position.clone().addScaledVector(direction, armLength);
    connector.y = low;
    const center = connector.clone().addScaledVector(direction, width / 2);
    box(group, center.x, low - 0.17, center.z, width, 0.34, width);
    box(group, center.x, low - 0.43, center.z, width - 0.3, 0.18, width - 0.3, baseStone);
    return { center, connector, direction, bridge: bridgeKey };
  }
  const islands = {
    start: island('left', new THREE.Vector3(-1, 0, 0)),
    amber: island('left', new THREE.Vector3(0, 0, -1)),
    blue: island('right', new THREE.Vector3(0, 0, 1)),
    exit: island('right', new THREE.Vector3(1, 0, 0)),
  };

  const seals = {};
  const sealLights = {};
  for (const name of ['amber', 'blue']) {
    const center = islands[name].center;
    const material = new THREE.MeshStandardMaterial({ color: colors[name], emissive: colors[name], emissiveIntensity: 0.48, roughness: 0.3 });
    const crystal = mesh(group, new THREE.OctahedronGeometry(0.28), material, center.x, low + 0.7, center.z);
    crystal.scale.y = 1.4;
    const halo = ring(group, center.x, low + 0.018, center.z, 0.34, 0.43, colors[name], 0.82);
    seals[name] = { crystal, halo };
  }
  const startMarker = createMarker(0x6bd08a);
  startMarker.position.copy(islands.start.center).add(new THREE.Vector3(0, 0.4, 0));
  group.add(startMarker);
  const goalMarker = createMarker(0xf2c14e);
  goalMarker.position.copy(islands.exit.center).add(new THREE.Vector3(0, 0.4, 0));
  group.add(goalMarker);
  ring(group, islands.exit.center.x, low + 0.018, 0, 0.3, 0.43, 0xffe9a8, 0.85);

  const gate = new THREE.Group();
  gate.position.copy(islands.exit.connector).add(new THREE.Vector3(0.3, 0, 0));
  gate.rotation.y = Math.PI / 2;
  group.add(gate);
  for (const side of [-1, 1]) {
    box(gate, side * 1.03, 1.13, 0, 0.26, 2.26, 0.36);
    box(gate, side * 1.03, 0.09, 0, 0.38, 0.18, 0.46, baseStone);
  }
  box(gate, 0, 2.28, 0, 2.4, 0.3, 0.42);
  for (const [name, x] of [['amber', -0.28], ['blue', 0.28]]) {
    const material = new THREE.MeshStandardMaterial({ color: 0x6c7276, emissive: colors[name], emissiveIntensity: 0.02 });
    sealLights[name] = material;
    mesh(gate, new THREE.OctahedronGeometry(0.13), material, x, 2.3, 0.23);
  }
  const bars = new THREE.Group();
  bars.position.y = 2.12;
  gate.add(bars);
  for (let i = -2; i <= 2; i++) box(bars, i * 0.32, -1.035, 0, 0.055, 2.07, 0.075, darkMetal);
  box(bars, 0, -1.5, 0, 1.66, 0.07, 0.09, darkMetal);
  box(bars, 0, -0.5, 0, 1.66, 0.07, 0.09, darkMetal);

  function setBridgeAngle(key, radians) { bridges[key].group.rotation.y = radians; }
  function setSelectedBridge(key) {
    for (const [name, selected] of Object.entries(selectedRings)) selected.material.opacity = name === key ? 0.95 : 0.14;
  }
  function setSealCollected(key, collected) {
    seals[key].crystal.visible = !collected;
    seals[key].halo.material.opacity = collected ? 0.28 : 0.82;
    sealLights[key].color.setHex(collected ? colors[key] : 0x6c7276);
    sealLights[key].emissiveIntensity = collected ? 0.85 : 0.02;
  }
  function setExitOpen(value) {
    const open = THREE.MathUtils.clamp(value, 0, 1);
    bars.scale.y = Math.max(0.001, 1 - open);
    bars.visible = open < 0.999;
  }
  setBridgeAngle('left', Math.PI / 2);
  setBridgeAngle('right', 0);
  setSelectedBridge('left');
  const bounds = new THREE.Box3().setFromObject(group);
  const levelRadius = Math.max(stairViewRadius, bounds.min.length(), bounds.max.length()) + 0.6;
  return { group, bridges, islands, levelRadius, viewRadius: stairViewRadius,
    setBridgeAngle, setSelectedBridge, setSealCollected, setExitOpen };
}
