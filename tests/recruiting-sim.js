// Plays a full recruiting season with a simple bot and reports outcomes.
// node tests/recruiting-sim.js [school] [strategy: idle|focused]
import { createCampaign, generateScouts, endDay, phoneCall, homeVisit, makeOffer, travel, watchFilm, attendGame, gamesToday,
  commitsFor, serializeCampaign, loadCampaign, DAYS, recruitView } from '../src/recruiting/campaign.js';

const school = process.argv[2] || 'duke';
const strat = process.argv[3] || 'focused';
const t0 = Date.now();
let ctx = createCampaign({ seed: Number(process.env.SEED || 2026), schoolId: school, scout: generateScouts(2026)[0] });
console.log(`setup ${Date.now() - t0} ms, slots ${ctx.slots}, scout`, ctx.state.scout);
// bot: pick targets near our level, offer, call daily, visit when possible
const minRank = Number(process.argv[4] || (ctx.school.prestige > 90 ? 1 : 100));
const myTargets = ctx.recruits.filter((r) => r.rank >= minRank).slice(0, ctx.slots + 3).map((r) => r.id);
for (let d = 1; d <= DAYS; d++) {
  if (strat === 'focused') {
    for (const id of myTargets) makeOffer(ctx, id);
    const unvisited = myTargets.find((id) => !ctx.state.commits[id] && (ctx.state.visits[id] || 0) < 2);
    if (unvisited) { travel(ctx, ctx.byId[unvisited].state); homeVisit(ctx, unvisited); }
    const g = gamesToday(ctx, ctx.state.scoutAt)[0]; if (g) attendGame(ctx, g.id);
    for (const id of myTargets) phoneCall(ctx, id);
    watchFilm(ctx, myTargets[0]);
  }
  endDay(ctx, d % 2 ? 'stay' : 'home');
  if (d === 10) { // save/load roundtrip mid-season
    const json = serializeCampaign(ctx);
    ctx = loadCampaign(json);
    console.log(`day 10 save ${(json.length / 1024).toFixed(1)} KB, reload ok, day ${ctx.state.day}`);
  }
}
const mine = commitsFor(ctx, school);
console.log(`elapsed ${Date.now() - t0} ms`);
console.log(`${school} (${strat}) signed ${mine.length}/${ctx.slots}:`, mine.map((id) => `#${ctx.byId[id].rank}`).join(' '));
console.log('targets outcome:', myTargets.map((id) => { const v = recruitView(ctx, id); return `#${v.r.rank}->${v.committed || 'none'}(${v.myInterest})`; }).join(', '));
const all = Object.values(ctx.state.commits);
console.log('total commits', all.length, 'of', ctx.recruits.length, '| top100 committed', ctx.recruits.slice(0, 100).filter((r) => ctx.state.commits[r.id]).length);
const top10 = ctx.recruits.slice(0, 10).map((r) => `#${r.rank} ${ctx.state.commits[r.id] || '-'}`);
console.log('top10:', top10.join(', '));
const needs = Object.keys(ctx.world.teams).map((s) => ctx.slotsFor(s) - commitsFor(ctx, s).length);
console.log('schools with unfilled slots', needs.filter((n) => n > 0).length, 'avg unfilled', (needs.reduce((a, b) => a + Math.max(0, b), 0) / needs.length).toFixed(2));
console.log(ctx.state.log.slice(0, 8).map((l) => `D${l.day} ${l.text}`).join('\n'));
