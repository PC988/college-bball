// 32-game regular season: schedule, sim, standings, stats, rankings.
import { makeRng } from './rng.js';
import { simGame } from './engine/game.js';
import { generatePlayer } from './player.js';

export const SEASON_GAMES = 32;

// Round-robin rounds via circle method. Returns array of rounds, each an array of [a, b].
function roundRobin(ids, rng) {
  const t = ids.slice();
  if (t.length % 2) t.push(null);
  const n = t.length, rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = t[i], b = t[n - 1 - i];
      if (a && b) pairs.push(r % 2 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    t.splice(1, 0, t.pop());
  }
  return rng ? rounds : rounds;
}

function confGameTarget(n, level) {
  if (n <= 11) return 2 * (n - 1);
  return level === 'power' ? 20 : 18;
}

// Non-D1 opponents fill holes in the schedule, the way real teams buy "cupcake" games.
function cupcake(rng, idx) {
  const names = ['Bluefield Tech', 'Carver College', 'Lakeside Christian', 'Mount Hollis', 'Prairie State Tech', 'North Ridge', 'St. Anselm Valley', 'Coastal Bible', 'Pine Hill', 'Westbrook'];
  const name = names[idx % names.length];
  const school = { id: 'nond1-' + idx, name, abbr: name.split(' ').map((w) => w[0]).join('').toUpperCase(), prestige: 1, nonD1: true };
  const roster = ['PG', 'SG', 'SG', 'SF', 'SF', 'PF', 'PF', 'C', 'PG', 'SF', 'PF', 'C'].map((pos, i) =>
    generatePlayer(rng, { pos, cls: ['FR', 'SO', 'JR', 'SR'][i % 4], potential: rng.int(25, 45) }));
  return { school, roster, tactics: {} };
}

export function buildSchedule(world, rng) {
  const games = []; // { round, home, away, conf }
  const count = Object.fromEntries(Object.keys(world.teams).map((id) => [id, 0]));
  const byConf = {};
  for (const t of Object.values(world.teams)) (byConf[t.school.conference] ||= []).push(t.school.id);

  // conference: double round robin, take rounds until target
  const confRounds = [];
  for (const conf of world.conferences) {
    const ids = byConf[conf.id] || [];
    const shuffled = ids.slice().sort(() => rng.next() - 0.5);
    const first = roundRobin(shuffled);
    const second = first.map((r) => r.map(([a, b]) => [b, a]));
    const target = confGameTarget(ids.length, conf.level);
    const rounds = [...first, ...second];
    const confCount = Object.fromEntries(ids.map((id) => [id, 0]));
    rounds.forEach((r, ri) => {
      const pairs = r.filter(([a, b]) => confCount[a] < target && confCount[b] < target);
      for (const [h, a] of pairs) { confCount[h]++; confCount[a]++; }
      (confRounds[ri] ||= []).push(...pairs.map(([h, a]) => ({ home: h, away: a, conf: true })));
    });
    for (const id of ids) count[id] += confCount[id];
  }

  // non-conference: random pairings across conferences until everyone hits 32
  const nonConfRounds = [];
  const teams = Object.values(world.teams);
  let fillers = 0;
  world.fillers = world.fillers || {};
  for (let r = 0; r < 40; r++) {
    const need = teams.filter((t) => count[t.school.id] < SEASON_GAMES).map((t) => t.school.id).sort(() => rng.next() - 0.5);
    if (!need.length) break;
    const used = new Set(), round = [];
    for (const id of need) {
      if (used.has(id)) continue;
      const conf = world.teams[id].school.conference;
      const opp = need.find((o) => !used.has(o) && o !== id && world.teams[o].school.conference !== conf);
      used.add(id);
      if (opp) {
        used.add(opp);
        const [a, b] = [world.teams[id].school, world.teams[opp].school];
        const homeFav = a.prestige >= b.prestige ? a : b;
        const home = rng.chance(0.7) ? homeFav : homeFav === a ? b : a;
        round.push({ home: home.id, away: home === a ? b.id : a.id, conf: false });
        count[id]++; count[opp]++;
      } else {
        const f = cupcake(rng, fillers++);
        world.fillers[f.school.id] = f;
        round.push({ home: id, away: f.school.id, conf: false });
        count[id]++;
      }
    }
    nonConfRounds.push(round);
  }
  const rounds = [...nonConfRounds, ...confRounds];
  rounds.forEach((r, ri) => r.forEach((g) => games.push({ ...g, round: ri })));
  return { games, rounds: rounds.length };
}

const team = (world, id) => world.teams[id] || world.fillers[id];

export function newSeasonState(world, seed) {
  const rng = makeRng(`${seed}:schedule:${world.year}`);
  const sched = buildSchedule(world, rng);
  return { year: world.year, ...sched, results: [], playedRounds: 0 };
}

function emptyRecord() { return { W: 0, L: 0, cW: 0, cL: 0, PF: 0, PA: 0 }; }

const LINE_KEYS = ['SEC', 'PTS', 'FGM', 'FGA', 'TPM', 'TPA', 'FTM', 'FTA', 'ORB', 'DRB', 'AST', 'STL', 'BLK', 'TO', 'PF', 'PM'];

// Small, saveable form of a game result: scores + every player's line.
export function compactResult(res) {
  const side = (s) => s.players.map((p) => [p.id, p.starter ? 1 : 0, ...LINE_KEYS.map((k) => p[k])]);
  return { s: [res.home.score, res.away.score, res.periods], h: side(res.home), a: side(res.away) };
}

// Rebuild box-score shaped sides from a compact result.
export function expandResult(world, season, gi, c) {
  const g = season.games[gi];
  return expandCompact(world, g.home, g.away, c);
}
export function expandCompact(world, homeId, awayId, c) {
  const g = { home: homeId, away: awayId };
  const side = (tid, lines, score) => {
    const t = team(world, tid);
    const byId = Object.fromEntries(t.roster.map((p) => [p.id, p]));
    const players = lines.map(([id, st, ...v]) => {
      const p = byId[id];
      const line = Object.fromEntries(LINE_KEYS.map((k, i) => [k, v[i]]));
      return { id, name: p ? `${p.fn} ${p.ln}` : 'Unknown', pos: p?.pos || '', starter: !!st, ...line, MIN: Math.round(line.SEC / 60) };
    });
    const totals = Object.fromEntries(LINE_KEYS.map((k) => [k, players.reduce((s, p) => s + p[k], 0)]));
    totals.PM = 0;
    return { schoolId: tid, name: t.school.name, abbr: t.school.abbr, score, players, totals };
  };
  return { home: side(g.home, c.h, c.s[0]), away: side(g.away, c.a, c.s[1]), periods: c.s[2], events: [] };
}

function addStats(world, season, tid, lines) {
  if (!world.teams[tid]) return;
  for (const [id, , ...v] of lines) {
    const line = Object.fromEntries(LINE_KEYS.map((k, i) => [k, v[i]]));
    const s = (season.playerStats[id] ||= { tid, GP: 0, MIN: 0, PTS: 0, FGM: 0, FGA: 0, TPM: 0, TPA: 0, FTM: 0, FTA: 0, ORB: 0, DRB: 0, AST: 0, STL: 0, BLK: 0, TO: 0, PF: 0 });
    if (line.SEC > 0) s.GP++;
    s.MIN += Math.round(line.SEC / 60);
    for (const k of Object.keys(s)) if (k !== 'tid' && k !== 'GP' && k !== 'MIN' && k in line) s[k] += line[k];
  }
}

export function recordGame(world, season, gi, c) {
  season.playerStats ||= {};
  season.results[gi] = c.s;
  const g = season.games[gi];
  addStats(world, season, g.home, c.h);
  addStats(world, season, g.away, c.a);
}

// Sim through the given round (inclusive). Games already recorded are skipped;
// `fixed` holds compact results to use instead of simming (e.g. the user's own games).
export function simRounds(world, season, throughRound, { keepFor = [], fixed = {} } = {}) {
  const keep = new Set(keepFor);
  season.kept ||= [];
  season.playerStats ||= {};
  for (let ri = season.playedRounds; ri <= Math.min(throughRound, season.rounds - 1); ri++) {
    for (const [gi, g] of season.games.entries()) {
      if (g.round !== ri || season.results[gi]) continue;
      if (fixed[gi]) { recordGame(world, season, gi, fixed[gi]); continue; }
      const res = simGame(team(world, g.home), team(world, g.away), { seed: `${world.seed}:${world.year}:g${gi}` });
      recordGame(world, season, gi, compactResult(res));
      if (keep.has(g.home) || keep.has(g.away)) season.kept.push({ gi, res });
    }
    season.playedRounds = ri + 1;
  }
}

export const teamOf = team;

export function standings(world, season) {
  const rec = {};
  for (const id of Object.keys(world.teams)) rec[id] = emptyRecord();
  season.games.forEach((g, gi) => {
    const r = season.results[gi];
    if (!r) return;
    const [hs, as] = r;
    const hw = hs > as;
    for (const [id, win, pf, pa] of [[g.home, hw, hs, as], [g.away, !hw, as, hs]]) {
      if (!rec[id]) continue;
      const t = rec[id];
      win ? t.W++ : t.L++;
      if (g.conf) win ? t.cW++ : t.cL++;
      t.PF += pf; t.PA += pa;
    }
  });
  return rec;
}

// Simple power rating: margin adjusted for opponent quality, iterated (SRS-style).
export function powerRatings(world, season) {
  const ids = Object.keys(world.teams);
  const games = season.games.map((g, gi) => ({ ...g, r: season.results[gi] })).filter((g) => g.r && world.teams[g.home] && world.teams[g.away]);
  const rating = Object.fromEntries(ids.map((id) => [id, 0]));
  for (let it = 0; it < 30; it++) {
    const sum = Object.fromEntries(ids.map((id) => [id, [0, 0]]));
    for (const g of games) {
      const m = Math.max(-25, Math.min(25, g.r[0] - g.r[1] - 3));
      sum[g.home][0] += m + rating[g.away]; sum[g.home][1]++;
      sum[g.away][0] += -m + rating[g.home]; sum[g.away][1]++;
    }
    for (const id of ids) rating[id] = sum[id][1] ? sum[id][0] / sum[id][1] : 0;
  }
  return rating;
}

export function teamSchedule(world, season, id) {
  return season.games.map((g, gi) => ({ ...g, gi, r: season.results[gi] })).filter((g) => g.home === id || g.away === id).sort((a, b) => a.round - b.round)
    .map((g) => {
      const home = g.home === id;
      const opp = team(world, home ? g.away : g.home).school;
      const out = { round: g.round, gi: g.gi, opp: opp.name, home, conf: g.conf };
      if (g.r) {
        const [hs, as, per] = g.r;
        const us = home ? hs : as, them = home ? as : hs;
        out.result = `${us > them ? 'W' : 'L'} ${us}-${them}${per > 2 ? ' (' + (per === 3 ? 'OT' : per - 2 + 'OT') + ')' : ''}`;
      }
      return out;
    });
}
