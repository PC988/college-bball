// High school senior-season averages: public for every recruit, no scouting needed.
// Pure function of the recruit's ratings, his HS teammates and the day, so nothing is saved.
// They are a noisy hint: a kid sharing the ball with other D1 recruits scores less than his ratings say.
import { makeRng } from './rng.js';
import { ovr } from './player.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const HS_GAMES = 28;

export function hsStats(r, mates = [], day = 32) {
  const rng = makeRng(`hs:${r.id}`);
  const s = (k) => r.skills[k].cur;
  const n = (sd) => 1 + rng.normal() * sd; // multiplicative noise
  // usage: alone = 1, sharing with an equal recruit ~0.8, with a better one less
  const mine = ovr(r) ** 4;
  const share = mine / (mine + mates.reduce((t, m) => t + ovr(m) ** 4, 0));
  const usage = 0.55 + 0.45 * share;
  const scoring = ['LAY', 'DNK', 'INS', 'MID', 'TPT'].map(s);
  const offS = 0.6 * Math.max(...scoring) + 0.4 * (scoring.reduce((a, b) => a + b, 0) / 5) * 0.5 + 0.4 * s('FTS') * 0.5;
  const big = r.pos === 'PF' || r.pos === 'C';
  const ppg = clamp((12 + (offS - 50) * 0.4) * usage * n(0.1), 2, 38);
  const rpg = clamp((2 + ((s('ORE') + s('DRE')) / 2 - 40) * 0.14 + (r.ht - 75) * 0.35) * n(0.12), 1, 17);
  const apg = clamp((0.5 + (s('PAS') - 40) * 0.09 + (s('DRB') - 40) * 0.03 + (r.pos === 'PG' ? 1 : 0)) * (0.7 + 0.3 * usage / 1) * n(0.15), 0.3, 11);
  const spg = clamp((0.3 + (s('STL') - 40) * 0.045) * n(0.15), 0.1, 4.5);
  const bpg = clamp((0.1 + (s('BLK') - 40) * 0.05 * clamp((r.ht - 72) / 10, 0.2, 1.4)) * n(0.18), 0, 5.5);
  const inside = Math.max(s('LAY'), s('DNK'), s('INS'));
  const fg = clamp(0.44 + (inside - 60) * 0.002 + (big ? 0.06 : 0) - (s('TPT') > 65 && !big ? 0.02 : 0) + rng.normal() * 0.02, 0.33, 0.68);
  const tpa = s('TPT') < 45 ? 0 : clamp((s('TPT') - 45) * 0.16 * usage * n(0.15), 0, 10);
  const tp = clamp(0.27 + (s('TPT') - 50) * 0.0035 + rng.normal() * 0.02, 0.15, 0.48);
  const ft = clamp(0.48 + (s('FTS') - 40) * 0.007 + rng.normal() * 0.02, 0.4, 0.92);
  const gp = clamp(Math.round(day * 0.875), 0, HS_GAMES);
  return { gp, ppg, rpg, apg, spg, bpg, fg, tp: tpa >= 0.5 ? tp : null, tpa, ft };
}
