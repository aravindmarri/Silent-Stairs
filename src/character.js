import * as THREE from 'three';

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
