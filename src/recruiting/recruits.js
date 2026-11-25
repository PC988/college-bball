// High school recruit class. True ratings are generated from the seed and stay hidden;
// the user only ever sees ranges from src/recruiting/scouting.js.
import { makeRng } from '../rng.js';
import { generatePlayer, ovr } from '../player.js';
import NAMES from '../../data/names.json' with { type: 'json' };

const HS_FIRST = ['Central', 'North', 'South', 'East', 'West', 'Lincoln', 'Washington', 'Roosevelt', 'Jefferson', 'Kennedy', 'Riverside',
  'Lakeview', 'Hillcrest', 'Valley', 'Westlake', 'Eastside', 'Northside', 'Southside', 'Cedar Ridge', 'Pine Grove', 'Oak Park', 'Maple',
  'Highland', 'Fairview', 'Summit', 'Heritage', 'Liberty', 'Franklin', 'Madison', 'Monroe', 'Grant', 'Harrison', 'Mountain View', 'Bayside'];
const HS_LAST = ['High School', 'HS', 'Prep', 'Academy', 'Christian', 'Catholic', 'High'];

export const CLASS_SIZE = 2400; // ~365 D1 programs x ~4-5 scholarships, plus kids nobody signs

/**
 * Returns { recruits, teams, byState }.
 * recruit: player object + { state, hsTeam, stars, rank, score }
 */
// Ceiling curve for a high school class: 25% D (60-69), 50% C (70-79), 20% B (80-89), 5% A (90-99).
// Potential by national rank, matched to the talent that leaves college each year (graduates + draft),
// so the league stays at the same level season after season. q in [0,1): 1 = best in the class.
const POT_CURVE = [[0, 99], [10, 96], [45, 91], [90, 88], [200, 84], [300, 80], [450, 77], [700, 73], [900, 70], [1100, 66], [1600, 60], [2400, 50]];
export function classPotential(q) {
  const rank = (1 - q) * 2400;
  for (let i = 1; i < POT_CURVE.length; i++) {
    const [r1, p1] = POT_CURVE[i];
    if (rank <= r1) { const [r0, p0] = POT_CURVE[i - 1]; return Math.round(p0 + ((rank - r0) / (r1 - r0)) * (p1 - p0)); }
  }
  return 50;
}

export function generateRecruitClass(seed, year) {
  const rng = makeRng(`${seed}:recruits:${year}`);
  const states = Object.entries(NAMES.stateWeights);
  const recruits = [];
  for (let i = 0; i < CLASS_SIZE; i++) {
    const [state] = rng.weighted(states, states.map(([, w]) => w));
    const potential = classPotential(rng.next());
    const p = generatePlayer(rng, { cls: 'HS', potential });
    p.home = state;
    p.state = state;
    recruits.push(p);
  }
  for (const r of recruits) r.score = r.potential * 0.7 + ovr(r) * 0.3;
  recruits.sort((a, b) => b.score - a.score);
  recruits.forEach((r, i) => {
    r.rank = i + 1;
    r.stars = i < 25 ? 5 : i < 150 ? 4 : i < 600 ? 3 : 2;
  });

  // high school teams: group each state's recruits into teams of 1-3
  const byState = {};
  for (const r of recruits) (byState[r.state] ||= []).push(r);
  const teams = {};
  for (const [state, list] of Object.entries(byState)) {
    const shuffled = list.slice().sort(() => rng.next() - 0.5);
    let i = 0, n = 0;
    while (i < shuffled.length) {
      const size = rng.int(1, 3);
      const id = `${state}-${n++}`;
      const name = state === 'INTL'
        ? rng.pick(['Atlantic Basket Academy', 'Canary Isles Basket', 'Southern Cross Centre', 'Maple Leaf Prep', 'Danube Youth', 'Seine Basket Club', 'Gulf Coast Elite (Lagos)', 'Baltic Hoops'])
        : `${rng.pick(HS_FIRST)} ${rng.pick(HS_LAST)}`;
      teams[id] = { id, state, name, players: [] };
      for (const r of shuffled.slice(i, i + size)) { r.hsTeam = id; teams[id].players.push(r.id); }
      i += size;
    }
  }
  return { recruits, teams, byState };
}
