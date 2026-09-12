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
