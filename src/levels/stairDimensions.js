// Shared tread proportions and framing keep the first two levels at the
// same visual scale. The reference view is the original tower layout.
export const stairDimensions = { rise: 3.4 / 5, run: 1.15, width: 2.3, endScale: 1.7 };
const towerArmLength = stairDimensions.run * (4 + stairDimensions.endScale);
export const stairViewRadius = Math.hypot(towerArmLength + 2.6, stairDimensions.rise) + 1;
