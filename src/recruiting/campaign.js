// Recruiting campaign: one day per game (32 days), 20 action points per day shared with
// training (training not built yet). Scout travels the map; rivals recruit in parallel.
// Pure logic, no DOM: the browser UI and Node tests both drive it.
import US from '../../data/us-states.json' with { type: 'json' };
import { makeRng } from '../rng.js';
import { createWorld, SCHOOL_DATA } from '../world.js';
import { newSeasonState, simRounds, teamSchedule, standings, compactResult, recordGame, teamOf } from '../season.js';
import { Game } from '../engine/game.js';
import { packPlayer, unpackPlayer } from '../pack.js';
import { DRILLS, TRAIN_COST, trainPlayer, applyTraining } from '../training.js';
import { advanceRoster, openScholarships, MAX_ROSTER } from '../roster.js';
import { ovr, rawOvr, fullName, SKILLS, OVR_SHIFT, useNames } from '../player.js';
import { generateRecruitClass, CLASS_SIZE } from './recruits.js';
import { computeAwards } from '../awards.js';
import * as T from '../tourney.js';
import { runCombine } from '../combine.js';
import { hsStats } from '../hsstats.js';
import { initialKnowledge, applyFilm, applyExact, applyLive, revealTraits, TRAIT_LABELS, describeTrait } from './scouting.js';

export const DAYS = 32;
export const MAX_OFFERS = 10;
export const AP_PER_DAY = 20;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const COSTS = { film: 1, exact: 4, phone: 1, visit: 5, offer: 1, lodging: 0, event: 6 };

export const EVENTS = [
  { id: 'all-american', day: 10, name: "McDonald's All American Game", state: 'TX', top: 20, strength: 1 },
  { id: 'holiday-showcase', day: 20, name: 'Holiday Hoops Showcase', state: 'NV', top: 60, strength: 0.8 },
];
// Star ratings and national rankings come out at the end of this day.
export const SKILL_LABEL = { LAY: 'Layup', DNK: 'Dunk', INS: 'Inside scoring', MID: 'Mid-range', TPT: 'Three-point', FTS: 'Free throw', DRB: 'Ball handling', PAS: 'Passing', ORE: 'Offensive rebound', DRE: 'Defensive rebound', STL: 'Steal', BLK: 'Block' };
export const STAR_RELEASE_DAY = 3;
export const starsKnown = (ctx) => !!ctx.state.over || ctx.state.day > STAR_RELEASE_DAY;
const tag = (ctx, r) => (starsKnown(ctx) ? `#${r.rank} ` : '');

// ---------- geography ----------
export const STATES = US.states;
const toRad = (d) => (d * Math.PI) / 180;
const MILES = new Map();
export function milesBetween(a, b) {
  if (a === b) return 0;
  const key = a < b ? a + b : b + a;
  const hit = MILES.get(key); if (hit !== undefined) return hit;
  const v = milesRaw(a, b); MILES.set(key, v); return v;
}
function milesRaw(a, b) {
  if (a === 'INTL' || b === 'INTL') return 2000; // one long flight, priced like a cross-country trip
  const [lon1, lat1] = STATES[a].lonlat, [lon2, lat2] = STATES[b].lonlat;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(3959 * 2 * Math.asin(Math.sqrt(h)));
}

// ---------- scouts ----------
const SCOUT_FIRST = ['Earl', 'Gus', 'Tammy', 'Ray', 'Dot', 'Lou', 'Marv', 'Bev', 'Hank', 'Rhonda', 'Sal', 'Vic', 'June', 'Otis', 'Pearl'];
const SCOUT_LAST = ['Haskins', 'Pruett', 'Delgado', 'Whitfield', 'Kowalski', 'Burrell', 'Okonkwo', 'Lindqvist', 'Marchetti', 'Coyle', 'Ybarra', 'Fenwick'];
export function generateScouts(seed) {
  const rng = makeRng(`${seed}:scouts`);
  return [0, 1, 2].map((i) => {
    // 220 points spread across 4 stats so every scout has a tradeoff
    const w = [rng.next(), rng.next(), rng.next(), rng.next()].map((x) => x + 0.35);
    const tot = w.reduce((a, b) => a + b, 0);
    const [accuracy, efficiency, charisma, speed] = w.map((x) => clamp(Math.round((x / tot) * 220), 25, 95));
    return { id: i, name: `${rng.pick(SCOUT_FIRST)} ${rng.pick(SCOUT_LAST)}`, accuracy, efficiency, charisma, speed };
  });
}

export function travelCost(scout, from, to) {
  const miles = milesBetween(from, to);
  if (!miles) return 0;
  return Math.max(1, Math.round((miles / 280) * (1.25 - scout.speed / 200)));
}
const effCost = (scout, base) => Math.max(1, Math.round(base * (1.2 - scout.efficiency / 250)));

// ---------- fit: how much a recruit likes a school (uses TRUE hidden traits) ----------
const FIT = new WeakMap();
export function fit(recruit, school) {
  let m = FIT.get(recruit); if (!m) FIT.set(recruit, (m = new Map()));
  let v = m.get(school.id); if (v === undefined) { v = fitRaw(recruit, school); m.set(school.id, v); }
  return v;
}
function fitRaw(recruit, school) {
  const t = recruit.traits;
  let f = 0.55 + (school.prestige / 100) * (0.45 + recruit.stars * 0.12);
  if (t.sizePref !== 'any') f += t.sizePref === school.size ? 0.15 : -0.08;
  f += (t.academicFocus / 100) * ((school.academic - 65) / 100);
  f += (t.partyFocus / 100) * ((school.party - 50) / 120);
  if (t.religious) f += school.religious ? 0.2 : -0.05;
  const miles = milesBetween(recruit.state, school.state);
  f += recruit.state === school.state ? (t.homeLoyalty / 100) * 0.45 : -(t.homeLoyalty / 100) * Math.min(1, miles / 2500) * 0.35;
  f += (t.wantsNIL / 100) * Math.min(1, school.nilBudget / 2000) * 0.35;
  return clamp(f, 0.3, 2.2) * prestigeGate(recruit, school);
}

// How well YOUR school matches one personality trait: 0 = poor fit (red) .. 1 = strong fit (green), plus a short why.
// A trait he barely cares about fits any school. Work ethic is about him, not you, so it has no fit (null).
export function traitFit(ctx, r, key) {
  const t = r.traits, sc = ctx.school;
  const care = (v) => clamp((v / 100 - 0.15) / 0.65, 0, 1); // below ~15 he does not care, ~80+ it is everything
  const blend = (w, m) => clamp(1 - w * (1 - m), 0, 1);
  switch (key) {
    case 'sizePref': return t.sizePref === 'any' ? { v: 0.8, why: 'Any size works' } : { v: t.sizePref === sc.size ? 1 : 0.1, why: `You are a ${sc.size} school` };
    case 'academicFocus': return { v: blend(care(t.academicFocus), clamp((sc.academic - 40) / 50, 0, 1)), why: `Your academics: ${sc.academic}` };
    case 'partyFocus': return { v: blend(care(t.partyFocus), clamp(sc.party / 90, 0, 1)), why: `Your social life: ${sc.party}` };
    case 'religious': return t.religious ? { v: sc.religious ? 1 : 0.05, why: sc.religious ? 'You are a religious school' : 'You are not a religious school' } : { v: 0.85, why: "Doesn't matter to him" };
    case 'homeLoyalty': {
      const same = r.state === sc.state, miles = same ? 0 : milesBetween(r.state, sc.state);
      return { v: blend(care(t.homeLoyalty), same ? 1 : 1 - Math.min(1, miles / 2000)), why: same ? 'Same state as you' : `${Math.round(miles / 10) * 10} miles from you` };
    }
    case 'wantsNIL': return { v: blend(care(t.wantsNIL), Math.min(1, sc.nilBudget / 2000)), why: `Your NIL budget: $${sc.nilBudget >= 1000 ? (sc.nilBudget / 1000).toFixed(1) + 'M' : sc.nilBudget + 'K'}` };
    case 'wantsPlayingTime': {
      const n = ctx.world.teams[ctx.state.schoolId].roster.filter((p) => !p.walkOn && p.cls !== 'SR' && p.pos === r.pos).length;
      return { v: blend(care(t.wantsPlayingTime), n <= 1 ? 1 : n === 2 ? 0.55 : 0.2), why: `You return ${n} ${r.pos}${n === 1 ? '' : 's'}` };
    }
    default: return null;
  }
}

// Recruits far above a school's level barely listen to it.
export function prestigeGate(recruit, school) {
  const c = desiredRank(school.prestige) * 0.2;
  return recruit.rank >= c ? 1 : Math.max(0.12, Math.pow(recruit.rank / c, 0.5));
}

// ---------- campaign ----------
export const DEFAULT_TACTICS = { tempo: 'normal', defense: 'man', focus: 'balanced', depth: 8, rotation: null };

function freshSeasonState(base) {
  return {
    v: 2, seed: base.seed, schoolId: base.schoolId, scout: base.scout, year: base.year, rosters: base.rosters || null,
    tactics: base.tactics || { ...DEFAULT_TACTICS }, history: base.history || [],
    day: 1, ap: AP_PER_DAY, apMax: AP_PER_DAY, lodgingDue: 0, gamePlayed: false,
    scoutAt: null, gameToday: null, burned: [], knowledge: {}, interest: {}, offers: {}, commits: {},
    visits: {}, phonedToday: [], calls: {}, aiTargets: {}, log: [], over: false, userGames: {},
    train: {}, trainedToday: [], teamTrainedToday: false,
    namesFrom: base.namesFrom, // name pool switch (see hydrate); carried across seasons
    careers: base.careers || {}, // pid -> season rows, see recordCareers
    scouted: base.scouted || {}, // pid -> 1 once you've seen his potential (in person); kept across seasons
  };
}

export function createCampaign({ seed = 2026, schoolId, scout }) {
  const state = freshSeasonState({ seed, schoolId, scout, year: 2026 });
  state.namesFrom = 0; // new careers use the big name pool everywhere
  const ctx = hydrate(state);
  state.scoutAt = ctx.school.state;
  setupAI(ctx);
  log(ctx, `Welcome to ${ctx.school.name}. Your scout ${scout.name} is based in ${STATES[ctx.school.state].name}. You have ${ctx.slots} open scholarships.`);
  return ctx;
}

// Rebuild everything derivable from the seed around a saved state.
export function hydrate(state) {
  // Saves made before the big name pool keep every name they already have: their starting world and every recruit
  // class already generated use the old pool. Recruit classes from the season after next (namesFrom) use the new one.
  if (state.namesFrom == null) state.namesFrom = (state.year || 2026) + 2;
  const oldWorld = state.namesFrom !== 0;
  useNames(oldWorld ? 1 : 2);
  const world = createWorld(state.seed);
  useNames(2);
  if (state.year) world.year = state.year;
  if (state.rosters) {
    for (const [id, arr] of Object.entries(state.rosters)) if (world.teams[id]) world.teams[id].roster = arr.map(unpackPlayer);
  }
  state.year = world.year;
  state.tactics ||= { ...DEFAULT_TACTICS };
  state.userGames ||= {};
  state.history ||= [];
  world.teams[state.schoolId].tactics = state.tactics;
  state.train ||= {}; state.trainedToday ||= [];
  applyTraining(world.teams[state.schoolId].roster, state.train);
  const season = newSeasonState(world, state.seed);
  const school = world.teams[state.schoolId].school;
  useNames(state.namesFrom && world.year + 1 < state.namesFrom ? 1 : 2);
  const cls = generateRecruitClass(state.seed, world.year + 1);
  useNames(2); // anything generated from here on (walk-ons, new players) uses the big pool
  const byId = Object.fromEntries(cls.recruits.map((r) => [r.id, r]));
  const schools = Object.fromEntries(SCHOOL_DATA.schools.map((s) => [s.id, s]));
  const slotsFor = (id) => openScholarships(world.teams[id].roster);
  const ctx = { state, world, season, school, recruits: cls.recruits, byId, hsTeams: cls.teams, byState: cls.byState, schools, slotsFor };
  ctx.slots = slotsFor(state.schoolId);
  ctx.schedule = teamSchedule(world, season, state.schoolId);
  // replay games already played (deterministic)
  const played = state.over ? DAYS : state.day - 1;
  if (played > 0) simRounds(world, season, ctx.schedule[played - 1].round, { fixed: state.userGames });
  const today = !state.over && ctx.schedule[state.day - 1];
  if (today && state.userGames[today.gi]) {
    simRounds(world, season, today.round - 1, { fixed: state.userGames });
    recordGame(world, season, today.gi, state.userGames[today.gi]);
  }
  ctx.schedule = teamSchedule(world, season, state.schoolId);
  return ctx;
}

export const serializeCampaign = (ctx) => JSON.stringify(ctx.state);
export const loadCampaign = (json) => hydrate(JSON.parse(json));

function log(ctx, text, kind = 'info') {
  ctx.state.log.unshift({ day: ctx.state.day, text, kind });
  if (ctx.state.log.length > 300) ctx.state.log.length = 300;
}

const rngFor = (ctx, label) => makeRng(`${ctx.state.seed}:${label}:${ctx.state.day}:${ctx.state.log.length}`);

// How much scouting you've put into a recruit (for sorting the Scouted board).
export function scoutDepth(ctx, rid) {
  const k = ctx.state.knowledge[rid];
  if (!k) return null;
  const seen = SKILLS.filter((s) => k.r[s]).length, exact = SKILLS.filter((s) => k.r[s] && k.r[s][0] === k.r[s][1]).length;
  const visits = ctx.state.visits[rid] || 0, calls = (ctx.state.calls || {})[rid] || 0;
  return { seen, exact, live: !!k.pot, at: k.at || null, traits: k.traits.length, visits, calls,
    score: seen + exact * 2 + (k.pot ? 4 : 0) + k.traits.length + visits * 2 + Math.min(calls, 5) };
}
// Have you scouted this (college) player's potential, now or in a past recruiting cycle?
export const potScouted = (ctx, pid) => !!(ctx.state.scouted || {})[pid] || !!ctx.state.knowledge[pid]?.pot;
// Full scouting report on a college player (opponent): 1 AP reveals ceiling, potential and every rating. Kept across seasons.
export const fullScouted = (ctx, pid) => (ctx.state.scouted || {})[pid] === 2;
export const PLAYER_SCOUT_COST = 1;
export function scoutPlayer(ctx, pid, name = 'him') {
  if (fullScouted(ctx, pid)) return fail('You already have a full report on him.');
  const err = spend(ctx, PLAYER_SCOUT_COST); if (err) return fail(err);
  (ctx.state.scouted ||= {})[pid] = 2;
  return okMsg(ctx, `Scouted ${name} (${PLAYER_SCOUT_COST} AP). Ceiling, potential and every rating revealed.`, 'scout');
}
export function knowledgeOf(ctx, rid) {
  const k = ctx.state.knowledge[rid];
  if (k) return k;
  return initialKnowledge(makeRng(`${ctx.state.seed}:k:${rid}`), ctx.byId[rid]);
}
function touchKnowledge(ctx, rid) {
  return (ctx.state.knowledge[rid] ||= initialKnowledge(makeRng(`${ctx.state.seed}:k:${rid}`), ctx.byId[rid]));
}

export const isBurned = (ctx, rid) => (ctx.state.burned || []).includes(rid);
// Interest your staff earns per action (before fit and the 0.8 user factor). In person counts most.
export const INTEREST = { visit: 10, game: 8, event: 4, phone: 3, film: 1, exact: 1, offer: 9 };
const USER_GAIN = 0.8; // your staff is one program among many; rivals never stop
// Elite recruits are hard to move: your actions count for less, and they only commit near 90.
export const hardness = (r) => (r.rank <= 25 ? 0.4 : r.rank <= 50 ? 0.55 : r.rank <= 150 ? 0.8 : 1);
export const commitBar = (r) => (r.rank <= 25 ? 90 : r.rank <= 50 ? 80 : r.rank <= 150 ? 50 : 15);
function addInterest(ctx, rid, schoolId, amount) {
  const r = ctx.byId[rid];
  amount *= hardness(r); // everyone moves an elite kid slowly
  if (schoolId === ctx.state.schoolId) { if (isBurned(ctx, rid)) return; amount *= USER_GAIN * (r.rank <= 25 ? 0.5 : r.rank <= 50 ? 0.8 : 1); } // you get many actions a day; rivals get one steady push
  const m = (ctx.state.interest[rid] ||= {});
  m[schoolId] = Math.min(100, Math.round(((m[schoolId] || 0) + amount) * 10) / 10);
}

function spend(ctx, cost) {
  if (ctx.state.over) return 'The recruiting period is over.';
  if (ctx.state.ap < cost) return `Not enough AP (need ${cost}, have ${ctx.state.ap}).`;
  ctx.state.ap -= cost;
  return null;
}

export function commitsFor(ctx, schoolId) {
  return Object.entries(ctx.state.commits).filter(([, s]) => s === schoolId).map(([rid]) => rid);
}
export const userOffers = (ctx) => Object.entries(ctx.state.offers).filter(([, l]) => l.includes(ctx.state.schoolId)).map(([rid]) => rid);

// ---------- daily high school games ----------
export function gamesToday(ctx, st) {
  // every high school team in the state plays every day; an odd team out faces a non-recruit opponent
  const teams = Object.values(ctx.hsTeams).filter((t) => t.state === st);
  if (!teams.length) return [];
  const rng = makeRng(`${ctx.state.seed}:hsgames:${st}:${ctx.state.day}`);
  const shuffled = teams.slice().sort(() => rng.next() - 0.5);
  const games = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    const a = shuffled[i], b = shuffled[i + 1];
    const players = b ? [...a.players, ...b.players] : [...a.players];
    const starPower = players.reduce((s, id) => s + ctx.byId[id].stars, 0);
    const top = Math.min(...players.map((id) => ctx.byId[id].rank));
    const base = clamp(1 + Math.round(starPower / 3) + (top <= 25 ? 2 : top <= 100 ? 1 : 0), 2, 8);
    games.push({ id: `${st}:${ctx.state.day}:${i / 2}`, state: st, hid: a.id, aid: b ? b.id : null, home: a.name, away: b ? b.name : 'Visiting Prep', players, cost: effCost(ctx.state.scout, base), starPower });
  }
  return games.sort((x, y) => y.starPower - x.starPower);
}
export const gameFor = (ctx, rid) => gamesToday(ctx, ctx.byId[rid].state).find((g) => g.players.includes(rid)) || null;

export function eventToday(ctx) {
  return EVENTS.find((e) => e.day === ctx.state.day) || null;
}
// McDonald's All Americans: the top 20 in the class, shown once rankings are out
export const isMcd = (ctx, r) => starsKnown(ctx) && r.rank <= 20;
export const eventPlayers = (ctx, ev) => ctx.recruits.slice(0, ev.top).map((r) => r.id);

// ---------- user actions (each returns { ok, msg }) ----------
const fail = (msg) => ({ ok: false, msg });
const okMsg = (ctx, msg, kind) => { log(ctx, msg, kind); return { ok: true, msg }; };

export function actionCosts(ctx, rid) {
  const r = rid ? ctx.byId[rid] : null;
  return {
    film: effCost(ctx.state.scout, COSTS.film),
    exact: COSTS.exact,
    phone: COSTS.phone,
    visit: effCost(ctx.state.scout, COSTS.visit),
    offer: COSTS.offer,
    travelTo: (st) => travelCost(ctx.state.scout, ctx.state.scoutAt, st),
    inState: r ? r.state === ctx.state.scoutAt : false,
  };
}

export function travel(ctx, st) {
  if (st === ctx.state.scoutAt) return fail('Scout is already there.');
  const cost = travelCost(ctx.state.scout, ctx.state.scoutAt, st);
  const err = spend(ctx, cost); if (err) return fail(err);
  const from = ctx.state.scoutAt;
  ctx.state.scoutAt = st;
  const name = st === 'INTL' ? 'overseas' : STATES[st].name;
  return okMsg(ctx, `${ctx.state.scout.name} traveled ${milesBetween(from, st).toLocaleString()} miles to ${name} (${cost} AP).`, 'travel');
}

export const filmDone = (ctx, rid) => { const k = ctx.state.knowledge[rid]; return !!k && SKILLS.every((s) => k.r[s]); };
export function watchFilm(ctx, rid) {
  if (filmDone(ctx, rid)) return fail('Film has shown you everything. Use Exact skill or watch him in person.');
  const cost = effCost(ctx.state.scout, COSTS.film);
  const err = spend(ctx, cost); if (err) return fail(err);
  const r = ctx.byId[rid];
  const picks = applyFilm(rngFor(ctx, 'film' + rid), touchKnowledge(ctx, rid), r, ctx.state.scout.accuracy);
  addInterest(ctx, rid, ctx.state.schoolId, INTEREST.film * fit(r, ctx.school));
  const what = picks.length ? `Got a read on ${picks.map((s) => SKILL_LABEL[s]).join(' and ')}.` : 'Nothing new: every skill is already exact.';
  return okMsg(ctx, `Watched game film on ${fullName(r)} (${cost} AP). ${what}`, 'scout');
}

export function scoutExact(ctx, rid, skill) {
  if (!SKILL_LABEL[skill]) return fail('Pick a skill.');
  const k = touchKnowledge(ctx, rid);
  if (k.r[skill] && k.r[skill][0] === k.r[skill][1]) return fail('You already know that one exactly.');
  const err = spend(ctx, COSTS.exact); if (err) return fail(err);
  const r = ctx.byId[rid];
  applyExact(k, r, skill);
  addInterest(ctx, rid, ctx.state.schoolId, INTEREST.exact * fit(r, ctx.school));
  return okMsg(ctx, `Scouted ${fullName(r)}'s ${SKILL_LABEL[skill]} (${COSTS.exact} AP): ${r.skills[skill].cur}/100.`, 'scout');
}

export function attendGame(ctx, gameId) {
  if (ctx.state.gameToday) return fail('Your scout already attended a game today.');
  const g = gamesToday(ctx, ctx.state.scoutAt).find((x) => x.id === gameId);
  if (!g) return fail('That game is not in the state your scout is in today.');
  const err = spend(ctx, g.cost); if (err) return fail(err);
  ctx.state.gameToday = gameId;
  const rng = rngFor(ctx, 'live' + gameId);
  for (const id of g.players) {
    const k = touchKnowledge(ctx, id);
    applyLive(rng, k, ctx.byId[id], ctx.state.scout.accuracy);
    k.at = `${g.away} at ${g.home}, day ${ctx.state.day}`;
    addInterest(ctx, id, ctx.state.schoolId, INTEREST.game * fit(ctx.byId[id], ctx.school));
  }
  return okMsg(ctx, `Scouted ${g.away} at ${g.home} in person (${g.cost} AP). Potential revealed for ${g.players.map((id) => fullName(ctx.byId[id])).join(', ')}.`, 'scout');
}

export function attendEvent(ctx) {
  const ev = eventToday(ctx);
  if (!ev) return fail('No event today.');
  if (ctx.state.gameToday) return fail('Your scout already attended a game today.');
  if (ctx.state.scoutAt !== ev.state) return fail(`The ${ev.name} is in ${STATES[ev.state].name}.`);
  const cost = effCost(ctx.state.scout, COSTS.event);
  const err = spend(ctx, cost); if (err) return fail(err);
  ctx.state.gameToday = ev.id;
  const rng = rngFor(ctx, 'event');
  for (const id of eventPlayers(ctx, ev)) { const k = touchKnowledge(ctx, id); applyLive(rng, k, ctx.byId[id], ctx.state.scout.accuracy, ev.strength); k.at = `${ev.name}, day ${ctx.state.day}`; addInterest(ctx, id, ctx.state.schoolId, INTEREST.event * fit(ctx.byId[id], ctx.school)); }
  return okMsg(ctx, `Scouted the ${ev.name} (${cost} AP). Potential revealed for the top ${ev.top} recruits in the class.`, 'event');
}

// The McDonald's All American Game itself: East vs West, watchable live once your scout is in the gym.
export function mcdGame(ctx) {
  const ev = EVENTS.find((e) => e.id === 'all-american');
  const ids = eventPlayers(ctx, ev);
  const side = (k, name, abbr, color) => ({ school: { id: `mcd-${abbr}`, name, abbr, color }, roster: ids.filter((_, i) => i % 2 === k).map((id) => ctx.byId[id]), tactics: { tempo: 'fast', depth: 10 } });
  const gm = new Game(side(0, 'East All-Americans', 'EAST', '#c62828'), side(1, 'West All-Americans', 'WEST', '#1565c0'), { seed: `${ctx.state.seed}:${ctx.state.year}:mcdgame`, neutral: true });
  gm.userSide = 'home';
  gm.exhibition = true;
  return gm;
}
export function finishMcdGame(ctx, gm) {
  const res = gm.result();
  const all = [...res.home.players.map((p) => ({ ...p, t: 'East' })), ...res.away.players.map((p) => ({ ...p, t: 'West' }))];
  const gs = (l) => l.PTS + 0.4 * l.FGM - 0.7 * l.FGA + 0.5 * (l.ORB + l.DRB) + 0.7 * l.AST + l.STL + 0.7 * l.BLK - l.TO;
  const winT = res.home.score > res.away.score ? 'East' : 'West';
  const mvp = all.filter((p) => p.t === winT).sort((a, b) => gs(b) - gs(a))[0];
  const again = ctx.state.mcd?.year === ctx.state.year;
  ctx.state.mcd = { year: ctx.state.year, s: [res.home.score, res.away.score], mvp: mvp && { pid: mvp.id, line: `${mvp.PTS} pts, ${mvp.ORB + mvp.DRB} reb, ${mvp.AST} ast` } };
  if (!again) log(ctx, `McDonald's All American Game: ${winT} wins ${Math.max(res.home.score, res.away.score)}-${Math.min(res.home.score, res.away.score)}. MVP ${mvp ? fullName(ctx.byId[mvp.id]) + ' (' + ctx.state.mcd.mvp.line + ')' : ''}.`, 'event');
  return res;
}

export function phoneCall(ctx, rid) {
  if (ctx.state.phonedToday.includes(rid)) return fail('Already called this recruit today.');
  if (ctx.state.commits[rid]) return fail('This recruit has committed.');
  const err = spend(ctx, COSTS.phone); if (err) return fail(err);
  ctx.state.phonedToday.push(rid);
  const calls = (ctx.state.calls ||= {});
  calls[rid] = (calls[rid] || 0) + 1;
  const r = ctx.byId[rid];
  const rng = rngFor(ctx, 'phone' + rid);
  const n = rng.chance(ctx.state.scout.charisma / 250) ? 2 : 1;
  const got = revealTraits(rng, touchKnowledge(ctx, rid), n);
  addInterest(ctx, rid, ctx.state.schoolId, (INTEREST.phone * fit(r, ctx.school)) / (1 + (calls[rid] - 1) / 2));
  const what = got.length ? ` Learned: ${got.map((t) => `${TRAIT_LABELS[t]}: ${describeTrait(t, r.traits[t])}`).join('; ')}.` : ' Nothing new learned.';
  return okMsg(ctx, `Phone call with ${fullName(r)} (1 AP).${what}`, 'contact');
}

export function homeVisit(ctx, rid) {
  const r = ctx.byId[rid];
  if (r.state !== ctx.state.scoutAt) return fail(`Your scout must be in ${r.state === 'INTL' ? 'the International region' : STATES[r.state].name} for a home visit.`);
  if (ctx.state.commits[rid]) return fail('This recruit has committed.');
  if ((ctx.state.visitedToday ||= []).includes(rid)) return fail('One home visit per recruit per day. Come back tomorrow.');
  const cost = effCost(ctx.state.scout, COSTS.visit);
  const err = spend(ctx, cost); if (err) return fail(err);
  ctx.state.visits[rid] = (ctx.state.visits[rid] || 0) + 1;
  ctx.state.visitedToday.push(rid);
  const rng = rngFor(ctx, 'visit' + rid);
  const n = 2 + (rng.chance(ctx.state.scout.charisma / 120) ? 1 : 0);
  const got = revealTraits(rng, touchKnowledge(ctx, rid), n);
  const gain = INTEREST.visit * fit(r, ctx.school) * (0.8 + ctx.state.scout.charisma / 250);
  addInterest(ctx, rid, ctx.state.schoolId, gain);
  const what = got.length ? ` Learned: ${got.map((t) => `${TRAIT_LABELS[t]}: ${describeTrait(t, r.traits[t])}`).join('; ')}.` : '';
  return okMsg(ctx, `Home visit with ${fullName(r)} (${cost} AP). Interest up.${what}`, 'contact');
}

export function makeOffer(ctx, rid) {
  const offers = (ctx.state.offers[rid] ||= []);
  if (offers.includes(ctx.state.schoolId)) return fail('Already offered.');
  if (isBurned(ctx, rid)) return fail('He wants nothing to do with you after you pulled his offer.');
  if (ctx.state.commits[rid]) return fail('This recruit has committed.');
  const open = ctx.slots - commitsFor(ctx, ctx.state.schoolId).length;
  if (open <= 0) return fail('No open scholarships left.');
  if (userOffers(ctx).filter((id) => !ctx.state.commits[id]).length >= MAX_OFFERS) return fail(`Offer limit reached (${MAX_OFFERS} outstanding).`);
  const err = spend(ctx, COSTS.offer); if (err) return fail(err);
  offers.push(ctx.state.schoolId);
  addInterest(ctx, rid, ctx.state.schoolId, INTEREST.offer * fit(ctx.byId[rid], ctx.school));
  return okMsg(ctx, `Offered a scholarship to ${fullName(ctx.byId[rid])} (1 AP).`, 'offer');
}

export function pullOffer(ctx, rid) {
  const offers = ctx.state.offers[rid] || [];
  if (!offers.includes(ctx.state.schoolId)) return fail('No offer to pull.');
  ctx.state.offers[rid] = offers.filter((s) => s !== ctx.state.schoolId);
  (ctx.state.burned ||= []).push(rid);
  if (ctx.state.interest[rid]) ctx.state.interest[rid][ctx.state.schoolId] = 0;
  return okMsg(ctx, `Pulled your offer to ${fullName(ctx.byId[rid])}. He will never play for ${ctx.school.name} now.`, 'offer');
}

// ---------- rival AI ----------
export function desiredRank(prestige) { return Math.max(3, CLASS_SIZE * Math.pow(1 - prestige / 100, 2)); }

// AI class shape by tier: how many A / B ceilings a program goes after per class (lifted late in the cycle).
const LETTER = (r) => (r._L ||= ((c) => (c >= 90 ? 'A' : c >= 80 ? 'B' : c >= 70 ? 'C' : 'D'))(ovr(r, 'cap')));
const CAP_LIFT_DAY = 24;
function classCaps(ctx, sid) {
  const s = ctx.schools[sid];
  const rng = makeRng(`${ctx.state.seed}:caps:${sid}:${ctx.state.year}`);
  if (s.tier === 'BB') return { A: 1, B: 5, D: 0 };
  if (s.tier === 'HM') return { A: rng.chance(clamp((s.prestige - 65) / 40, 0.05, 0.6)) ? 1 : 0, B: rng.chance(0.5) ? 2 : 1, D: 0 };
  if (s.tier === 'MM') return { A: 0, B: rng.chance(0.6) ? 2 : 1, D: 0 };
  return { A: 0, B: rng.chance(0.3) ? 1 : 0, D: 0 };
}
function aiWants(ctx, sid, r, caps = classCaps(ctx, sid)) {
  const L = LETTER(r);
  if (L === 'C') return true;
  if (ctx.state.day >= CAP_LIFT_DAY && L !== 'D' && ctx.schools[sid].tier !== 'BB') return true;
  const have = commitsFor(ctx, sid).filter((id) => LETTER(ctx.byId[id]) === L).length;
  return have < (caps[L] ?? 99);
}

// Can this AI program land him? A-ceiling kids only while the program is under its A quota (HM: one).
function canLand(ctx, sid, r) {
  if (sid === ctx.state.schoolId || LETTER(r) !== 'A') return true;
  const s = ctx.schools[sid];
  const haveA = commitsFor(ctx, sid).filter((id) => LETTER(ctx.byId[id]) === 'A').length;
  if (haveA < (s.tier === 'HM' ? 1 : classCaps(ctx, sid).A)) return true;
  // over quota: a blue blood still takes an elite kid who has it clearly on top (one extra at most)
  return s.tier === 'BB' && haveA < classCaps(ctx, sid).A + 1 && leads(ctx, sid, r.id, 1.15);
}

function leads(ctx, sid, rid, margin = 1) {
  const m = ctx.state.interest[rid] || {};
  const mine = m[sid] || 0;
  return mine > 0 && (ctx.state.offers[rid] || []).every((o) => o === sid || (m[o] || 0) * margin <= mine);
}

function pickTargets(ctx, sid, count) {
  const s = ctx.schools[sid];
  const caps = classCaps(ctx, sid);
  const rng = makeRng(`${ctx.state.seed}:targets:${sid}:${ctx.state.day}`);
  const c = desiredRank(s.prestige);
  const lo = Math.max(1, Math.floor(c * 0.35)), hi = Math.ceil(c * 1.8 + 40);
  const taken = new Set(ctx.state.aiTargets[sid] || []);
  void lo;
  let pool = ctx.recruits.filter((r) => r.rank <= hi && !ctx.state.commits[r.id] && !taken.has(r.id) && aiWants(ctx, sid, r, caps));
  if (pool.length < count) pool = ctx.recruits.filter((r) => !ctx.state.commits[r.id] && !taken.has(r.id) && aiWants(ctx, sid, r, caps)).slice(0, count * 3);
  const out = [];
  for (let i = 0; i < count && pool.length; i++) {
    const r = rng.weighted(pool, pool.map((x) => fit(x, s) ** 2 * Math.sqrt(hi / x.rank)));
    pool.splice(pool.indexOf(r), 1);
    out.push(r.id);
  }
  return out;
}

// Every recruit starts with a few favorite programs (fit, prestige, a little luck): a head start you must overcome.
function seedFavorites(ctx) {
  const ids = Object.keys(ctx.world.teams);
  for (const r of ctx.recruits) {
    const rng = makeRng(`${ctx.state.seed}:fav:${r.id}`);
    const scored = ids.map((sid) => [sid, fit(r, ctx.schools[sid]) * (0.6 + rng.next() * 0.8)]).sort((a, b) => b[1] - a[1]).slice(0, 3);
    scored.forEach(([sid, f], i) => addInterest(ctx, r.id, sid, (22 - i * 6) * f));
  }
}

function setupAI(ctx) {
  seedFavorites(ctx);
  for (const sid of Object.keys(ctx.world.teams)) {
    if (sid === ctx.state.schoolId) continue;
    ctx.state.aiTargets[sid] = pickTargets(ctx, sid, ctx.slotsFor(sid) * 4);
  }
}

// How many scholarship offers a program keeps out at once (offers are cheap, effort is not).
const AI_OFFERS = { BB: 18, HM: 16, MM: 15, LM: 14 };
function offerWave(ctx, sid, outCount) {
  const s = ctx.schools[sid];
  const out = outCount[sid] || 0;
  const want = (AI_OFFERS[s.tier] || 10) - out;
  if (want <= 0) return;
  const c = desiredRank(s.prestige);
  const late = ctx.state.day >= 25 ? 2 : 1; // late in the cycle, unfilled programs widen their search
  const lo = Math.max(1, Math.floor(c * 0.04)), hi = Math.ceil((c * 1.6 + 30) * late);
  const caps = classCaps(ctx, sid);
  const rng = makeRng(`${ctx.state.seed}:wave:${sid}:${ctx.state.day}`);
  const pool = ctx.recruits.slice(lo - 1, hi).filter((r) => r.rank >= lo && r.rank <= hi && !ctx.state.commits[r.id] && !(ctx.state.offers[r.id] || []).includes(sid) && LETTER(r) !== 'D' && canLand(ctx, sid, r));
  void caps;
  for (let i = 0; i < Math.min(want, 4) && pool.length; i++) {
    const r = rng.weighted(pool, pool.map((x) => Math.sqrt(fit(x, s) / prestigeGate(x, s)) * Math.pow(hi / x.rank, 0.9)));
    pool.splice(pool.indexOf(r), 1);
    (ctx.state.offers[r.id] ||= []).push(sid);
    addInterest(ctx, r.id, sid, 7 * fit(r, s));
    if ((r.rank <= 25 && starsKnown(ctx)) || ctx.state.offers[r.id].includes(ctx.state.schoolId)) log(ctx, `${s.name} offered ${tag(ctx, r)}${fullName(r)} (${r.pos}, ${r.state}).`, 'rival');
  }
}

// The elite never run short of suitors: a 5-star keeps ~10 live offers from programs that can actually take him,
// the rest of the top 50 keep ~6. Programs that fill up or hit their quota get replaced by the next in line.
function topUpElite(ctx, commitCount) {
  if (ctx.state.day < 2) return;
  const user = ctx.state.schoolId;
  const hasRoom = (sid) => ctx.slotsFor(sid) - (commitCount[sid] || 0) > 0;
  const pool = Object.values(ctx.schools).filter((s) => s.id !== user && (s.tier === 'BB' || s.tier === 'HM' || s.tier === 'MM')).sort((a, b) => b.prestige - a.prestige);
  for (const r of ctx.recruits.slice(0, 50)) {
    if (ctx.state.commits[r.id]) continue;
    const need = r.rank <= 25 ? 10 : 6;
    const offers = (ctx.state.offers[r.id] ||= []);
    const live = offers.filter((sid) => sid !== user && hasRoom(sid) && canLand(ctx, sid, r)).length;
    let add = Math.min(3, need - live);
    for (const s of pool) {
      if (add <= 0) break;
      if (offers.includes(s.id) || !hasRoom(s.id) || !canLand(ctx, s.id, r)) continue;
      if (r.rank <= 25 && s.tier === 'MM') continue;
      offers.push(s.id);
      addInterest(ctx, r.id, s.id, 7 * fit(r, s));
      if (starsKnown(ctx) && (r.rank <= 25 || offers.includes(user))) log(ctx, `${s.name} offered ${tag(ctx, r)}${fullName(r)} (${r.pos}, ${r.state}).`, 'rival');
      add--;
    }
  }
}

function runAI(ctx) {
  const day = ctx.state.day;
  const outCount = {}, commitCount = {};
  for (const sid of Object.values(ctx.state.commits)) commitCount[sid] = (commitCount[sid] || 0) + 1;
  for (const [rid, l] of Object.entries(ctx.state.offers)) if (!ctx.state.commits[rid]) for (const sid of l) outCount[sid] = (outCount[sid] || 0) + 1;
  for (const sid of Object.keys(ctx.state.aiTargets)) if (ctx.slotsFor(sid) - (commitCount[sid] || 0) > 0) offerWave(ctx, sid, outCount);
  topUpElite(ctx, commitCount);
  for (const [sid, targets] of Object.entries(ctx.state.aiTargets)) {
    const s = ctx.schools[sid];
    const slots = ctx.slotsFor(sid);
    const open = slots - commitsFor(ctx, sid).length;
    if (open <= 0) { ctx.state.aiTargets[sid] = []; continue; }
    const caps = classCaps(ctx, sid);
    let live = targets.filter((id) => !ctx.state.commits[id] && aiWants(ctx, sid, ctx.byId[id], caps));
    if (live.length < open * 2) live = live.concat(pickTargets(ctx, sid, open * 3 - live.length));
    ctx.state.aiTargets[sid] = live;
    // hidden budget: prestige-scaled points per day, no travel cost
    const budget = 2 + (s.prestige * s.prestige) / 700;
    const rng = makeRng(`${ctx.state.seed}:ai:${sid}:${day}`);
    const want = (id) => ((ctx.state.interest[id]?.[sid] || 0) + 10) * Math.pow(200 / ctx.byId[id].rank, 0.35) * (canLand(ctx, sid, ctx.byId[id]) ? 1 : 0);
    const focus = live.filter((id) => want(id) > 0).sort((a, b) => want(b) - want(a)).slice(0, open + 2);
    for (const id of focus) {
      const r = ctx.byId[id];
      const offers = (ctx.state.offers[id] ||= []);
      if (!offers.includes(sid) && rng.chance(0.5)) {
        offers.push(sid);
        addInterest(ctx, id, sid, 12 * fit(r, s));
        if ((r.rank <= 25 && starsKnown(ctx)) || offers.includes(ctx.state.schoolId)) log(ctx, `${s.name} offered ${tag(ctx, r)}${fullName(r)} (${r.pos}, ${r.state}).`, 'rival');
      }
      if (r.rank > 50) addInterest(ctx, id, sid, (budget / focus.length) * 1.6 * fit(r, s) * (0.7 + rng.next() * 0.6));
    }
  }
  eliteSuitors(ctx, commitCount);
}

// Top-50 recruits: the five best-fitting programs with a live offer are his serious suitors. Each climbs
// about 4-5 interest a day, so the race peaks around 90 in the second half of the season. You have to outwork them.
function eliteSuitors(ctx, commitCount) {
  const user = ctx.state.schoolId;
  for (const r of ctx.recruits.slice(0, 50)) {
    if (ctx.state.commits[r.id]) continue;
    const m = ctx.state.interest[r.id] || {};
    const suitors = (ctx.state.offers[r.id] || []).filter((sid) => sid !== user && ctx.slotsFor(sid) - (commitCount[sid] || 0) > 0 && canLand(ctx, sid, r))
      .map((sid) => ctx.schools[sid]).sort((a, b) => b.prestige * fit(r, b) - a.prestige * fit(r, a)).slice(0, 5);
    const rng = makeRng(`${ctx.state.seed}:suit:${r.id}:${ctx.state.day}`);
    for (const s of suitors) {
      const pace = (r.rank <= 25 ? 9.5 : 8.5) * clamp(fit(r, s), 0.7, 1.4) * (0.7 + rng.next() * 0.6); // x hardness inside addInterest
      addInterest(ctx, r.id, s.id, pace);
    }
  }
}

export function decisionDay(ctx, r) {
  if (r._dd) return r._dd;
  const u = makeRng(`${ctx.state.seed}:dday:${r.id}`).next();
  return (r._dd = r.rank <= 100 ? 12 + Math.floor(u * 17) : 6 + Math.floor(u * 22));
}
function resolveCommitments(ctx, signingDay) {
  const day = ctx.state.day;
  for (const [rid, offers] of Object.entries(ctx.state.offers)) {
    if (ctx.state.commits[rid] || !offers.length) continue;
    const r = ctx.byId[rid];
    const m = ctx.state.interest[rid] || {};
    // signing day: any program with a spot can take him, quotas or not (no elite kid goes unsigned)
    const open = offers.filter((sid) => ctx.slotsFor(sid) - commitsFor(ctx, sid).length > 0 && (signingDay || canLand(ctx, sid, r)));
    if (!open.length) continue;
    // offered schools get a little passive interest each day
    for (const sid of open) addInterest(ctx, rid, sid, 0.4 * fit(r, ctx.schools[sid]));
    const ranked = open.map((sid) => [sid, m[sid] || 0]).sort((a, b) => b[1] - a[1]);
    const [lead, lv] = ranked[0];
    const sv = ranked[1]?.[1] || 0;
    const rng = makeRng(`${ctx.state.seed}:commit:${rid}:${day}`);
    // Each recruit has a hidden decision day spread through the season (top recruits tend to wait longer).
    // From then on he commits to whoever clearly leads. A runaway leader can get him earlier.
    const dd = decisionDay(ctx, r);
    const ready = (signingDay && lv > 0)
      || (day >= (r.rank <= 50 ? Math.max(10, dd - 4) : 5) && lv >= Math.max(70, commitBar(r) + 5) && lv - sv >= 15 && rng.chance(0.5))
      || (day >= dd && lv >= commitBar(r) && lv - sv >= Math.max(1, 10 - (day - dd) * 2) && rng.chance(0.6));
    if (!ready) continue;
    ctx.state.commits[rid] = lead;
    if (ctx.slotsFor(lead) - commitsFor(ctx, lead).length <= 0) {
      // class full: that school's other offers come off the table
      for (const [orid, list] of Object.entries(ctx.state.offers)) if (orid !== rid && !ctx.state.commits[orid] && list.includes(lead)) ctx.state.offers[orid] = list.filter((x) => x !== lead);
      if (lead === ctx.state.schoolId) log(ctx, 'Your class is full. Remaining offers were pulled.', 'offer');
    }
    // AI class shape: once a program hits its A/B quota, its other offers at that level come off
    if (lead !== ctx.state.schoolId) {
      const caps = classCaps(ctx, lead);
      for (const [orid, list] of Object.entries(ctx.state.offers)) if (!ctx.state.commits[orid] && list.includes(lead) && !aiWants(ctx, lead, ctx.byId[orid], caps) && !canLand(ctx, lead, ctx.byId[orid])) ctx.state.offers[orid] = list.filter((x) => x !== lead);
    }
    const mine = lead === ctx.state.schoolId;
    const lostByUs = !mine && offers.includes(ctx.state.schoolId);
    if (mine) log(ctx, `COMMIT! ${tag(ctx, r)}${fullName(r)} (${starsKnown(ctx) ? `${r.stars}★ ` : ''}${r.pos}) committed to ${ctx.school.name}.`, 'commit');
    else if (lostByUs) log(ctx, `Lost ${tag(ctx, r)}${fullName(r)} to ${ctx.schools[lead].name}.`, 'lost');
    else if (r.rank <= 50 && starsKnown(ctx)) log(ctx, `#${r.rank} ${fullName(r)} committed to ${ctx.schools[lead].name}.`, 'rival');
  }
}

// ---------- end of day: stay or return home, play the game, rivals act ----------
export function endDay(ctx, choice = 'stay') {
  const st = ctx.state;
  if (st.over) return fail('The recruiting period is over.');
  const home = ctx.school.state;
  if (choice === 'home' && st.scoutAt !== home) { st.scoutAt = home; st.lodgingDue = 0; log(ctx, `${st.scout.name} flew home to ${STATES[home].name}.`, 'travel'); }
  else if (st.scoutAt !== home) { st.lodgingDue = 0; log(ctx, `${st.scout.name} stays on the road in ${st.scoutAt === 'INTL' ? 'the International region' : STATES[st.scoutAt].name} (no lodging cost).`, 'travel'); }
  else st.lodgingDue = 0; // staying away from home is free (Preston's rule, 2026-11-25)

  // today's game: play it with your tactics if you haven't, then the rest of the round
  const g = ctx.schedule[st.day - 1];
  if (!st.userGames[g.gi]) finishUserGame(ctx, prepareUserGame(ctx).sim2());
  simRounds(ctx.world, ctx.season, g.round, { fixed: st.userGames });
  ctx.schedule = teamSchedule(ctx.world, ctx.season, st.schoolId);

  runAI(ctx);
  const signing = st.day >= DAYS;
  resolveCommitments(ctx, signing);

  if (signing) {
    st.over = true;
    const rec = standings(ctx.world, ctx.season)[st.schoolId];
    const awards = computeAwards(ctx.world, ctx.season);
    st.history.push({ year: st.year, W: rec.W, L: rec.L, cW: rec.cW, cL: rec.cL, signed: commitsFor(ctx, st.schoolId).length, slots: ctx.slots, awards });
    const poy = awards.find((a) => a.award === 'National Player of the Year');
    if (poy) log(ctx, `Awards are out. National Player of the Year: ${poy.name} (${poy.school}). ${awards.filter((a) => a.sid === st.schoolId && a.group !== 'final').length} honors for ${ctx.school.name}.`, 'event');
    const mine = commitsFor(ctx, st.schoolId);
    const walkOns = Math.max(0, ctx.slots - mine.length);
    declareForDraft(ctx);
    const mineDeclared = Object.values(st.draft).filter((d) => d.tid === st.schoolId).length;
    if (mineDeclared) log(ctx, `${mineDeclared} of your players declared for the draft. Open the offseason to try to keep them.`, 'event');
    log(ctx, `Signing day. You signed ${mine.length} of ${ctx.slots} spots.${walkOns ? ` ${walkOns} spot(s) will be filled by walk-ons.` : ''}`, 'commit');
    const mm = T.startTourney(ctx);
    const me = mm.field.find((f) => f.sid === st.schoolId);
    log(ctx, me ? `Selection Sunday: you're in! ${me.seed} seed${me.region >= 0 ? ` in the ${T.REGIONS[me.region]}` : ' in the First Four'}.` : 'Selection Sunday: your name was not called. March Madness goes on without you.', 'event');
    return { ok: true, msg: 'Season over' };
  }
  st.day++;
  st.gamePlayed = false;
  st.ap = st.apMax; st.lodgingDue = 0;
  st.gameToday = null;
  st.phonedToday = [];
  st.visitedToday = [];
  st.trainedToday = [];
  st.teamTrainedToday = false;
  if (st.day === STAR_RELEASE_DAY + 1) log(ctx, 'Star ratings and national rankings are out. Check the Board.', 'event');
  const ev = eventToday(ctx);
  if (ev) log(ctx, `Today: ${ev.name} in ${STATES[ev.state].name}, featuring the top ${ev.top} recruits.`, 'event');
  return { ok: true, msg: `Day ${st.day}` };
}

// ---------- your games ----------
export const todaysGame = (ctx) => (ctx.state.over ? null : ctx.schedule[ctx.state.day - 1]);

// Build tonight's Game (not yet played). Every other game before this round is simmed first.
export function prepareUserGame(ctx) {
  const g = todaysGame(ctx);
  simRounds(ctx.world, ctx.season, g.round - 1, { fixed: ctx.state.userGames });
  const game = ctx.season.games[g.gi];
  const side = (id) => ({ ...teamOf(ctx.world, id), tactics: id === ctx.state.schoolId ? { ...ctx.state.tactics } : {} });
  const gm = new Game(side(game.home), side(game.away), { seed: `${ctx.world.seed}:${ctx.world.year}:g${g.gi}` });
  gm.userSide = game.home === ctx.state.schoolId ? 'home' : 'away';
  gm.gi = g.gi;
  gm.sim2 = () => { gm.sim(); return gm; };
  return gm;
}

// Record a finished Game as tonight's result (box score kept in the save).
export function finishUserGame(ctx, gm) {
  const res = gm.result();
  const c = compactResult(res);
  ctx.state.userGames[gm.gi] = c;
  recordGame(ctx.world, ctx.season, gm.gi, c);
  ctx.state.gamePlayed = true;
  ctx.lastGame = res;
  ctx.schedule = teamSchedule(ctx.world, ctx.season, ctx.state.schoolId);
  const played = ctx.schedule[ctx.state.day - 1];
  const rec = standings(ctx.world, ctx.season)[ctx.state.schoolId];
  log(ctx, `Game ${ctx.state.day}: ${played.home ? 'vs' : '@'} ${played.opp}: ${played.result}. Record ${rec.W}-${rec.L}.`, played.result.startsWith('W') ? 'win' : 'loss');
  return res;
}

export function setTactics(ctx, patch) {
  Object.assign(ctx.state.tactics, patch);
  ctx.world.teams[ctx.state.schoolId].tactics = ctx.state.tactics;
}

// ---------- training (same AP pool as recruiting) ----------
const trainRec = (st, pid) => (st.train[pid] ||= { xp: {}, up: {} });
export function trainSolo(ctx, pid, drill) {
  const st = ctx.state;
  if (st.over) return fail('The season is over.');
  if (!DRILLS[drill]) return fail('Pick a drill.');
  const p = ctx.world.teams[st.schoolId].roster.find((x) => x.id === pid);
  if (!p) return fail('Player not found.');
  if (st.trainedToday.includes(pid)) return fail(`${fullName(p)} already had a session today.`);
  const err = spend(ctx, TRAIN_COST.solo); if (err) return fail(err);
  st.trainedToday.push(pid);
  const ups = trainPlayer(p, trainRec(st, pid), drill, 'solo');
  return okMsg(ctx, `${fullName(p)}: ${DRILLS[drill].label} session (${TRAIN_COST.solo} AP).${ups.length ? ` Level up: ${ups.map((k) => '+1 ' + k).join(', ')}!` : ''}`, 'train');
}
export function trainTeam(ctx, drill) {
  const st = ctx.state;
  if (st.over) return fail('The season is over.');
  if (!DRILLS[drill]) return fail('Pick a drill.');
  if (st.teamTrainedToday) return fail('The team already practiced today.');
  const err = spend(ctx, TRAIN_COST.team); if (err) return fail(err);
  st.teamTrainedToday = true;
  let ups = 0;
  for (const p of ctx.world.teams[st.schoolId].roster) ups += trainPlayer(p, trainRec(st, p.id), drill, 'team').length;
  return okMsg(ctx, `Team practice: ${DRILLS[drill].label} (${TRAIN_COST.team} AP).${ups ? ` ${ups} level-up${ups > 1 ? 's' : ''}!` : ''}`, 'train');
}

// ---------- draft: underclassmen with big OVR may declare at season's end ----------
export const DRAFT_OVR = 90; // displayed OVR
function declareForDraft(ctx) {
  // underclassmen look at where they'd go: a projected lottery pick almost always leaves, a fringe second-rounder rarely does
  const st = ctx.state;
  st.draft = {};
  // Underclassmen declare only when they project as real picks. Young guys with upside who project late stay in school.
  let rank = 0;
  for (const { p, sid } of T.bigBoard(ctx.world)) {
    rank++;
    if (p.cls === 'SR') continue;
    if (rank > 50) break;
    const rng = makeRng(`${st.seed}:draft:${st.year}:${p.id}`);
    const tbl = rank <= 20 ? { FR: 0.8, SO: 0.85, JR: 0.9 } : rank <= 35 ? { FR: 0.15, SO: 0.4, JR: 0.55 } : { FR: 0, SO: 0.08, JR: 0.25 };
    if (!rng.chance(tbl[p.cls] || 0)) continue;
    st.draft[p.id] = { tid: sid, proj: rank, status: sid === st.schoolId ? 'declared' : rng.chance(0.2) ? 'stay' : 'gone' };
  }
}
export function draftFor(ctx) {
  if (ctx.state.over && !ctx.state.draft) declareForDraft(ctx);
  const team = ctx.world.teams[ctx.state.schoolId];
  return Object.entries(ctx.state.draft || {}).filter(([, d]) => d.tid === ctx.state.schoolId)
    .map(([pid, d]) => ({ ...d, pid, p: team.roster.find((x) => x.id === pid) })).filter((x) => x.p);
}
export function convinceToStay(ctx, pid) {
  const d = ctx.state.draft?.[pid];
  if (!d || d.tid !== ctx.state.schoolId) return fail('He has not declared.');
  if (d.status !== 'declared') return fail('His decision is already made.');
  const p = ctx.world.teams[ctx.state.schoolId].roster.find((x) => x.id === pid);
  const o = ovr(p);
  const t = p.traits || {};
  const chance = stayChance(ctx, pid);
  const stays = makeRng(`${ctx.state.seed}:stay:${ctx.state.year}:${pid}`).chance(chance);
  d.status = stays ? 'stay' : 'gone';
  return okMsg(ctx, stays ? `${fullName(p)} is coming back for another year!` : `${fullName(p)} is staying in the draft. He's gone.`, stays ? 'commit' : 'lost');
}
export function letGo(ctx, pid) {
  const d = ctx.state.draft?.[pid];
  if (!d || d.status !== 'declared') return fail('Nothing to decide.');
  d.status = 'gone';
  return { ok: true, msg: 'Wished him luck in the draft.' };
}

// ---------- March Madness ----------
export const userMMGame = (ctx) => T.userMMGame(ctx);
export const prepareMMGame = (ctx) => T.mmGame(ctx, T.userMMGame(ctx));
export function finishMMGame(ctx, gm) {
  const res = T.recordMM(ctx, gm);
  ctx.lastGame = res;
  const g = ctx.state.mm.games[gm.mmIdx];
  const won = T.gameWinner(g) === ctx.state.schoolId;
  const opp = ctx.world.teams[g.a === ctx.state.schoolId ? g.b : g.a].school.name;
  const my = g.a === ctx.state.schoolId ? g.s[0] : g.s[1], their = g.a === ctx.state.schoolId ? g.s[1] : g.s[0];
  log(ctx, `${T.ROUND_NAMES[g.r]}: ${won ? 'beat' : 'lost to'} ${opp} ${my}-${their}.`, won ? 'win' : 'loss');
  return res;
}
// Sim the rest of the current round (your game too, if you haven't played it).
export function simMMRound(ctx) {
  const mm = ctx.state.mm;
  if (!mm || mm.champ) return fail('The tournament is over.');
  const ui = T.userMMGame(ctx);
  if (ui != null && !mm.games[ui].s) finishMMGame(ctx, T.mmGame(ctx, ui).sim2());
  const r = mm.round;
  T.playRound(ctx);
  if (mm.champ) {
    const name = ctx.world.teams[mm.champ].school.name;
    const h = ctx.state.history.at(-1);
    if (h) { h.mm = T.tourneyResult(mm, ctx.state.schoolId); h.champ = name; Object.assign(h, T.seasonRecord(ctx)); h.mmAw = T.mmAwards(ctx); }
    log(ctx, `${name} are national champions!${mm.champ === ctx.state.schoolId ? ' That is YOUR program. Cut down the nets.' : ''}`, 'event');
  }
  return { ok: true, msg: mm.champ ? 'Tournament over' : `${T.ROUND_NAMES[r]} done` };
}
// History rows, with the finished season filled in for saves made before the History page recorded it.
export function leagueHistory(ctx) {
  const st = ctx.state, h = st.history.at(-1);
  if (h && st.mm?.champ && h.year === st.year && !h.ff) { Object.assign(h, T.seasonRecord(ctx)); h.mmAw = T.mmAwards(ctx); }
  return st.history;
}
export function simMMAll(ctx) { while (ctx.state.mm && !ctx.state.mm.champ) simMMRound(ctx); return { ok: true, msg: 'Tournament over' }; }

// ---------- NBA draft ----------
export function stayChance(ctx, pid) {
  const p = ctx.world.teams[ctx.state.schoolId].roster.find((x) => x.id === pid);
  if (!p) return 0;
  const t = p.traits || {};
  const proj = ctx.state.draft?.[pid]?.proj ?? 30;
  // projected #1 pick: ~5%; projected late second-rounder: ~55%
  return clamp(0.05 + 0.5 * (proj - 1) / 59 + ((t.homeLoyalty ?? 50) - 50) / 250 - ((t.wantsNIL ?? 50) - 50) / 300 + ctx.school.prestige / 600, 0.05, 0.6);
}
// NBA Combine: after the title game, before decision day.
export const combineDone = (ctx) => ctx.state.combine?.year === ctx.state.year;
export function nbaCombine(ctx) {
  const st = ctx.state;
  if (!st.mm?.champ) return fail('Finish March Madness first.');
  if (combineDone(ctx)) return { ok: true, msg: 'The combine is done' };
  draftFor(ctx);
  runCombine(ctx);
  const mine = Object.values(st.combine.res).filter((r) => r.sid === st.schoolId).length;
  log(ctx, `NBA Combine: ${Object.keys(st.combine.res).length} prospects tested. ${mine} of your players were invited.`, 'event');
  return { ok: true, msg: 'NBA Combine results are in' };
}
export function startDraft(ctx) {
  const st = ctx.state;
  if (!st.mm?.champ) return fail('Finish March Madness first.');
  if (draftFor(ctx).some((d) => d.status === 'declared')) return fail('Decide on every declared player first.');
  if (!st.nba) {
    if (!combineDone(ctx)) { draftFor(ctx); runCombine(ctx); }
    T.runDraft(ctx);
    // early entrants: picked = gone to the NBA; not picked = back with his college team
    const picked = new Set(st.nba.map((x) => x.pid));
    for (const [pid, d] of Object.entries(st.draft || {})) if (d.status === 'gone') d.status = picked.has(pid) ? 'drafted' : 'back';
    for (const x of st.nba) if (st.draft?.[x.pid]) st.draft[x.pid].pick = x.pick;
    const mine = st.nba.filter((x) => x.sid === st.schoolId);
    const h = st.history.at(-1);
    if (h) h.nba = mine.map((x) => `#${x.pick} ${x.name} (${x.team})`);
    log(ctx, `NBA Draft: ${st.nba[0].name} (${st.nba[0].school}) goes #1 to the ${st.nba[0].team}. ${mine.length} of your players were drafted.`, 'event');
  }
  return { ok: true, msg: 'The draft is on' };
}

// What next year's roster looks like before you start it: returning players, signees, needed cuts.
export function offseasonPreview(ctx, cuts = []) {
  const roster = ctx.world.teams[ctx.state.schoolId].roster;
  const draft = Object.fromEntries(draftFor(ctx).map((d) => [d.pid, d.status]));
  const seniors = roster.filter((p) => p.cls === 'SR');
  const drafted = roster.filter((p) => draft[p.id] === 'gone' || draft[p.id] === 'drafted');
  const pending = roster.filter((p) => draft[p.id] === 'declared');
  const returning = roster.filter((p) => p.cls !== 'SR' && draft[p.id] !== 'gone' && draft[p.id] !== 'drafted' && !cuts.includes(p.id));
  const signees = commitsFor(ctx, ctx.state.schoolId).map((id) => ctx.byId[id]);
  const total = returning.length + signees.length;
  return { seniors, drafted, pending, returning, signees, total, needCut: Math.max(0, total - MAX_ROSTER), walkOns: roster.filter((p) => p.walkOn && p.cls !== 'SR') };
}

// ---------- offseason: graduation, draft, cuts, signees join, walk-ons, next season ----------
// ---------- career stats ----------
// state.careers[pid] = rows, oldest first. College row: [year, GP, MIN, PTS, REB, AST, STL, BLK, FGM, FGA, TPM, TPA, FTM, FTA, mine]
// (season totals, ints; mine = 1 if he played it for you). HS row: ['HS', GP, PPG*10, RPG*10, APG*10, SPG*10, BPG*10, FG%, 3P% or -1, FT%].
// Written at the end of each season. Players who leave college are dropped unless they played for you, to keep the save small.
export const CAREER_HS = 'HS';
function hsRow(ctx, r) {
  const mates = (ctx.hsTeams[r.hsTeam]?.players || []).filter((id) => id !== r.id).map((id) => ctx.byId[id]).filter(Boolean);
  const h = hsStats(r, mates, 32);
  const t = (v) => Math.round(v * 10);
  return [CAREER_HS, h.gp, t(h.ppg), t(h.rpg), t(h.apg), t(h.spg), t(h.bpg), Math.round(h.fg * 100), h.tp == null ? -1 : Math.round(h.tp * 100), Math.round(h.ft * 100)];
}
function recordCareers(ctx) {
  const st = ctx.state;
  st.careers ||= {};
  const ps = ctx.season.playerStats || {};
  for (const [sid, t] of Object.entries(ctx.world.teams)) for (const p of t.roster) {
    const s = ps[p.id];
    if (!s || !s.GP) continue;
    const rows = (st.careers[p.id] ||= []);
    if (rows.some((r) => r[0] === st.year)) continue;
    rows.push([st.year, s.GP, Math.round(s.MIN), s.PTS, s.ORB + s.DRB, s.AST, s.STL, s.BLK, s.FGM, s.FGA, s.TPM, s.TPA, s.FTM, s.FTA, sid === st.schoolId ? 1 : 0]);
  }
  // incoming freshmen bring their HS senior year
  for (const sid of Object.keys(ctx.world.teams)) for (const rid of commitsFor(ctx, sid)) {
    const r = ctx.byId[rid];
    if (r && !st.careers[rid]) st.careers[rid] = [hsRow(ctx, r)];
  }
}
function pruneCareers(ctx) {
  const st = ctx.state;
  const live = new Set();
  for (const t of Object.values(ctx.world.teams)) for (const p of t.roster) live.add(p.id);
  for (const [pid, rows] of Object.entries(st.careers || {})) if (!live.has(pid) && !rows.some((r) => r[14] === 1)) delete st.careers[pid];
}
// His rows plus the season in progress, for the player card.
export function careerFor(ctx, pid) {
  const rows = (ctx.state.careers?.[pid] || []).slice();
  const s = (ctx.season.playerStats || {})[pid];
  if (s && s.GP && !rows.some((r) => r[0] === ctx.state.year)) {
    const sid = Object.keys(ctx.world.teams).find((k) => ctx.world.teams[k].roster.some((p) => p.id === pid));
    rows.push([ctx.state.year, s.GP, Math.round(s.MIN), s.PTS, s.ORB + s.DRB, s.AST, s.STL, s.BLK, s.FGM, s.FGA, s.TPM, s.TPA, s.FTM, s.FTA, sid === ctx.state.schoolId ? 1 : 0, 'live']);
  }
  return rows;
}

export function advanceSeason(ctx, { cuts = [] } = {}) {
  const st = ctx.state;
  if (!st.over) return { ok: false, msg: 'Finish the season first.' };
  draftFor(ctx);
  if (st.mm && !st.mm.champ) simMMAll(ctx);
  if (st.mm && !st.nba) { for (const d of Object.values(st.draft || {})) if (d.status === 'declared') d.status = 'gone'; startDraft(ctx); }
  recordCareers(ctx);
  const rng = makeRng(`${st.seed}:offseason:${st.year}`);
  let userLog = null;
  const LEAVES = new Set(['gone', 'drafted', 'declared']);
  const leaving = new Set(Object.entries(st.draft || {}).filter(([, d]) => LEAVES.has(d.status)).map(([pid]) => pid));
  const userTeam = ctx.world.teams[st.schoolId];
  const cutIds = new Set(cuts.filter((id) => userTeam.roster.find((p) => p.id === id)?.walkOn));
  const draftedUser = userTeam.roster.filter((p) => leaving.has(p.id));
  const cutUser = userTeam.roster.filter((p) => cutIds.has(p.id));
  for (const [sid, t] of Object.entries(ctx.world.teams)) {
    t.roster = t.roster.filter((p) => !leaving.has(p.id) && !cutIds.has(p.id));
    const incoming = commitsFor(ctx, sid).map((rid) => {
      const r = ctx.byId[rid];
      const p = { ...r, cls: 'FR', age: 18, walkOn: false };
      p.mcd = r.rank <= 20; // McDonald's All American, carried into college
      for (const k of ['state', 'hsTeam', 'stars', 'rank', 'score']) delete p[k];
      return p;
    });
    const log_ = advanceRoster(t, rng, incoming);
    if (sid === st.schoolId) userLog = { ...log_, drafted: draftedUser, cutByYou: cutUser };
  }
  pruneCareers(ctx);
  const rosters = Object.fromEntries(Object.entries(ctx.world.teams).map(([id, t]) => [id, t.roster.map(packPlayer)]));
  const ids = new Set(ctx.world.teams[st.schoolId].roster.map((p) => p.id));
  const rotation = (st.tactics.rotation || []).filter((id) => ids.has(id));
  const scouted = { ...(st.scouted || {}) };
  for (const [rid, k] of Object.entries(st.knowledge || {})) if (k.pot) scouted[rid] ||= 1;
  const next = freshSeasonState({ ...st, scouted, year: st.year + 1, rosters, tactics: { ...st.tactics, rotation: rotation.length ? rotation : null, minutes: null } });
  const nctx = hydrate(next);
  next.scoutAt = nctx.school.state;
  setupAI(nctx);
  log(nctx, `Season ${next.year}-${String(next.year + 1).slice(2)} begins. ${userLog.graduated.length} seniors graduated, ${userLog.drafted.length} left for the draft, ${userLog.signed.length} freshmen joined, ${userLog.walkOns.length} walk-on(s) added. You have ${nctx.slots} open scholarships for next year.`, 'event');
  return { ok: true, ctx: nctx, summary: userLog };
}

// ---------- view helpers for the UI ----------
export function recruitView(ctx, rid) {
  const r = ctx.byId[rid];
  const k = knowledgeOf(ctx, rid);
  const m = ctx.state.interest[rid] || {};
  const offers = ctx.state.offers[rid] || [];
  const schools = offers.map((sid) => ({ sid, name: ctx.schools[sid].name, v: m[sid] || 0, mine: sid === ctx.state.schoolId }))
    .sort((a, b) => b.v - a.v);
  return {
    r, k, offers, schools,
    myInterest: Math.round(m[ctx.state.schoolId] || 0),
    committed: ctx.state.commits[rid] ? ctx.schools[ctx.state.commits[rid]].name : null,
    committedMine: ctx.state.commits[rid] === ctx.state.schoolId,
    traits: k.traits.map((t) => ({ key: t, label: TRAIT_LABELS[t], value: describeTrait(t, r.traits[t]) })),
  };
}

export { ovr };
