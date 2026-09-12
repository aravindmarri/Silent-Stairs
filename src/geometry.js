import * as THREE from 'three';

// Builds a solid staircase descending along +X while dropping in -Y.
// The "entry" point sits on the group's local Y-axis (x=0, z=0), which
// means rotating the returned group around its own Y axis never moves
// the entry point in X/Z — only the far end of the staircase swings.
// The first and last treads can be widened (enlargeFirst/enlargeLast)
// into sturdier landing platforms.
export function createStaircase({
  steps = 5,
  rise = 0.6,
  run = 1.0,
  width = 2.2,
  color = 0xdad3c8,
  endScale = 1.6,
  enlargeFirst = true,
  enlargeLast = true,
}) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05 });

  let x = 0;
  const noses = [];
  for (let i = 0; i < steps; i++) {
    const isEnd = (i === 0 && enlargeFirst) || (i === steps - 1 && enlargeLast);
    const w = isEnd ? run * endScale : run;
    const height = (steps - i) * rise;

    const geo = new THREE.BoxGeometry(w, height, width);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x + w / 2, height / 2, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    x += w;
    noses.push(new THREE.Vector3(x, height, 0));
  }

  const entryLocal = new THREE.Vector3(0, steps * rise, 0);
  // The staircase "ends" at the nosing of its last tread — not a step
  // down onto an implied floor beyond it, since there's no floor drawn
  // there. This also keeps the walking path entirely above solid
  // geometry (see pathLocal below).
  const exitLocal = noses[noses.length - 1].clone();

  // The full-width edges at the entrance and exit — not just their
  // center points. Exact alignment is checked against both endpoints of
  // each edge, so a connector that only lines up at its midpoint (but is
  // angled or mismatched in width) is correctly rejected.
  const halfWidth = width / 2;
  const entryEdge = {
    a: new THREE.Vector3(entryLocal.x, entryLocal.y, -halfWidth),
    b: new THREE.Vector3(entryLocal.x, entryLocal.y, halfWidth),
  };
  const exitEdge = {
    a: new THREE.Vector3(exitLocal.x, exitLocal.y, -halfWidth),
    b: new THREE.Vector3(exitLocal.x, exitLocal.y, halfWidth),
  };

  // The walking path follows the nosing line — the front-top corner of
  // each tread, in sequence. A straight segment between two consecutive
  // nosings starts at the higher tread's height and descends to the
  // lower tread's height exactly at its front edge, which stays at or
  // above that lower tread's (flat) surface for its entire span. So the
  // path glides along the stair profile without ever dipping below a
  // tread into the solid step mass beneath it — unlike a single overall
  // diagonal, or separate flat/drop legs, both of which cut through
  // the stairs.
  const pathLocal = [entryLocal.clone(), ...noses.map((n) => n.clone())];

  return { group, entryLocal, exitLocal, entryEdge, exitEdge, pathLocal, width, height: steps * rise, length: x };
}

export function createMarker(color) {
  const geo = new THREE.ConeGeometry(0.25, 0.5, 16);
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = Math.PI;
  return mesh;
}
