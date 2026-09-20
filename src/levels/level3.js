import { buildCounterweightLevel } from './counterweightBuilder.js';
import { stairViewRadius } from './stairDimensions.js';

export const level3 = {
  id: 3,
  name: 'The Counterweight',
  type: 'counterweight',
  viewRadius: stairViewRadius,
  controls: ['move', 'balance', 'restart'],
  build: buildCounterweightLevel,
};
