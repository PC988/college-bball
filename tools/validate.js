// Sims many random D1 matchups and compares per-team averages to real college numbers.
import { createWorld } from '../src/world.js';
import { simGame } from '../src/engine/game.js';
import { makeRng } from '../src/rng.js';

const N = Number(process.argv[2] || 600);
const world = createWorld(11);
const ids = Object.keys(world.teams);
const rng = makeRng(99);
const tot = {}; let teamGames = 0, homeWins = 0, ot = 0, poss = 0, orbChances = 0, orb = 0;
const minutes = [];
for (let i = 0; i < N; i++) {
  const h = world.teams[rng.pick(ids)];
  let a = world.teams[rng.pick(ids)];
  if (a === h) continue;
  const res = simGame(h, a, { seed: i + 1 });
  if (res.winner === 'home') homeWins++;
  if (res.periods > 2) ot++;
  for (const side of ['home', 'away']) {
    const t = res[side].totals; teamGames++;
    poss += res[side].possessions;
    for (const [k, v] of Object.entries(t)) tot[k] = (tot[k] || 0) + v;
    const opp = res[side === 'home' ? 'away' : 'home'].totals;
    orb += t.ORB; orbChances += t.ORB + opp.DRB;
    const mins = res[side].players.map((p) => p.MIN).sort((x, y) => y - x);
    minutes.push(mins);
  }
}
const avg = (k) => (tot[k] / teamGames).toFixed(1);
const pct = (m, a) => ((tot[m] / tot[a]) * 100).toFixed(1) + '%';
console.log(`games ${teamGames / 2}  home win ${(homeWins / (teamGames / 2) * 100).toFixed(1)}%  OT ${(ot / (teamGames / 2) * 100).toFixed(1)}%`);
console.log('stat      sim     real D1 (approx)');
const rows = [
  ['PTS', avg('PTS'), '72-74'], ['poss', (poss / teamGames).toFixed(1), '67-69'],
  ['FGM-FGA', `${avg('FGM')}-${avg('FGA')}`, '25.5-58'], ['FG%', pct('FGM', 'FGA'), '44%'],
  ['3PM-3PA', `${avg('TPM')}-${avg('TPA')}`, '7.8-23'], ['3P%', pct('TPM', 'TPA'), '34%'],
  ['FTM-FTA', `${avg('FTM')}-${avg('FTA')}`, '13.5-19'], ['FT%', pct('FTM', 'FTA'), '72%'],
  ['ORB', avg('ORB'), '9.5'], ['DRB', avg('DRB'), '24'], ['ORB%', (orb / orbChances * 100).toFixed(1) + '%', '29%'],
  ['AST', avg('AST'), '13.5'], ['STL', avg('STL'), '6.5'], ['BLK', avg('BLK'), '3.5'], ['TO', avg('TO'), '11.5'], ['PF', avg('PF'), '17'],
];
for (const r of rows) console.log(r[0].padEnd(9), String(r[1]).padEnd(8), r[2]);
const mAvg = minutes[0].map((_, i) => (minutes.reduce((s, m) => s + (m[i] || 0), 0) / minutes.length).toFixed(1));
console.log('minutes by rank:', mAvg.join(' '));

// ---- coaching inputs and talent should move results ----
const W = createWorld(5);
const T = (id, tactics = {}) => ({ ...W.teams[id], tactics });
function series(hid, aid, ht, at, n = 300) {
  let hw = 0; const agg = { poss: 0, tpa: 0, to: 0, pts: 0, starterMin: 0 };
  for (let i = 0; i < n; i++) {
    const r = simGame(T(hid, ht), T(aid, at), { seed: 5000 + i, neutral: true });
    if (r.winner === 'home') hw++;
    agg.poss += r.home.possessions; agg.tpa += r.home.totals.TPA; agg.to += r.away.totals.TO; agg.pts += r.home.score;
    agg.starterMin += r.home.players.filter((p) => p.starter).reduce((s, p) => s + p.MIN, 0) / 5;
  }
  const f = (v) => (v / n).toFixed(1);
  return `win ${(hw / n * 100).toFixed(0)}%  poss ${f(agg.poss)}  3PA ${f(agg.tpa)}  oppTO ${f(agg.to)}  pts ${f(agg.pts)}  starterMIN ${f(agg.starterMin)}`;
}
console.log('\nDuke vs Mississippi Valley St (neutral):', series('duke', 'mississippi-valley-state'));
console.log('Duke vs Kentucky (neutral):           ', series('duke', 'kentucky'));
console.log('Butler vs Xavier baseline:            ', series('butler', 'xavier'));
console.log('  Butler tempo fast:                  ', series('butler', 'xavier', { tempo: 'fast' }));
console.log('  Butler tempo slow:                  ', series('butler', 'xavier', { tempo: 'slow' }));
console.log('  Butler focus perimeter:             ', series('butler', 'xavier', { focus: 'perimeter' }));
console.log('  Butler press defense:               ', series('butler', 'xavier', { defense: 'press' }));
console.log('  Xavier vs Butler baseline:          ', series('xavier', 'butler'));
console.log('  Butler zone defense (Xavier 3PA up):', series('xavier', 'butler', {}, { defense: 'zone' }));
console.log('  Butler depth 7:                     ', series('butler', 'xavier', { depth: 7 }));
console.log('  Butler depth 10:                    ', series('butler', 'xavier', { depth: 10 }));
