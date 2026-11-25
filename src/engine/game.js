// Possession-based game engine. Instant sim and the watchable simcast use the
// same Game object: sim calls step() until done; simcast calls step() and
// renders the events each possession emits, and can change tactics between steps.
import { makeRng } from '../rng.js';
import { ovr, fullName, OVR_SHIFT } from '../player.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const HALF = 1200;
const OT = 300;

export const DEFAULT_TACTICS = {
  tempo: 'normal', // slow | normal | fast
  defense: 'man', // man | zone | press
  focus: 'balanced', // inside | balanced | perimeter
  depth: 8, // rotation size 7-10
  rotation: null, // optional array of player ids, starters first
  shotTend: null, // optional { playerId: -5..5 } shot tendency set by the coach
  minutes: null, // optional { playerId: minutes } set by the coach; soft targets, scaled to 200
};

export const TARGET_MIN = {
  7: [34, 33, 32, 31, 30, 22, 18],
  8: [32, 31, 30, 29, 28, 20, 16, 14],
  9: [30, 29, 28, 27, 26, 18, 16, 14, 12],
  10: [28, 27, 26, 25, 24, 18, 16, 14, 12, 10],
};

const POS_IDX = { PG: 0, SG: 1, SF: 2, PF: 3, C: 4 };
export const TEND_K = 0.32;
const isGuard = (p) => p.pos === 'PG' || p.pos === 'SG';
const isBig = (p) => p.pos === 'PF' || p.pos === 'C';

function derive(p) {
  const s = (k) => p.skills[k].cur + OVR_SHIFT; // engine was calibrated on the old, 8-higher scale
  const ph = (k) => p.phys[k].cur;
  const hs = clamp((p.ht - 72) * 6.5, 0, 99); // height score
  const rim = 0.6 * s('LAY') + 0.4 * Math.max(s('DNK'), s('LAY') * 0.8);
  const post = 0.75 * s('INS') + 0.25 * ph('STR');
  const off = 0.35 * Math.max(rim, post) + 0.35 * Math.max(s('TPT'), s('MID')) + 0.15 * s('DRB') + 0.15 * s('FTS');
  return {
    rim, post, mid: s('MID'), three: s('TPT'), ft: s('FTS'),
    handle: s('DRB'), pass: s('PAS'),
    perD: 0.55 * s('STL') + 0.45 * ph('SPD'),
    intD: 0.5 * s('BLK') + 0.25 * ph('STR') + 0.25 * hs,
    stl: s('STL'), blk: s('BLK'),
    orb: s('ORE') * (1 + (p.ht - 78) * 0.035),
    drb: s('DRE') * (1 + (p.ht - 78) * 0.035),
    dunk: s('DNK'), hs, off, stm: ph('STM'),
  };
}

function blankLine() {
  return { SEC: 0, PTS: 0, FGM: 0, FGA: 0, TPM: 0, TPA: 0, FTM: 0, FTA: 0, ORB: 0, DRB: 0, AST: 0, STL: 0, BLK: 0, TO: 0, PF: 0, PM: 0 };
}

export function pickStarters(roster) {
  const byOvr = roster.slice().sort((a, b) => ovr(b) - ovr(a));
  const starters = [];
  const take = (pred, n) => {
    for (const p of byOvr) if (n > 0 && pred(p) && !starters.includes(p)) { starters.push(p); n--; }
  };
  take(isGuard, 2);
  take((p) => p.pos === 'SF' || p.pos === 'PF', 2);
  take((p) => p.pos === 'C' || p.pos === 'PF', 1);
  take(() => true, 5 - starters.length);
  return [...starters, ...byOvr.filter((p) => !starters.includes(p))];
}

class Side {
  constructor(key, team, tactics) {
    this.key = key;
    this.team = team; // { school, roster }
    this.tactics = { ...DEFAULT_TACTICS, ...(tactics || {}) };
    this.score = 0;
    this.teamFouls = 0;
    this.players = team.roster.map((p) => ({ p, r: derive(p), energy: 100, fouls: 0, on: false, line: blankLine(), name: fullName(p) }));
    this.setRotation(this.tactics.rotation);
    this.order.slice(0, 5).forEach((ps, i) => { ps.on = true; ps.slot = i; ps.home = i; }); // slot 0-4 = PG SG SF PF C
    this.lastSubCheck = 0;
  }
  setRotation(ids) {
    const order = ids
      ? ids.map((id) => this.team.roster.find((p) => p.id === id)).filter(Boolean)
      : pickStarters(this.team.roster);
    for (const p of this.team.roster) if (!order.includes(p)) order.push(p);
    this.order = order.map((p) => this.players.find((ps) => ps.p === p));
    const depth = clamp(this.tactics.depth, 7, 10);
    const t = TARGET_MIN[depth];
    this.order.forEach((ps, i) => (ps.target = (t[i] || 0) * 60));
    const mins = this.tactics.minutes;
    if (mins) {
      // coach's minutes: soft targets (fatigue, fouls and close games still move them), scaled to a 200-minute game
      const raw = this.order.map((ps) => clamp(mins[ps.p.id] || 0, 0, 40));
      const sum = raw.reduce((a, b) => a + b, 0);
      if (sum > 0) this.order.forEach((ps, i) => (ps.target = Math.min(40, (raw[i] * 200) / sum) * 60));
    }
    this.order.forEach((ps, i) => (ps.rank = i));
  }
  get onCourt() { return this.players.filter((ps) => ps.on); }
  get pace() { return { slow: 60, normal: 65, fast: 71 }[this.tactics.tempo] + (this.tactics.defense === 'press' ? 2 : 0); }
}

export class Game {
  /**
   * home/away: { school, roster, tactics? }
   * opts: { seed, neutral }
   */
  constructor(home, away, opts = {}) {
    this.rng = makeRng(opts.seed ?? 1);
    this.neutral = !!opts.neutral;
    this.sides = { home: new Side('home', home, home.tactics), away: new Side('away', away, away.tactics) };
    this.period = 1;
    this.clock = HALF;
    this.elapsed = 0;
    this.poss = this.rng.chance(0.5) ? 'home' : 'away';
    this.secondHalfPoss = this.poss === 'home' ? 'away' : 'home';
    this.events = [];
    this.done = false;
    this.possCount = { home: 0, away: 0 };
  }

  setTactics(sideKey, patch) {
    const s = this.sides[sideKey];
    Object.assign(s.tactics, patch);
    if (patch.rotation || patch.depth || 'minutes' in patch) s.setRotation(s.tactics.rotation);
  }

  get score() { return [this.sides.home.score, this.sides.away.score]; }

  emit(sideKey, type, text, extra = {}) {
    const ev = { period: this.period, clock: Math.max(0, Math.round(this.clock)), team: sideKey, type, text, score: this.score, ...extra };
    this.events.push(ev);
    this._stepEvents.push(ev);
    return ev;
  }

  // ---------- helpers ----------
  homeEdge(sideKey) { return this.neutral ? 0 : sideKey === 'home' ? 1 : -1; }
  eff(ps, val) { return val - (100 - ps.energy) * 0.18; }

  weighted(list, fn) {
    return this.rng.weighted(list, list.map(fn));
  }

  addPoints(sideKey, pts) {
    const off = this.sides[sideKey];
    const def = this.sides[sideKey === 'home' ? 'away' : 'home'];
    off.score += pts;
    for (const ps of off.onCourt) ps.line.PM += pts;
    for (const ps of def.onCourt) ps.line.PM -= pts;
  }

  tick(secs) {
    secs = Math.min(secs, this.clock);
    this.clock -= secs;
    this.elapsed += secs;
    for (const side of Object.values(this.sides)) {
      const pf = (side.tactics.tempo === 'fast' ? 1.1 : side.tactics.tempo === 'slow' ? 0.92 : 1) * (side.tactics.defense === 'press' ? 1.15 : 1);
      for (const ps of side.players) {
        if (ps.on) {
          ps.line.SEC += secs;
          ps.energy = clamp(ps.energy - secs * 0.05 * (1.4 - ps.r.stm / 100) * pf, 0, 100);
        } else {
          ps.energy = clamp(ps.energy + secs * 0.09, 0, 100);
        }
      }
    }
  }

  foul(defSide, fouler, shooting) {
    fouler.fouls++;
    fouler.line.PF++;
    defSide.teamFouls++;
    if (fouler.fouls >= 5) {
      this.emit(defSide.key, 'foulout', `${fouler.name} has fouled out.`);
      this.substitute(defSide, true);
    }
    return shooting;
  }

  freeThrows(offKey, shooterPs, n, oneAndOne = false) {
    const off = this.sides[offKey];
    const pct = clamp(0.264 + 0.006 * this.eff(shooterPs, shooterPs.r.ft), 0.3, 0.95);
    let made = 0, lastMade = true;
    for (let i = 0; i < n; i++) {
      shooterPs.line.FTA++;
      lastMade = this.rng.chance(pct);
      if (lastMade) {
        shooterPs.line.FTM++; shooterPs.line.PTS++; made++;
        this.addPoints(offKey, 1);
        this.emit(offKey, 'ft', `${shooterPs.name} makes free throw ${i + 1} of ${n}.`, { pid: shooterPs.p.id, note: this.interactive ? `${shooterPs.line.PTS} ${shooterPs.line.PTS === 1 ? "pt" : "pts"}` : undefined });
      } else {
        this.emit(offKey, 'ftmiss', `${shooterPs.name} misses free throw ${i + 1} of ${n}.`, { pid: shooterPs.p.id });
        if (oneAndOne && i === 0) break;
      }
      if (oneAndOne && i === 0 && lastMade) n = 2;
    }
    void off;
    return { made, lastMade };
  }

  rebound(offKey, defKey, ftMiss = false) {
    const off = this.sides[offKey], def = this.sides[defKey];
    const oSum = off.onCourt.reduce((s, ps) => s + Math.max(5, this.eff(ps, ps.r.orb)), 0);
    const dSum = def.onCourt.reduce((s, ps) => s + Math.max(5, this.eff(ps, ps.r.drb)), 0);
    let pOrb = 0.33 * Math.pow(oSum / dSum, 1.4);
    if (def.tactics.defense === 'zone') pOrb += 0.025;
    if (ftMiss) pOrb *= 0.45;
    pOrb = clamp(pOrb, 0.1, 0.5);
    if (this.rng.chance(pOrb)) {
      const r = this.weighted(off.onCourt, (ps) => Math.max(1, ps.r.orb) ** 2);
      r.line.ORB++;
      this.emit(offKey, 'oreb', `Offensive rebound by ${r.name}.`, { pid: r.p.id, note: this.interactive ? `${r.line.ORB + r.line.DRB} reb` : undefined });
      return { offensive: true, rebounder: r };
    }
    const r = this.weighted(def.onCourt, (ps) => Math.max(1, ps.r.drb) ** 2);
    r.line.DRB++;
    this.emit(defKey, 'dreb', `Defensive rebound by ${r.name}.`, { pid: r.p.id, note: this.interactive ? `${r.line.ORB + r.line.DRB} reb` : undefined });
    return { offensive: false, rebounder: r };
  }

  // ---------- substitutions ----------
  substitute(side, forced = false) {
    if (!forced && this.elapsed - side.lastSubCheck < 75) return;
    side.lastSubCheck = this.elapsed;
    const totalReg = 2 * HALF;
    const frac = clamp(this.elapsed / totalReg, 0.02, 1);
    const late = this.period >= 2 && this.clock <= 240;
    const margin = Math.abs(this.sides.home.score - this.sides.away.score);
    const blowout = this.period === 2 && this.clock <= 300 && margin >= 18;
    const close = late && margin <= 10;
    const firstHalf = this.period === 1;

    const prio = (ps) => {
      if (ps.fouls >= 5) return -1e9;
      let v = ps.target * frac - ps.line.SEC; // seconds behind/ahead of plan
      if (ps.on) v += 45;
      v -= Math.max(0, 60 - ps.energy) * 6;
      if (firstHalf && ps.fouls >= 2) v -= 400;
      if (!firstHalf && ps.fouls >= 4 && this.clock > 300) v -= 400;
      if (close) v = ps.rank < 5 ? 1e6 - ps.rank + ps.energy : ps.rank < 8 ? 5e5 - ps.rank : v;
      if (blowout) v = ps.rank >= 5 ? 1e6 - ps.line.SEC : -ps.rank;
      if (ps.target === 0 && !close && !blowout) v -= 900;
      return v;
    };
    const ranked = side.players.slice().sort((a, b) => prio(b) - prio(a)).filter((ps) => ps.fouls < 5);
    const pick = [];
    const guards = () => pick.filter((ps) => isGuard(ps.p)).length;
    const bigs = () => pick.filter((ps) => isBig(ps.p)).length;
    for (const ps of ranked) {
      if (pick.length >= 5) break;
      if (isBig(ps.p) && bigs() >= 3) continue;
      if (!isGuard(ps.p) && pick.length === 4 && guards() === 0) continue;
      pick.push(ps);
    }
    for (const ps of ranked) if (pick.length < 5 && !pick.includes(ps)) pick.push(ps);
    if (pick.length < 5) {
      // fewer than 5 eligible players: bring back fouled-out players (rare)
      for (const ps of side.players) if (pick.length < 5 && !pick.includes(ps)) pick.push(ps);
    }
    const outs = side.onCourt.filter((ps) => !pick.includes(ps));
    const ins = pick.filter((ps) => !ps.on);
    for (const ps of side.players) ps.on = pick.includes(ps);
    // incoming players take the outgoing players' slots, natural positions lined up (guards to low slots, bigs to high)
    const free = outs.map((ps) => ps.slot).filter((x) => x != null).sort((a, b) => a - b);
    for (let i = 0; i < 5; i++) if (!pick.some((ps) => !ins.includes(ps) && ps.slot === i) && !free.includes(i)) free.push(i);
    free.sort((a, b) => a - b);
    const rest = [];
    for (const ps of ins) { const h = free.indexOf(ps.home); if (ps.home != null && h >= 0) { ps.slot = ps.home; free.splice(h, 1); } else rest.push(ps); } // starters return to their own slot
    rest.sort((a, b) => POS_IDX[a.p.pos] - POS_IDX[b.p.pos] || a.p.ht - b.p.ht).forEach((ps, i) => (ps.slot = free[i] ?? i));
    for (const ps of outs) ps.slot = null;
    if (ins.length) {
      this.emit(side.key, 'sub', `${side.team.school.abbr} substitution: in ${ins.map((p) => p.p.ln).join(', ')}; out ${outs.map((p) => p.p.ln).join(', ')}.`);
    }
  }

  // ---------- one possession ----------
  // Critical moments: 2 or 3 per live game, always on your ball.
  //  - last shot of the 1st half, and a 2nd-half timeout by 6:00 if you're still short (keeps one call for the finish)
  //  - the finish: last 2:00 of the 2nd half or OT. Never while they're fouling you (you up 1-9 inside a minute).
  //  - a tied or down-1-to-3 game inside 30 seconds can add one extra call, up to 3.
  isCritical(offKey) {
    if (offKey !== this.userSide || this.clock <= 0) return false;
    this.calls ||= 0;
    this.callTarget ||= this.rng.chance(0.5) ? 3 : 2;
    const T = this.callTarget, n = this.calls;
    const d = this.sides[offKey].score - this.sides[offKey === 'home' ? 'away' : 'home'].score;
    let fire = false;
    if (this.period === 1) fire = this.clock <= 35 && n < T - 1;
    else if (this.clock > 120) fire = this.clock <= 360 && n < T - 1;
    else if (!(d > 0 && d <= 9 && this.clock <= 60)) fire = n < T || (n < 3 && d <= 0 && d >= -3 && this.clock <= 30);
    if (fire) this.calls++;
    return fire;
  }
  // choice = { pid, type } (type rim|post|mid|three, or null for the shot he likes), or null to let the game run the play
  callPlay(choice) {
    this.waiting = null;
    this.forced = { side: this.poss, pid: choice?.pid ?? null, type: choice?.type ?? null, called: true };
  }

  step() {
    if (this.done || this.waiting) return [];
    this._stepEvents = [];
    if (this.clock <= 0) {
      this.endPeriod();
      return this._stepEvents;
    }
    const offKey = this.poss;
    const defKey = offKey === 'home' ? 'away' : 'home';
    const off = this.sides[offKey], def = this.sides[defKey];
    // critical moment: the coach calls the play (live games only)
    if (this.interactive && !this.forced && this.isCritical(offKey)) {
      this.waiting = { side: offKey };
      return this._stepEvents;
    }
    this.possCount[offKey]++;

    const pace = (off.pace * 0.6 + def.pace * 0.4);
    const meanLen = 2400 / (2 * pace);
    let len = clamp(meanLen + this.rng.normal() * meanLen * 0.35, 5, 30);

    // late game: trailing defense fouls intentionally
    const diff = def.score - off.score; // defense perspective: negative = trailing
    const lateGame = this.period >= 2 && this.clock <= 60;
    if (lateGame && diff < 0 && diff >= -9) {
      this.tick(this.rng.int(2, 6));
      const fouler = this.weighted(def.onCourt, (ps) => 1 + ps.r.perD);
      const target = off.onCourt.slice().sort((a, b) => a.r.ft - b.r.ft)[this.rng.int(0, 1)];
      this.foul(def, fouler, false);
      this.emit(defKey, 'foul', `Intentional foul by ${fouler.name} on ${target.name}.`, { pid: fouler.p.id });
      const bonus = def.teamFouls >= 10 ? 2 : def.teamFouls >= 7 ? 'oneandone' : 0;
      if (!bonus) { this.possCount[offKey]--; return this._stepEvents; } // side out, offense keeps ball
      const res = this.freeThrows(offKey, target, bonus === 2 ? 2 : 1, bonus === 'oneandone');
      if (!res.lastMade) {
        const rb = this.rebound(offKey, defKey, true);
        if (rb.offensive) { this.possCount[offKey]--; return this._stepEvents; }
      }
      return this.finishPossession(offKey);
    }
    // end of half: hold for last shot
    if (this.clock <= 35 && this.clock > 0) len = Math.max(2, this.clock - this.rng.int(0, 3));

    // turnover check
    const handler = this.weighted(off.onCourt, (ps) => (ps.r.handle + ps.r.pass) ** 2);
    const defPer = def.onCourt.reduce((s, ps) => s + this.eff(ps, ps.r.perD), 0) / 5;
    let pTO = 0.175 + (60 - this.eff(handler, (handler.r.handle + handler.r.pass) / 2)) * 0.0022 + (defPer - 55) * 0.0018;
    if (def.tactics.defense === 'press') pTO += 0.03;
    if (def.tactics.defense === 'zone') pTO -= 0.01;
    pTO -= this.homeEdge(offKey) * 0.004;
    // a called play: the ball is in his hands and the set is drawn up, so fewer giveaways
    const called = this.forced && this.forced.side === offKey && this.forced.pid ? off.onCourt.find((ps) => ps.p.id === this.forced.pid) : null;
    if (called) pTO *= 0.6;
    if (this.rng.chance(clamp(pTO, called ? 0.04 : 0.07, 0.3))) {
      this.tick(len * 0.6);
      const stealer = this.weighted(def.onCourt, (ps) => Math.max(1, ps.r.stl) ** 2);
      const pSteal = clamp(0.48 + (stealer.r.stl - 60) * 0.006 + (def.tactics.defense === 'press' ? 0.06 : 0), 0.25, 0.75);
      const loser = called || (this.rng.chance(0.7) ? handler : this.weighted(off.onCourt, (ps) => 1 + ps.r.off));
      loser.line.TO++;
      if (this.rng.chance(pSteal)) {
        stealer.line.STL++;
        this.emit(offKey, 'to', `${loser.name} turnover, stolen by ${stealer.name}.`, { pid: loser.p.id, steal: stealer.p.id, note: this.interactive ? `${stealer.p.ln} ${stealer.line.STL} stl` : undefined });
      } else {
        const kind = this.rng.pick(['bad pass', 'traveling', 'offensive foul', 'lost ball out of bounds', 'shot clock violation', 'bad pass']);
        if (kind === 'offensive foul') { loser.fouls++; loser.line.PF++; }
        this.emit(offKey, 'to', `${loser.name} turnover (${kind}).`, { pid: loser.p.id });
      }
      return this.finishPossession(offKey, false);
    }

    // non-shooting foul on the floor
    let used = 0;
    const pNSF = 0.14 + (def.tactics.defense === 'press' ? 0.035 : 0) + this.homeEdge(offKey) * 0.004;
    if (this.rng.chance(pNSF)) {
      used = len * 0.4;
      this.tick(used);
      const fouler = this.weighted(def.onCourt, () => 1);
      const fouled = this.weighted(off.onCourt, (ps) => 1 + ps.r.off);
      this.foul(def, fouler, false);
      this.emit(defKey, 'foul', `Foul on ${fouler.name}.`, { pid: fouler.p.id });
      if (def.teamFouls >= 7) {
        const res = this.freeThrows(offKey, fouled, def.teamFouls >= 10 ? 2 : 1, def.teamFouls < 10);
        if (!res.lastMade) {
          const rb = this.rebound(offKey, defKey, true);
          if (!rb.offensive) return this.finishPossession(offKey, false);
        } else {
          return this.finishPossession(offKey, true);
        }
      }
      if (this.clock <= 0) return this.finishPossession(offKey, false);
    }

    // shot loop (offensive rebounds continue the possession)
    let putback = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const t = attempt === 0 ? Math.max(1, len - used) : this.rng.int(3, 9);
      this.tick(t);
      const result = this.shoot(offKey, defKey, putback);
      if (result === 'made' || result === 'ft') return this.finishPossession(offKey, true);
      if (result === 'ftmiss_def') return this.finishPossession(offKey, false);
      // missed: rebound
      const rb = result === 'ftmiss_off' ? { offensive: true, rebounder: null } : this.rebound(offKey, defKey);
      if (!rb.offensive) return this.finishPossession(offKey, false);
      if (this.clock <= 0) return this.finishPossession(offKey, false);
      putback = rb.rebounder;
    }
    return this.finishPossession(offKey, false);
  }

  shoot(offKey, defKey, putback) {
    const off = this.sides[offKey], def = this.sides[defKey];
    const r = this.rng;
    const focus = off.tactics.focus;
    const zone = def.tactics.defense === 'zone';
    const press = def.tactics.defense === 'press';

    // size mismatch vs his man (man defense only): the offense goes at it
    const mm = (ps) => { if (zone) return 0; const d = def.onCourt.find((x) => x.slot === ps.slot); return d ? Math.max(0, ps.p.ht - d.p.ht - 3) : 0; };
    let shooter;
    const forced = this.forced && this.forced.side === offKey && !putback ? this.forced : null;
    this.forced = null;
    const forcedPs = forced && off.onCourt.find((ps) => ps.p.id === forced.pid);
    if (forcedPs) shooter = forcedPs;
    else if (putback && r.chance(0.6)) shooter = putback;
    else shooter = this.weighted(off.onCourt, (ps) => Math.exp((this.eff(ps, ps.r.off) - 60) / 18 + mm(ps) / 12 + (off.tactics.shotTend?.[ps.p.id] || 0) * TEND_K));

    const s = shooter.r;
    const base = { rim: 0.35, post: 0.12, mid: 0.19, three: 0.3 };
    const w = {
      rim: base.rim * Math.exp((this.eff(shooter, s.rim) - 60) / 14),
      post: base.post * Math.exp((this.eff(shooter, s.post) - 60) / 12) * (isBig(shooter.p) ? 1.4 : 0.4),
      mid: base.mid * Math.exp((this.eff(shooter, s.mid) - 60) / 14),
      three: base.three * Math.exp((this.eff(shooter, s.three) - 56) / 12),
    };
    const edge = mm(shooter);
    if (edge) { w.post *= Math.exp(edge / 4); w.rim *= 1 + edge * 0.05; }
    if (focus === 'inside') { w.rim *= 1.3; w.post *= 1.4; w.three *= 0.78; }
    if (focus === 'perimeter') { w.three *= 1.3; w.mid *= 1.1; w.rim *= 0.85; w.post *= 0.7; }
    if (zone) { w.three *= 1.15; w.rim *= 0.82; w.post *= 0.8; }
    if (press) { w.rim *= 1.12; }
    if (putback && shooter === putback) { w.rim *= 4; w.three *= 0.3; }
    const type = forced && forced.type ? forced.type : r.weighted(['rim', 'post', 'mid', 'three'], [w.rim, w.post, w.mid, w.three]);

    // defender
    const defenders = def.onCourt;
    // man-to-man by lineup slot: whoever plays C guards their C, even if he's a 6'1" point guard
    const matchup = defenders.find((d) => d.slot === shooter.slot) || defenders[Math.min(off.onCourt.indexOf(shooter), defenders.length - 1)] || defenders[0];
    const rimProt = defenders.reduce((a, b) => (this.eff(b, b.r.intD) > this.eff(a, a.r.intD) ? b : a));
    let defVal;
    if (type === 'rim' || type === 'post') {
      defVal = zone
        ? this.eff(rimProt, rimProt.r.intD) * 0.6 + defenders.reduce((t, d) => t + this.eff(d, d.r.intD), 0) / 5 * 0.4 + 6
        : this.eff(matchup, matchup.r.intD) * 0.5 + this.eff(rimProt, rimProt.r.intD) * 0.5;
    } else {
      defVal = zone ? defenders.reduce((t, d) => t + this.eff(d, d.r.perD), 0) / 5 + 1 : this.eff(matchup, matchup.r.perD);
    }

    const skill = { rim: s.rim, post: s.post, mid: s.mid, three: s.three }[type];
    const baseP = { rim: 0.575, post: 0.455, mid: 0.37, three: 0.347 }[type];
    const k = { rim: 0.0045, post: 0.0045, mid: 0.0042, three: 0.0026 }[type];
    const center = { rim: 74, post: 60, mid: 65, three: 69 }[type];
    let pMake = baseP + (this.eff(shooter, skill) - center) * k - (defVal - 58) * 0.0028 + this.homeEdge(offKey) * 0.012;
    // height: a taller contester takes away more, a shorter one less. Biggest at the rim, small on jumpers.
    const defHt = zone ? (type === 'rim' || type === 'post' ? (rimProt.p.ht + defenders.reduce((t, d) => t + d.p.ht, 0) / defenders.length) / 2 : defenders.reduce((t, d) => t + d.p.ht, 0) / defenders.length)
      : type === 'rim' || type === 'post' ? matchup.p.ht * 0.8 + rimProt.p.ht * 0.2 : matchup.p.ht;
    const htGap = clamp(defHt - shooter.p.ht, -12, 12);
    pMake -= htGap * { rim: 0.012, post: 0.015, mid: 0.004, three: 0.0025 }[type];
    if (putback && shooter === putback && type === 'rim') pMake += 0.05;
    if (press && type === 'rim') pMake += 0.03;
    pMake = clamp(pMake, 0.05, 0.85);

    const isDunk = type === 'rim' && shooter.p.ht >= 77 && r.chance(clamp((s.dunk - 45) / 80, 0, 0.6));
    const label = { rim: isDunk ? 'dunk' : 'layup', post: 'post hook', mid: 'jumper', three: 'three-pointer' }[type];
    const pts = type === 'three' ? 3 : 2;

    // block
    if (type !== 'three') {
      const blocker = this.weighted(defenders, (ps) => (Math.max(1, ps.r.blk) * (0.5 + ps.r.hs / 100)) ** 2);
      const pBlk = { rim: 0.06, post: 0.055, mid: 0.018 }[type] * Math.exp((this.eff(blocker, blocker.r.blk) - 68) / 22);
      if (r.chance(clamp(pBlk, 0, 0.25))) {
        shooter.line.FGA++;
        blocker.line.BLK++;
        this.emit(offKey, 'block', `${shooter.name}'s ${label} is blocked by ${blocker.name}.`, { pid: shooter.p.id, blk: blocker.p.id, note: this.interactive ? `${blocker.p.ln} ${blocker.line.BLK} blk` : undefined });
        return 'miss';
      }
    }

    // shooting foul
    const pFoul = { rim: 0.25, post: 0.21, mid: 0.07, three: 0.022 }[type] + this.homeEdge(offKey) * 0.005;
    const fouled = r.chance(pFoul);
    const made = r.chance(fouled ? pMake * 0.42 : pMake);
    if (fouled) {
      const fouler = type === 'rim' || type === 'post' ? (r.chance(0.5) ? rimProt : matchup) : matchup;
      this.foul(def, fouler, true);
      if (made) {
        this.recordMake(offKey, shooter, type, pts, label, null);
        this.emit(defKey, 'foul', `And one! Shooting foul on ${fouler.name}.`, { pid: fouler.p.id });
        const res = this.freeThrows(offKey, shooter, 1);
        return res.lastMade ? 'ft' : this.ftMissRebound(offKey, defKey);
      }
      this.emit(defKey, 'foul', `Shooting foul on ${fouler.name}.`, { pid: fouler.p.id });
      const res = this.freeThrows(offKey, shooter, pts);
      return res.lastMade ? 'ft' : this.ftMissRebound(offKey, defKey);
    }

    shooter.line.FGA++;
    if (type === 'three') shooter.line.TPA++;
    if (made) {
      shooter.line.FGA--; // recordMake re-adds
      if (type === 'three') shooter.line.TPA--;
      let assister = null;
      const isPutback = putback && shooter === putback;
      const pAst = isPutback ? 0.05 : { rim: 0.45, post: 0.2, mid: 0.33, three: 0.78 }[type] * (0.86 + off.onCourt.reduce((t, ps) => t + ps.r.pass, 0) / 5 / 220);
      if (r.chance(clamp(pAst, 0, 0.95))) {
        assister = this.weighted(off.onCourt.filter((ps) => ps !== shooter), (ps) => Math.max(1, ps.r.pass) ** 4 * (ps.p.pos === 'PG' ? 1.6 : 1));
      }
      this.recordMake(offKey, shooter, type, pts, label, assister);
      return 'made';
    }
    this.emit(offKey, 'miss', `${shooter.name} misses ${type === 'three' ? 'a' : 'a'} ${label}.`, { pid: shooter.p.id, shot: type });
    return 'miss';
  }

  ftMissRebound(offKey, defKey) {
    const rb = this.rebound(offKey, defKey, true);
    return rb.offensive ? 'ftmiss_off' : 'ftmiss_def';
  }

  recordMake(offKey, shooter, type, pts, label, assister) {
    shooter.line.FGM++; shooter.line.FGA++;
    if (type === 'three') { shooter.line.TPM++; shooter.line.TPA++; }
    shooter.line.PTS += pts;
    this.addPoints(offKey, pts);
    let text = `${shooter.name} makes a ${label}.`;
    if (assister) { assister.line.AST++; text = `${shooter.name} makes a ${label} (assist ${assister.name}).`; }
    const note = this.interactive ? `${shooter.line.PTS} pts${assister ? ` · ${assister.p.ln} ${assister.line.AST} ast` : ''}` : undefined;
    this.emit(offKey, 'score', text, { pid: shooter.p.id, shot: type, pts, ast: assister?.p.id, note });
  }

  finishPossession(offKey) {
    this.forced = null;
    this.poss = offKey === 'home' ? 'away' : 'home';
    this.substitute(this.sides.home);
    this.substitute(this.sides.away);
    if (this.clock <= 0) this.endPeriod();
    return this._stepEvents;
  }

  endPeriod() {
    const [h, a] = this.score;
    const label = this.period === 1 ? 'End of 1st half' : this.period === 2 ? 'End of regulation' : `End of OT${this.period - 2}`;
    this.emit('home', 'period', `${label}: ${this.sides.home.team.school.abbr} ${h}, ${this.sides.away.team.school.abbr} ${a}.`);
    if (this.period >= 2 && h !== a) {
      this.done = true;
      this.emit('home', 'final', `Final: ${this.sides.home.team.school.name} ${h}, ${this.sides.away.team.school.name} ${a}.`);
      return;
    }
    this.period++;
    this.clock = this.period === 2 ? HALF : OT;
    if (this.period === 2) {
      this.poss = this.secondHalfPoss;
      this.sides.home.teamFouls = 0;
      this.sides.away.teamFouls = 0;
    } else {
      this.poss = this.rng.chance(0.5) ? 'home' : 'away';
    }
    for (const side of Object.values(this.sides)) {
      for (const ps of side.players) ps.energy = clamp(ps.energy + (this.period === 2 ? 35 : 10), 0, 100);
      side.lastSubCheck = -999;
      this.substitute(side, true);
    }
  }

  sim() {
    let guard = 0;
    while (!this.done && guard++ < 2000) this.step();
    return this.result();
  }

  result() {
    const side = (s) => {
      const players = s.order.map((ps) => ({ id: ps.p.id, name: ps.name, pos: ps.p.pos, starter: ps.rank < 5, ...ps.line, MIN: Math.round(ps.line.SEC / 60) }));
      const tot = blankLine();
      for (const p of players) for (const k of Object.keys(tot)) tot[k] += p[k];
      tot.PM = 0;
      return { schoolId: s.team.school.id, name: s.team.school.name, abbr: s.team.school.abbr, score: s.score, players, totals: tot, possessions: this.possCount[s.key] };
    };
    return {
      home: side(this.sides.home),
      away: side(this.sides.away),
      periods: this.period,
      winner: this.sides.home.score > this.sides.away.score ? 'home' : 'away',
      events: this.events,
    };
  }
}

export function simGame(home, away, opts) {
  return new Game(home, away, opts).sim();
}
