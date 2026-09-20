import { buildEchoGateLevel } from './echoGateBuilder.js';
import { stairViewRadius } from './stairDimensions.js';

export const level4 = {
  id: 4,
  name: 'The Echo Gate',
  type: 'echo',
  viewRadius: stairViewRadius,
  controls: ['move', 'echo', 'restart'],
  build: buildEchoGateLevel,
};
