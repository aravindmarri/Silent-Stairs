import { level1 } from './level1.js';
import { level2 } from './level2.js';

// The level registry — add new levels here and they're automatically
// available to progression, the dev toolbar, and ?level= deep links.
export const levels = [level1, level2];

export function getLevelById(id) {
  return levels.find((l) => l.id === id) ?? null;
}

export function getNextLevel(id) {
  const index = levels.findIndex((l) => l.id === id);
  return index >= 0 && index + 1 < levels.length ? levels[index + 1] : null;
}
