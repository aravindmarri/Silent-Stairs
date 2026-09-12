// Animates a level swap: the outgoing root gently descends and tilts
// away while the incoming root rises up into place with the opposite
// tilt easing to neutral. Both roots are plain THREE.Group instances
// that sit ABOVE each level's own rotating "world" group in the scene
// graph — this animation only ever touches the roots' own transform,
// never `world.rotation.y`, so it can't corrupt the puzzle's authored
// rotation or any alignment math derived from it. Both roots are reset
// to an identity transform when the transition ends (or is cancelled),
// so whichever one survives is left in a clean state for gameplay.
//
// `shouldContinue()` is polled every frame; the animation resolves
// immediately (without forcing the "arrived" transform) the moment it
// returns false — used to abort cleanly when a level switch supersedes
// this one mid-flight.
export function animateLevelTransition({ outgoingRoot, incomingRoot, duration = 1000, shouldContinue = () => true }) {
  const reduceMotion =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const dur = reduceMotion ? Math.min(duration, 180) : duration;
  const dropDistance = reduceMotion ? 0.5 : 2.5;
  const tilt = reduceMotion ? 0 : Math.PI / 30; // ~6°

  const resetTransform = (root) => {
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
  };

  incomingRoot.position.y = -dropDistance;
  incomingRoot.rotation.z = -tilt;

  return new Promise((resolve) => {
    const startTime = performance.now();

    function step() {
      if (!shouldContinue()) {
        resolve();
        return;
      }

      const t = Math.min((performance.now() - startTime) / dur, 1);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic

      if (outgoingRoot) {
        outgoingRoot.position.y = -dropDistance * eased;
        outgoingRoot.rotation.z = tilt * eased;
      }
      incomingRoot.position.y = -dropDistance * (1 - eased);
      incomingRoot.rotation.z = -tilt * (1 - eased);

      if (t < 1) {
        requestAnimationFrame(step);
        return;
      }

      if (outgoingRoot) resetTransform(outgoingRoot);
      resetTransform(incomingRoot);
      resolve();
    }
    requestAnimationFrame(step);
  });
}
