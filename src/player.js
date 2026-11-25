// Player generation. Skills use Hoopland's 12 categories on a 1-100 scale,
// each stored as { cur, cap }. Physicals (STR/SPD/STM) do not count toward OVR.

import NAMES from '../data/names.json' with { type: 'json' };

export const SKILLS = ['LAY', 'DNK', 'INS', 'MID', 'TPT', 'FTS', 'DRB', 'PAS', 'ORE', 'DRE', 'STL', 'BLK'];
export const PHYS = ['STR', 'SPD', 'STM'];
export const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
export const CLASSES = ['FR', 'SO', 'JR', 'SR'];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Height (inches) mean/sd and weight base by position
const BODY = {
  PG: { ht: [74.5, 1.6], wtBase: 180 },
  SG: { ht: [76.5, 1.4], wtBase: 192 },
  SF: { ht: [78.5, 1.3], wtBase: 207 },
  PF: { ht: [80.5, 1.3], wtBase: 225 },
  C: { ht: [83, 1.5], wtBase: 245 },
};

// How far archetype strengths/weaknesses pull a skill from the peak (1.7 made specialists 85+ at 72 OVR).
const ARCH_SPREAD = 0.8;
// Shooting is the hardest thing to be elite at: pull it down, the OVR shift spreads the difference over everything else.
const SKILL_BIAS = { TPT: -7, MID: -5, FTS: -4 };

// OVR weights per position (weighted average of skills => 1-99)
const EQ = { LAY: 1, DNK: 1, INS: 1, MID: 1, TPT: 1, FTS: 1, DRB: 1, PAS: 1, ORE: 1, DRE: 1, STL: 1, BLK: 1 };
const OVR_W = { PG: EQ, SG: EQ, SF: EQ, PF: EQ, C: EQ };

// Archetypes: skill offsets from the player's peak (positive = strength).
// phys offsets for STR/SPD/STM.
const ARCH = {
  PG: {
    floor_general: { s: { PAS: 14, DRB: 10, TPT: 2, MID: 2, STL: 4, LAY: 0, DNK: -30, INS: -30, ORE: -30, DRE: -20, BLK: -35, FTS: 4 }, p: { SPD: 6 } },
    scoring_guard: { s: { TPT: 10, MID: 10, DRB: 8, LAY: 6, PAS: 0, FTS: 8, DNK: -25, INS: -28, ORE: -30, DRE: -22, STL: 0, BLK: -35 }, p: { SPD: 4 } },
    defensive_pest: { s: { STL: 16, DRB: 4, PAS: 6, LAY: 2, TPT: -4, MID: -6, DNK: -24, INS: -30, ORE: -26, DRE: -18, BLK: -30, FTS: -2 }, p: { SPD: 10, STM: 8 } },
    sharpshooter: { s: { TPT: 16, FTS: 12, MID: 6, DRB: 2, PAS: 2, LAY: -6, DNK: -32, INS: -32, ORE: -32, DRE: -24, STL: -4, BLK: -36 }, p: {} },
  },
  SG: {
    sharpshooter: { s: { TPT: 16, FTS: 12, MID: 8, DRB: 0, PAS: -4, LAY: -2, DNK: -22, INS: -26, ORE: -26, DRE: -20, STL: -2, BLK: -30 }, p: {} },
    slasher: { s: { LAY: 14, DNK: 4, DRB: 8, TPT: -6, MID: 0, FTS: 2, PAS: -4, INS: -14, ORE: -16, DRE: -14, STL: 2, BLK: -24 }, p: { SPD: 8, STR: 4 } },
    two_way: { s: { STL: 12, TPT: 6, LAY: 4, MID: 2, DRB: 2, PAS: -2, FTS: 0, DNK: -14, INS: -22, ORE: -20, DRE: -12, BLK: -18 }, p: { SPD: 4, STM: 6 } },
    shot_creator: { s: { MID: 14, DRB: 12, TPT: 6, LAY: 6, FTS: 8, PAS: 2, DNK: -18, INS: -22, ORE: -24, DRE: -18, STL: -4, BLK: -30 }, p: {} },
  },
  SF: {
    wing_scorer: { s: { MID: 10, TPT: 8, LAY: 8, DNK: 2, DRB: 4, FTS: 4, PAS: -4, INS: -10, ORE: -12, DRE: -8, STL: -2, BLK: -14 }, p: {} },
    three_and_d: { s: { TPT: 12, STL: 12, DRE: 0, FTS: 2, LAY: -4, MID: -4, DRB: -8, PAS: -8, DNK: -8, INS: -16, ORE: -14, BLK: -6 }, p: { SPD: 4, STM: 6 } },
    point_forward: { s: { PAS: 12, DRB: 8, MID: 4, LAY: 4, TPT: 0, FTS: 0, DRE: 0, DNK: -6, INS: -10, ORE: -10, STL: 0, BLK: -12 }, p: {} },
    athletic_wing: { s: { DNK: 14, LAY: 10, STL: 4, BLK: 0, ORE: -2, DRE: -4, TPT: -10, MID: -6, FTS: -8, DRB: 0, PAS: -8, INS: -8 }, p: { SPD: 10, STR: 6 } },
  },
  PF: {
    stretch_four: { s: { TPT: 10, MID: 8, FTS: 6, DRE: 2, LAY: -2, DNK: -4, INS: -6, ORE: -8, BLK: -8, DRB: -16, PAS: -12, STL: -12 }, p: {} },
    post_scorer: { s: { INS: 14, LAY: 6, DNK: 4, ORE: 4, DRE: 2, MID: 0, FTS: -4, TPT: -26, DRB: -22, PAS: -10, STL: -16, BLK: -2 }, p: { STR: 10 } },
    glass_cleaner: { s: { ORE: 16, DRE: 16, BLK: 4, DNK: 2, INS: 0, LAY: -4, MID: -16, TPT: -30, FTS: -14, DRB: -26, PAS: -14, STL: -10 }, p: { STR: 8, STM: 6 } },
    athletic_finisher: { s: { DNK: 16, LAY: 6, BLK: 6, ORE: 4, DRE: 0, INS: -2, MID: -14, TPT: -24, FTS: -12, DRB: -16, PAS: -14, STL: -6 }, p: { SPD: 8 } },
  },
  C: {
    rim_protector: { s: { BLK: 18, DRE: 10, DNK: 6, ORE: 2, INS: -4, LAY: -6, MID: -24, TPT: -36, FTS: -18, DRB: -32, PAS: -16, STL: -14 }, p: { STR: 6 } },
    post_scorer: { s: { INS: 16, LAY: 4, DNK: 4, ORE: 4, DRE: 4, FTS: -6, MID: -10, TPT: -34, DRB: -28, PAS: -10, STL: -18, BLK: 0 }, p: { STR: 10 } },
    stretch_five: { s: { TPT: 4, MID: 8, FTS: 4, INS: 4, DRE: 4, BLK: 0, DNK: -2, LAY: -4, ORE: -6, DRB: -24, PAS: -10, STL: -18 }, p: { STR: -4 } },
    rebounder: { s: { ORE: 16, DRE: 16, DNK: 4, BLK: 4, INS: 2, LAY: -4, MID: -22, TPT: -36, FTS: -16, DRB: -30, PAS: -16, STL: -14 }, p: { STR: 10, STM: 4 } },
  },
};

// Potential score (1-100) to letter, school grading scale
export function gradeOf(score) {
  const s = Math.round(score);
  if (s >= 97) return 'A+';
  if (s >= 93) return 'A';
  if (s >= 90) return 'A-';
  if (s >= 87) return 'B+';
  if (s >= 83) return 'B';
  if (s >= 80) return 'B-';
  if (s >= 77) return 'C+';
  if (s >= 73) return 'C';
  if (s >= 70) return 'C-';
  if (s >= 67) return 'D+';
  if (s >= 63) return 'D';
  if (s >= 60) return 'D-';
  return 'F';
}

// Peak OVR the player can reach given potential score
// Potential IS the ceiling OVR (school scale: A 90-100, B 80-89, C 70-79, D 60-69).
// Potential IS the ceiling displayed OVR: a 90 potential tops out at 90 OVR (grade A-).
// peakFromPotential gives the skill average that displays as that OVR.
export const OVR_SHIFT = 8; // engine calibration offset only (engine was tuned on skills 8 higher)
export const peakFromPotential = (p) => (p - 16) / (84 / 92);
export const ceilGrade = (capOvr) => gradeOf(capOvr); // capOvr = displayed ceiling OVR
// Grade for a raw potential score (recruit scouting ranges): the grade of the ceiling it implies.
export const potGrade = (pot) => gradeOf(Math.round(pot));
// Share of peak a player shows as a high school senior: better prospects arrive more polished.
// A 97 ceiling arrives ~88, a 74 ~61, a 65 ~53; each college year closes ~38% of the gap to the cap.
export const hsDev = (pot) => Math.max(0.78, Math.min(0.89, 0.79 + (pot - 60) * 0.0024));
const YEARS_IN = { HS: 0, FR: 0, SO: 1, JR: 2, SR: 3 };

// Raw skill average (internal: generation, potential letters).
export function rawOvr(player, which = 'cur') {
  const w = OVR_W[player.pos];
  let sum = 0, wsum = 0;
  for (const k of SKILLS) {
    sum += player.skills[k][which] * w[k];
    wsum += w[k];
  }
  return sum / wsum;
}
// Displayed OVR, Hoopland-style: 16 + 0.913 x average skill, so the best possible player (average ~92) is 100.
export const OVR_BASE = 16, OVR_MULT = 84 / 92;
export const ovrFromAvg = (avg) => clamp(Math.round(OVR_BASE + OVR_MULT * avg), 1, 100);
export function ovr(player, which = 'cur') {
  return ovrFromAvg(rawOvr(player, which));
}

function pickName(rng) {
  return { fn: rng.pick(NAMES.first), ln: rng.pick(NAMES.last) };
}

function pickHome(rng, biasState) {
  const entries = Object.entries(NAMES.stateWeights);
  const weights = entries.map(([st, w]) => (st === biasState ? w + 12 : w));
  return rng.weighted(entries, weights)[0];
}


export function newPlayerId(rng) {
  return 'p' + rng.int(0, 2 ** 31).toString(36) + rng.int(0, 2 ** 31).toString(36);
}

/**
 * Generate a player.
 * opts: { potential (1-100), pos, cls ('FR'..'SR' or 'HS'), homeBias (state), walkOn (bool) }
 */
export function generatePlayer(rng, opts = {}) {
  const pos = opts.pos || rng.pick(POSITIONS);
  const cls = opts.cls || rng.pick(CLASSES);
  const archs = Object.keys(ARCH[pos]);
  const archetype = opts.archetype || rng.pick(archs);
  const arch = ARCH[pos][archetype];
  const potential = clamp(Math.round(opts.potential ?? 72 + rng.normal() * 11), 1, 100);
  const peak = peakFromPotential(potential);

  // body
  const b = BODY[pos];
  const ht = clamp(Math.round(b.ht[0] + rng.normal() * b.ht[1]), { PG: 70, SG: 73, SF: 75, PF: 77, C: 79 }[pos], 88);
  const wt = Math.round(b.wtBase + (ht - b.ht[0]) * 6 + rng.normal() * 12 + (arch.p.STR || 0) * 1.2);

  // caps: peak + archetype offset + jitter, then shift so OVR(cap) ~= peak
  const skills = {};
  for (const k of SKILLS) {
    const cap = peak + (arch.s[k] || 0) * ARCH_SPREAD + (SKILL_BIAS[k] || 0) + rng.normal() * 5;
    skills[k] = { cur: 0, cap };
  }
  // shift caps so OVR(cap) ~= peak, accounting for the 99 ceiling on single skills
  const clampedRaw = () => weightedRaw({ pos, skills: Object.fromEntries(SKILLS.map((k) => [k, { cap: clamp(Math.round(skills[k].cap), 1, 99) }])) }, 'cap');
  for (let iter = 0; iter < 8; iter++) {
    const diff = peak - clampedRaw();
    if (Math.abs(diff) < 0.3) break;
    for (const k of SKILLS) skills[k].cap += diff;
  }
  const base = hsDev(potential) + rng.normal() * 0.02;
  const left = Math.pow(0.62, YEARS_IN[cls] ?? 0); // share of the HS gap still to close
  const dev = 1 - (1 - base) * left;
  for (const k of SKILLS) {
    const cap = clamp(Math.round(skills[k].cap), 1, 99);
    const cur = clamp(Math.round(cap * (dev + rng.normal() * 0.025)), 1, cap);
    skills[k] = { cur, cap };
  }

  // physicals, also { cur, cap }
  const physBase = { PG: { STR: 42, SPD: 74, STM: 72 }, SG: { STR: 46, SPD: 70, STM: 72 }, SF: { STR: 54, SPD: 64, STM: 70 },
    PF: { STR: 64, SPD: 56, STM: 68 }, C: { STR: 72, SPD: 48, STM: 66 } }[pos];
  const phys = {};
  for (const k of PHYS) {
    const cap = clamp(Math.round(physBase[k] + (arch.p[k] || 0) + (peak - 75) * 0.25 + rng.normal() * 8), 15, 99);
    const cur = clamp(Math.round(cap * (dev + 0.05)), 10, cap);
    phys[k] = { cur, cap };
  }

  const age = { HS: 17, FR: 18, SO: 19, JR: 20, SR: 21 }[cls] + (rng.chance(0.35) ? 1 : 0);
  const name = pickName(rng);
  const player = {
    id: newPlayerId(rng),
    fn: name.fn,
    ln: name.ln,
    home: pickHome(rng, opts.homeBias),
    cls,
    age,
    redshirt: false,
    pos,
    archetype,
    ht,
    wt,
    num: rng.pick([0, 1, 2, 3, 4, 5, 10, 11, 12, 13, 14, 15, 20, 21, 22, 23, 24, 25, 30, 31, 32, 33, 34, 35, 40, 41, 42, 44, 45, 50, 55]),
    potential,
    grade: null,
    skills,
    phys,
    walkOn: !!opts.walkOn,
    // Hidden recruiting/personality traits (revealed later by phone calls, home visits)
    traits: {
      wantsPlayingTime: rng.int(1, 100),
      wantsNIL: rng.int(1, 100),
      sizePref: rng.pick(['small', 'medium', 'large', 'any']),
      academicFocus: rng.int(1, 100),
      partyFocus: rng.int(1, 100),
      religious: rng.chance(0.2),
      homeLoyalty: rng.int(1, 100),
      workEthic: rng.int(1, 100), // future: training gains
    },
    // Hook for future randomized pixel art. Renderer derives looks from seed; fields can override.
    appearance: { seed: rng.int(1, 2 ** 31 - 1), v: 0 },
  };
  player.grade = ceilGrade(ovr(player, 'cap')); // potential grade = ceiling OVR on the school scale
  return player;
}

function weightedRaw(p, which) {
  const w = OVR_W[p.pos];
  let s = 0, ws = 0;
  for (const k of SKILLS) { s += p.skills[k][which] * w[k]; ws += w[k]; }
  return s / ws;
}

export function walkOn(rng, pos, cls = 'FR') {
  return generatePlayer(rng, { pos, cls, potential: rng.int(68, 74), walkOn: true });
}

export const fmtHeight = (ht) => `${Math.floor(ht / 12)}'${ht % 12}"`;
export const fullName = (p) => `${p.fn} ${p.ln}`;
