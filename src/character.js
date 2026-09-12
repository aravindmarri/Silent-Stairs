import * as THREE from 'three';

// Animates `character.position` (in its parent's local space) through a
// list of waypoints. Because the waypoints that straddle the "impossible"
// connection share the same screen projection at the puzzle's solved
// angle, a straight local-space lerp between them reads as a smooth,
// unbroken walk on screen — even though the character silently jumps
// depth in true 3D space. That depth-only segment covers real distance
// with zero visible motion, so it needs a much higher speed than the
// on-stair segments — otherwise the character appears to freeze in
// place for however long the crossing takes. `speeds` may be a single
// number applied to every segment, or an array giving one per segment.
// `noRotateSegments` marks segment indices (typically that same
// crossing segment) where the character should keep facing whatever
// direction it already had — the crossing's raw displacement vector is
// an arbitrary jump through depth, not an actual walking direction, so
// turning to face it reads as the character spinning in place.
export function walkPath(character, waypoints, speeds = 2.2, noRotateSegments = []) {
  const speedFor = (i) => (Array.isArray(speeds) ? speeds[i] : speeds);
  const skipRotate = new Set(noRotateSegments);
  return new Promise((resolve) => {
    let segment = 0;
    let t = 0;
    const clock = new THREE.Clock();

    function step() {
      const from = waypoints[segment];
      const to = waypoints[segment + 1];
      const dist = from.distanceTo(to);
      const dt = clock.getDelta();
      t += (speedFor(segment) * dt) / Math.max(dist, 0.0001);

      character.position.lerpVectors(from, to, Math.min(t, 1));

      if (!skipRotate.has(segment)) {
        const dx = to.x - from.x;
        const dz = to.z - from.z;
        if (Math.hypot(dx, dz) > 0.001) {
          character.rotation.y = Math.atan2(dx, dz);
        }
      }

      if (t >= 1) {
        segment += 1;
        t = 0;
        if (segment >= waypoints.length - 1) {
          resolve();
          return;
        }
      }
      requestAnimationFrame(step);
    }

    clock.start();
    requestAnimationFrame(step);
  });
}
