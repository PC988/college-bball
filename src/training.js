// Training: drills turn AP into XP; 100 XP = +1 to a rating, never past its cap.
// XP per session scales with work ethic, age (class) and how far the rating is from its cap.
import { SKILLS, PHYS } from './player.js';

export const DRILLS = {
  shooting: { label: 'Shooting', keys: ['MID', 'TPT', 'FTS'] },
  finishing: { label: 'Finishing', keys: ['LAY', 'DNK', 'INS'] },
  handles: { label: 'Ball skills', keys: ['DRB', 'PAS'] },
  rebounding: { label: 'Rebounding', keys: ['ORE', 'DRE'] },
  defense: { label: 'Defense', keys: ['STL', 'BLK'] },
  conditioning: { label: 'Conditioning', keys: ['STR', 'SPD', 'STM'] },
};
export const TRAIN_COST = { solo: 2, team: 8 };
const BASE_XP = { solo: 150, team: 60 }; // daily solo work on a player far from his ceiling is worth about +6 OVR a season
export const AGE_MULT = { FR: 1.25, SO: 1.05, JR: 0.9, SR: 0.75 };
export const ethicMult = (p) => 0.55 + ((p.traits?.workEthic ?? 50) / 100) * 0.9;
export const xpMult = (p) => ethicMult(p) * (AGE_MULT[p.cls] ?? 1);
const isPhys = (k) => PHYS.includes(k);
const rating = (p, k) => (isPhys(k) ? p.phys[k] : p.skills[k]);

// rec = { xp: {K: n}, up: {K: n} } stored in the save; mutates player ratings.
export function trainPlayer(p, rec, drill, kind) {
  const gains = [];
  for (const k of DRILLS[drill].keys) {
    const r = rating(p, k);
    const gap = r.cap - r.cur;
    if (gap <= 0) continue;
    const xp = Math.round(BASE_XP[kind] * xpMult(p) * (gap / (gap + 3)));
    rec.xp[k] = (rec.xp[k] || 0) + xp;
    while (rec.xp[k] >= 100 && r.cur < r.cap) {
      rec.xp[k] -= 100;
      r.cur++;
      rec.up[k] = (rec.up[k] || 0) + 1;
      gains.push(k);
    }
    if (r.cur >= r.cap) rec.xp[k] = 0;
  }
  return gains;
}

// Re-apply saved level-ups to a freshly unpacked roster.
export function applyTraining(roster, train) {
  for (const p of roster) {
    const rec = train?.[p.id];
    if (!rec) continue;
    for (const [k, n] of Object.entries(rec.up || {})) {
      const r = rating(p, k);
      if (r) r.cur = Math.min(r.cap, r.cur + n);
    }
  }
}
export const KEYS = [...SKILLS, ...PHYS];
