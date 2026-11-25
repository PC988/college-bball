// Compact player encoding shared by Node saves and the browser game.
import { SKILLS, PHYS, ceilGrade, ovr } from './player.js';

export const STAT_KEYS = ['tid', 'GP', 'MIN', 'PTS', 'FGM', 'FGA', 'TPM', 'TPA', 'FTM', 'FTA', 'ORB', 'DRB', 'AST', 'STL', 'BLK', 'TO', 'PF'];
export const TRAITS = ['wantsPlayingTime', 'wantsNIL', 'sizePref', 'academicFocus', 'partyFocus', 'religious', 'homeLoyalty', 'workEthic'];

export function packPlayer(p) {
  return [p.id, p.fn, p.ln, p.home, p.cls, p.age, p.ht, p.wt, p.num, p.pos, p.archetype, p.potential, (p.walkOn ? 1 : 0) | (p.mcd ? 2 : 0), p.redshirt ? 1 : 0,
    p.appearance.seed, SKILLS.map((k) => p.skills[k].cur), SKILLS.map((k) => p.skills[k].cap),
    PHYS.map((k) => p.phys[k].cur), PHYS.map((k) => p.phys[k].cap), TRAITS.map((k) => p.traits[k])];
}

export function unpackPlayer(a) {
  const [id, fn, ln, home, cls, age, ht, wt, num, pos, archetype, potential, walkOn, redshirt, seed, sc, sp, pc, pp, tr] = a;
  const p = {
    id, fn, ln, home, cls, age, redshirt: !!redshirt, pos, archetype, ht, wt, num, potential,
    skills: Object.fromEntries(SKILLS.map((k, i) => [k, { cur: sc[i], cap: sp[i] }])),
    phys: Object.fromEntries(PHYS.map((k, i) => [k, { cur: pc[i], cap: pp[i] }])),
    walkOn: !!(walkOn & 1), mcd: !!(walkOn & 2),
    traits: Object.fromEntries(TRAITS.map((k, i) => [k, tr[i]])),
    appearance: { seed, v: 0 },
  };
  p.grade = ceilGrade(ovr(p, 'cap')); // potential grade = ceiling OVR on the school scale
  return p;
}

