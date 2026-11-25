// World: static school data + seeded rosters.
import { makeRng } from './rng.js';
import { generateRoster } from './roster.js';

import SCHOOL_DATA from '../data/schools.json' with { type: 'json' };
import COLORS from '../data/colors.json' with { type: 'json' };
// team primary colors (white text reads on all of them)
for (const s of SCHOOL_DATA.schools) s.color ||= COLORS[s.id] || '#1565c0';
export { SCHOOL_DATA };

export function getSchool(idOrName) {
  const q = String(idOrName).toLowerCase();
  return SCHOOL_DATA.schools.find((s) => s.id === q || s.abbr.toLowerCase() === q || s.name.toLowerCase() === q);
}

// Every school's starting roster is derived from (worldSeed, schoolId), so a fresh
// world needs only its seed to be rebuilt.
export function createWorld(seed = 2026, year = 2026) {
  const teams = {};
  for (const school of SCHOOL_DATA.schools) {
    const rng = makeRng(`${seed}:roster:${school.id}`);
    teams[school.id] = { school, roster: generateRoster(school, rng), tactics: {} };
  }
  return { seed, year, teams, conferences: SCHOOL_DATA.conferences };
}
