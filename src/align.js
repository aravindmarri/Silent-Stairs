import * as THREE from 'three';

// The core "impossible geometry" trick.
//
// `sourcePointLocal` lives in the rotating world-group's local space
// (the space that spins as the player drags). We want to find a second
// point, also in that local space, which — once the whole group is
// spun to `targetAngleRad` — lands at the exact same screen position
// as sourcePoint, but sits `depthOffset` units further along the
// camera's view direction. Same screen spot, different depth: two
// platforms that only look connected from one angle.
//
// This only works with an ORTHOGRAPHIC camera: moving a point along
// the view direction doesn't change its screen-space (x, y) position,
// only how far away it is — exactly the ambiguity the illusion needs.
export function solveConnectorPosition(sourcePointLocal, camera, targetAngleRad, depthOffset) {
  const rot = new THREE.Matrix4().makeRotationY(targetAngleRad);
  const rotInv = new THREE.Matrix4().makeRotationY(-targetAngleRad);

  const sourceRotated = sourcePointLocal.clone().applyMatrix4(rot);

  camera.updateMatrixWorld(true);
  const viewDir = new THREE.Vector3();
  camera.getWorldDirection(viewDir);

  const targetRotated = sourceRotated.clone().addScaledVector(viewDir, depthOffset);

  return targetRotated.applyMatrix4(rotInv);
}

export function normalizeAngle(angle) {
  let a = angle % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// The closest angle to `current` that is congruent to `target` modulo a
// full turn. Dragging can wind `current` through several revolutions
// (rotation.y isn't wrapped), so snapping straight to `target` could
// spin the world the long way around; this picks whichever equivalent
// copy of `target` is nearest, so the snap always takes the short path.
export function nearestEquivalentAngle(current, target) {
  const twoPi = Math.PI * 2;
  const k = Math.round((current - target) / twoPi);
  return target + k * twoPi;
}

// Projects a point in `object3D`'s local space to CSS pixel coordinates
// on `canvasEl`, using object3D's CURRENT world matrix — so this reflects
// whatever rotation the world is at right now, not a cached transform.
export function projectToCanvasPx(pointLocal, object3D, camera, canvasEl) {
  object3D.updateMatrixWorld(true);
  const worldPos = pointLocal.clone().applyMatrix4(object3D.matrixWorld);
  const ndc = worldPos.clone().project(camera);
  const rect = canvasEl.getBoundingClientRect();
  return {
    x: (ndc.x * 0.5 + 0.5) * rect.width,
    y: (1 - (ndc.y * 0.5 + 0.5)) * rect.height,
  };
}

// The real, authoritative alignment test — the ±3° rotation check only
// finds the neighborhood of the solution; this confirms it in the space
// that actually matters, the rendered pixels. Both endpoints of each
// edge are checked (not just their midpoints), and the edges' on-screen
// directions must agree (not be reversed), so a connector that only
// touches at its center, or connects mirrored, is correctly rejected.
export function edgesMatchOnScreen({ world, camera, canvasEl, edgeA, edgeB, pixelTolerance = 1.5 }) {
  const a1 = projectToCanvasPx(edgeA.a, world, camera, canvasEl);
  const a2 = projectToCanvasPx(edgeA.b, world, camera, canvasEl);
  const b1 = projectToCanvasPx(edgeB.a, world, camera, canvasEl);
  const b2 = projectToCanvasPx(edgeB.b, world, camera, canvasEl);

  const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  const sub = (p, q) => ({ x: p.x - q.x, y: p.y - q.y });
  const dot = (u, v) => u.x * v.x + u.y * v.y;
  const norm = (u) => Math.hypot(u.x, u.y) || 1;

  const dirA = sub(a2, a1);

  // Try both possible endpoint pairings (a1<->b1 or a1<->b2) since
  // nothing guarantees which end of edgeB corresponds to which end of
  // edgeA — only that a correct connection has one consistent pairing
  // whose direction is compatible (not flipped).
  const pairings = [
    { dist: Math.max(dist(a1, b1), dist(a2, b2)), dir: sub(b2, b1) },
    { dist: Math.max(dist(a1, b2), dist(a2, b1)), dir: sub(b1, b2) },
  ];

  return pairings.some(
    (p) => p.dist <= pixelTolerance && dot(dirA, p.dir) / (norm(dirA) * norm(p.dir)) > 0.98
  );
}
