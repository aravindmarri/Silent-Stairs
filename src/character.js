import * as THREE from 'three';
import { normalizeAngle } from './align.js';

// Animates `character.position` (in its parent's local space) through a
// list of waypoints at a given speed (a single number, or an array with
// one entry per segment). Any leftover time within a frame — after a
// segment finishes — carries into the next segment rather than being
// dropped, so a segment boundary landing mid-frame doesn't cost or gain
// a few milliseconds of travel; walking speed stays independent of
// frame rate even across many short segments.
//
// `options.signal`, if given, is a plain `{ cancelled: boolean }` object
// the caller can flip to stop the walk early (e.g. on Restart) — the
// promise resolves immediately without finishing the remaining path,
// leaving the character wherever it was.
export function walkPath(character, waypoints, speeds = 2.2, { signal } = {}) {
  const speedFor = (i) => (Array.isArray(speeds) ? speeds[i] : speeds);

  return new Promise((resolve) => {
    if (waypoints.length < 2) {
      resolve();
      return;
    }
    let segment = 0;
    let t = 0; // fraction of the current segment completed
    const clock = new THREE.Clock();

    function applyPosition() {
      const from = waypoints[segment];
      const to = waypoints[segment + 1];
      character.position.lerpVectors(from, to, t);

      const dx = to.x - from.x;
      const dz = to.z - from.z;
      if (Math.hypot(dx, dz) > 0.001) {
        character.rotation.y = Math.atan2(dx, dz);
      }
    }

    function step() {
      if (signal?.cancelled) {
        resolve();
        return;
      }

      let dt = clock.getDelta();

      while (dt > 0 && segment < waypoints.length - 1) {
        const from = waypoints[segment];
        const to = waypoints[segment + 1];
        const dist = Math.max(from.distanceTo(to), 0.0001);
        const speed = speedFor(segment);
        const remainingDist = (1 - t) * dist;
        const distThisFrame = speed * dt;

        if (distThisFrame < remainingDist) {
          t += distThisFrame / dist;
          dt = 0;
        } else {
          const timeToFinishSegment = remainingDist / speed;
          dt -= timeToFinishSegment;
          t = 1;
          applyPosition();
          segment += 1;
          t = 0;
          if (segment >= waypoints.length - 1) {
            resolve();
            return;
          }
        }
      }

      applyPosition();
      requestAnimationFrame(step);
    }

    clock.start();
    requestAnimationFrame(step);
  });
}

// Smoothly turns `character` to face the camera, over `duration` ms,
// via the shortest yaw path — used once the ghost reaches a level's
// goal. Only `.rotation.y` is ever touched (matching the convention
// everywhere else in this file), so it stays upright.
//
// An orthographic camera's rays are all parallel, so "facing the
// camera" is the same world-space direction everywhere in the scene,
// regardless of the character's position: the negative of the camera's
// view direction. That direction is computed in WORLD space, then
// converted into the character's PARENT's local space (removing
// whatever the parent chain's current rotation is — chiefly the
// puzzle's own world-rotation — since `character.rotation.y` is
// expressed in that local frame) so the result faces the screen
// correctly no matter how the world is currently rotated.
export function faceCamera(character, camera, duration = 500, { signal } = {}) {
  return new Promise((resolve) => {
    const parent = character.parent;
    parent.updateMatrixWorld(true);
    const parentWorldQuat = new THREE.Quaternion();
    parent.getWorldQuaternion(parentWorldQuat);
    const toParentLocal = parentWorldQuat.clone().invert();

    const worldForward = new THREE.Vector3();
    camera.getWorldDirection(worldForward);
    worldForward.negate(); // point back toward the camera, not along its view ray

    const localForward = worldForward.applyQuaternion(toParentLocal);
    const targetYaw = Math.atan2(localForward.x, localForward.z);

    const fromYaw = character.rotation.y;
    const delta = normalizeAngle(targetYaw - fromYaw); // shortest yaw path, either direction
    const startTime = performance.now();

    function step() {
      if (signal?.cancelled) {
        resolve();
        return;
      }
      const t = Math.min((performance.now() - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      character.rotation.y = fromYaw + delta * eased;
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    }
    requestAnimationFrame(step);
  });
}
