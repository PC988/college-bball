// League leaders and end-of-season awards, all from season.playerStats (every D1 game is simmed).
import { ovr } from './player.js';
import { standings } from './season.js';

export const LEADER_CATS = [
  ['PTS', 'Points'], ['REB', 'Rebounds'], ['AST', 'Assists'], ['STL', 'Steals'], ['BLK', 'Blocks'],
  ['TPM', '3-pointers made'], ['FGP', 'FG%'], ['TPP', '3P%'], ['FTP', 'FT%'], ['MIN', 'Minutes'],
];

function index(world) {
  const out = {};
  for (const [sid, t] of Object.entries(world.teams)) for (const p of t.roster) out[p.id] = { p, sid, school: t.school };
  return out;
}

// One row per player with totals and per-game numbers.
export function statRows(world, season) {
  const idx = index(world);
  const rows = [];
  for (const [pid, s] of Object.entries(season.playerStats || {})) {
    const hit = idx[pid];
    if (!hit || !s.GP) continue;
    const g = s.GP, REB = s.ORB + s.DRB;
    rows.push({
      pid, p: hit.p, sid: hit.sid, school: hit.school, GP: g,
      tot: { PTS: s.PTS, REB, AST: s.AST, STL: s.STL, BLK: s.BLK, TPM: s.TPM, MIN: s.MIN, DRB: s.DRB, FGM: s.FGM, FGA: s.FGA, TPA: s.TPA, FTM: s.FTM, FTA: s.FTA, TO: s.TO },
      pg: { PTS: s.PTS / g, REB: REB / g, AST: s.AST / g, STL: s.STL / g, BLK: s.BLK / g, TPM: s.TPM / g, MIN: s.MIN / g, DRB: s.DRB / g, TO: s.TO / g },
      FGP: s.FGA ? s.FGM / s.FGA : 0, TPP: s.TPA ? s.TPM / s.TPA : 0, FTP: s.FTA ? s.FTM / s.FTA : 0,
    });
  }
  return rows;
}

const maxGP = (rows) => rows.reduce((m, r) => Math.max(m, r.GP), 0);

// Top N for a category. mode 'tot' | 'pg'. Percentages need volume; per-game needs half the games.
export function leaders(rows, cat, mode = 'pg', n = 10) {
  const mg = maxGP(rows);
  let pool = rows;
  if (mode === 'pg') pool = pool.filter((r) => r.GP >= mg * 0.5);
  const val = (r) => (cat === 'FGP' ? r.FGP : cat === 'TPP' ? r.TPP : cat === 'FTP' ? r.FTP : r[mode][cat]);
  if (cat === 'FGP') pool = pool.filter((r) => r.tot.FGA >= Math.max(1, mg) * 4);
  if (cat === 'TPP') pool = pool.filter((r) => r.tot.TPA >= Math.max(1, mg) * 2);
  if (cat === 'FTP') pool = pool.filter((r) => r.tot.FTA >= Math.max(1, mg) * 2);
  return pool.map((r) => ({ r, v: val(r) })).sort((a, b) => b.v - a.v).slice(0, n);
}

// Award scores. prod = all-around production per game; share = his slice of his team's production;
// winShare = share x team wins, so carrying a winning team counts, not just volume scoring.
const prodOf = (pg) => pg.PTS + 0.75 * pg.REB + 1.0 * pg.AST + 1.4 * pg.STL + 1.2 * pg.BLK - 0.6 * pg.TO;
function poyScore(r, ctxT) {
  const prod = prodOf(r.pg);
  const share = ctxT.teamProd[r.sid] ? prod / ctxT.teamProd[r.sid] : 0;
  const winShare = share * ctxT.wins(r.sid);
  return prod + (r.FGP - 0.45) * 25 + winShare * 2.0 + ovr(r.p) * 0.03;
}
function dpoyScore(r, winPct) {
  const pg = r.pg;
  return 3.2 * pg.STL + 3.0 * pg.BLK + 0.6 * pg.DRB + ((r.p.skills.STL.cur + r.p.skills.BLK.cur + r.p.skills.DRE.cur) / 3) * 0.06 + winPct * 3;
}
const line = (r) => `${r.pg.PTS.toFixed(1)} pts, ${r.pg.REB.toFixed(1)} reb, ${r.pg.AST.toFixed(1)} ast`;
const dline = (r) => `${r.pg.STL.toFixed(1)} stl, ${r.pg.BLK.toFixed(1)} blk, ${r.pg.REB.toFixed(1)} reb`;

export const POSITION_AWARDS = { PG: 'Bob Cousy Award', SG: 'Jerry West Award', SF: 'Julius Erving Award', PF: 'Karl Malone Award', C: 'Kareem Abdul-Jabbar Award' };

// Returns a plain, save-friendly list of { award, group, pid, name, pos, cls, sid, school, line }.
export function computeAwards(world, season) {
  const rows = statRows(world, season);
  const mg = maxGP(rows);
  const pool = rows.filter((r) => r.GP >= mg * 0.6 && r.pg.MIN >= 15);
  if (!pool.length) return [];
  const rec = standings(world, season);
  const wp = (sid) => { const x = rec[sid]; return x && x.W + x.L ? x.W / (x.W + x.L) : 0.5; };
  const teamProd = {};
  for (const r of rows) teamProd[r.sid] = (teamProd[r.sid] || 0) + prodOf(r.pg) * (r.GP / Math.max(1, mg));
  const ctxT = { teamProd, wins: (sid) => rec[sid]?.W || 0 };
  const poy = pool.map((r) => ({ r, s: poyScore(r, ctxT) })).sort((a, b) => b.s - a.s);
  const entry = (award, group, r, l = line(r)) => ({ award, group, pid: r.pid, name: `${r.p.fn} ${r.p.ln}`, pos: r.p.pos, cls: r.p.cls, sid: r.sid, school: r.school.name, line: l });
  const out = [];
  // winner plus the 2nd and 3rd place finalists (for the ceremony podium)
  const podium = (award, group, ranked, l = line) => ranked.slice(0, 3).forEach((x, i) => out.push({ ...entry(award, i ? 'final' : group, x.r, l(x.r)), place: i + 1 }));
  podium('National Player of the Year', 'major', poy);
  const dpoy = pool.map((r) => ({ r, s: dpoyScore(r, wp(r.sid)) })).sort((a, b) => b.s - a.s);
  podium('Defensive Player of the Year', 'major', dpoy, dline);
  podium('Freshman of the Year', 'major', poy.filter((x) => x.r.p.cls === 'FR'));
  for (const [pos, name] of Object.entries(POSITION_AWARDS)) podium(name, 'position', poy.filter((x) => x.r.p.pos === pos));
  // All-America teams: one PG, SG, SF, PF and C per team, best available at each spot.
  ['First', 'Second', 'Third'].forEach((n, ti) => {
    for (const pos of ['PG', 'SG', 'SF', 'PF', 'C']) {
      const x = poy.filter((y) => y.r.p.pos === pos)[ti];
      if (x) out.push(entry(`All-America ${n} Team`, 'allam', x.r));
    }
  });
  for (const conf of world.conferences) {
    const best = poy.find((x) => x.r.school.conference === conf.id);
    if (best) out.push({ ...entry(`${conf.name} Player of the Year`, 'conf', best.r), conf: conf.name });
  }
  return out;
}
