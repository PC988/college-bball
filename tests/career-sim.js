// Two-season career smoke test: play, recruit, offseason, reload, keep playing.
import * as C from '../src/recruiting/campaign.js';
import { ovr, fullName } from '../src/player.js';
import { teamOvr } from '../src/roster.js';

const school = process.argv[2] || 'butler';
let ctx = C.createCampaign({ seed: 77, schoolId: school, scout: C.generateScouts(77)[1] });
C.setTactics(ctx, { tempo: 'fast', defense: 'press', depth: 9 });
const targets = ctx.recruits.filter((r) => r.rank >= 110).slice(0, ctx.slots + 2).map((r) => r.id);
let t0 = Date.now();
for (let d = 1; d <= C.DAYS; d++) {
  for (const id of targets) C.makeOffer(ctx, id);
  for (const id of targets) C.phoneCall(ctx, id);
  if (d === 3) { const gm = C.prepareUserGame(ctx); while (!gm.done) { gm.step(); if (gm.period === 2) gm.setTactics(gm.userSide, { defense: 'zone' }); } C.finishUserGame(ctx, gm); }
  C.endDay(ctx, 'home');
  if (d === 15) { const json = C.serializeCampaign(ctx); ctx = C.loadCampaign(json); console.log(`mid-season reload ok (${(json.length / 1024).toFixed(0)} KB), day ${ctx.state.day}`); }
}
const h = ctx.state.history.at(-1);
console.log(`season 1: ${h.W}-${h.L}, signed ${h.signed}/${h.slots}, ${Date.now() - t0} ms`);
const signedIds = C.commitsFor(ctx, school);
const before = teamOvr(ctx.world.teams[school].roster);
const adv = C.advanceSeason(ctx);
ctx = adv.ctx;
const roster = ctx.world.teams[school].roster;
console.log(`offseason: graduated ${adv.summary.graduated.length}, signed ${adv.summary.signed.length}, walk-ons ${adv.summary.walkOns.length}; team OVR ${before} -> ${teamOvr(roster)}; roster ${roster.length}`);
console.log('freshmen on roster:', roster.filter((p) => p.cls === 'FR').map((p) => `${fullName(p)} ${p.pos} ${ovr(p)}${p.walkOn ? ' (WO)' : ''}${signedIds.includes(p.id) ? ' [signed by you]' : ''}`).join(', '));
// AI signees landed on AI rosters
const duke = ctx.world.teams.duke.roster.filter((p) => p.cls === 'FR');
console.log('Duke freshmen:', duke.map((p) => `${p.pos} ${ovr(p)}${p.walkOn ? ' WO' : ''}`).join(', '));
const json = C.serializeCampaign(ctx);
ctx = C.loadCampaign(json);
console.log(`season 2 reload ok (${(json.length / 1024).toFixed(0)} KB), year ${ctx.state.year}, day ${ctx.state.day}, slots ${ctx.slots}, roster ids match: ${ctx.world.teams[school].roster.every((p, i) => p.id === roster[i].id)}`);
t0 = Date.now();
for (let d = 1; d <= 5; d++) C.endDay(ctx, 'home');
const ss = Object.entries(ctx.season.playerStats).filter(([, s]) => s.tid === school).sort((a, b) => b[1].PTS - a[1].PTS).slice(0, 3);
console.log('season 2 after 5 games:', ctx.state.log.find((l) => l.kind === 'win' || l.kind === 'loss').text, `| leading scorers: ${ss.map(([id, s]) => `${fullName(roster.find((p) => p.id === id))} ${(s.PTS / s.GP).toFixed(1)}`).join(', ')} | ${Date.now() - t0} ms`);
