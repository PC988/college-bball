// Advance one offseason: seniors graduate, everyone develops, AI teams sign freshmen,
// your team signs --recruits N (default 0 until recruiting exists), empty spots become walk-ons.
// node cli/offseason.js --load saves/season.json --team duke [--recruits 2] [--save saves/next.json]
import { parseArgs } from './args.js';
import { getSchool, createWorld } from '../src/world.js';
import { loadFrom, saveTo } from '../src/save.js';
import { advanceRoster, aiRecruitClass, teamOvr } from '../src/roster.js';
import { makeRng } from '../src/rng.js';
import { ovr, fullName } from '../src/player.js';

const args = parseArgs();
const state = args.load ? loadFrom(args.load) : { world: createWorld(Number(args.world || 2026)) };
const { world } = state;
const school = getSchool(args.team || state.user?.school || 'duke');
const userRecruits = Number(args.recruits || 0);
const rng = makeRng(`${world.seed}:offseason:${world.year}`);
let userLog;
const before = teamOvr(world.teams[school.id].roster);
for (const t of Object.values(world.teams)) {
  const seniors = t.roster.filter((p) => p.cls === 'SR').length;
  const isUser = t.school.id === school.id;
  const incoming = aiRecruitClass(t.school, rng, isUser ? userRecruits : seniors);
  const log = advanceRoster(t, rng, incoming);
  if (isUser) userLog = log;
}
world.year++;
world.rostersModified = true;
const t = world.teams[school.id];
console.log(`=== ${school.name} offseason -> ${world.year}-${String(world.year + 1).slice(2)} ===`);
console.log(`Graduated (${userLog.graduated.length}): ${userLog.graduated.map((p) => `${fullName(p)} ${p.pos} ${ovr(p)}`).join(', ') || 'none'}`);
console.log(`Signed (${userLog.signed.length}): ${userLog.signed.map((p) => `${fullName(p)} ${p.pos} ${ovr(p)} (${p.grade})`).join(', ') || 'none'}`);
console.log(`Walk-ons added (${userLog.walkOns.length}): ${userLog.walkOns.map((p) => `${fullName(p)} ${p.pos} ${ovr(p)} OVR`).join(', ') || 'none'}`);
if (userLog.cut.length) console.log(`Cut: ${userLog.cut.map(fullName).join(', ')}`);
console.log('Development:');
for (const { p, before: b, after: a } of userLog.progressed) console.log(`  ${fullName(p).padEnd(22)} ${p.cls} ${b} -> ${a} (+${a - b})`);
console.log(`Team OVR ${before} -> ${teamOvr(t.roster)}   roster ${t.roster.length}/12`);
if (args.save) {
  const bytes = saveTo(args.save, { world, season: null, user: { school: school.id } });
  console.log(`Saved ${args.save} (${(bytes / 1024).toFixed(1)} KB)`);
}
