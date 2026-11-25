// node cli/roster.js duke [--world 2026] [--load saves/x.json]
import { parseArgs } from './args.js';
import { createWorld, getSchool } from '../src/world.js';
import { loadFrom } from '../src/save.js';
import { ovr, fmtHeight, SKILLS } from '../src/player.js';
import { teamOvr } from '../src/roster.js';

const args = parseArgs();
const school = getSchool(args._[0] || 'duke');
if (!school) { console.error('Unknown school'); process.exit(1); }
const world = args.load ? loadFrom(args.load).world : createWorld(Number(args.world || 2026));
const t = world.teams[school.id];
console.log(`${school.name} (${school.tier}, prestige ${school.prestige}, ${school.state}) team OVR ${teamOvr(t.roster)}  roster ${t.roster.length}/12`);
console.log('#   NAME                   POS CLS HT    WT  ARCHETYPE          OVR POT GRD  ' + SKILLS.join(' ') + '  STR SPD STM');
for (const p of t.roster.slice().sort((a, b) => ovr(b) - ovr(a))) {
  console.log(`${String(p.num).padEnd(3)} ${(p.fn + ' ' + p.ln + (p.walkOn ? ' (WO)' : '')).padEnd(22)} ${p.pos.padEnd(3)} ${p.cls}  ${fmtHeight(p.ht).padEnd(5)} ${String(p.wt).padEnd(3)} ${p.archetype.padEnd(18)} ${String(ovr(p)).padStart(3)} ${String(ovr(p, 'cap')).padStart(3)} ${p.grade.padEnd(3)}  ${SKILLS.map((k) => String(p.skills[k].cur).padStart(3)).join(' ')}  ${['STR', 'SPD', 'STM'].map((k) => String(p.phys[k].cur).padStart(3)).join(' ')}`);
}
