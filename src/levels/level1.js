import * as THREE from 'three';
import { buildStairChain } from './stairChain.js';
import { stairDimensions, stairViewRadius } from './stairDimensions.js';

// The original puzzle: two staircases, one connection.
export const level1 = {
  id: 1,
  name: 'One Connection',
  type: 'illusion',
  viewRadius: stairViewRadius,
  controls: ['move', 'cross', 'restart'],
  build(camera) {
    return buildStairChain({
      camera,
      center: true,
      stairSpecs: [
        { ...stairDimensions, steps: 5, color: 0xe4dccb, enlargeLast: false },
        { ...stairDimensions, steps: 4, color: 0xe4dccb, enlargeFirst: false },
      ],
      connectionAngles: [THREE.MathUtils.degToRad(42)],
      connectionDepths: [6.5],
    });
  },
};
