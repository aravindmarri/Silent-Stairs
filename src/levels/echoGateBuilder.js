import * as THREE from 'three';
import { createMarker } from '../geometry.js';
import { stairDimensions, stairViewRadius } from './stairDimensions.js';

// One echo can hold either plate. The distant relay latches the amber
// passage and powers the cyan circuit, making the return trip possible.
export function buildEchoGateLevel() {
  const group = new THREE.Group();
  const { rise, run, width } = stairDimensions;
  const LOW = rise * 2;
  const MID = rise * 4;
  const HIGH = rise * 6;
  const half = width / 2;
  const deck = 0.34;
  const stone = new THREE.MeshStandardMaterial({ color: 0xe4dccb, roughness: 0.87, metalness: 0.03 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xa7a295, roughness: 0.92 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x626970, roughness: 0.65, metalness: 0.36 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x343e48, roughness: 0.75, metalness: 0.18 });
  const colors = { amber: 0xe8b964, blue: 0x88cfde };
  const nodes = {
    start: new THREE.Vector3(-6 * run, LOW, 0),
    amber: new THREE.Vector3(-2 * run, MID, 0),
    hub: new THREE.Vector3(0, MID, 0),
    relay: new THREE.Vector3(0, HIGH, -5 * run),
    blue: new THREE.Vector3(0, LOW, 4 * run),
    exit: new THREE.Vector3(5 * run, HIGH, 0),
  };

  function box(parent, x, y, z, sx, sy, sz, material = stone) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function platform(point) {
    box(group, point.x, point.y - deck / 2, point.z, width, deck, width);
    box(group, point.x, point.y - deck - 0.08, point.z, width - 0.24, 0.16, width - 0.24, trim);
  }
  Object.values(nodes).forEach(platform);

  function tread(x, z, top, bottom, axis) {
    box(group, x, (top + bottom) / 2, z, axis === 'x' ? run : width,
      top - bottom, axis === 'z' ? run : width);
  }

  const paths = {};
  // Two upward risers from the starting island into the amber landing.
  const startPath = [nodes.start.clone(), new THREE.Vector3(-5 * run, LOW, 0)];
  for (let i = 0; i < 2; i++) {
    const x = (-5 + i) * run;
    const top = LOW + (i + 1) * rise;
    tread(x + run / 2, 0, top, LOW - deck, 'x');
    startPath.push(new THREE.Vector3(x, top, 0), new THREE.Vector3(x + run, top, 0));
  }
  startPath.push(nodes.amber.clone());
  paths['start:amber'] = startPath;
  paths['amber:hub'] = [nodes.amber.clone(), nodes.hub.clone()];

  // The two locked arms have a short level bridge before their stairs.
  // Their doors sit on that bridge, so neither can be bypassed on a tread.
  function raisedArm(destination, axis, sign) {
    const along = (distance, height) => axis === 'x'
      ? new THREE.Vector3(sign * distance, height, 0)
      : new THREE.Vector3(0, height, sign * distance);
    const bridgeCenter = along(1.5 * run, MID - deck / 2);
    box(group, bridgeCenter.x, bridgeCenter.y, bridgeCenter.z,
      axis === 'x' ? run : width, deck, axis === 'z' ? run : width);
    const path = [nodes.hub.clone(), along(2 * run, MID)];
    for (let i = 0; i < 2; i++) {
      const distance = (2 + i) * run;
      const top = MID + (i + 1) * rise;
      const middle = along(distance + run / 2, top);
      tread(middle.x, middle.z, top, MID - deck, axis);
      path.push(along(distance, top), along(distance + run, top));
    }
    path.push(nodes[destination].clone());
    paths[`hub:${destination}`] = path;
  }
  raisedArm('relay', 'z', -1);
  raisedArm('exit', 'x', 1);

  // Cyan sits two risers below the junction. Explicit flat/drop segments
  // keep the ghost above the stone in both directions, including return.
  const bluePath = [nodes.hub.clone(), new THREE.Vector3(0, MID, run)];
  for (let i = 0; i < 2; i++) {
    const z = (1 + i) * run;
    const top = MID - (i + 1) * rise;
    tread(0, z + run / 2, top, LOW - deck, 'z');
    bluePath.push(new THREE.Vector3(0, top, z), new THREE.Vector3(0, top, z + run));
  }
  bluePath.push(nodes.blue.clone());
  paths['hub:blue'] = bluePath;

  function ring(point, inner, outer, color, opacity = 0.6, height = 0.018) {
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity,
      side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 40), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(point).add(new THREE.Vector3(0, height, 0));
    group.add(mesh);
    return mesh;
  }

  const plates = {};
  for (const name of ['amber', 'blue']) {
    const point = nodes[name];
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.72, 0.055, 32), dark);
    rim.position.copy(point).add(new THREE.Vector3(0, 0.02, 0));
    rim.receiveShadow = true;
    group.add(rim);
    const material = new THREE.MeshStandardMaterial({ color: colors[name], emissive: colors[name],
      emissiveIntensity: 0.12, roughness: 0.64, metalness: 0.28 });
    const surface = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 0.04, 32), material);
    surface.position.copy(point).add(new THREE.Vector3(0, 0.065, 0));
    surface.receiveShadow = true;
    group.add(surface);
    const glow = ring(point, 0.62, 0.67, colors[name], 0.32, 0.052);
    // Two etched arcs read as a footprint without adding instruction text.
    for (const side of [-1, 1]) {
      const etching = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.018, 5, 16, Math.PI * 1.3), dark);
      etching.rotation.x = -Math.PI / 2;
      etching.position.copy(point).add(new THREE.Vector3(side * 0.2, 0.088, 0));
      group.add(etching);
    }
    plates[name] = { surface, glow, baseHeight: point.y };
  }

  const gates = {};
  function gate(name, x, z, rotation) {
    const portal = new THREE.Group();
    portal.position.set(x, MID, z);
    portal.rotation.y = rotation;
    group.add(portal);
    const accent = new THREE.MeshStandardMaterial({ color: colors[name], emissive: colors[name],
      emissiveIntensity: 0.14, roughness: 0.65, metalness: 0.2 });
    // A 1.78-wide, 2.04-high opening comfortably clears the ghost.
    for (const side of [-1, 1]) {
      box(portal, side * 1.03, 1.1, 0, 0.28, 2.2, 0.34);
      box(portal, side * 1.03, 0.09, 0, 0.38, 0.18, 0.46, trim);
      box(portal, side * 1.03, 1.26, 0.183, 0.08, 1.33, 0.022, accent);
    }
    box(portal, 0, 2.2, 0, 2.46, 0.32, 0.42);
    box(portal, 0, 2.24, 0.221, 0.62, 0.09, 0.025, accent);
    const bars = new THREE.Group();
    bars.position.y = 2.04;
    portal.add(bars);
    for (let i = -2; i <= 2; i++) {
      box(bars, i * 0.32, -1.005, 0, 0.055, 2.01, 0.075, metal);
    }
    box(bars, 0, -1.46, 0, 1.64, 0.065, 0.1, metal);
    box(bars, 0, -0.46, 0, 1.64, 0.065, 0.1, metal);
    gates[name] = { bars, accent };
  }
  gate('amber', 0, -1.5 * run, 0);
  gate('blue', 1.5 * run, 0, Math.PI / 2);

  // Small inset circuit studs connect each plate's color to its portal.
  for (let i = 0; i < 3; i++) {
    box(group, -0.66 + i * 0.32, MID + 0.012, -0.62, 0.14, 0.024, 0.14,
      new THREE.MeshStandardMaterial({ color: colors.amber, emissive: colors.amber, emissiveIntensity: 0.16 }));
    box(group, 0.66, MID + 0.012, -0.1 + i * 0.32, 0.14, 0.024, 0.14,
      new THREE.MeshStandardMaterial({ color: colors.blue, emissive: colors.blue, emissiveIntensity: 0.16 }));
  }
  ring(nodes.hub, 0.33, 0.39, 0xc9c8ba, 0.5);

  // The relay is beside the walkable center: visiting its island never
  // places the player inside a pedestal or behind a decorative obstacle.
  const relayPoint = nodes.relay.clone().add(new THREE.Vector3(0.76, 0, -0.38));
  box(group, relayPoint.x, HIGH + 0.22, relayPoint.z, 0.4, 0.44, 0.4, trim);
  const relayMaterial = new THREE.MeshStandardMaterial({ color: 0x87999f, emissive: colors.blue,
    emissiveIntensity: 0.02, roughness: 0.3, metalness: 0.18 });
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), relayMaterial);
  crystal.scale.y = 1.45;
  crystal.position.copy(relayPoint).add(new THREE.Vector3(0, 0.87, 0));
  crystal.castShadow = true;
  group.add(crystal);
  const relayGlow = ring(nodes.relay, 0.47, 0.55, colors.blue, 0.15);

  const marker = createMarker(0xf2c14e);
  marker.position.copy(nodes.exit).add(new THREE.Vector3(0, 0.4, 0));
  group.add(marker);
  ring(nodes.exit, 0.3, 0.43, 0xffe9a8, 0.85);
  const goalLight = new THREE.PointLight(0xffe9a8, 0.8, 3, 2);
  goalLight.position.copy(nodes.exit).add(new THREE.Vector3(0, 0.7, 0));
  group.add(goalLight);

  // The selected destination is readable even when the controls wrap on
  // a small screen; the thin rings never cover the pressure-plate colors.
  const selectedRings = Object.fromEntries(Object.entries(nodes).map(([name, point]) =>
    [name, ring(point, 0.84, 0.89, 0xf1ebcf, 0)]));
  function setSelectedRoute(destination) {
    for (const [name, mesh] of Object.entries(selectedRings)) {
      mesh.material.opacity = name === destination ? 0.85 : 0;
    }
  }
  function setGateOpen(name, value) {
    const current = gates[name];
    if (!current) return;
    const open = THREE.MathUtils.clamp(value, 0, 1);
    // Bars retract upwards into the lintel without sticking above the
    // architecture. A fully raised gate has the entire opening clear.
    current.bars.scale.y = Math.max(0.001, 1 - open);
    current.bars.visible = open < 0.999;
    current.accent.emissiveIntensity = 0.14 + open * 0.55;
  }
  function setPlateActive(name, active) {
    const current = plates[name];
    if (!current) return;
    current.surface.position.y = current.baseHeight + (active ? 0.047 : 0.065);
    current.surface.material.emissiveIntensity = active ? 0.7 : 0.12;
    current.glow.material.opacity = active ? 0.95 : 0.32;
  }
  function setRelayActive(active) {
    relayMaterial.color.setHex(active ? colors.blue : 0x87999f);
    relayMaterial.emissiveIntensity = active ? 0.9 : 0.02;
    relayGlow.material.opacity = active ? 0.8 : 0.15;
  }
  const bounds = new THREE.Box3().setFromObject(group);
  const levelRadius = Math.max(stairViewRadius, bounds.min.length(), bounds.max.length()) + 0.5;
  return { group, nodes, paths, levelRadius, viewRadius: stairViewRadius,
    setGateOpen, setPlateActive, setRelayActive, setSelectedRoute };
}
