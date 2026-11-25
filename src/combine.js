// NBA Combine: after March Madness, before decision day. Measurements, athletic tests, shooting drills and
// scrimmages for the top 60 prospects in the draft pool. Results move draft stock (see boost) and are saved
// compactly in state.combine until the offseason.
import { makeRng } from './rng.js';
import { Game } from './engine/game.js';
import { ovr } from './player.js';
import { draftValue, bigBoard } from './tourney.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const COMBINE_INVITES = 60;
export const SKIP_SCRIM = 10; // projected lottery picks sit out the scrimmages
const BOOST = 0.6; // draft value points per standard deviation of combine score (avg move ~5 spots, more in the packed 2nd round)

// Who's in the draft pool right now: scholarship seniors plus underclassmen who declared.
export function draftPool(ctx) {
  const st = ctx.state, out = [];
  for (const [sid, t] of Object.entries(ctx.world.teams)) for (const p of t.roster) {
    if (p.walkOn) continue;
    const d = st.draft?.[p.id];
    if (p.cls === 'SR' || (d && (d.status === 'gone' || d.status === 'declared'))) out.push({ p, sid });
  }
  return out;
}

function tests(p, rng) {
  const s = (k) => p.skills[k].cur, ph = (k) => p.phys[k].cur;
  const N = () => rng.normal();
  const ht = p.ht - 0.5 - Math.round(rng.next() * 2) / 4; // barefoot, to the quarter inch
  const wing = Math.round((p.ht + 2.5 + N() * 2.2 + (s('BLK') - 60) * 0.03) * 4) / 4;
  const reach = Math.round((p.ht * 1.31 + (wing - p.ht) * 0.45 + N() * 0.6) * 2) / 2;
  const wt = Math.round(p.wt + N() * 3);
  const vert = Math.round(clamp(29 + (ph('SPD') - 50) * 0.16 + (s('DNK') - 50) * 0.1 - (p.ht - 78) * 0.15 + N() * 2.2, 24, 45) * 2) / 2;
  const lane = Math.round(clamp(11.6 - (ph('SPD') - 50) * 0.022 + (p.ht - 78) * 0.035 + N() * 0.2, 10.3, 13) * 100) / 100;
  const sprint = Math.round(clamp(3.32 - (ph('SPD') - 50) * 0.0055 + (p.ht - 78) * 0.007 + N() * 0.045, 3.0, 3.7) * 100) / 100;
  const bench = Math.max(0, Math.round(4 + (ph('STR') - 40) * 0.22 + N() * 2.5));
  const make = (n, pr) => { let m = 0; for (let i = 0; i < n; i++) if (rng.next() < pr) m++; return m; };
  const three = make(25, clamp(0.3 + (s('TPT') - 50) * 0.009, 0.12, 0.82));
  const drib = make(15, clamp(0.24 + (s('MID') - 50) * 0.008 + (s('DRB') - 50) * 0.003, 0.1, 0.8));
  return { ht, wing, reach, wt, vert, lane, sprint, bench, three, drib };
}

// Scrimmages: invitees ranked SKIP_SCRIM+1 and down, snake-drafted into 6-man teams.
function scrimmages(ctx, invited) {
  const st = ctx.state;
  const pool = invited.slice(SKIP_SCRIM);
  const nTeams = Math.floor(pool.length / 6) - (Math.floor(pool.length / 6) % 2);
  const teams = Array.from({ length: nTeams }, () => []);
  pool.slice(0, nTeams * 6).forEach((x, i) => { const r = Math.floor(i / nTeams), k = i % nTeams; teams[r % 2 ? nTeams - 1 - k : k].push(x); });
  const lines = {}, games = [];
  for (let g = 0; g < nTeams; g += 2) {
    const side = (k) => ({ school: { id: `cmb${k}`, name: `Combine Team ${k + 1}`, abbr: `T${k + 1}`, color: '#334' }, roster: teams[k].map((x) => x.p), tactics: { depth: 7 } });
    const gm = new Game(side(g), side(g + 1), { seed: `${st.seed}:combine:${st.year}:${g}`, neutral: true });
    const res = gm.sim();
    games.push({ a: g + 1, b: g + 2, s: [res.home.score, res.away.score] });
    for (const pl of [...res.home.players, ...res.away.players]) lines[pl.id] = { team: res.home.players.includes(pl) ? g + 1 : g + 2, MIN: Math.round(pl.MIN || 0), PTS: pl.PTS, REB: (pl.ORB || 0) + (pl.DRB || 0), AST: pl.AST, STL: pl.STL, BLK: pl.BLK, FGM: pl.FGM, FGA: pl.FGA, TO: pl.TO };
  }
  return { lines, games };
}

export function runCombine(ctx) {
  const st = ctx.state;
  const rng = makeRng(`${st.seed}:combine:${st.year}`);
  const invited = draftPool(ctx).map((x) => ({ ...x, v: draftValue(x.p) })).sort((a, b) => b.v - a.v).slice(0, COMBINE_INVITES);
  const res = {};
  for (const x of invited) res[x.p.id] = { sid: x.sid, ...tests(x.p, rng) };
  const { lines, games } = scrimmages(ctx, invited);
  for (const [pid, l] of Object.entries(lines)) if (res[pid]) res[pid].scrim = l;
  // combine score: athleticism and length, shooting, and scrimmage play, each as a z-score across the field
  const ids = Object.keys(res);
  const z = (f) => { const v = ids.map((id) => f(res[id])); const m = v.reduce((a, b) => a + b, 0) / v.length; const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 1; return Object.fromEntries(ids.map((id, i) => [id, (v[i] - m) / sd])); };
  const zVert = z((r) => r.vert), zLane = z((r) => -r.lane), zSpr = z((r) => -r.sprint), zWing = z((r) => r.wing - r.ht), zBench = z((r) => r.bench);
  const zShot = z((r) => r.three / 25 + r.drib / 15);
  const scr = ids.filter((id) => res[id].scrim);
  const gs = (l) => l.PTS + 0.4 * l.FGM - 0.7 * l.FGA + 0.5 * l.REB + 0.7 * l.AST + l.STL + 0.7 * l.BLK - l.TO;
  const zScr = (() => { const v = scr.map((id) => gs(res[id].scrim)); const m = v.reduce((a, b) => a + b, 0) / (v.length || 1); const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length || 1)) || 1; return Object.fromEntries(scr.map((id, i) => [id, (v[i] - m) / sd])); })();
  for (const id of ids) {
    const ath = (zVert[id] + zLane[id] + zSpr[id] + 0.6 * zWing[id] + 0.4 * zBench[id]) / 3;
    const score = 0.45 * ath + 0.3 * zShot[id] + 0.25 * (zScr[id] ?? 0);
    res[id].score = Math.round(score * 100) / 100;
    res[id].boost = Math.round(clamp(score * BOOST, -1.2, 1.2) * 100) / 100;
  }
  // before/after rank on the draft board, for risers and fallers
  const before = invited.map((x) => x.p.id);
  const after = invited.slice().sort((a, b) => (b.v + res[b.p.id].boost) - (a.v + res[a.p.id].boost)).map((x) => x.p.id);
  before.forEach((id, i) => { res[id].pre = i + 1; });
  after.forEach((id, i) => { res[id].post = i + 1; });
  // declared underclassmen re-project off the new board
  if (st.draft) {
    const board = bigBoard(ctx.world).map((x) => ({ id: x.p.id, v: x.v + (res[x.p.id]?.boost || 0) })).sort((a, b) => b.v - a.v);
    board.forEach((x, i) => { if (st.draft[x.id]) st.draft[x.id].proj = i + 1; });
  }
  st.combine = { year: st.year, res, games };
  return st.combine;
}
export const combineBoost = (st, pid) => (st.combine && st.combine.year === st.year ? st.combine.res[pid]?.boost || 0 : 0);
