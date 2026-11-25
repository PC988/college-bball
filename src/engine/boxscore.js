// Text renderers for box scores and play-by-play.
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

export function clockStr(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function renderBoxScore(res) {
  const out = [];
  out.push(`${res.away.name} ${res.away.score} @ ${res.home.name} ${res.home.score}${res.periods > 2 ? ` (${res.periods === 3 ? 'OT' : res.periods - 2 + 'OT'})` : ''}`);
  for (const side of [res.away, res.home]) {
    out.push('');
    out.push(`${side.name} (${side.possessions} poss)`);
    out.push(`${pad('PLAYER', 22)} POS MIN  PTS  FG     3PT    FT     OR DR REB AST STL BLK TO PF  +/-`);
    const row = (name, pos, p) => `${pad(name, 22)} ${pad(pos, 3)} ${lpad(p.MIN, 3)} ${lpad(p.PTS, 4)}  ${pad(`${p.FGM}-${p.FGA}`, 6)} ${pad(`${p.TPM}-${p.TPA}`, 6)} ${pad(`${p.FTM}-${p.FTA}`, 6)} ${lpad(p.ORB, 2)} ${lpad(p.DRB, 2)} ${lpad(p.ORB + p.DRB, 3)} ${lpad(p.AST, 3)} ${lpad(p.STL, 3)} ${lpad(p.BLK, 3)} ${lpad(p.TO, 2)} ${lpad(p.PF, 2)} ${lpad(p.PM === undefined ? '' : (p.PM > 0 ? '+' : '') + p.PM, 4)}`;
    for (const p of side.players) {
      if (p.MIN === 0 && p.SEC === 0) { out.push(`${pad(p.name, 22)} ${pad(p.pos, 3)} DNP`); continue; }
      out.push(row(p.name + (p.starter ? '*' : ''), p.pos, p));
    }
    const t = side.totals;
    out.push(row('TEAM', '', { ...t, MIN: Math.round(t.SEC / 60), PM: undefined }));
    const pc = (m, a) => (a ? ((m / a) * 100).toFixed(1) : '0.0');
    out.push(`${pad('', 22)}         FG ${pc(t.FGM, t.FGA)}%  3P ${pc(t.TPM, t.TPA)}%  FT ${pc(t.FTM, t.FTA)}%`);
  }
  return out.join('\n');
}

export function renderPlayByPlay(res, { skipSubs = false } = {}) {
  const abbr = { home: res.home.abbr, away: res.away.abbr };
  const out = [];
  let lastPeriod = 0;
  for (const e of res.events) {
    if (skipSubs && e.type === 'sub') continue;
    if (e.period !== lastPeriod) {
      lastPeriod = e.period;
      out.push(`--- ${e.period === 1 ? '1st half' : e.period === 2 ? '2nd half' : 'OT' + (e.period - 2)} ---`);
    }
    out.push(`${lpad(clockStr(e.clock), 5)}  ${pad(abbr[e.team], 5)} ${pad(`${e.score[1]}-${e.score[0]}`, 7)} ${e.text}`);
  }
  return out.join('\n');
}
