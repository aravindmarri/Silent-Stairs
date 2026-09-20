import { buildTwinMoonsLevel } from './twinMoonsBuilder.js';
import { stairViewRadius } from './stairDimensions.js';

export const level5 = {
  id: 5,
  name: 'The Twin Moons',
  type: 'twin-moons',
  viewRadius: stairViewRadius,
  controls: ['move', 'rotate', 'twin-moons', 'restart'],
  build: buildTwinMoonsLevel,
};
