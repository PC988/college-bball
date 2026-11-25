// Sim a full 32-game season for every D1 team in the data file.
// node cli/sim-season.js [--team duke] [--world 2026] [--load saves/x.json] [--save saves/season.json] [--box 1] [--pbp]
import { parseArgs } from './args.js';
import { createWorld, getSchool } from '../src/world.js';
import { newSeasonState, simRounds, standings, powerRatings, teamSchedule } from '../src/season.js';
import { renderBoxScore, renderPlayByPlay } from '../src/engine/boxscore.js';
import { saveTo, loadFrom } from '../src/save.js';
import { fullName } from '../src/player.js';

const args = parseArgs();
const school = getSchool(args.team || 'duke');
if (!school) { console.error('Unknown school'); process.exit(1); }
let world, season;
if (args.load) ({ world } = loadFrom(args.load));
else world = createWorld(Number(args.world || 2026));
season = newSeasonState(world, world.seed);

const t0 = Date.now();
simRounds(world, season, Infinity, { keepFor: [school.id] });
const ms = Date.now() - t0;

const rec = standings(world, season);
const pr = powerRatings(world, season);
const r = rec[school.id];
console.log(`\n=== ${world.year}-${String(world.year + 1).slice(2)} ${school.name}: ${r.W}-${r.L} (${r.cW}-${r.cL} conf) ===`);
console.log(`(${season.games.length} games simmed in ${ms} ms)\n`);
for (const [i, g] of teamSchedule(world, season, school.id).entries()) {
  console.log(`${String(i + 1).padStart(2)}. ${g.home ? 'vs' : '@ '} ${g.opp.padEnd(26)} ${g.conf ? 'C' : ' '}  ${g.result}`);
}

const conf = world.conferences.find((c) => c.id === school.conference);
console.log(`\n--- ${conf.name} standings ---`);
const confTeams = Object.values(world.teams).filter((t) => t.school.conference === conf.id).map((t) => t.school)
  .sort((a, b) => rec[b.id].cW - rec[b.id].cL - (rec[a.id].cW - rec[a.id].cL) || rec[b.id].W - rec[a.id].W);
for (const s of confTeams) console.log(`${s.name.padEnd(26)} ${`${rec[s.id].cW}-${rec[s.id].cL}`.padEnd(6)} ${rec[s.id].W}-${rec[s.id].L}`);

console.log('\n--- Top 25 (power rating) ---');
Object.keys(pr).sort((a, b) => pr[b] - pr[a]).slice(0, 25).forEach((id, i) => {
  const s = world.teams[id].school;
  console.log(`${String(i + 1).padStart(2)}. ${s.name.padEnd(26)} ${`${rec[id].W}-${rec[id].L}`.padEnd(6)} ${pr[id] >= 0 ? '+' : ''}${pr[id].toFixed(1)}`);
});

const players = Object.fromEntries(Object.values(world.teams).flatMap((t) => t.roster.map((p) => [p.id, { p, school: t.school }])));
const line = (id, s) => {
  const g = Math.max(1, s.GP);
  return `${fullName(players[id].p).padEnd(22)} ${players[id].p.pos.padEnd(3)} ${String(s.GP).padStart(2)} GP ${(s.MIN / g).toFixed(1).padStart(5)} MIN ${(s.PTS / g).toFixed(1).padStart(5)} PTS ${((s.ORB + s.DRB) / g).toFixed(1).padStart(4)} REB ${(s.AST / g).toFixed(1).padStart(4)} AST  FG ${(s.FGA ? s.FGM / s.FGA * 100 : 0).toFixed(1)}%  3P ${(s.TPA ? s.TPM / s.TPA * 100 : 0).toFixed(1)}%  FT ${(s.FTA ? s.FTM / s.FTA * 100 : 0).toFixed(1)}%`;
};
console.log(`\n--- ${school.name} per game ---`);
Object.entries(season.playerStats).filter(([, s]) => s.tid === school.id).sort((a, b) => b[1].PTS - a[1].PTS).forEach(([id, s]) => console.log(line(id, s)));

console.log('\n--- National leaders (20+ GP) ---');
const qual = Object.entries(season.playerStats).filter(([, s]) => s.GP >= 20);
for (const [label, f] of [['PPG', (s) => s.PTS / s.GP], ['RPG', (s) => (s.ORB + s.DRB) / s.GP], ['APG', (s) => s.AST / s.GP], ['BPG', (s) => s.BLK / s.GP], ['SPG', (s) => s.STL / s.GP]]) {
  const top = qual.sort((a, b) => f(b[1]) - f(a[1])).slice(0, 3);
  console.log(`${label}: ` + top.map(([id, s]) => `${fullName(players[id].p)} (${players[id].school.abbr}) ${f(s).toFixed(1)}`).join(', '));
}

if (args.box) {
  const k = season.kept[Number(args.box) - 1];
  if (k) {
    console.log('\n' + renderBoxScore(k.res));
    if (args.pbp) console.log('\n' + renderPlayByPlay(k.res, { skipSubs: true }));
  }
}
if (args.save) {
  const bytes = saveTo(args.save, { world, season, user: { school: school.id } });
  console.log(`\nSaved ${args.save} (${(bytes / 1024).toFixed(1)} KB)`);
}
