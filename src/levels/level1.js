import * as THREE from 'three';
import { buildStairChain } from './stairChain.js';

// The original puzzle: two staircases, one connection.
export const level1 = {
  id: 1,
  name: 'One Connection',
  type: 'illusion',
  controls: ['move', 'cross', 'restart'],
  build(camera) {
    return buildStairChain({
      camera,
      stairSpecs: [
        { steps: 5, rise: 0.6, run: 1.0, width: 2.2, color: 0xe4dccb, enlargeLast: false },
        { steps: 4, rise: 0.6, run: 1.0, width: 2.2, color: 0xe4dccb, enlargeFirst: false },
      ],
      connectionAngles: [THREE.MathUtils.degToRad(42)],
      connectionDepths: [6.5],
    });
  },
};
