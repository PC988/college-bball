// March Madness (68-team field) and the NBA draft (60 picks).
// Everything is deterministic from the seed + the regular season; the save keeps only scores.
import { makeRng } from './rng.js';
import { Game } from './engine/game.js';
import { standings, powerRatings, teamOf, compactResult, expandCompact } from './season.js';
import { ovr } from './player.js';

export const REGIONS = ['East', 'West', 'South', 'Midwest'];
export const ROUND_NAMES = ['First Four', 'Round of 64', 'Round of 32', 'Sweet 16', 'Elite Eight', 'Final Four', 'National Championship'];
const BRACKET = [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15];

// ---------- selection ----------
// 31 automatic bids (best conference record) + 37 at-large by a résumé score; seeded 1-68 on an S-curve.
export function selectField(world, season) {
  const rec = standings(world, season);
  const pr = powerRatings(world, season);
  const ids = Object.keys(world.teams);
  const score = (id) => { const r = rec[id]; const g = r.W + r.L || 1; return pr[id] + (r.W / g - 0.5) * 14; };
  const auto = new Set();
  for (const c of world.conferences) {
    const mem = ids.filter((id) => world.teams[id].school.conference === c.id);
    if (!mem.length) continue;
    mem.sort((a, b) => (rec[b].cW - rec[b].cL) - (rec[a].cW - rec[a].cL) || score(b) - score(a));
    auto.add(mem[0]);
  }
  const atLarge = ids.filter((id) => !auto.has(id)).sort((a, b) => score(b) - score(a)).slice(0, 68 - auto.size);
  const all = [...auto, ...atLarge].sort((a, b) => score(b) - score(a));
  // seed lines: 1-10 have 4 teams, 11 has 6, 12-15 have 4, 16 has 6
  const lines = [];
  let i = 0;
  for (let seed = 1; seed <= 16; seed++) { const n = seed === 11 || seed === 16 ? 6 : 4; lines.push(all.slice(i, i + n)); i += n; }
  const field = [];
  lines.forEach((line, li) => line.forEach((sid, k) => {
    // snake the S-curve so the top 1 seed doesn't share a region with the top 2 seed
    const reg = k < 4 ? (li % 2 ? 3 - k : k) : -1;
    field.push({ sid, seed: li + 1, region: reg, auto: auto.has(sid) });
  }));
  // lines 11 and 16 have six teams: the top two go straight in, the other four make two First Four games
  const ff = [];
  for (const seed of [11, 16]) {
    const L = field.filter((f) => f.seed === seed);
    const R = seed === 11 ? [0, 1, 2, 3] : [3, 2, 1, 0];
    L.forEach((f) => (f.region = -1));
    L[0].region = R[0]; L[1].region = R[1];
    ff.push({ seed, region: R[2], teams: [L[2].sid, L[5].sid] });
    ff.push({ seed, region: R[3], teams: [L[3].sid, L[4].sid] });
  }
  return { field, ff };
}

export function startTourney(ctx) {
  const st = ctx.state;
  const { field, ff } = selectField(ctx.world, ctx.season);
  st.mm = { field, round: 0, games: ff.map((x) => ({ r: 0, reg: x.region, seed: x.seed, a: x.teams[0], b: x.teams[1], s: null })), box: {}, champ: null };
  return st.mm;
}

const seedOf = (mm, sid) => mm.field.find((f) => f.sid === sid)?.seed;
const winner = (g) => (g.s ? (g.s[0] > g.s[1] ? g.a : g.b) : null);
export const gameWinner = winner;
export const tourneySeed = seedOf;

function buildNext(mm) {
  const r = mm.round;
  const prev = mm.games.filter((g) => g.r === r);
  if (r === 0) {
    // Round of 64: fill each region's bracket, First Four winners take their slots
    for (let reg = 0; reg < 4; reg++) {
      const slot = (seed) => {
        const play = prev.find((g) => g.reg === reg && g.seed === seed);
        if (play) return winner(play);
        return mm.field.find((f) => f.region === reg && f.seed === seed).sid;
      };
      for (let i = 0; i < 16; i += 2) mm.games.push({ r: 1, reg, a: slot(BRACKET[i]), b: slot(BRACKET[i + 1]), s: null });
    }
  } else if (r < 6) {
    for (let i = 0; i < prev.length; i += 2) mm.games.push({ r: r + 1, reg: r + 1 >= 5 ? -1 : prev[i].reg, a: winner(prev[i]), b: winner(prev[i + 1]), s: null });
  }
  if (r === 6) mm.champ = winner(prev[0]);
  else mm.round = r + 1;
}

// The game object for a tournament game (neutral court). User side gets your tactics.
export function mmGame(ctx, idx) {
  const g = ctx.state.mm.games[idx];
  const side = (id) => ({ ...teamOf(ctx.world, id), tactics: id === ctx.state.schoolId ? { ...ctx.state.tactics } : {} });
  const gm = new Game(side(g.a), side(g.b), { seed: `${ctx.world.seed}:${ctx.world.year}:mm${idx}`, neutral: true });
  gm.userSide = g.a === ctx.state.schoolId ? 'home' : g.b === ctx.state.schoolId ? 'away' : null;
  gm.mmIdx = idx;
  gm.sim2 = () => { gm.sim(); return gm; };
  return gm;
}
export function recordMM(ctx, gm) {
  const res = gm.result();
  const g = ctx.state.mm.games[gm.mmIdx];
  g.s = [res.home.score, res.away.score];
  if (g.a === ctx.state.schoolId || g.b === ctx.state.schoolId) ctx.state.mm.box[gm.mmIdx] = compactResult(res);
  return res;
}
export const mmBox = (ctx, idx) => { const g = ctx.state.mm.games[idx]; const c = ctx.state.mm.box[idx]; return c ? expandCompact(ctx.world, g.a, g.b, c) : null; };

// Your game in the current round (index), if you're still alive.
export function userMMGame(ctx) {
  const mm = ctx.state.mm;
  if (!mm || mm.champ) return null;
  const idx = mm.games.findIndex((g) => g.r === mm.round && (g.a === ctx.state.schoolId || g.b === ctx.state.schoolId));
  return idx < 0 ? null : idx;
}

// Sim every unplayed game in the current round, then build the next one.
export function playRound(ctx) {
  const mm = ctx.state.mm;
  if (mm.champ) return;
  mm.games.forEach((g, i) => { if (g.r === mm.round && !g.s) recordMM(ctx, mmGame(ctx, i).sim2()); });
  buildNext(mm);
}
export function finishTourney(ctx) { while (ctx.state.mm && !ctx.state.mm.champ) playRound(ctx); }

// How far a team went: 'Champion', 'Lost in the Sweet 16', or null if not in the field.
export function tourneyResult(mm, sid) {
  if (!mm || !mm.field.some((f) => f.sid === sid)) return null;
  if (mm.champ === sid) return 'National champion';
  const mine = mm.games.filter((g) => g.a === sid || g.b === sid);
  const last = mine[mine.length - 1];
  if (!last || !last.s) return 'Still alive';
  if (winner(last) === sid) return 'Still alive';
  return `Lost in the ${ROUND_NAMES[last.r]}`;
}

// ---------- NBA draft ----------
export const NBA_TEAMS = ['Atlanta Hawks', 'Boston Celtics', 'Brooklyn Nets', 'Charlotte Hornets', 'Chicago Bulls', 'Cleveland Cavaliers', 'Dallas Mavericks', 'Denver Nuggets', 'Detroit Pistons', 'Golden State Warriors', 'Houston Rockets', 'Indiana Pacers', 'LA Clippers', 'Los Angeles Lakers', 'Memphis Grizzlies', 'Miami Heat', 'Milwaukee Bucks', 'Minnesota Timberwolves', 'New Orleans Pelicans', 'New York Knicks', 'Oklahoma City Thunder', 'Orlando Magic', 'Philadelphia 76ers', 'Phoenix Suns', 'Portland Trail Blazers', 'Sacramento Kings', 'San Antonio Spurs', 'Toronto Raptors', 'Utah Jazz', 'Washington Wizards'];

// NBA teams draft on upside: the player's ceiling first, a youth bonus on top, today's OVR only as a tiebreak.
// A freshman 85 with a 95 ceiling goes ahead of a senior 90 who is maxed out at 91; a freshman whose ceiling
// is well below the senior's does not.
const YOUTH = { FR: 2.5, SO: 1.7, JR: 0.8, SR: 0 };
export const draftValue = (p) => { const now = ovr(p), cap = ovr(p, 'cap'); return cap + (YOUTH[p.cls] || 0) + 0.25 * (now - cap); };
// Big board: every scholarship player in the country ranked by draft value (rank 1 = best prospect).
export function bigBoard(world) {
  const all = [];
  for (const [sid, t] of Object.entries(world.teams)) for (const p of t.roster) if (!p.walkOn) all.push({ p, sid, v: draftValue(p) });
  all.sort((a, b) => b.v - a.v);
  return all;
}

// Who's in: every scholarship senior, plus underclassmen who declared and didn't come back.
export function runDraft(ctx) {
  const st = ctx.state;
  const rng = makeRng(`${st.seed}:nbadraft:${st.year}`);
  const pool = [];
  for (const [sid, t] of Object.entries(ctx.world.teams)) for (const p of t.roster) {
    if (p.walkOn) continue;
    const d = st.draft?.[p.id];
    if (p.cls !== 'SR' && !(d && d.status === 'gone')) continue;
    const boost = st.combine && st.combine.year === st.year ? st.combine.res[p.id]?.boost || 0 : 0; // NBA Combine
    pool.push({ p, sid, v: draftValue(p) + boost + (rng.next() - 0.5) * 3 });
  }
  pool.sort((a, b) => b.v - a.v);
  const order = NBA_TEAMS.slice().sort(() => rng.next() - 0.5);
  st.nba = pool.slice(0, 60).map((x, i) => ({
    pick: i + 1, team: order[i % 30], pid: x.p.id, sid: x.sid,
    name: `${x.p.fn} ${x.p.ln}`, pos: x.p.pos, cls: x.p.cls, ovr: ovr(x.p), pot: x.p.grade, school: ctx.world.teams[x.sid].school.name,
  }));
  return st.nba;
}
