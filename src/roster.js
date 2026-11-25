// Rosters: max 12. Graduation, yearly progression, walk-on fill.
import { generatePlayer, walkOn, ovr, SKILLS, PHYS, CLASSES, POSITIONS } from './player.js';

export const MAX_ROSTER = 12;
export const MAX_CLASS = 5; // most recruits a school can sign in one class
// Open scholarships for next year's class: roster spots not held by returning scholarship players.
export const openScholarships = (roster) => Math.max(0, Math.min(MAX_CLASS, MAX_ROSTER - roster.filter((p) => p.cls !== 'SR' && !p.walkOn).length));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Position template for a full 12-man roster
const TEMPLATE = ['PG', 'PG', 'SG', 'SG', 'SG', 'SF', 'SF', 'PF', 'PF', 'PF', 'C', 'C'];

// Mean potential for a school's players, from prestige (1-100)
export const teamPotentialMean = (prestige) => 50 + prestige * 0.4;

// Ceiling (potential) letters by school tier: [starters], [bench]. Two walk-ons fill out the 12.
const TIER_TEMPLATE = {
  LM: [['B', 'B', 'C', 'C', 'C'], ['C', 'C', 'C', 'C', 'C']],
  MM: [['B', 'B', 'B', 'B', 'C'], ['B', 'C', 'C', 'C', 'C']],
  HM: [['A', 'B', 'B', 'B', 'B'], ['B', 'B', 'C', 'C', 'C']],
  BB: [['A', 'A', 'B', 'B', 'B'], ['B', 'B', 'B', 'C', 'C']],
};
const BAND = { A: 90, B: 80, C: 70, D: 60 };
const STARTER_IDX = [0, 2, 5, 7, 10]; // PG SG SF PF C in TEMPLATE
const BENCH_IDX = [1, 3, 6, 8, 11];
const WALKON_IDX = [4, 9];

export function rosterCeilings(school, rng) {
  const [st, bn] = TIER_TEMPLATE[school.tier] || TIER_TEMPLATE.MM;
  const starters = st.slice();
  // stronger programs in a tier get an extra A
  if (school.tier === 'HM' && rng.chance(Math.max(0, (school.prestige - 70) / 25))) starters[1] = 'A';
  if (school.tier === 'BB' && rng.chance(Math.max(0, (school.prestige - 90) / 10))) starters[2] = 'A';
  const shuffled = starters.sort(() => rng.next() - 0.5);
  const val = (letter) => Math.min(99, BAND[letter] + Math.floor((rng.next() * 0.7 + (school.prestige / 100) * 0.3) * 10));
  const out = {};
  STARTER_IDX.forEach((idx, i) => (out[idx] = val(shuffled[i])));
  BENCH_IDX.forEach((idx, i) => (out[idx] = val(bn[i])));
  return out;
}

export function generateRoster(school, rng) {
  const ceil = rosterCeilings(school, rng);
  const roster = [];
  TEMPLATE.forEach((pos, i) => {
    const cls = CLASSES[i % 4];
    // walk-ons hold no scholarship: they can be cut to make room
    roster.push(WALKON_IDX.includes(i) ? walkOn(rng, pos, cls) : generatePlayer(rng, { pos, cls, potential: ceil[i], homeBias: school.state }));
  });
  fixNumbers(roster, rng);
  return roster;
}

const NUMS = [0, 1, 2, 3, 4, 5, 10, 11, 12, 13, 14, 15, 20, 21, 22, 23, 24, 25, 30, 31, 32, 33, 34, 35, 40, 41, 42, 44, 45, 50, 55];
// Jersey numbers must be unique on a roster; later arrivals pick a free number.
export function fixNumbers(roster, rng) {
  const used = new Set();
  for (const p of roster) {
    if (used.has(p.num)) {
      const free = NUMS.filter((n) => !used.has(n));
      p.num = rng ? rng.pick(free) : free[0];
    }
    used.add(p.num);
  }
}

/**
 * One year of development toward caps. Future: training and action points modify `boost`.
 * Returns list of { id, before, after } OVR changes.
 */
export function progressPlayer(player, rng, boost = 0) {
  const before = ovr(player);
  const ethic = (player.traits?.workEthic ?? 50) / 100;
  const age = { FR: 1.15, SO: 1.0, JR: 0.88, SR: 0.8 }[player.cls] ?? 1; // older players grow slower
  for (const k of SKILLS) {
    const s = player.skills[k];
    const gap = s.cap - s.cur;
    const rate = clamp((0.26 + ethic * 0.24 + boost) * age + rng.normal() * 0.08, 0.05, 0.9);
    s.cur = clamp(Math.round(s.cur + gap * rate), 1, s.cap);
  }
  for (const k of PHYS) {
    const s = player.phys[k];
    s.cur = clamp(Math.round(s.cur + (s.cap - s.cur) * 0.4), 1, s.cap);
  }
  return { before, after: ovr(player) };
}

/**
 * Offseason roster turnover for one team.
 * - seniors graduate
 * - everyone else ages a year and develops
 * - incoming players (recruits) join, bumping walk-ons first if full
 * - empty spots fill with walk-ons
 */
export function advanceRoster(team, rng, incoming = []) {
  const log = { graduated: [], progressed: [], signed: [], walkOns: [], cut: [] };
  const stay = [];
  for (const p of team.roster) {
    if (p.cls === 'SR') { log.graduated.push(p); continue; }
    p.cls = CLASSES[CLASSES.indexOf(p.cls) + 1];
    p.age += 1;
    log.progressed.push({ p, ...progressPlayer(p, rng) });
    stay.push(p);
  }
  team.roster = stay;
  for (const r of incoming) {
    const res = addPlayer(team, { ...r, cls: 'FR' });
    if (res.cut) log.cut.push(res.cut);
    if (res.added) log.signed.push(r);
  }
  log.walkOns = fillWalkOns(team, rng);
  return log;
}

// Adds a player. If full, the worst walk-on is cut. Non-walk-on full roster => refused.
export function addPlayer(team, player) {
  if (team.roster.length < MAX_ROSTER) {
    team.roster.push(player);
    fixNumbers(team.roster);
    return { added: true };
  }
  const walkOns = team.roster.filter((p) => p.walkOn).sort((a, b) => ovr(a) - ovr(b));
  if (!walkOns.length) return { added: false };
  const cut = walkOns[0];
  team.roster = team.roster.filter((p) => p !== cut);
  team.roster.push(player);
  fixNumbers(team.roster);
  return { added: true, cut };
}

// Fill to 12 with low-rated walk-ons at the positions the roster is thinnest.
export function fillWalkOns(team, rng) {
  const added = [];
  while (team.roster.length < MAX_ROSTER) {
    const counts = Object.fromEntries(POSITIONS.map((p) => [p, 0]));
    for (const p of team.roster) counts[p.pos]++;
    const want = { PG: 2, SG: 3, SF: 2, PF: 3, C: 2 };
    const pos = POSITIONS.slice().sort((a, b) => counts[a] - want[a] - (counts[b] - want[b]))[0];
    const w = walkOn(rng, pos, 'FR');
    team.roster.push(w);
    added.push(w);
  }
  fixNumbers(team.roster, rng);
  return added;
}

// Placeholder AI recruiting until the real recruiting phase exists:
// each team signs freshmen to replace graduates, quality scaled by prestige.
export function aiRecruitClass(school, rng, slots) {
  const mean = teamPotentialMean(school.prestige) + 2;
  const out = [];
  for (let i = 0; i < slots; i++) {
    const potential = clamp(Math.round(mean + rng.normal() * 8), 15, 100);
    out.push(generatePlayer(rng, { cls: 'HS', potential, homeBias: school.state }));
  }
  return out;
}

export const teamOvr = (roster) => {
  const top = roster.map((p) => ovr(p)).sort((a, b) => b - a).slice(0, 8);
  const w = [1.3, 1.25, 1.2, 1.15, 1.1, 0.8, 0.6, 0.5];
  return Math.round(top.reduce((s, v, i) => s + v * w[i], 0) / w.slice(0, top.length).reduce((a, b) => a + b, 0));
};
