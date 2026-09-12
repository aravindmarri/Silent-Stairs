import { buildTowerLevel } from './towerBuilder.js';

// The Turning Tower: a fixed tower core carries a rotating staircase
// arm. Physically rotate it in quarter turns to dock with island A,
// climb to the central landing B, pause there, rotate again to dock
// with island C, then descend and enter. No camera-illusion mechanic
// is involved — this is real 3D docking, checked against actual world
// positions and directions.
export const level2 = {
  id: 2,
  name: 'The Turning Tower',
  type: 'tower',
  controls: ['move', 'rotate', 'restart'],
  build() {
    return buildTowerLevel();
  },
};
