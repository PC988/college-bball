// What the user knows about a recruit: rating ranges that always contain the truth
// and shrink with scouting, plus which hidden traits have been revealed.
import { SKILLS, PHYS } from '../player.js';

export const FILM_SKILLS = ['LAY', 'DNK', 'INS', 'MID', 'TPT', 'FTS'];
export const LIVE_SKILLS = ['DRB', 'PAS', 'ORE', 'DRE', 'STL', 'BLK'];
export const TRAIT_KEYS = ['sizePref', 'academicFocus', 'partyFocus', 'religious', 'homeLoyalty', 'wantsNIL', 'wantsPlayingTime', 'workEthic'];
export const TRAIT_LABELS = {
  sizePref: 'School size preference', academicFocus: 'Academic focus', partyFocus: 'Social life / party focus', religious: 'Wants a religious school',
  homeLoyalty: 'Wants to stay close to home', wantsNIL: 'NIL money importance', wantsPlayingTime: 'Playing time importance', workEthic: 'Work ethic',
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function makeRange(rng, truth, half) {
  const w = Math.round(half * 2);
  let lo = Math.round(truth - w * rng.next());
  lo = clamp(lo, 1, 99);
  let hi = clamp(lo + w, 1, 99);
  if (hi < truth) hi = truth;
  if (lo > truth) lo = truth;
  return [lo, hi];
}

// Every recruit starts fully unknown (null = "?"). The first look at a skill opens a
// range whose width depends on how well known the kid is, later looks narrow it.
const HALF = { 5: 10, 4: 14, 3: 18, 2: 22 };
export function initialKnowledge() {
  const r = {};
  for (const k of SKILLS) r[k] = null;
  for (const k of PHYS) r[k] = null;
  return { r, pot: null, traits: [], seen: 0, film: 0 };
}
const firstLook = (rng, recruit, truth, extra = 0) => makeRange(rng, truth, (HALF[recruit.stars] || 22) + extra);

// Shrink a range by factor (0-1 = new width share) while still containing truth.
export function narrow(rng, range, truth, factor) {
  const [lo, hi] = range;
  const newW = Math.max(0, Math.round((hi - lo) * factor));
  if (newW <= 2) return [truth, truth]; // fully scouted: exact number
  let nlo = Math.round(truth - newW * rng.next());
  nlo = clamp(nlo, lo, Math.max(lo, hi - newW));
  if (nlo > truth) nlo = truth;
  let nhi = Math.min(hi, nlo + newW);
  if (nhi < truth) nhi = truth;
  return [nlo, nhi];
}

// accuracy 1-100 => better scouts shrink more per look
const eff = (base, accuracy) => 1 - (1 - base) * (0.6 + accuracy / 125);

// look at one rating: open it if unknown (no narrowing on the first look), else narrow
function look(rng, recruit, range, truth, factor, extra = 0) {
  return range ? narrow(rng, range, truth, factor) : firstLook(rng, recruit, truth, extra);
}

// Film: opens 2 random skills (unseen first); once all are open it narrows 2 random ranges.
export function applyFilm(rng, k, recruit, accuracy) {
  const unseen = SKILLS.filter((s) => !k.r[s]);
  const seen = SKILLS.filter((s) => k.r[s] && k.r[s][0] !== k.r[s][1]);
  const picks = [];
  for (const pool of [unseen, seen]) while (picks.length < 2 && pool.length) picks.push(pool.splice(rng.int(0, pool.length - 1), 1)[0]);
  for (const s of picks) k.r[s] = look(rng, recruit, k.r[s], recruit.skills[s].cur, eff(0.55, accuracy));
  k.film++;
  syncPhys(k, recruit);
  return picks;
}

// Exact scout: one chosen skill, exact value.
export function applyExact(k, recruit, skill) {
  k.r[skill] = [recruit.skills[skill].cur, recruit.skills[skill].cur];
  syncPhys(k, recruit);
}

// Physicals unlock (exactly) once every skill has been seen, the same moment OVR shows.
export function syncPhys(k, recruit) {
  if (SKILLS.every((s) => k.r[s])) for (const s of PHYS) k.r[s] = [recruit.phys[s].cur, recruit.phys[s].cur];
}

// In person (a game or an event): potential, exactly.
export function applyLive(rng, k, recruit) {
  k.pot = [recruit.potential, recruit.potential];
  k.seen++;
}

export function revealTraits(rng, k, n) {
  const hidden = TRAIT_KEYS.filter((t) => !k.traits.includes(t));
  const out = [];
  for (let i = 0; i < n && hidden.length; i++) {
    const t = hidden.splice(rng.int(0, hidden.length - 1), 1)[0];
    k.traits.push(t);
    out.push(t);
  }
  return out;
}

export function describeTrait(key, value) {
  if (key === 'sizePref') return value === 'any' ? "Doesn't care" : `${value[0].toUpperCase()}${value.slice(1)} schools`;
  if (key === 'religious') return value ? 'Yes' : 'No';
  return value >= 75 ? 'Very high' : value >= 55 ? 'High' : value >= 35 ? 'Medium' : 'Low';
}

// Estimated OVR range from skill ranges, using the position's OVR weights via midpoint math
export function estimateOvr(k, ovrFn, recruit) {
  if (SKILLS.some((s) => !k.r[s])) return null; // not every skill seen yet: OVR unknown
  const lo = { ...recruit, skills: {} }, hi = { ...recruit, skills: {} };
  for (const s of SKILLS) { lo.skills[s] = { cur: k.r[s][0], cap: 99 }; hi.skills[s] = { cur: k.r[s][1], cap: 99 }; }
  return [ovrFn(lo), ovrFn(hi)];
}
