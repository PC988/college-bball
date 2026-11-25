// Scouting Map, phone-first UI. All game rules live in src/recruiting/campaign.js.
import * as C from '../src/recruiting/campaign.js';
import { SCHOOL_DATA } from '../src/world.js';
import { ovr, gradeOf, potGrade, fullName, fmtHeight, SKILLS, PHYS } from '../src/player.js';
import { faceSvg } from '../src/face.js';
import { hsStats, HS_GAMES } from '../src/hsstats.js';
import { statRows, leaders, computeAwards, LEADER_CATS } from '../src/awards.js';
import { DRILLS, TRAIN_COST, xpMult } from '../src/training.js';
import { estimateOvr, TRAIT_KEYS, TRAIT_LABELS } from '../src/recruiting/scouting.js';
import { standings, powerRatings, expandResult } from '../src/season.js';
import { pickStarters, TARGET_MIN } from '../src/engine/game.js';
import { teamOvr } from '../src/roster.js';
import { makeRng } from '../src/rng.js';
import { REGIONS as MM_REGIONS, ROUND_NAMES, tourneySeed, gameWinner, mmBox, tourneyResult } from '../src/tourney.js';

const SAVE_KEY = 'cbbm-recruiting-v1';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stars = (n) => `<span class="stars">${'★'.repeat(n)}<span class="off">${'★'.repeat(5 - n)}</span></span>`;
const SK = () => C.starsKnown(ctx);
// McDonald's All Americans get a burger: recruits ranked top 20 (once rankings are out), and the college players they become
const burger = (x) => (x.mcd || (x.rank && x.rank <= 20 && SK()) ? ' <span class="mcd" title="McDonald\'s All American">🍔</span>' : '');
const nmB = (x) => esc(fullName(x)) + burger(x);
// before stars come out: no stars, no rank, and lists in a neutral (id) order
const shownStars = (r) => (SK() ? r.stars : 0);
const starsHtml = (r) => (SK() ? stars(r.stars) : '<span class="stars q">?</span>');
const rankTxt = (r) => (SK() ? `#${r.rank}` : 'Unranked');
const byShown = (list) => (SK() ? list : list.slice().sort((a, b) => (a.id < b.id ? -1 : 1)));
let fakeTier = null; // map zoom tiers before release, unrelated to true stars
function zoomTier(r) {
  if (SK()) return r.stars;
  if (!fakeTier || !(r.id in fakeTier)) { fakeTier = {}; byShown(ctx.recruits.filter((x) => x.stars >= 4)).forEach((x, i) => { fakeTier[x.id] = i < 25 ? 5 : 4; }); }
  return fakeTier[r.id];
}
const teamColor = () => ctx?.school?.color || '#1565c0';
function applyTeamTheme() {
  const c = teamColor();
  document.documentElement.style.setProperty('--team', c);
  document.documentElement.style.setProperty('--teamsoft', c + '1f');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', c);
}
const teamDot = (school) => `<span class="teamdot" style="background:${school.color || '#6b7785'}">${esc(school.abbr)}</span>`;
const stName = (st) => (st === 'INTL' ? 'International' : C.STATES[st].name);
const SKILL_NAMES = { LAY: 'Layup', DNK: 'Dunk', INS: 'Inside scoring', MID: 'Mid-range', TPT: 'Three-point', FTS: 'Free throw', DRB: 'Ball handling', PAS: 'Passing', ORE: 'Offensive rebound', DRE: 'Defensive rebound', STL: 'Steal', BLK: 'Block', STR: 'Strength', SPD: 'Speed', STM: 'Stamina' };
const REGIONS = {
  West: { c: '#d6e5db', s: ['WA', 'OR', 'CA', 'NV', 'ID', 'MT', 'WY', 'UT', 'CO', 'AK', 'HI'] },
  Southwest: { c: '#eedfcf', s: ['AZ', 'NM', 'TX', 'OK'] },
  Midwest: { c: '#d5e0ee', s: ['ND', 'SD', 'NE', 'KS', 'MN', 'IA', 'MO', 'WI', 'IL', 'IN', 'MI', 'OH'] },
  South: { c: '#e5dbe9', s: ['AR', 'LA', 'MS', 'AL', 'TN', 'KY', 'GA', 'FL', 'SC', 'NC', 'VA', 'WV'] },
  Northeast: { c: '#d4e7e8', s: ['PA', 'NY', 'NJ', 'DE', 'MD', 'DC', 'CT', 'RI', 'MA', 'VT', 'NH', 'ME'] },
};
const regionColor = Object.fromEntries(Object.values(REGIONS).flatMap((r) => r.s.map((s) => [s, r.c])));
const INTL_BOX = { x: 820, y: 480, w: 120, h: 70 };

let ctx = null;
const ui = { tab: 'today', seasonView: 'schedule', boxSide: null, sel: null, selRecruit: null, sheet: 'closed', sheetView: null, board: { pos: '', stars: '', status: 'open' }, lastSeenLog: 0 };
const view = { cx: 480, cy: 300, k: 1 }; // map camera: center + zoom (1 = whole country fits width)
const pins = {}; // rid -> [x, y]

// ---------- storage (may be blocked in sandboxed frames) ----------
const store = {
  get() { try { return localStorage.getItem(SAVE_KEY); } catch { return null; } },
  set(v) { try { localStorage.setItem(SAVE_KEY, v); } catch { /* no persistence */ } },
  remove() { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } },
};
const save = () => store.set(C.serializeCampaign(ctx));
// ---------- save backup: export to a file, import from one ----------
async function exportText(text, name) {
  const file = new File([text], name, { type: 'application/json' });
  try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function exportSave() {
  const st = ctx.state;
  exportText(C.serializeCampaign(ctx), `hoops-${ctx.school.abbr || st.schoolId}-${st.year}-day${st.day}.json`.toLowerCase());
}
function importSave(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    const text = String(r.result);
    let next;
    try { const j = JSON.parse(text); if (!j.seed || !j.schoolId) throw new Error('not a College Hoops Manager save'); next = C.loadCampaign(text); }
    catch (e) { toast(`Import failed: ${e.message}. Your current save is untouched.`, 'bad'); const el = $('loadErr'); if (el) { el.classList.remove('hidden'); el.textContent = `Import failed: ${e.message}. Your current save is untouched.`; } return; }
    void next;
    store.set(text);
    try { sessionStorage.setItem('cbbm-autocontinue', '1'); } catch { /* ignore */ }
    location.reload();
  };
  r.readAsText(file);
}

// ---------- start screen ----------
function startScreen() {
  $('start').classList.remove('hidden');
  const seed = Math.floor(Math.random() * 1e9);
  const scouts = C.generateScouts(seed);
  let school = null, scout = null;
  const ready = () => ($('startBtn').disabled = !(school && scout));
  const tierName = { BB: 'Blue blood', HM: 'High major', MM: 'Mid major', LM: 'Low major' };
  const pick = (s) => {
    school = s;
    $('schoolSearch').value = s.name;
    $('schoolResults').innerHTML = '';
    $('schoolInfo').classList.remove('hidden');
    $('schoolInfo').innerHTML = `<b>${esc(s.name)}</b><br>${tierName[s.tier]} · prestige ${s.prestige} · ${esc(stName(s.state))}<br>NIL $${s.nilBudget}K/yr · ${s.size} ${s.control} school`;
    ready();
  };
  $('schoolSearch').oninput = (e) => {
    const q = e.target.value.trim().toLowerCase();
    school = null; ready();
    $('schoolInfo').classList.add('hidden');
    const hits = q ? SCHOOL_DATA.schools.filter((s) => s.name.toLowerCase().includes(q) || s.abbr.toLowerCase() === q).slice(0, 6) : [];
    $('schoolResults').innerHTML = hits.map((s) => `<button data-id="${s.id}"><span>${esc(s.name)}</span><span class="muted">${s.tier} · ${s.state}</span></button>`).join('');
    $('schoolResults').querySelectorAll('button').forEach((b) => (b.onclick = () => pick(SCHOOL_DATA.schools.find((s) => s.id === b.dataset.id))));
  };
  $('scoutChoices').innerHTML = scouts.map((s) => `<button class="scout" data-id="${s.id}"><b>${esc(s.name)}</b>
    ${[['Accuracy', s.accuracy], ['Efficiency', s.efficiency], ['Charisma', s.charisma], ['Travel speed', s.speed]].map(([l, v]) => `<div class="mini"><span>${l}</span><span class="t"><i style="width:${v}%"></i></span><b>${v}</b></div>`).join('')}</button>`).join('');
  document.querySelectorAll('.scout').forEach((el) => (el.onclick = () => {
    document.querySelectorAll('.scout').forEach((x) => x.classList.remove('sel'));
    el.classList.add('sel'); scout = scouts[Number(el.dataset.id)]; ready();
  }));
  $('startBtn').onclick = () => {
    $('startBtn').textContent = 'Building the world...';
    setTimeout(() => { ctx = C.createCampaign({ seed, schoolId: school.id, scout }); save(); enterGame(); }, 30);
  };
  const saved = store.get();
  if (saved) {
    $('continueBtn').classList.remove('hidden');
    $('continueBtn').onclick = () => { $('continueBtn').textContent = 'Loading...'; setTimeout(() => {
      // a save that fails to load is never deleted: show why and offer to export it
      try { ctx = C.loadCampaign(saved); enterGame(); }
      catch (e) { $('continueBtn').textContent = 'Continue saved game'; $('loadErr').classList.remove('hidden'); $('loadErr').innerHTML = `Your save could not be loaded (${esc(e.message)}). It has NOT been deleted. <button class="btn wide" id="errExport">Download it as a file</button>`; $('errExport').onclick = () => exportText(saved, 'hoops-save-backup.json'); }
    }, 30); };
  }
  let auto = false; try { auto = sessionStorage.getItem('cbbm-autocontinue') === '1'; sessionStorage.removeItem('cbbm-autocontinue'); } catch { /* ignore */ }
  if (saved && auto) $('continueBtn').click();
  $('importBtn').onclick = () => $('importFile').click();
  $('importFile').onchange = () => importSave($('importFile').files[0]);
}

// ---------- game ----------
function enterGame() {
  $('start').classList.add('hidden');
  $('game').classList.remove('hidden');
  applyTeamTheme();
  ui.lastSeenLog = ctx.state.log.length;
  buildMap();
  const home = C.STATES[ctx.school.state].label;
  Object.assign(view, { cx: home[0], cy: home[1], k: 3 });
  applyView();
  bindMapGestures();
  $('zoomIn').onclick = () => zoomBy(1.5);
  $('zoomOut').onclick = () => zoomBy(1 / 1.5);
  $('locateBtn').onclick = () => { const [x, y] = posOf(ctx.state.scoutAt); animateTo(x, y, Math.max(view.k, 2.6)); };
  $('needsBtn').onclick = () => openSheet('needs', 'full');
  $('boardBtn').onclick = () => openSheet('board', 'full');
  $('newsBtn').onclick = () => { ui.lastSeenLog = ctx.state.log.length; openSheet('news', 'full'); };
  $('endDayBtn').onclick = onEndDay;
  $('menuBtn').onclick = () => openSheet('menu', 'half');
  $('sheetClose').onclick = closeSheet;
  $('sheetBack').onclick = sheetBack;
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-pcard]'); if (b) { e.preventDefault(); openPlayerCard(b.dataset.pcard); } });
  $('scrim').onclick = closeSheet;
  document.querySelectorAll('#tabbar button').forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
  bindGrab();
  // tap feedback that survives re-renders long enough to see
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    b.classList.add('pressed');
    setTimeout(() => b.classList.remove('pressed'), 160);
  });
  const syncTop = () => document.documentElement.style.setProperty('--topbar-h', `${document.querySelector('.topbar').offsetHeight}px`);
  addEventListener('resize', syncTop);
  setTab(ui.tab);
  syncTop();
}

function setTab(tab) {
  ui.tab = tab;
  document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $('mapArea').classList.toggle('hidden', tab !== 'recruit');
  for (const t of ['today', 'roster', 'train', 'season']) $('page-' + t).classList.toggle('hidden', t !== tab);
  if (tab === 'recruit') applyView();
  render();
}

function act(res) {
  toast(res.msg, res.ok ? 'ok' : 'bad');
  if (res.ok) save();
  render();
}
let toastTimer;
function toast(msg, kind = 'ok') {
  const t = $('toast');
  t.textContent = msg; t.className = `toast ${kind}`;
  void t.offsetWidth; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3200);
}

function onEndDay() {
  if (ctx.state.over) return openSheet('summary', 'full');
  if (!ctx.state.gamePlayed && !ui.confirmAutoSim) { ui.confirmAutoSim = true; return openSheet('unplayed', 'half'); }
  ui.confirmAutoSim = false;
  if (ctx.state.scoutAt === ctx.school.state) return doEndDay('stay');
  openSheet('endday', 'half');
}
function doEndDay(choice) {
  const before = ctx.state.log.length;
  const day = ctx.state.day;
  C.endDay(ctx, choice);
  save();
  ui.daySummary = { day, items: ctx.state.log.slice(0, ctx.state.log.length - before).filter((l) => l.day === day) };
  if (ctx.state.over) openSheet('summary', 'full');
  else openSheet('daysum', 'half');
  render();
}

// ---------- map ----------
function posOf(st) { return st === 'INTL' ? [INTL_BOX.x + INTL_BOX.w / 2, INTL_BOX.y + INTL_BOX.h / 2] : C.STATES[st].label; }

function buildMap() {
  const svg = $('map');
  const ns = 'http://www.w3.org/2000/svg';
  let h = '<g class="grid">';
  for (let x = -480; x <= 1440; x += 120) h += `<line x1="${x}" y1="-400" x2="${x}" y2="1000"/>`;
  for (let y = -400; y <= 1000; y += 120) h += `<line x1="-480" y1="${y}" x2="1440" y2="${y}"/>`;
  h += '</g><g id="land">';
  for (const [code, s] of Object.entries(C.STATES)) h += `<path class="st" data-st="${code}" d="${s.d}" fill="${regionColor[code]}"/>`;
  h += `<g class="intl" data-st="INTL"><rect data-st="INTL" x="${INTL_BOX.x}" y="${INTL_BOX.y}" width="${INTL_BOX.w}" height="${INTL_BOX.h}" rx="10" fill="#dde1e8"/></g>`;
  h += '</g><g id="labels"></g><g id="routes"></g><g id="pinLayer"></g><g id="markers"></g>';
  svg.innerHTML = h;
  // state labels sized to the state
  let lb = '';
  for (const [code, s] of Object.entries(C.STATES)) {
    const bb = svg.querySelector(`path[data-st="${code}"]`).getBBox();
    const size = Math.max(5, Math.min(22, Math.sqrt(bb.width * bb.height) / 7));
    lb += `<text class="slbl" x="${s.label[0]}" y="${s.label[1] + size * 0.35}" font-size="${size.toFixed(1)}">${code}</text>`;
  }
  lb += `<text class="slbl" x="${INTL_BOX.x + INTL_BOX.w / 2}" y="${INTL_BOX.y + 16}" font-size="11">INTERNATIONAL</text>`;
  $('labels').innerHTML = lb;
  placePins(svg, ns);
}

// Scatter each recruit's pin inside his state (deterministic).
function placePins(svg) {
  const pt = svg.createSVGPoint ? svg.createSVGPoint() : null;
  for (const [st, list] of Object.entries(ctx.byState)) {
    const rng = makeRng(`${ctx.state.seed}:pins:${st}`);
    const placed = [];
    if (st === 'INTL') {
      list.forEach((r, i) => { pins[r.id] = [INTL_BOX.x + 12 + (i % 8) * 13.5, INTL_BOX.y + 30 + Math.floor(i / 8) * 9]; });
      continue;
    }
    const path = svg.querySelector(`path[data-st="${st}"]`);
    const bb = path.getBBox();
    const minD = Math.max(2.5, Math.sqrt((bb.width * bb.height) / Math.max(1, list.length)) * 0.55);
    for (const r of list) {
      let best = null;
      for (let tries = 0; tries < 40; tries++) {
        const x = bb.x + rng.next() * bb.width, y = bb.y + rng.next() * bb.height;
        let inside = true;
        if (pt && path.isPointInFill) { pt.x = x; pt.y = y; inside = path.isPointInFill(pt); }
        if (!inside) continue;
        const near = placed.some(([px, py]) => (px - x) ** 2 + (py - y) ** 2 < minD * minD);
        best = [x, y];
        if (!near) break;
      }
      best ||= C.STATES[st].label;
      placed.push(best);
      pins[r.id] = best;
    }
  }
}

function svgSize() { const r = $('map').getBoundingClientRect(); return [r.width || 1, r.height || 1]; }
function applyView() {
  const [W, H] = svgSize();
  const w = 960 / view.k, h = w * (H / W);
  view.cx = Math.min(1000, Math.max(-40, view.cx));
  view.cy = Math.min(620, Math.max(-20, view.cy));
  const svg = $('map');
  svg.setAttribute('viewBox', `${view.cx - w / 2} ${view.cy - h / 2} ${w} ${h}`);
  const unitsPerPx = w / W;
  svg.style.setProperty('--pk', unitsPerPx.toFixed(4));
  svg.classList.toggle('z4', view.k >= 2.4);
  svg.classList.toggle('z3', view.k >= 4.5);
  svg.classList.toggle('z2', view.k >= 8);
}
function zoomBy(f, ax, ay) {
  const k = Math.min(12, Math.max(0.9, view.k * f));
  if (ax !== undefined) { // keep the point under the fingers fixed
    const ratio = view.k / k;
    view.cx = ax + (view.cx - ax) * ratio;
    view.cy = ay + (view.cy - ay) * ratio;
  }
  view.k = k;
  applyView();
}
function animateTo(x, y, k) {
  const from = { ...view }, t0 = performance.now(), dur = 350;
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur), e = 1 - (1 - p) ** 3;
    view.cx = from.cx + (x - from.cx) * e; view.cy = from.cy + (y - from.cy) * e; view.k = from.k + (k - from.k) * e;
    applyView();
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function clientToMap(cx, cy) {
  const svg = $('map'); const r = svg.getBoundingClientRect();
  const [vx, vy, vw, vh] = svg.getAttribute('viewBox').split(' ').map(Number);
  return [vx + ((cx - r.left) / r.width) * vw, vy + ((cy - r.top) / r.height) * vh];
}

function bindMapGestures() {
  const svg = $('map');
  const pts = new Map();
  let moved = 0, downTarget = null, pinch = null;
  svg.addEventListener('pointerdown', (e) => {
    svg.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1) { moved = 0; downTarget = e.target; }
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: view.k };
    }
  });
  svg.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId);
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1) {
      const [W] = svgSize();
      const upp = 960 / view.k / W;
      const dx = e.clientX - prev[0], dy = e.clientY - prev[1];
      moved += Math.abs(dx) + Math.abs(dy);
      view.cx -= dx * upp; view.cy -= dy * upp;
      applyView();
    } else if (pts.size === 2 && pinch) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const [mx, my] = clientToMap((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      zoomBy((pinch.k * (d / pinch.d)) / view.k, mx, my);
      moved = 99;
    }
  });
  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size === 0 && moved < 8 && downTarget) onMapTap(downTarget);
  };
  svg.addEventListener('pointerup', up);
  svg.addEventListener('pointercancel', (e) => { pts.delete(e.pointerId); pinch = null; });
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [mx, my] = clientToMap(e.clientX, e.clientY);
    zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, mx, my);
  }, { passive: false });
  window.addEventListener('resize', applyView);
}

function onMapTap(target) {
  const pin = target.closest('[data-rid]');
  if (pin) return selectRecruit(pin.dataset.rid);
  const st = target.closest('[data-st]');
  if (st) { ui.sel = st.dataset.st; ui.selRecruit = null; openSheet('state', 'half'); render(); }
}
function selectRecruit(rid) {
  ui.selRecruit = rid;
  ui.sel = ctx.byId[rid].state;
  openSheet('recruit', 'full');
  render();
}

function renderMap() {
  const svg = $('map');
  svg.querySelectorAll('path.st').forEach((p) => p.classList.toggle('sel', p.dataset.st === ui.sel));
  svg.querySelector('.intl').classList.toggle('sel', ui.sel === 'INTL');
  // pins
  const todayIds = new Set();
  const here = C.gamesToday(ctx, ctx.state.scoutAt);
  for (const g of here) for (const id of g.players) todayIds.add(id);
  let ph = '';
  const order = byShown(ctx.recruits).slice().reverse(); // best recruits drawn last (on top)
  for (const r of order) {
    const commit = ctx.state.commits[r.id];
    const mine = commit === ctx.state.schoolId;
    if (commit && !mine) continue;
    if (r.stars < 4) continue; // map pins are 4★ and 5★ only
    const offered = (ctx.state.offers[r.id] || []).includes(ctx.state.schoolId);
    const known = !!ctx.state.knowledge[r.id];
    const zt = zoomTier(r);
    const tier = zt === 5 || offered || mine || known || r.id === ui.selRecruit ? '' : `t${zt}`;
    const [x, y] = pins[r.id];
    const cls = `pin s${shownStars(r)} ${tier}${offered ? ' offered' : ''}${mine ? ' mine' : ''}${r.id === ui.selRecruit ? ' sel' : ''}`;
    const badge = todayIds.has(r.id) && !ctx.state.gameToday ? '<circle class="badge" cx="10" cy="-30" r="7"/><text class="badge-t" x="10" y="-26.5">!</text>' : '';
    ph += `<g class="${cls}" data-rid="${r.id}" style="transform:translate(${x.toFixed(1)}px,${y.toFixed(1)}px) scale(calc(var(--pk) * .78))">
      <path class="head" d="M0 0 L-6 -13 A14 14 0 1 1 6 -13 Z"/><text y="-19">${r.pos}</text>${badge}</g>`;
  }
  $('pinLayer').innerHTML = ph;
  // routes + markers
  const [hx, hy] = posOf(ctx.school.state);
  const [sx, sy] = posOf(ctx.state.scoutAt);
  let rt = '';
  if (ctx.state.scoutAt !== ctx.school.state) rt += `<line class="route home" x1="${hx}" y1="${hy}" x2="${sx}" y2="${sy}"/>`;
  let mk = '';
  if (ui.sel && ui.sel !== ctx.state.scoutAt) {
    const [tx, ty] = posOf(ui.sel);
    rt += `<line class="route" x1="${sx}" y1="${sy}" x2="${tx}" y2="${ty}"/>`;
    const cost = C.travelCost(ctx.state.scout, ctx.state.scoutAt, ui.sel);
    mk += `<g class="chip" style="transform:translate(${((sx + tx) / 2).toFixed(1)}px,${((sy + ty) / 2).toFixed(1)}px) scale(var(--pk))"><rect x="-28" y="-14" width="56" height="28" rx="14"/><text y="5">${cost} AP</text></g>`;
  }
  $('routes').innerHTML = rt;
  mk += `<g class="homemark" style="transform:translate(${hx}px,${hy}px) scale(var(--pk)) translate(-22px,0)"><circle r="9" fill="${'#f5c542'}" stroke="#0b1626" stroke-width="2"/><path d="M-4.5 1 L0 -4 L4.5 1 V5 H-4.5 Z" fill="#0b1626"/></g>`;
  const ev = C.eventToday(ctx);
  if (ev) { const [ex, ey] = posOf(ev.state); mk += `<g class="evmark" style="transform:translate(${ex}px,${ey}px) scale(var(--pk))"><circle r="14" fill="#3d2a07" stroke="#f5c542" stroke-width="2.5"/><text y="6" text-anchor="middle" font-size="16" fill="#f5c542">★</text></g>`; }
  // scout van
  mk += `<g class="token" style="transform:translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px) scale(var(--pk)) translate(14px,4px)">
    <circle class="bg" r="18"/><rect x="-11" y="-7" width="22" height="11" rx="3" fill="#d6453c"/><rect x="-6" y="-11" width="12" height="6" rx="2" fill="#d6453c"/>
    <rect x="-4.5" y="-9.5" width="9" height="4" rx="1" fill="#bfe3ff"/><circle cx="-6" cy="5" r="3" fill="#1c2430"/><circle cx="6" cy="5" r="3" fill="#1c2430"/></g>`;
  $('markers').innerHTML = mk;
}

// ---------- HUD ----------
function renderHUD() {
  const st = ctx.state;
  const rec = standings(ctx.world, ctx.season)[st.schoolId];
  $('tSchool').textContent = ctx.school.name.length > 12 ? ctx.school.abbr : ctx.school.name;
  $('tRecord').textContent = `${rec.W}-${rec.L} · Class ${C.commitsFor(ctx, st.schoolId).length}/${ctx.slots} signed`;
  $('apNum').textContent = st.ap;
  $('apMax').textContent = `/${st.apMax}`;
  $('apCard').classList.toggle('low', st.ap <= 3);
  if (ui.lastAp !== undefined && ui.lastAp !== st.ap) { const c = $('apCard'); c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); }
  ui.lastAp = st.ap;
  const left = C.DAYS - st.day;
  $('dayPill').textContent = st.over ? 'Signing day is done' : `Day ${st.day} · ${left} day${left === 1 ? '' : 's'} left`;
  $('endDayBtn').textContent = st.over ? 'Results' : 'End Day';
  const ev = C.eventToday(ctx);
  $('eventChip').classList.toggle('hidden', !ev || st.over);
  if (ev) $('eventChip').textContent = `★ ${ev.name} today in ${stName(ev.state)}`;
  $('newsDot').classList.toggle('hidden', ctx.state.log.length <= ui.lastSeenLog);
}

// ---------- sheet ----------
// Back stack: opening a different view from an open sheet remembers where you were (view, size, scroll, selection).
const sheetStack = [];
function openSheet(view_, size = 'half') {
  if (ui.sheet !== 'closed' && ui.sheetView && ui.sheetView !== view_) sheetStack.push({ view: ui.sheetView, size: ui.sheet, scroll: $('sheetBody').scrollTop, sel: ui.sel, rid: ui.selRecruit, stTab: ui.stTab, stTabFor: ui.stTabFor });
  else if (ui.sheet === 'closed') sheetStack.length = 0;
  ui.sheetView = view_;
  ui.sheet = size;
  renderSheet();
  $('sheetBody').scrollTop = 0;
}
function sheetBack() {
  const prev = sheetStack.pop();
  if (!prev) return closeSheet();
  Object.assign(ui, { sheetView: prev.view, sheet: prev.size, sel: prev.sel, selRecruit: prev.rid, stTab: prev.stTab, stTabFor: prev.stTabFor, pickExact: false });
  renderSheet(); render();
  $('sheetBody').scrollTop = prev.scroll;
}
function closeSheet() { document.body.classList.remove('sheet-over-live'); sheetStack.length = 0; ui.sheet = 'closed'; ui.selRecruit = null; ui.pickExact = false; renderSheet(); render(); }
function setSheetSize() {
  const s = $('sheet');
  s.classList.toggle('half', ui.sheet === 'half');
  s.classList.toggle('full', ui.sheet === 'full');
  s.setAttribute('aria-hidden', ui.sheet === 'closed');
  $('scrim').classList.toggle('hidden', ui.sheet !== 'full');
}
function bindGrab() {
  let y0 = null;
  const g = $('grab');
  g.addEventListener('pointerdown', (e) => { y0 = e.clientY; g.setPointerCapture(e.pointerId); });
  g.addEventListener('pointerup', (e) => {
    if (y0 === null) return;
    const dy = e.clientY - y0; y0 = null;
    if (Math.abs(dy) < 8) ui.sheet = ui.sheet === 'full' ? 'half' : 'full';
    else if (dy < 0) ui.sheet = 'full';
    else ui.sheet = ui.sheet === 'full' ? 'half' : 'closed';
    if (ui.sheet === 'closed') closeSheet(); else setSheetSize();
  });
}

function renderSheet() {
  setSheetSize();
  if (ui.sheet === 'closed') return;
  const body = $('sheetBody');
  const v = ui.sheetView;
  const html = {
    state: sheetState, recruit: sheetRecruit, board: sheetBoard, needs: sheetNeeds, news: sheetNews,
    endday: sheetEndDay, daysum: sheetDaySummary, summary: sheetSummary, menu: sheetMenu,
    unplayed: sheetUnplayed, box: sheetBox, player: sheetPlayer, offseason: sheetOffseason, preoff: sheetPreOff, train: sheetTrain, draft: sheetDraft, ceremony: sheetCeremony, combine: sheetCombine,
  }[v]();
  body.innerHTML = html;
  $('sheetBack').classList.toggle('hidden', !sheetStack.length);
  bindSheet(body);
}

// Each high school gets its own color, fixed by its id.
const HS_COLORS = ['#c62828', '#1565c0', '#2e7d32', '#6a1b9a', '#ef6c00', '#00838f', '#ad1457', '#4e342e', '#283593', '#9e7700', '#558b2f', '#37474f', '#d84315', '#00695c', '#5e35b1', '#b71c1c'];
function hsColor(id) { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return HS_COLORS[h % HS_COLORS.length]; }
// State list grouped by high school, best team (by its top recruit) first.
function byTeam(list) {
  const groups = {};
  for (const r of byShown(list)) (groups[r.hsTeam] ||= []).push(r);
  return Object.entries(groups).map(([tid, rs]) => `<div class="hshead" style="--hs:${hsColor(tid)}"><span>${esc(ctx.hsTeams[tid].name)}</span><small>${rs.length} recruit${rs.length > 1 ? 's' : ''}</small></div>
    <div class="list">${rs.map((r) => cardFor(r, { school: true })).join('')}</div>`).join('');
}
// OVR color bands on the 1-100 scale (90+ elite, 80s good, 70s solid, 60s role, below that raw).
const oc = (v) => (typeof v !== 'number' ? '' : v >= 90 ? 'o9' : v >= 80 ? 'o8' : v >= 70 ? 'o7' : v >= 60 ? 'o6' : 'o5');
function cardFor(r, o) {
  const opt = o && typeof o === 'object' ? o : {};
  const school = !!opt.school;
  const e = est(r);
  const sd = opt.scout ? C.scoutDepth(ctx, r.id) : null;
  const col = school ? hsColor(r.hsTeam) : null;
  return `<button class="card${school ? ' hs' : ''}" data-open="${r.id}" ${col ? `style="--hs:${col}"` : ''}><span class="pos s${shownStars(r)}">${r.pos}</span>
    <span><div class="nm">${nmB(r)}</div><div class="meta">${school ? `<b class="hsn">${esc(ctx.hsTeams[r.hsTeam].name)}</b> · ` : ''}${rankTxt(r)} · ${fmtHeight(r.ht)} · ${r.state} · OVR ${e.ovr}</div>${sd ? `<div class="meta scouted">${sd.at ? `<b>Seen live:</b> ${esc(sd.at)} · ` : ''}${sd.seen}/12 skills${sd.exact ? ` (${sd.exact} exact)` : ''}${sd.traits ? ` · ${sd.traits} traits` : ''}${sd.visits ? ` · ${sd.visits} visit${sd.visits > 1 ? 's' : ''}` : ''}</div>` : ''}</span>
    <span class="right">${starsHtml(r)}<br>${statusTag(r)}</span></button>`;
}
function est(r) {
  const k = C.knowledgeOf(ctx, r.id);
  const o = estimateOvr(k, ovr, r);
  const ovrS = !o ? '?' : o[0] === o[1] ? `${o[0]}` : `${o[0]}-${o[1]}`;
  const potS = !k.pot ? '?' : k.pot[0] === k.pot[1] ? r.grade : potGrade(k.pot[0]) === potGrade(k.pot[1]) ? potGrade(k.pot[0]) : `${potGrade(k.pot[0])}-${potGrade(k.pot[1])}`;
  return { k, ovr: ovrS, pot: potS };
}
function statusTag(r) {
  const c = ctx.state.commits[r.id];
  if (c === ctx.state.schoolId) return '<span class="tag mine">Signed</span>';
  if (c) return `<span class="tag ${(ctx.state.offers[r.id] || []).includes(ctx.state.schoolId) ? 'lost' : ''}">${esc(ctx.schools[c].abbr)}</span>`;
  const off = ctx.state.offers[r.id] || [];
  if (off.includes(ctx.state.schoolId)) return '<span class="tag off">Offered</span>';
  if (C.isBurned(ctx, r.id)) return '<span class="tag lost">Burned</span>';
  return off.length ? `<span class="tag">${off.length} offer${off.length > 1 ? 's' : ''}</span>` : '';
}

function sheetState() {
  const st = ui.sel;
  const here = st === ctx.state.scoutAt;
  const cost = C.travelCost(ctx.state.scout, ctx.state.scoutAt, st);
  const list = (ctx.byState[st] || []);
  const open = list.filter((r) => !ctx.state.commits[r.id]);
  const games = C.gamesToday(ctx, st);
  const tab = ui.stTab && ui.stTabFor === st ? ui.stTab : here ? 'games' : 'players';
  const ev = C.eventToday(ctx);
  const evCost = Math.max(1, Math.round(C.COSTS.event * (1.2 - ctx.state.scout.efficiency / 250)));
  return `<h2>${esc(stName(st))}</h2>
    <div class="note">${open.length} uncommitted recruits${SK() ? ` · ${open.filter((r) => r.stars >= 4).length} four or five star` : ''}${st === ctx.school.state ? ' · home state' : ''}</div>
    ${here ? '<div class="note" style="color:var(--green)">Your scout is here.</div>' : `<button class="btn primary wide" data-act="travel">Send scout here · ${cost} AP · ${C.milesBetween(ctx.state.scoutAt, st).toLocaleString()} mi</button>`}
    ${ev && ev.state === st ? `<div class="sec">Event today</div><div class="game-row"><b>★ ${esc(ev.name)}</b><div class="who">The top ${ev.top} recruits in the class, all in one gym.</div>${ev.id === 'all-american' ? (() => { const ids = C.eventPlayers(ctx, ev); const team = (k) => ids.filter((_, i) => i % 2 === k).map((id) => `<div>${nmB(ctx.byId[id])} <span class="muted">${ctx.byId[id].pos}</span></div>`).join(''); return `<div class="mcdteams"><div><b>East</b>${team(0)}</div><div><b>West</b>${team(1)}</div></div>`; })() : ''}${ev.id === 'all-american' && ctx.state.gameToday === ev.id ? `${ctx.state.mcd?.year === ctx.state.year ? `<div class="note">${ctx.state.mcd.s[0] > ctx.state.mcd.s[1] ? 'East' : 'West'} won ${Math.max(...ctx.state.mcd.s)}-${Math.min(...ctx.state.mcd.s)}. MVP ${nmB(ctx.byId[ctx.state.mcd.mvp.pid])}: ${esc(ctx.state.mcd.mvp.line)}.</div>` : ''}<button class="btn primary wide" data-act="mcdwatch">${ctx.state.mcd?.year === ctx.state.year ? 'Watch it again' : 'Watch the game live'}</button>` : `<button class="btn wide" data-act="event" ${here && !ctx.state.gameToday ? '' : 'disabled'}>${ev.id === 'all-american' ? 'Scout and watch the game' : 'Scout the event'} · ${evCost} AP</button>`}</div>` : ''}
    ${segHtml('st', [['games', `Games (${games.length})`], ['players', `Players (${list.length})`]], tab, 'data-sttab')}
    ${tab === 'games' ? `${here ? '' : '<div class="note">Send your scout here to watch a game in person.</div>'}
    ${games.length ? games.map((g) => {
      const who = byShown(g.players.map((id) => ctx.byId[id]).sort((a, b) => a.rank - b.rank));
      const done = ctx.state.gameToday === g.id;
      const hc = hsColor(g.hid), ac = g.aid ? hsColor(g.aid) : '#78909c';
      return `<div class="game-row hsg"><div class="hsband"><span style="background:${ac}">${esc(g.away)}</span><span style="background:${hc}">${esc(g.home)}</span></div><div class="who">${who.map((r) => `<i style="background:${hsColor(r.hsTeam)}"></i>${SK() ? `${r.stars}★ ${esc(r.ln)} ${r.pos} (#${r.rank})` : `${esc(r.ln)} ${r.pos}`}`).join(' · ')}</div>
        <button class="btn wide" data-game="${g.id}" ${here && !ctx.state.gameToday ? '' : 'disabled'}>${done ? 'Attended' : `Scout in person · ${g.cost} AP`}</button></div>`;
    }).join('') : '<div class="note">No high school teams here.</div>'}` : `<div class="sortrow"><label for="stSort">Sort by</label><select id="stSort" data-stsort><option value="rank" ${ui.stSort !== 'team' ? 'selected' : ''}>Ranking</option><option value="team" ${ui.stSort === 'team' ? 'selected' : ''}>High school team</option></select></div>
    ${ui.stSort === 'team' ? byTeam(list) : `<div class="list">${byShown(list).slice(0, 80).map((r) => cardFor(r, { school: true })).join('')}</div>`}`}`;
}

function rateRow(key, range, cls = '') {
  if (!range) return `<div class="rate ${cls} unk"><div class="top"><span>${esc(SKILL_NAMES[key] || key)}</span>
    <span class="val q">?<small>/100</small></span></div><div class="track"></div></div>`;
  const [lo, hi] = range;
  const exact = lo === hi;
  return `<div class="rate ${cls}"><div class="top"><span>${esc(SKILL_NAMES[key] || key)}</span>
    <span class="val ${exact ? 'exact' : ''}">${exact ? lo : `${lo}-${hi}`}<small>/100</small></span></div>
    <div class="track"><div class="fill" style="width:${lo}%"></div>${exact ? '' : `<div class="unc" style="left:${lo}%;width:${Math.max(1, hi - lo)}%"></div>`}</div></div>`;
}

// Senior season averages: public, everyone sees them, scouting not needed.
function hsLine(r) {
  const mates = ctx.hsTeams[r.hsTeam].players.filter((id) => id !== r.id).map((id) => ctx.byId[id]).filter(Boolean);
  const h = hsStats(r, mates, ctx.state.day);
  const f = (k, v) => `<div class="fact"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  const pct = (v) => (v == null ? '-' : `${Math.round(v * 100)}%`);
  if (!h.gp) return '<div class="sec">Senior season</div><div class="note">His high school season tips off with yours.</div>';
  return `<div class="sec">Senior season · ${h.gp} of ${HS_GAMES} games${mates.length ? ` · shares the ball with ${mates.length} D1 recruit${mates.length > 1 ? 's' : ''}` : ''}</div>
    <div class="facts">${f('PPG', h.ppg.toFixed(1))}${f('RPG', h.rpg.toFixed(1))}${f('APG', h.apg.toFixed(1))}</div>
    <div class="note">${h.spg.toFixed(1)} STL · ${h.bpg.toFixed(1)} BLK · ${pct(h.fg)} FG · ${pct(h.tp)} 3P${h.tp != null ? ` on ${h.tpa.toFixed(1)} a game` : ''} · ${pct(h.ft)} FT</div>`;
}
function sheetRecruit() {
  const v = C.recruitView(ctx, ui.selRecruit);
  const { r, k } = v;
  const e = est(r);
  const c = C.actionCosts(ctx, r.id);
  const offered = v.offers.includes(ctx.state.schoolId);
  const burned = C.isBurned(ctx, r.id);
  const hsg = C.gameFor(ctx, r.id);
  const dis = v.committed ? 'disabled' : '';
  const maxV = Math.max(1, ...v.schools.map((s) => s.v));
  const level = (s, i) => (s.mine ? `${Math.round(s.v)} interest` : i === 0 ? 'Leader' : s.v > maxV * 0.75 ? 'Contender' : s.v > maxV * 0.4 ? 'In the mix' : 'Long shot');
  return `<div class="phead"><div class="face-box">${faceSvg(r, { jersey: hsColor(r.hsTeam) })}</div><div><h2>${nmB(r)}</h2>
    <div>${starsHtml(r)} <span class="muted">${rankTxt(r)} · ${r.pos} · ${fmtHeight(r.ht)} ${r.wt} lbs</span></div></div></div>
    <div class="note">${esc(ctx.hsTeams[r.hsTeam].name)}, ${esc(stName(r.state))} · ${k.seen ? esc(r.archetype.replace(/_/g, ' ')) : 'style unknown until seen in person'}</div>
    ${burned && !v.committed ? '<div class="note"><span class="tag lost">Burned: you pulled his offer</span></div>' : ''}
    ${v.committed ? `<div class="note"><span class="tag ${v.committedMine ? 'mine' : 'lost'}">${v.committedMine ? 'Signed with you' : 'Committed to ' + esc(v.committed)}</span></div>` : ''}
    <div class="facts"><div class="fact"><div class="k">OVR</div><div class="v">${e.ovr}</div></div><div class="fact"><div class="k">Potential</div><div class="v">${e.pot}</div></div><div class="fact"><div class="k">Interest</div><div class="v">${v.myInterest}</div></div></div>
    ${hsLine(r)}
    <div class="acts">
      <button class="btn" data-act="film" ${dis || (C.filmDone(ctx, r.id) ? 'disabled' : '')}>${C.filmDone(ctx, r.id) ? 'Film: all seen' : `Game film · ${c.film} AP`}</button>
      <button class="btn ${ui.pickExact ? 'on' : ''}" data-act="exactPick" ${dis}>Exact skill · ${c.exact} AP</button>
      <button class="btn" data-act="phone" ${dis || (ctx.state.phonedToday.includes(r.id) ? 'disabled' : '')}>Phone call · ${c.phone} AP</button>
      <button class="btn" data-act="visit" ${dis || (c.inState && !(ctx.state.visitedToday || []).includes(r.id) ? '' : 'disabled')}>${(ctx.state.visitedToday || []).includes(r.id) ? 'Visited today' : `Home visit · ${c.visit} AP`}</button>
      ${offered ? `<button class="btn span2" data-act="pull" ${dis}>Pull offer (he will never come)</button>` : burned ? `<button class="btn span2" disabled>Offer pulled · he's done with you</button>` : `<button class="btn primary span2" data-act="offer" ${dis}>Offer · ${c.offer} AP</button>`}
      ${hsg && c.inState ? `<button class="btn span2" data-hswatch="${hsg.id}" ${dis || (ctx.state.gameToday ? 'disabled' : '')}>${ctx.state.gameToday === hsg.id ? 'Attended his game' : `Watch his game in person · ${hsg.cost} AP`}</button>` : ''}
      ${c.inState ? '' : `<button class="btn span2" data-act="travelR">Send scout to ${esc(stName(r.state))} · ${c.travelTo(r.state)} AP</button>`}
    </div>
    ${ui.pickExact && !v.committed ? `<div class="sec">Pick a skill to learn exactly · ${c.exact} AP</div><div class="pick">${SKILLS.map((s) => { const ex = k.r[s] && k.r[s][0] === k.r[s][1]; return `<button class="btn" data-exact="${s}" ${ex ? 'disabled' : ''}>${esc(SKILL_NAMES[s])}${ex ? ` · ${k.r[s][0]}` : ''}</button>`; }).join('')}</div>` : ''}
    ${c.inState ? '' : '<div class="note">Home visits need your scout in his state.</div>'}
    <div class="sec">Ratings · film shows 2 random skills, a game in person shows potential, physicals unlock with OVR</div>
    ${SKILLS.map((s) => rateRow(s, k.r[s])).join('')}
    ${PHYS.map((s) => rateRow(s, k.r[s], 'phys')).join('')}
    ${rateRow('Potential', k.pot, 'pot')}
    <div class="sec">Personality · calls and visits reveal these · bar = how well ${esc(ctx.school.name)} fits him</div>
    ${TRAIT_KEYS.map((t) => {
      const kn = v.traits.find((x) => x.key === t);
      const f = kn ? C.traitFit(ctx, r, t) : null;
      const bar = f ? `<div class="tfit" title="${esc(f.why)}"><i style="width:${Math.max(6, Math.round(f.v * 100))}%;background:hsl(${Math.round(Math.max(0, Math.min(1, (f.v - 0.35) / 0.6)) * 120)},70%,45%)"></i></div><small class="tw">${esc(f.why)}</small>` : '';
      return `<div class="trait ${f ? 'has' : ''}"><span>${esc(TRAIT_LABELS[t])}</span><b class="${kn ? '' : 'q'}">${kn ? esc(kn.value) : '???'}</b>${bar}</div>`;
    }).join('')}
    <div class="sec">Offers</div>
    ${v.schools.length ? v.schools.map((s, i) => `<div class="offer"><div class="row1"><span>${esc(s.name)}${s.mine ? ' (you)' : ''}</span><b>${level(s, i)}</b></div><div class="ibar ${s.mine ? 'mine' : ''}"><i style="width:${Math.min(100, (s.v / maxV) * 100)}%"></i></div></div>`).join('') : '<div class="note">No offers yet.</div>'}`;
}

function sheetBoard() {
  const f = ui.board;
  let list = ctx.recruits;
  if (f.pos) list = list.filter((r) => r.pos === f.pos);
  list = byShown(list);
  if (f.stars && SK()) list = list.filter((r) => r.stars === Number(f.stars));
  if (f.status === 'open') list = list.filter((r) => !ctx.state.commits[r.id]);
  if (f.status === 'offered') list = list.filter((r) => (ctx.state.offers[r.id] || []).includes(ctx.state.schoolId));
  const scouted = f.status === 'scouted';
  if (scouted) list = list.filter((r) => ctx.state.knowledge[r.id]).map((r) => [r, C.scoutDepth(ctx, r.id).score]).sort((a, b) => b[1] - a[1] || a[0].rank - b[0].rank).map(([r]) => r);
  const chip = (key, val, label) => `<button data-f="${key}" data-v="${val}" class="${f[key] === val ? 'on' : ''}">${label}</button>`;
  return `<h2>Big Board</h2>
    <div class="filters">${chip('status', 'open', 'Uncommitted')}${chip('status', 'offered', 'My offers')}${chip('status', 'scouted', 'Scouted')}${chip('status', '', 'All')}</div>
    <div class="filters">${chip('pos', '', 'All pos')}${['PG', 'SG', 'SF', 'PF', 'C'].map((p) => chip('pos', p, p)).join('')}</div>
    ${SK() ? `<div class="filters">${chip('stars', '', 'All stars')}${['5', '4', '3', '2'].map((s) => chip('stars', s, s + '★')).join('')}</div>` : `<div class="note">Star ratings come out after day ${C.STAR_RELEASE_DAY}.</div>`}
    <div class="note" style="margin-bottom:8px">${list.length} recruits${list.length > 100 ? `, showing ${SK() ? 'top ' : ''}100` : ''}</div>
    ${scouted && !list.length ? '<div class="note">You have not scouted anyone yet.</div>' : ''}
    <div class="list">${list.slice(0, 100).map((r) => cardFor(r, { scout: scouted })).join('')}</div>`;
}

function sheetNeeds() {
  const roster = ctx.world.teams[ctx.state.schoolId].roster;
  const seniors = roster.filter((p) => p.cls === 'SR');
  const signed = C.commitsFor(ctx, ctx.state.schoolId).map((id) => ctx.byId[id]);
  const offered = C.userOffers(ctx).map((id) => ctx.byId[id]).filter((r) => !ctx.state.commits[r.id]);
  const count = (list) => Object.fromEntries(['PG', 'SG', 'SF', 'PF', 'C'].map((p) => [p, list.filter((x) => x.pos === p).length]));
  const stay = count(roster.filter((p) => p.cls !== 'SR')), inc = count(signed);
  return `<h2>Class Needs</h2>
    <div class="note">${ctx.slots} scholarships open (max 5 per class). Up to ${C.MAX_OFFERS} offers out at once. Walk-ons don't hold a scholarship and can be cut in the offseason.</div>
    <div class="facts"><div class="fact"><div class="k">Open</div><div class="v">${ctx.slots}</div></div><div class="fact"><div class="k">Signed</div><div class="v">${signed.length}</div></div><div class="fact"><div class="k">Offers out</div><div class="v">${offered.length}/${C.MAX_OFFERS}</div></div></div>
    <div class="sec">Leaving: graduating seniors</div>
    ${seniors.map((p) => `<div class="needs-row"><span>${nmB(p)}</span><b>${p.pos} · ${ovr(p)} OVR</b></div>`).join('') || '<div class="note">None</div>'}
    <div class="sec">Next year's depth by position (returning + signed)</div>
    ${['PG', 'SG', 'SF', 'PF', 'C'].map((p) => `<div class="needs-row"><span>${p}</span><b style="color:${stay[p] + inc[p] < 2 ? 'var(--red)' : 'inherit'}">${stay[p]} returning${inc[p] ? ` + ${inc[p]} signed` : ''}${stay[p] + inc[p] < 2 ? ' · need' : ''}</b></div>`).join('')}
    <div class="sec">Signed</div><div class="list">${signed.map((r) => cardFor(r)).join('') || '<div class="note">Nobody yet.</div>'}</div>
    <div class="sec">Offers out</div><div class="list">${offered.map((r) => cardFor(r)).join('') || '<div class="note">No open offers.</div>'}</div>`;
}

function sheetNews() {
  return `<h2>News</h2>${ctx.state.log.slice(0, 150).map((l) => `<div class="news ${l.kind}"><span class="d">Day ${l.day}</span>${esc(l.text)}</div>`).join('')}`;
}

function sheetEndDay() {
  const where = stName(ctx.state.scoutAt);
  const back = C.travelCost(ctx.state.scout, ctx.school.state, ctx.state.scoutAt);
  return `<h2>End day ${ctx.state.day}</h2><div class="note">Your scout is in ${esc(where)}. Tonight you play your game.</div>
    <div class="choice">
      <button class="btn primary" data-end="stay">Stay overnight in ${esc(where)}<small>Free. Start the day already here.</small></button>
      <button class="btn" data-end="home">Fly home<small>Free tonight. Going back costs ${back} AP.</small></button>
    </div>`;
}

function sheetDaySummary() {
  const s = ui.daySummary || { items: [] };
  const game = s.items.find((l) => l.kind === 'win' || l.kind === 'loss');
  const rest = s.items.filter((l) => l !== game && l.kind !== 'travel');
  return `<h2>Day ${s.day} recap</h2>
    ${game ? `<div class="news ${game.kind}" style="font-size:17px">${esc(game.text)}</div>` : ''}
    ${rest.length ? rest.slice(0, 12).map((l) => `<div class="news ${l.kind}">${esc(l.text)}</div>`).join('') : '<div class="note">Quiet day on the trail.</div>'}
    <button class="btn primary wide" data-close>Start day ${ctx.state.day}</button>`;
}

function sheetSummary() {
  const signed = C.commitsFor(ctx, ctx.state.schoolId).map((id) => ctx.byId[id]);
  const rec = standings(ctx.world, ctx.season)[ctx.state.schoolId];
  const walk = ctx.slots - signed.length;
  return `<h2>Signing day</h2><div class="note">Season finished ${rec.W}-${rec.L}. You signed ${signed.length} of ${ctx.slots}.</div>
    <div class="list" style="margin-top:12px">${signed.map((r) => cardFor(r)).join('')}</div>
    ${walk ? `<div class="note" style="margin-top:10px">${walk} empty spot${walk > 1 ? 's' : ''} will be filled by walk-ons.</div>` : ''}
    ${ctx.state.mm ? '<button class="btn primary wide" data-ceremony>Awards ceremony</button>' : '<button class="btn primary wide" data-advance>Start the offseason</button>'}`;
}

function sheetMenu() {
  return `<h2>Menu</h2><div class="note">Scout: ${esc(ctx.state.scout.name)} · accuracy ${ctx.state.scout.accuracy}, efficiency ${ctx.state.scout.efficiency}, charisma ${ctx.state.scout.charisma}, speed ${ctx.state.scout.speed}</div>
    <div class="note">Your game saves automatically on this device. Updates to the game never delete it. Export a copy now and then as a backup, or to move your career to another device.</div>
    <div class="two"><button class="btn" data-export>Export save</button><button class="btn" data-import>Import save</button></div>
    <button class="btn wide" data-new2>Start a new game</button>`;
}

function bindSheet(body) {
  const rid = ui.selRecruit;
  const on = (sel, fn) => body.querySelectorAll(sel).forEach((b) => (b.onclick = () => fn(b)));
  on('[data-open]', (b) => selectRecruit(b.dataset.open));
  on('[data-game]', (b) => act(C.attendGame(ctx, b.dataset.game)));
  on('[data-sttab]', (b) => { ui.stTab = b.dataset.v; ui.stTabFor = ui.sel; renderSheet(); });
  body.querySelectorAll('[data-stsort]').forEach((sel) => (sel.onchange = () => { ui.stSort = sel.value; renderSheet(); }));
  on('[data-hswatch]', (b) => act(C.attendGame(ctx, b.dataset.hswatch)));
  on('[data-end]', (b) => doEndDay(b.dataset.end));
  on('[data-close]', () => closeSheet());
  on('[data-export]', () => exportSave());
  on('[data-import]', () => $('importFile').click());
  on('[data-f]', (b) => { ui.board[b.dataset.f] = b.dataset.v; renderSheet(); });
  on('[data-new]', () => { store.remove(); location.reload(); });
  on('[data-advance]', () => openPreOff());
  on('[data-advgo]', () => advance());
  on('[data-tend]', (b) => {
    const cur = { ...(ctx.state.tactics.shotTend || {}) };
    const v = Math.max(-5, Math.min(5, (cur[b.dataset.id] || 0) + Number(b.dataset.tend)));
    if (v) cur[b.dataset.id] = v; else delete cur[b.dataset.id];
    const shotTend = Object.keys(cur).length ? cur : null;
    C.setTactics(ctx, { shotTend });
    if (live.gm && live.gm.userSide) live.gm.setTactics(live.gm.userSide, { shotTend });
    save(); render();
  });
  on('[data-pscout]', (b) => { const h = findPlayer(b.dataset.pscout); act(C.scoutPlayer(ctx, b.dataset.pscout, h ? fullName(h.p) : 'him')); });
  on('[data-solo]', (b) => act(C.trainSolo(ctx, ui.player, b.dataset.solo)));
  on('[data-stay]', (b) => act(C.convinceToStay(ctx, b.dataset.stay)));
  on('[data-letgo]', (b) => act(C.letGo(ctx, b.dataset.letgo)));
  on('[data-cut]', (b) => { ui.cutsTouched = true; const id = b.dataset.cut; ui.cuts = ui.cuts.includes(id) ? ui.cuts.filter((x) => x !== id) : [...ui.cuts, id]; render(); });
  on('[data-dplay]', () => { ui.draftPlaying = !ui.draftPlaying; if (ui.draftPlaying) draftStep(); else renderSheet(); draftTick(); });
  on('[data-dnext]', () => { ui.draftPlaying = false; clearTimeout(draftTimer); draftStep(); });
  on('[data-cbtab]', (b) => { ui.cbTab = b.dataset.v; renderSheet(); });
  on('[data-dskip]', () => { ui.draftPlaying = false; clearTimeout(draftTimer); ui.draftN = (ctx.state.nba || []).length; renderSheet(); });
  on('[data-ceremony]', () => openSheet('ceremony', 'full'));
  on('[data-endday]', () => onEndDay());
  on('[data-watchnow]', () => { ui.confirmAutoSim = false; closeSheet(); startLive(); });
  on('[data-box]', (b) => { ui.boxGi = Number(b.dataset.box); ui.boxRes = null; ui.boxSide = null; openSheet('box', 'full'); });
  on('[data-boxside]', (b) => { ui.boxSide = b.dataset.boxside; renderSheet(); });
  on('[data-goto]', (b) => { closeSheet(); setTab(b.dataset.goto); });
  on('[data-new2]', (b) => { b.textContent = 'Tap again to delete your save'; b.onclick = () => { store.remove(); location.reload(); }; });
  on('[data-exact]', (b) => { ui.pickExact = false; act(C.scoutExact(ctx, ui.selRecruit, b.dataset.exact)); });
  on('[data-act]', (b) => {
    const a = b.dataset.act;
    if (a === 'travel') { const res = C.travel(ctx, ui.sel); act(res); if (res.ok) { const [x, y] = posOf(ui.sel); animateTo(x, y, Math.max(view.k, 2.6)); } return; }
    if (a === 'travelR') { const st = ctx.byId[rid].state; const res = C.travel(ctx, st); act(res); return; }
    if (a === 'event') { const res = C.attendEvent(ctx); act(res); if (res.ok && C.eventToday(ctx)?.id === 'all-american') { closeSheet(); startLive(C.mcdGame(ctx), 'mcd'); } return; }
    if (a === 'mcdwatch') { closeSheet(); return startLive(C.mcdGame(ctx), 'mcd'); }
    if (a === 'film') return act(C.watchFilm(ctx, rid));
    if (a === 'exactPick') { ui.pickExact = !ui.pickExact; return render(); }
    if (a === 'phone') return act(C.phoneCall(ctx, rid));
    if (a === 'visit') return act(C.homeVisit(ctx, rid));
    if (a === 'offer') return act(C.makeOffer(ctx, rid));
    if (a === 'pull') {
      if (!b.dataset.armed) { b.dataset.armed = '1'; b.classList.add('danger'); b.textContent = 'Tap again: he will never come'; return; }
      return act(C.pullOffer(ctx, rid));
    }
  });
}

function render() {
  renderHUD();
  if (ui.tab === 'recruit') renderMap();
  if (ui.tab === 'today') renderToday();
  if (ui.tab === 'roster') renderRoster();
  if (ui.tab === 'train') renderTrain();
  if (ui.tab === 'season') renderSeason();
  $('tabDot').classList.toggle('hidden', ctx.state.log.length <= ui.lastSeenLog || ui.tab === 'recruit');
  if (ui.sheet !== 'closed') {
    const body = $('sheetBody'); const top = body.scrollTop;
    renderSheet();
    body.scrollTop = top;
  }
}

// =====================================================================
// Manager: Today, Roster, Season, live game, box scores, offseason
// =====================================================================
const TEMPO = [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']];
const DEF = [['man', 'Man'], ['zone', 'Zone'], ['press', 'Press']];
const FOCUS = [['inside', 'Inside'], ['balanced', 'Balanced'], ['perimeter', 'Outside']];
const DEPTH = [[7, '7'], [8, '8'], [9, '9'], [10, '10']];
const myTeam = () => ctx.world.teams[ctx.state.schoolId];
const recOf = (id) => standings(ctx.world, ctx.season)[id] || { W: 0, L: 0, cW: 0, cL: 0 };
const segHtml = (key, opts, cur, attr = 'data-tac') => `<div class="seg">${opts.map(([v, l]) => `<button ${attr}="${key}" data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;

function rotationOrder() {
  const roster = myTeam().roster;
  const ids = ctx.state.tactics.rotation;
  const order = ids ? ids.map((id) => roster.find((p) => p.id === id)).filter(Boolean) : pickStarters(roster);
  for (const p of roster) if (!order.includes(p)) order.push(p);
  return order;
}

function oppInfo(g) {
  const game = ctx.season.games[g.gi];
  const oppId = game.home === ctx.state.schoolId ? game.away : game.home;
  const t = ctx.world.teams[oppId] || ctx.world.fillers[oppId];
  return { t, rec: ctx.world.teams[oppId] ? recOf(oppId) : null };
}

function renderToday() {
  const st = ctx.state;
  const root = $('page-today');
  if (st.over && st.mm) return renderPost(root);
  if (st.over) {
    const h = st.history.at(-1);
    root.innerHTML = `<div class="panel"><div class="kick">${st.year}-${String(st.year + 1).slice(2)} season complete</div>
      <div class="final ${h.W >= h.L ? 'w' : 'l'}">${h.W}-${h.L}</div><div class="note" style="text-align:center">${h.cW}-${h.cL} in conference · signed ${h.signed} of ${h.slots}</div>
      <button class="btn primary wide" data-advance>Start the offseason</button></div>`;
    return bindPage(root);
  }
  const g = C.todaysGame(ctx);
  const { t: opp, rec: orec } = oppInfo(g);
  const me = recOf(st.schoolId);
  const tac = st.tactics;
  const played = st.gamePlayed;
  const res = played ? ctx.schedule[st.day - 1].result : null;
  const meCol = `<div class="me">${teamDot(ctx.school)}<div class="nm">${me.W}-${me.L}</div><div class="ovr">OVR <b>${teamOvr(myTeam().roster)}</b></div></div>`;
  const oppCol = `<div>${teamDot(opp.school)}<div class="nm">${orec ? `${orec.W}-${orec.L}` : 'Non-D1'}</div><div class="ovr">OVR <b>${teamOvr(opp.roster)}</b></div></div>`;
  const recent = ctx.schedule.slice(Math.max(0, st.day - 4), st.day - 1).reverse();
  root.innerHTML = `
    <div class="panel"><div class="kick">Day ${st.day} of ${C.DAYS} · Game ${st.day}${g.conf ? ' · Conference' : ''} · ${g.home ? 'Home' : 'Away'}</div>
      <div class="matchup">${g.home ? oppCol : meCol}<div class="vs">${g.home ? 'at' : 'at'}</div>${g.home ? meCol : oppCol}</div>
      <div class="note" style="text-align:center">${esc(opp.school.name)}</div>
      ${played ? `<div class="final ${res.startsWith('W') ? 'w' : 'l'}">${esc(res)}</div>
        <div class="two"><button class="btn" data-lastbox>Box score</button><button class="btn primary" data-endday>End Day</button></div>`
      : `<div class="two" style="margin-top:12px"><button class="btn primary" data-watch>Watch game</button><button class="btn" data-quick>Quick sim</button></div>`}
    </div>
    <div class="panel"><div class="kick" style="margin-bottom:6px">Coaching${played ? ' · applies to your next game' : ''}</div>
      <div class="seg-l">Tempo</div>${segHtml('tempo', TEMPO, tac.tempo)}
      <div class="seg-l">Defense</div>${segHtml('defense', DEF, tac.defense)}
      <div class="seg-l">Offensive focus</div>${segHtml('focus', FOCUS, tac.focus)}
      <div class="seg-l">Rotation depth</div>${segHtml('depth', DEPTH, tac.depth)}
      <button class="btn wide" data-goto="roster">Set starters and rotation</button>
    </div>
    <div class="panel"><div class="kick">Recruiting today</div>
      <div class="facts"><div class="fact"><div class="k">AP left</div><div class="v">${st.ap}</div></div><div class="fact"><div class="k">Scout in</div><div class="v" style="font-size:16px">${esc(st.scoutAt === 'INTL' ? 'Intl' : st.scoutAt)}</div></div><div class="fact"><div class="k">Signed</div><div class="v">${C.commitsFor(ctx, st.schoolId).length}/${ctx.slots}</div></div></div>
      ${C.eventToday(ctx) ? `<div class="note" style="color:var(--gold)">★ ${esc(C.eventToday(ctx).name)} today in ${esc(stName(C.eventToday(ctx).state))}</div>` : ''}
      <button class="btn wide" data-goto="recruit">Open the scouting map</button>
    </div>
    ${recent.length ? `<div class="panel"><div class="kick">Recent games</div>${recent.map((x) => resRow(x, st.day)).join('')}</div>` : ''}`;
  bindPage(root);
}

const dtag = (d) => d.status === 'stay' ? '<span class="tag mine">Coming back</span>' : d.status === 'back' ? '<span class="tag mine">Undrafted · back</span>' : d.status === 'drafted' ? `<span class="tag lost">Drafted #${d.pick}</span>` : '<span class="tag lost">Gone</span>';
// ---------- after the regular season: March Madness, decision day, NBA draft ----------
const seedName = (mm, sid) => `<span class="seed">${tourneySeed(mm, sid) ?? ''}</span> ${esc(ctx.world.teams[sid].school.name)}`;
function renderPost(root) {
  const st = ctx.state, mm = st.mm, h = st.history.at(-1) || { W: 0, L: 0, cW: 0, cL: 0 };
  const yr = `${st.year}-${String(st.year + 1).slice(2)}`;
  const me = mm.field.find((f) => f.sid === st.schoolId);
  let html = `<div class="panel"><div class="kick">${yr} regular season</div><div class="final ${h.W >= h.L ? 'w' : 'l'}">${h.W}-${h.L}</div>
    <div class="note" style="text-align:center">${h.cW}-${h.cL} in conference · ${me ? `<b>${me.seed} seed</b> in March Madness` : 'missed March Madness'} · signed ${h.signed} of ${h.slots}</div><button class="btn wide" data-ceremony>🏆 Awards ceremony</button></div>`;
  if (!mm.champ) {
    const idx = C.userMMGame(ctx);
    const g = idx != null ? mm.games[idx] : null;
    const rname = ROUND_NAMES[mm.round];
    if (g && !g.s) {
      const opp = ctx.world.teams[g.a === st.schoolId ? g.b : g.a];
      const col = (t, cls) => `<div class="${cls}">${teamDot(t.school)}<div class="nm">${tourneySeed(mm, t.school.id)} seed</div><div class="ovr">OVR <b>${teamOvr(t.roster)}</b></div></div>`;
      html += `<div class="panel mmpanel"><div class="kick">March Madness · ${rname}${g.reg >= 0 ? ` · ${MM_REGIONS[g.reg]}` : ''}</div>
        <div class="matchup">${col(myTeam(), 'me')}<div class="vs">vs</div>${col(opp, '')}</div>
        <div class="note" style="text-align:center">${esc(opp.school.name)} · neutral court · lose and you go home</div>
        <div class="two" style="margin-top:12px"><button class="btn primary" data-watch>Watch game</button><button class="btn" data-mmquick>Quick sim</button></div></div>`;
    } else {
      const alive = me && tourneyResult(mm, st.schoolId) === 'Still alive';
      const res = g ? (gameWinner(g) === st.schoolId ? `You won your ${rname} game.` : `You lost in the ${rname}.`) : alive ? `You're a ${me.seed} seed in the ${MM_REGIONS[me.region]}. Your first game is in the Round of 64.` : me ? tourneyResult(mm, st.schoolId) + '.' : 'You missed the field this year.';
      html += `<div class="panel mmpanel"><div class="kick">March Madness · ${rname}</div><div class="note">${esc(res)}</div>
        ${g ? `<button class="btn wide" data-mmbox="${idx}">Box score</button>` : ''}
        <div class="two" style="margin-top:10px"><button class="btn primary" data-mmround>${g && gameWinner(g) === st.schoolId ? 'Next round' : `Sim the ${rname}`}</button><button class="btn" data-mmall>Sim to the end</button></div></div>`;
    }
    html += `<button class="btn wide" data-bracket>View the bracket</button>`;
  } else {
    const champ = ctx.world.teams[mm.champ].school;
    html += `<div class="panel mmpanel"><div class="kick">March Madness</div><div class="champ">🏆 ${esc(champ.name)}</div><div class="note" style="text-align:center">National champions${me ? ` · you: ${esc(tourneyResult(mm, st.schoolId))}` : ''}</div>
      <button class="btn wide" data-bracket>View the bracket</button></div>`;
    if (!st.nba && !C.combineDone(ctx)) {
      html += `<div class="panel"><div class="kick">NBA Combine</div>
        <div class="note">The top 60 prospects in the draft pool get measured, run the athletic tests, shoot, and scrimmage. Projected lottery picks sit out the scrimmages. A big week moves a prospect up the board, and a bad one drops him. Your declared players will see where they now stand before decision day.</div>
        <button class="btn primary wide" data-combine>Run the NBA Combine</button></div>`;
    } else if (!st.nba) {
      html += combinePanel();
      const draft = C.draftFor(ctx);
      const pending = draft.some((d) => d.status === 'declared');
      const mini = (p) => `<span class="mface">${faceSvg(p, { size: 34, jersey: teamColor() })}</span>`;
      html += `<div class="panel"><div class="kick">Decision day</div>
        <div class="note">${draft.length ? 'These players declared for the NBA draft. You get one shot to talk each one into coming back.' : 'Nobody on your roster declared early. Your seniors are in the draft pool.'}</div>
        ${draft.map((d) => { const { p, status } = d; return `<div class="drow">${mini(p)}<div class="dn">${pname(p.id, `<b>${nmB(p)}</b>`)}<div class="muted">${p.pos} · ${p.cls} · ${ovr(p)} OVR</div></div>
          ${status === 'declared' ? `<div class="dbtn"><button class="btn primary" data-stay="${p.id}">Talk him out of it · ${Math.round(C.stayChance(ctx, p.id) * 100)}%</button><button class="btn" data-letgo="${p.id}">Let him go</button></div>`
          : dtag(d)}</div>`; }).join('')}
        ${pending ? '<div class="note" style="color:var(--red)">Decide on every declared player first.</div>' : ''}
        <button class="btn primary wide" data-draftgo ${pending ? 'disabled' : ''}>Start the NBA Draft</button></div>`;
    } else {
      const mine = st.nba.filter((x) => x.sid === st.schoolId);
      if (C.combineDone(ctx)) html += combinePanel();
      html += `<div class="panel"><div class="kick">NBA Draft</div><div class="note">#1 pick: <b>${esc(st.nba[0].name)}</b> (${esc(st.nba[0].school)}) to the ${esc(st.nba[0].team)}. ${mine.length ? `Your drafted players: ${mine.map((x) => `#${x.pick} ${esc(x.name)}`).join(', ')}.` : 'None of your players were drafted.'}</div>
        <button class="btn wide" data-draftshow>Watch the draft again</button>
        <button class="btn primary wide" data-advance>Start the offseason</button></div>`;
    }
  }
  root.innerHTML = html;
  bindPage(root);
}

function resRow(x, today) {
  const r = x.result;
  const gno = ctx.schedule.indexOf(x) + 1;
  return `<button class="res-row ${gno === today && !r ? 'today' : ''}" ${r ? `data-box="${x.gi}"` : ''}><span class="gno">${gno}</span><span class="opp">${x.home ? 'vs' : '@'} ${esc(x.opp)}${x.conf ? ' <span class="muted">·C</span>' : ''}</span>${r ? `<span class="${r[0] === 'W' ? 'w' : 'l'}">${esc(r)}</span>` : `<span class="muted">${gno === today ? 'Today' : ''}</span>`}</button>`;
}

function bindPage(root) {
  const on = (sel, fn) => root.querySelectorAll(sel).forEach((b) => (b.onclick = () => fn(b)));
  on('[data-tac]', (b) => { const k = b.dataset.tac; C.setTactics(ctx, k === 'depth' ? { depth: Number(b.dataset.v), minutes: null } : { [k]: b.dataset.v }); save(); render(); });
  on('[data-watch]', () => startLive());
  on('[data-quick]', () => { const gm = C.prepareUserGame(ctx); gm.sim(); C.finishUserGame(ctx, gm); save(); ui.boxGi = gm.gi; ui.boxRes = ctx.lastGame; ui.boxSide = null; openSheet('box', 'full'); render(); });
  on('[data-lastbox]', () => { ui.boxGi = C.todaysGame(ctx).gi; ui.boxRes = null; ui.boxSide = null; openSheet('box', 'full'); });
  on('[data-box]', (b) => { ui.boxGi = Number(b.dataset.box); ui.boxRes = null; ui.boxSide = null; openSheet('box', 'full'); });
  on('[data-endday]', () => onEndDay());
  on('[data-mmquick]', () => { const gm = C.prepareMMGame(ctx); gm.sim(); C.finishMMGame(ctx, gm); save(); ui.boxRes = ctx.lastGame; ui.boxSide = null; openSheet('box', 'full'); render(); });
  on('[data-mmround]', () => { const r = ctx.state.mm.round; act(C.simMMRound(ctx)); ui.mmR = null; if (ctx.state.mm.champ || r !== ctx.state.mm.round) openBracket(true); });
  on('[data-mmall]', () => { act(C.simMMAll(ctx)); ui.mmR = 6; openBracket(true); });
  on('[data-mmbox]', (b) => { ui.boxRes = mmBox(ctx, Number(b.dataset.mmbox)); ui.boxSide = null; if (ui.boxRes) openSheet('box', 'full'); });
  on('[data-bracket]', () => openBracket());
  on('[data-mmr]', (b) => { ui.mmR = Number(b.dataset.mmr); render(); });
  on('[data-stay]', (b) => act(C.convinceToStay(ctx, b.dataset.stay)));
  on('[data-letgo]', (b) => act(C.letGo(ctx, b.dataset.letgo)));
  on('[data-draftgo]', () => { const res = C.startDraft(ctx); if (!res.ok) return toast(res.msg, 'bad'); save(); ui.draftN = 0; ui.draftPlaying = false; openSheet('draft', 'full'); render(); });
  on('[data-draftshow]', () => { ui.draftN = 0; ui.draftPlaying = false; openSheet('draft', 'full'); });
  on('[data-combine]', () => { const r = C.nbaCombine(ctx); if (!r.ok) return toast(r.msg, 'bad'); save(); ui.cbTab = 'measure'; openSheet('combine', 'full'); render(); });
  on('[data-cbshow]', () => { ui.cbTab = ui.cbTab || 'measure'; openSheet('combine', 'full'); });
  on('[data-ceremony]', () => openSheet('ceremony', 'full'));
  on('[data-advance]', () => openPreOff());
  on('[data-tdrill]', (b) => { ui.teamDrill = b.dataset.tdrill; render(); });
  on('[data-teamtrain]', () => act(C.trainTeam(ctx, ui.teamDrill || 'shooting')));
  on('[data-tplayer]', (b) => { ui.player = b.dataset.tplayer; openSheet('train', 'full'); });
  on('[data-goto]', (b) => setTab(b.dataset.goto));
  on('[data-player]', (b) => openPlayerCard(b.dataset.player));
  on('[data-mv]', (b) => {
    const order = rotationOrder().map((p) => p.id);
    const i = order.indexOf(b.dataset.id), j = i + Number(b.dataset.mv);
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    C.setTactics(ctx, { rotation: order }); save(); render();
  });
  on('[data-autorot]', () => { C.setTactics(ctx, { rotation: null, minutes: null }); save(); render(); });
  on('[data-min]', (b) => {
    const order = rotationOrder();
    const plan = minutesPlan(order);
    plan[b.dataset.id] = Math.max(0, Math.min(40, (plan[b.dataset.id] || 0) + Number(b.dataset.min)));
    C.setTactics(ctx, { minutes: plan, rotation: order.map((p) => p.id) }); save(); render();
  });
  on('[data-sv]', (b) => { ui.seasonView = b.dataset.v; render(); });
  on('[data-ldmode]', (b) => { ui.ldMode = b.dataset.v; render(); });
  on('[data-ldcat]', (b) => { ui.ldCat = b.dataset.ldcat; render(); });
  on('[data-awyear]', (b) => { ui.awYear = b.dataset.awyear; render(); });
}

// Minutes plan: the coach's numbers if set, else the automatic plan from rotation depth.
function minutesPlan(order) {
  const m = ctx.state.tactics.minutes;
  if (m) return Object.fromEntries(order.map((p) => [p.id, m[p.id] || 0]));
  const t = TARGET_MIN[ctx.state.tactics.depth] || TARGET_MIN[8];
  return Object.fromEntries(order.map((p, i) => [p.id, t[i] || 0]));
}
const SLOTS = ['PG', 'SG', 'SF', 'PF', 'C'];
function renderRoster() {
  const root = $('page-roster');
  const order = rotationOrder();
  const plan = minutesPlan(order);
  const total = Object.values(plan).reduce((a, b) => a + b, 0);
  const stats = ctx.season.playerStats || {};
  const line = (p) => { const s = stats[p.id]; return s && s.GP ? `${(s.PTS / s.GP).toFixed(1)} pts · ${((s.ORB + s.DRB) / s.GP).toFixed(1)} reb · ${(s.MIN / s.GP).toFixed(0)} min` : 'No games yet'; };
  const row = (p, i) => `${i === 5 ? '<div class="divider">Bench</div>' : ''}
      <div class="prow ${plan[p.id] ? '' : 'dnp'}"><span class="slot ${i < 5 ? 'st' : ''}">${i < 5 ? SLOTS[i] : i + 1}</span>
        <button class="who" data-player="${p.id}"><b>${nmB(p)}${p.walkOn ? ' <span class="tag">Walk-on</span>' : ''}${tendTag(p)}</b><span><span class="ovr-badge ${oc(ovr(p))}">${ovr(p)}</span> ${p.pos}${i < 5 && p.pos !== SLOTS[i] ? ` <span class="oop">at ${SLOTS[i]}</span>` : ''} · ${p.cls} · ${line(p)}</span></button>
        <span class="mins"><button data-min="-1" data-id="${p.id}" aria-label="Fewer minutes" ${plan[p.id] <= 0 ? 'disabled' : ''}>−</button><b>${plan[p.id]}</b><button data-min="1" data-id="${p.id}" aria-label="More minutes" ${plan[p.id] >= 40 ? 'disabled' : ''}>+</button></span>
        <span class="mv"><button data-mv="-1" data-id="${p.id}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>▲</button><button data-mv="1" data-id="${p.id}" aria-label="Move down" ${i === order.length - 1 ? 'disabled' : ''}>▼</button></span></div>`;
  root.innerHTML = `<h2>${esc(ctx.school.name)} roster</h2>
    <div class="note" style="margin-bottom:8px">Team OVR ${teamOvr(myTeam().roster)} · ${myTeam().roster.length}/12 players. Arrows move a player into any slot, any position. Minutes are targets: fatigue, fouls and close games still shift them.</div>
    <div class="mintotal ${total === 200 ? '' : 'off'}">Planned minutes <b>${total}</b> / 200${total === 200 ? '' : ` · ${total > 200 ? 'over' : 'under'}: the game scales everyone to fit`}</div>
    <div class="panel" style="padding:4px 12px">${order.map(row).join('')}</div>
    ${ctx.state.tactics.rotation || ctx.state.tactics.minutes ? '<button class="btn wide" data-autorot>Reset to automatic lineup and minutes</button>' : ''}`;
  bindPage(root);
}

// ---------- training ----------
const ethicTag = (p) => { const e = p.traits?.workEthic ?? 50; const l = e >= 75 ? 'Elite' : e >= 55 ? 'High' : e >= 35 ? 'Average' : 'Low'; return `<span class="ethic ${e >= 55 ? 'hi' : e < 35 ? 'lo' : ''}">${l} work ethic</span>`; };
const KEY_NAME = (k) => SKILL_NAMES[k] || k;
function xpBar(p, k) {
  const xp = ctx.state.train?.[p.id]?.xp?.[k] || 0;
  return `<div class="xp" title="${xp}/100 XP"><i style="width:${Math.min(100, xp)}%"></i></div>`;
}
function renderTrain() {
  const root = $('page-train');
  const st = ctx.state;
  const drill = ui.teamDrill || 'shooting';
  const roster = rotationOrder();
  const drillBtns = (attr, cur) => `<div class="drills">${Object.entries(DRILLS).map(([id, d]) => `<button ${attr}="${id}" class="${id === cur ? 'on' : ''}">${d.label}</button>`).join('')}</div>`;
  root.innerHTML = `<h2>Training</h2>
    <div class="note">Uses the same AP as recruiting. 100 XP = +1 to a rating, up to the player's ceiling. Work ethic and youth earn XP faster.</div>
    ${st.over ? '<div class="panel"><div class="note">The season is over. Training opens again next season.</div></div>' : `
    <div class="panel"><div class="kick">Team practice · ${TRAIN_COST.team} AP · once a day</div>
      ${drillBtns('data-tdrill', drill)}
      <div class="note">Trains ${DRILLS[drill].keys.map(KEY_NAME).join(', ')} for all ${roster.length} players.</div>
      <button class="btn primary wide" data-teamtrain ${st.teamTrainedToday ? 'disabled' : ''}>${st.teamTrainedToday ? 'Team already practiced today' : `Run team practice · ${TRAIN_COST.team} AP`}</button></div>
    <div class="sec">Individual sessions · ${TRAIN_COST.solo} AP · one per player per day</div>
    <div class="panel" style="padding:4px 12px">${roster.map((p) => { const done = st.trainedToday.includes(p.id); return `<div class="drow"><span class="mface">${faceSvg(p, { size: 34, jersey: teamColor() })}</span>
      <div class="dn"><b>${nmB(p)}</b><div class="muted">${p.pos} · ${p.cls} · ${ovr(p)} OVR · ${xpMult(p).toFixed(2)}x XP</div></div>
      <button class="btn ${done ? '' : 'primary'}" data-tplayer="${p.id}">${done ? 'Done ✓' : 'Train'}</button></div>`; }).join('')}</div>`}`;
  bindPage(root);
}
function sheetTrain() {
  const p = myTeam().roster.find((x) => x.id === ui.player);
  if (!p) return '<div class="note">Player not found.</div>';
  const done = ctx.state.trainedToday.includes(p.id);
  const keys = Object.values(DRILLS).flatMap((d) => d.keys);
  const val = (k) => (PHYS.includes(k) ? p.phys[k] : p.skills[k]);
  return `<div class="phead"><div class="face-box">${faceSvg(p, { jersey: teamColor() })}</div><div><h2>${nmB(p)}</h2>
    <div class="muted">${p.pos} · ${p.cls} · ${ovr(p)} OVR</div><div style="margin-top:6px">${ethicTag(p)} <span class="muted">${xpMult(p).toFixed(2)}x XP</span></div></div></div>
    <div class="sec">${done ? 'Already trained today. Come back tomorrow.' : `Pick a drill · ${TRAIN_COST.solo} AP`}</div>
    <div class="drills">${Object.entries(DRILLS).map(([id, d]) => `<button data-solo="${id}" ${done || ctx.state.over ? 'disabled' : ''}>${d.label}</button>`).join('')}</div>
    <div class="sec">Ratings · purple bar is XP toward the next point</div>
    ${keys.map((k) => rateRow(k, [val(k).cur, val(k).cur], PHYS.includes(k) ? 'phys' : '').replace('<small>/100</small>', `<small>/100 (${val(k).cap})</small>`) + xpBar(p, k)).join('')}`;
}

function renderSeason() {
  const root = $('page-season');
  const v = ui.seasonView;
  let body = '';
  if (v === 'schedule') body = `<div class="panel" style="padding:4px 12px">${ctx.schedule.map((x) => resRow(x, ctx.state.over ? 0 : ctx.state.day)).join('')}</div>`;
  if (v === 'standings') {
    const conf = ctx.world.conferences.find((c) => c.id === ctx.school.conference);
    const rec = standings(ctx.world, ctx.season);
    const teams = Object.values(ctx.world.teams).filter((t) => t.school.conference === conf.id).map((t) => t.school)
      .sort((a, b) => (rec[b.id].cW - rec[b.id].cL) - (rec[a.id].cW - rec[a.id].cL) || (rec[b.id].W - rec[b.id].L) - (rec[a.id].W - rec[a.id].L));
    body = `<div class="panel"><div class="kick">${esc(conf.name)}</div><table class="stand"><tr><th>Team</th><th class="n">Conf</th><th class="n">Overall</th></tr>
      ${teams.map((s) => `<tr class="${s.id === ctx.state.schoolId ? 'me' : ''}"><td>${esc(s.name)}</td><td class="n">${rec[s.id].cW}-${rec[s.id].cL}</td><td class="n">${rec[s.id].W}-${rec[s.id].L}</td></tr>`).join('')}</table></div>`;
  }
  if (v === 'top25') {
    const pr = powerRatings(ctx.world, ctx.season);
    const rec = standings(ctx.world, ctx.season);
    const ids = Object.keys(pr).sort((a, b) => pr[b] - pr[a]);
    const mine = ids.indexOf(ctx.state.schoolId) + 1;
    body = `<div class="panel"><div class="kick">Power rating · you are #${mine}</div><table class="stand"><tr><th>#</th><th>Team</th><th class="n">Record</th><th class="n">Rating</th></tr>
      ${ids.slice(0, 25).map((id, i) => `<tr class="${id === ctx.state.schoolId ? 'me' : ''}"><td>${i + 1}</td><td>${esc(ctx.world.teams[id].school.name)}</td><td class="n">${rec[id].W}-${rec[id].L}</td><td class="n">${pr[id] >= 0 ? '+' : ''}${pr[id].toFixed(1)}</td></tr>`).join('')}</table></div>`;
  }
  if (v === 'leaders') {
    const mode = ui.ldMode || 'pg', cat = ui.ldCat || 'PTS';
    const rows = statRows(ctx.world, ctx.season);
    const pctCat = ['FGP', 'TPP', 'FTP'].includes(cat);
    const list = leaders(rows, cat, pctCat ? 'tot' : mode, 15);
    const fmt = (x) => (pctCat ? (x * 100).toFixed(1) + '%' : mode === 'pg' ? x.toFixed(1) : Math.round(x).toLocaleString());
    body = `${segHtml('ld', [['pg', 'Per game'], ['tot', 'Totals']], mode, 'data-ldmode')}
      <div class="filters">${LEADER_CATS.map(([k, l]) => `<button data-ldcat="${k}" class="${k === cat ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="panel">${list.length ? `<table class="stand lead"><tr><th>#</th><th>Player</th><th class="n">${pctCat ? '%' : mode === 'pg' ? 'Avg' : 'Total'}</th></tr>
      ${list.map(({ r, v: x }, i) => `<tr class="${r.sid === ctx.state.schoolId ? 'me' : ''}"><td>${i + 1}</td><td>${pname(r.pid, esc(r.p.fn[0] + '. ' + r.p.ln))} <span class="muted">${r.p.pos} · ${esc(r.school.abbr)}</span></td><td class="n"><b>${fmt(x)}</b></td></tr>`).join('')}</table>` : '<div class="note">No games played yet.</div>'}
      ${mode === 'pg' && !pctCat ? '<div class="note">Per-game leaders need half of the games played.</div>' : pctCat ? '<div class="note">Percentages need real volume (FG: 4 attempts a game, 3P and FT: 2).</div>' : ''}</div>`;
  }
  if (v === 'awards') {
    const past = ctx.state.history.filter((h) => h.awards && h.awards.length);
    const yr = ui.awYear ?? (ctx.state.over && past.length ? past[past.length - 1].year : 'now');
    const list = yr === 'now' ? computeAwards(ctx.world, ctx.season) : (past.find((h) => h.year === Number(yr)) || {}).awards || [];
    const who = (a) => (findPlayer(a.pid) ? pname(a.pid, esc(a.name)) : esc(a.name));
    const row = (a, label = a.award) => `<tr class="${a.sid === ctx.state.schoolId ? 'me' : ''}"><td><div class="aw-l">${esc(label)}</div>${who(a)} <span class="muted">${a.pos} · ${a.cls} · ${esc(a.school)}</span><div class="muted aw-s">${esc(a.line)}</div></td></tr>`;
    const grp = (g) => list.filter((a) => a.group === g);
    const team = (n) => list.filter((a) => a.award.startsWith(`All-America ${n}`));
    body = `<div class="filters">${yr === 'now' || !ctx.state.over ? `<button data-awyear="now" class="${yr === 'now' ? 'on' : ''}">${ctx.state.over ? 'This season' : 'Race so far'}</button>` : ''}${past.map((h) => `<button data-awyear="${h.year}" class="${String(h.year) === String(yr) ? 'on' : ''}">${h.year}-${String(h.year + 1).slice(2)}</button>`).join('')}</div>
      ${yr === 'now' && !ctx.state.over ? '<div class="note">Awards are handed out after the final game. This is who would win if the season ended today.</div>' : ''}
      ${list.length ? `<div class="panel"><div class="kick">National awards</div><table class="stand aw">${grp('major').map((a) => row(a)).join('')}</table></div>
      <div class="panel"><div class="kick">Best at each position</div><table class="stand aw">${grp('position').map((a) => row(a)).join('')}</table></div>
      ${['First', 'Second', 'Third'].map((n) => `<div class="panel"><div class="kick">All-America ${n} Team</div><table class="stand aw">${team(n).map((a) => row(a, '')).join('')}</table></div>`).join('')}
      <div class="panel"><div class="kick">Conference Players of the Year</div><table class="stand aw">${grp('conf').map((a) => row(a, a.conf || a.award)).join('')}</table></div>` : '<div class="note">Play some games first.</div>'}`;
  }
  if (v === 'mm' && ctx.state.mm) body = bracketHtml();
  if (v === 'history') {
    const h = ctx.state.history;
    body = `<div class="panel">${h.length ? `<table class="stand"><tr><th>Season</th><th class="n">Record</th><th class="n">Conf</th><th class="n">Class</th><th>March</th></tr>${h.map((x) => `<tr><td>${x.year}-${String(x.year + 1).slice(2)}</td><td class="n">${x.W}-${x.L}</td><td class="n">${x.cW}-${x.cL}</td><td class="n">${x.signed}/${x.slots}</td><td class="muted">${esc(x.mm ? x.mm.replace('Lost in the ', '').replace('National champion', '🏆 Champs') : '—')}</td></tr>`).join('')}</table>` : '<div class="note">Your first season is in progress.</div>'}</div>`;
  }
  root.innerHTML = `<h2>${ctx.state.year}-${String(ctx.state.year + 1).slice(2)} season</h2><div class="filters sv">${[['schedule', 'Schedule'], ['standings', 'Standings'], ['top25', 'Top 25'], ['leaders', 'Leaders'], ['awards', 'Awards']].concat(ctx.state.mm ? [['mm', 'March Madness']] : [], [['history', 'History']]).map(([k, l]) => `<button data-sv="${k}" data-v="${k}" class="${k === v ? 'on' : ''}">${l}</button>`).join('')}</div>${body}`;
  bindPage(root);
}

// ---------- box score ----------
function sheetBox() {
  const res = ui.boxRes || expandResult(ctx.world, ctx.season, ui.boxGi, ctx.state.userGames[ui.boxGi] || null);
  const mineSide = res.home.schoolId === ctx.state.schoolId ? 'home' : 'away';
  const sideKey = ui.boxSide || mineSide;
  const s = res[sideKey];
  const cols = [['MIN', (p) => p.MIN], ['PTS', (p) => p.PTS], ['REB', (p) => p.ORB + p.DRB], ['AST', (p) => p.AST], ['FG', (p) => `${p.FGM}-${p.FGA}`], ['3P', (p) => `${p.TPM}-${p.TPA}`], ['FT', (p) => `${p.FTM}-${p.FTA}`], ['STL', (p) => p.STL], ['BLK', (p) => p.BLK], ['TO', (p) => p.TO], ['PF', (p) => p.PF], ['+/-', (p) => (p.PM > 0 ? '+' : '') + p.PM]];
  const pct = (m, a) => (a ? Math.round((m / a) * 100) : 0);
  const t = { ...s.totals, MIN: Math.round(s.totals.SEC / 60) };
  return `<h2>${esc(res.away.abbr)} ${res.away.score}, ${esc(res.home.abbr)} ${res.home.score}${res.periods > 2 ? ` <span class="muted">(${res.periods === 3 ? 'OT' : res.periods - 2 + 'OT'})</span>` : ''}</h2>
    <div class="seg">${['away', 'home'].map((k) => `<button data-boxside="${k}" class="${k === sideKey ? 'on' : ''}">${esc(res[k].name)}</button>`).join('')}</div>
    <div class="note">FG ${pct(t.FGM, t.FGA)}% · 3P ${pct(t.TPM, t.TPA)}% · FT ${pct(t.FTM, t.FTA)}% · TO ${t.TO}</div>
    <div class="scroll" style="margin-top:8px"><table class="box"><tr><th>Player</th>${cols.map(([h]) => `<th>${h}</th>`).join('')}</tr>
    ${s.players.map((p) => `<tr><td>${pname(p.id, esc(p.name.replace(/^(\S)\S*\s/, '$1. ')))}${p.starter ? '*' : ''} <span class="muted">${p.pos}</span></td>${p.SEC ? cols.map(([, f]) => `<td>${f(p)}</td>`).join('') : `<td colspan="${cols.length}" style="text-align:left" class="muted">DNP</td>`}</tr>`).join('')}
    <tr class="tot"><td>Team</td>${cols.map(([h, f]) => `<td>${h === '+/-' ? '' : f(t)}</td>`).join('')}</tr></table></div>`;
}

// ---------- bracket ----------
function openBracket(stay) { ui.seasonView = 'mm'; if (!stay || ctx.state.mm.champ) setTab('season'); else render(); }
function bracketHtml() {
  const mm = ctx.state.mm, me = ctx.state.schoolId;
  const maxR = mm.champ ? 6 : mm.round;
  const r = Math.min(ui.mmR ?? maxR, maxR);
  const row = (g, i) => {
    const w = gameWinner(g);
    const side = (sid, sc) => `<div class="bt ${w === sid ? 'win' : w ? 'out' : ''} ${sid === me ? 'me' : ''}"><span>${seedName(mm, sid)}</span><b>${g.s ? sc : ''}</b></div>`;
    const box = mm.box[i] ? `data-mmbox="${i}"` : '';
    return `<button class="bgame" ${box}>${side(g.a, g.s?.[0])}${side(g.b, g.s?.[1])}${box ? '<div class="muted bx">Box score ›</div>' : ''}</button>`;
  };
  const games = mm.games.map((g, i) => [g, i]).filter(([g]) => g.r === r);
  const groups = r >= 5 ? [['', games]] : MM_REGIONS.map((n, k) => [n, games.filter(([g]) => g.reg === k)]).filter(([, l]) => l.length);
  return `<div class="filters">${ROUND_NAMES.slice(0, maxR + 1).map((n, k) => `<button data-mmr="${k}" class="${k === r ? 'on' : ''}">${n.replace('National Championship', 'Title').replace('Round of ', 'R')}</button>`).join('')}</div>
    ${mm.champ ? `<div class="champ">🏆 ${esc(ctx.world.teams[mm.champ].school.name)}</div>` : ''}
    ${groups.map(([n, l]) => `<div class="panel">${n ? `<div class="kick">${n}</div>` : `<div class="kick">${ROUND_NAMES[r]}</div>`}${l.map(([g, i]) => row(g, i)).join('')}</div>`).join('')}`;
}

// ---------- NBA draft show ----------
// Paused until you press Play; Play/Pause toggles a slow pick-by-pick reveal, Next pick shows one, Skip shows all.
let draftTimer = null;
function draftTick() {
  clearTimeout(draftTimer);
  if (!ui.draftPlaying || ui.sheetView !== 'draft' || ui.sheet === 'closed' || !ctx.state.nba) return;
  if ((ui.draftN || 0) >= ctx.state.nba.length) { ui.draftPlaying = false; return; }
  draftTimer = setTimeout(() => {
    if (!ui.draftPlaying || ui.sheetView !== 'draft' || ui.sheet === 'closed') return;
    draftStep();
    draftTick();
  }, 3500);
}
function draftStep() {
  ui.draftN = Math.min((ui.draftN || 0) + 1, ctx.state.nba.length);
  if (ui.draftN >= ctx.state.nba.length) ui.draftPlaying = false;
  renderSheet(); $('sheetBody').scrollTop = 0;
}
function seasonLine(pid) {
  const s = (ctx.season.playerStats || {})[pid];
  if (!s || !s.GP) return 'No stats';
  const g = s.GP, f = (v) => (v / g).toFixed(1);
  return `${f(s.PTS)} PPG · ${f(s.ORB + s.DRB)} RPG · ${f(s.AST)} APG · ${f(s.STL)} SPG · ${f(s.BLK)} BPG`;
}
function sheetDraft() {
  const picks = ctx.state.nba || [];
  const n = Math.min(ui.draftN || 0, picks.length);
  const shown = picks.slice(0, n).reverse();
  const me = ctx.state.schoolId;
  const latest = shown[0];
  const done = n >= picks.length;
  const card = (x) => `<div class="pick ${x.sid === me ? 'mine' : ''}"><span class="pno">${x.pick}</span><div class="dn"><b>${pname(x.pid, esc(x.name))}</b><div class="muted">${x.pos} · ${x.cls} · ${esc(x.school)} · ${x.ovr} OVR</div></div><span class="nba">${esc(x.team)}</span></div>`;
  let top = '';
  if (latest) {
    const hit = findPlayer(latest.pid);
    const face = hit ? faceSvg(hit.p, { jersey: hit.school.color || '#5b6b7d' }) : '';
    top = `<div class="onclock ${latest.sid === me ? 'mine' : ''}"><div class="kick">With the ${ordinal(latest.pick)} pick, the ${esc(latest.team)} select</div>
      <div class="dface">${face}</div><div class="big">${esc(latest.name)}</div>
      <div class="muted">${latest.pos} · ${latest.cls} · ${esc(latest.school)} · ${latest.ovr} OVR</div>
      <div class="dline">${seasonLine(latest.pid)}</div></div>`;
  } else top = `<div class="onclock"><div class="kick">${ctx.state.year + 1} NBA Draft</div><div class="big">The ${esc(picks[0]?.team || '')} are on the clock</div><div class="muted">Press Play to start, or reveal one pick at a time.</div></div>`;
  return `<h2>${ctx.state.year + 1} NBA Draft</h2>
    <div class="note">${done ? 'The draft is complete.' : latest ? `Round ${latest.pick > 30 ? 2 : 1} · pick ${n} of ${picks.length}` : 'Round 1 · pick 1'}</div>
    ${!done ? `<div class="three"><button class="btn ${ui.draftPlaying ? 'on' : 'primary'}" data-dplay>${ui.draftPlaying ? '⏸ Pause' : '▶ Play'}</button><button class="btn" data-dnext>Next pick</button><button class="btn" data-dskip>Skip ⏭</button></div>` : ''}
    ${top}
    <div class="list">${shown.map(card).join('')}</div>
    ${done ? '<button class="btn primary wide" data-close>Done</button>' : ''}`;
}

// ---------- NBA Combine ----------
const inches = (x) => { const ft = Math.floor(x / 12), i = x - ft * 12; return `${ft}'${Number.isInteger(i) ? i : i.toFixed(2).replace(/0$/, '')}"`; };
function combineRows() {
  const res = ctx.state.combine?.res || {};
  return Object.entries(res).map(([pid, r]) => ({ pid, r, hit: findPlayer(pid) })).filter((x) => x.hit);
}
const mvTag = (r) => { const d = r.pre - r.post; return d ? `<span class="mv ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'}${Math.abs(d)}</span>` : '<span class="mv">=</span>'; };
function combinePanel() {
  const rows = combineRows(), me = ctx.state.schoolId;
  const mine = rows.filter((x) => x.r.sid === me);
  const mv = (x) => x.r.pre - x.r.post;
  const riser = rows.slice().sort((a, b) => mv(b) - mv(a))[0];
  const line = (x) => `${pname(x.pid, `<b>${esc(fullName(x.hit.p))}</b>`)} ${mvTag(x.r)}`;
  return `<div class="panel"><div class="kick">NBA Combine</div>
    <div class="note">${mine.length ? `Your invitees: ${mine.map(line).join(', ')}.` : 'None of your players were invited.'}${riser ? ` Biggest riser: ${line(riser)}.` : ''}</div>
    <button class="btn wide" data-cbshow>Combine results</button></div>`;
}
const CB_TABS = [['measure', 'Size'], ['ath', 'Athletic'], ['shoot', 'Shooting'], ['scrim', 'Scrims'], ['move', 'Movers']];
function sheetCombine() {
  const tab = ui.cbTab || 'measure', me = ctx.state.schoolId;
  let rows = combineRows();
  const name = (x) => `<td>${pname(x.pid, `<b>${esc(x.hit.p.ln)}</b>`)} <span class="muted">${x.hit.p.pos}</span></td>`;
  const sign = (d) => (d >= 0 ? '+' : '−') + String(Math.abs(d)).replace(/^0\./, '.');
  const cols = {
    measure: [['Height', (r) => inches(r.ht)], ['Wingspan', (r) => inches(r.wing)], ['Wing +/-', (r) => sign(r.wing - r.ht)], ['Reach', (r) => inches(r.reach)], ['Weight', (r) => r.wt]],
    ath: [['Max vert', (r) => `${r.vert}"`], ['Lane agility', (r) => r.lane.toFixed(2)], ['3/4 sprint', (r) => r.sprint.toFixed(2)], ['Bench 185', (r) => r.bench]],
    shoot: [['Spot-up 3s', (r) => `${r.three}/25`], ['Off dribble', (r) => `${r.drib}/15`]],
    scrim: [['MIN', (r) => r.scrim.MIN], ['PTS', (r) => r.scrim.PTS], ['REB', (r) => r.scrim.REB], ['AST', (r) => r.scrim.AST], ['STL', (r) => r.scrim.STL], ['BLK', (r) => r.scrim.BLK], ['FG', (r) => `${r.scrim.FGM}-${r.scrim.FGA}`]],
    move: [['Before', (r) => `#${r.pre}`], ['After', (r) => `#${r.post}`], ['Move', (r) => mvTag(r)]],
  }[tab];
  const sorters = { measure: (a, b) => (b.r.wing - b.r.ht) - (a.r.wing - a.r.ht), ath: (a, b) => b.r.vert - a.r.vert, shoot: (a, b) => (b.r.three / 25 + b.r.drib / 15) - (a.r.three / 25 + a.r.drib / 15), scrim: (a, b) => b.r.scrim.PTS - a.r.scrim.PTS, move: (a, b) => (b.r.pre - b.r.post) - (a.r.pre - a.r.post) };
  if (tab === 'scrim') rows = rows.filter((x) => x.r.scrim);
  rows.sort(sorters[tab]);
  const games = (ctx.state.combine?.games || []).map((g) => `Team ${g.a} ${g.s[0]}, Team ${g.b} ${g.s[1]}`).join(' · ');
  const notes = { measure: 'Barefoot height. Sorted by wingspan minus height, the length scouts circle.', ath: 'Sorted by max vertical. Lower times are better in lane agility and the sprint.', shoot: 'Sorted by makes: 25 catch-and-shoot threes and 15 pull-ups off the dribble.', scrim: `Projected lottery picks sat out. ${games}`, move: 'Draft board rank among the 60 invitees, before and after the combine.' };
  return `<h2>${ctx.state.year + 1} NBA Combine</h2>
    ${segHtml('cb', CB_TABS, tab, 'data-cbtab')}
    <div class="note">${notes[tab]}</div>
    <div class="scroll"><table class="box cbox"><tr><th>Player</th>${cols.map(([h]) => `<th>${h}</th>`).join('')}</tr>
    ${rows.map((x) => `<tr class="${x.r.sid === me ? 'mine' : ''}">${name(x)}${cols.map(([, f]) => `<td>${f(x.r)}</td>`).join('')}</tr>`).join('')}</table></div>
    <button class="btn primary wide" data-close style="margin-top:12px">Done</button>`;
}

// ---------- awards ceremony ----------
const MAIN_AWARDS = ['National Player of the Year', 'Defensive Player of the Year', 'Freshman of the Year', 'Bob Cousy Award', 'Jerry West Award', 'Julius Erving Award', 'Karl Malone Award', 'Kareem Abdul-Jabbar Award'];
function sheetCeremony() {
  const h = ctx.state.history.at(-1);
  const aw = (h && h.awards) || [];
  const me = ctx.state.schoolId;
  const step = (a) => {
    if (!a) return '<div class="pod empty"></div>';
    const hit = findPlayer(a.pid);
    const face = hit ? faceSvg(hit.p, { jersey: hit.school.color || '#5b6b7d' }) : '';
    return `<div class="pod p${a.place} ${a.sid === me ? 'mine' : ''}"><div class="pface">${face}</div><div class="pn">${pname(a.pid, esc(a.name))}</div><div class="muted ps">${esc(a.school)}</div>
      <div class="block">${a.place === 1 ? '🏆' : a.place}</div></div>`;
  };
  const awards = MAIN_AWARDS.map((name) => {
    const list = aw.filter((a) => a.award === name && a.place);
    if (!list.length) return '';
    const at = (k) => list.find((a) => a.place === k);
    const w = at(1);
    return `<div class="panel cere"><div class="kick">${esc(name)}</div><div class="podium">${step(at(2))}${step(at(1))}${step(at(3))}</div>
      <div class="note" style="text-align:center"><b>${esc(w.name)}</b> · ${w.pos} · ${w.cls} · ${esc(w.line)}</div></div>`;
  }).join('');
  return `<h2>${ctx.state.year}-${String(ctx.state.year + 1).slice(2)} Awards Ceremony</h2>
    ${awards || '<div class="note">No awards this year.</div>'}
    ${ctx.state.mm && !ctx.state.mm.champ ? '<button class="btn primary wide" data-goto="today">On to March Madness</button>' : '<button class="btn primary wide" data-close>Done</button>'}`;
}

const ordinal = (k) => k + (['th', 'st', 'nd', 'rd'][(k % 100 > 10 && k % 100 < 14) ? 0 : k % 10] || 'th');

// ---------- player card ----------
function findPlayer(pid) {
  for (const [sid, t] of Object.entries(ctx.world.teams)) { const p = t.roster.find((x) => x.id === pid); if (p) return { p, sid, school: t.school }; }
  return null;
}
function sheetPlayer() {
  const hit = findPlayer(ui.player);
  if (!hit) return '<div class="note">Player not found.</div>';
  const { p, sid, school } = hit;
  const mine = sid === ctx.state.schoolId;
  const s = (ctx.season.playerStats || {})[p.id];
  const g = s && s.GP ? s.GP : 0;
  const per = (v) => (g ? (v / g).toFixed(1) : '0.0');
  const jersey = mine ? teamColor() : school.color || '#5b6b7d';
  const full = !mine && C.fullScouted(ctx, p.id);
  const known = mine || full || C.potScouted(ctx, p.id);
  const head = `<div class="phead"><div class="face-box">${faceSvg(p, { jersey })}</div><div><h2>${nmB(p)}</h2>
    <div class="muted">${mine ? '' : `${esc(school.name)} · `}#${p.num ?? ''} · ${p.pos} · ${p.cls}</div></div></div>
    <div class="muted">${fmtHeight(p.ht)} ${p.wt} lbs${mine ? ` · ${esc(p.archetype.replace(/_/g, ' '))}` : ''} · from ${esc(stName(p.home) || p.home)}${p.walkOn ? ' · walk-on' : ''}</div>
    <div class="facts"><div class="fact"><div class="k">OVR</div><div class="v ${oc(ovr(p))}">${ovr(p)}</div></div><div class="fact"><div class="k">Ceiling</div><div class="v ${known ? oc(ovr(p, 'cap')) : ''}">${known ? ovr(p, 'cap') : '?'}</div></div><div class="fact"><div class="k">Potential</div><div class="v">${known ? p.grade : '?'}</div></div></div>
    <div class="sec">Season averages</div>
    <div class="facts"><div class="fact"><div class="k">PPG</div><div class="v">${per(s?.PTS || 0)}</div></div><div class="fact"><div class="k">RPG</div><div class="v">${per((s?.ORB || 0) + (s?.DRB || 0))}</div></div><div class="fact"><div class="k">APG</div><div class="v">${per(s?.AST || 0)}</div></div></div>
    <div class="facts"><div class="fact"><div class="k">SPG</div><div class="v">${per(s?.STL || 0)}</div></div><div class="fact"><div class="k">BPG</div><div class="v">${per(s?.BLK || 0)}</div></div><div class="fact"><div class="k">MPG</div><div class="v">${per(s?.MIN || 0)}</div></div></div>
    <div class="note">${g} games · ${s && s.FGA ? Math.round((s.FGM / s.FGA) * 100) : 0}% FG · ${s && s.TPA ? Math.round((s.TPM / s.TPA) * 100) : 0}% 3P · ${s && s.FTA ? Math.round((s.FTM / s.FTA) * 100) : 0}% FT</div>
    ${careerTable(p.id)}`;
  if (!mine && !full) return head + `<button class="btn primary wide" data-pscout="${p.id}" style="margin-top:12px" ${ctx.state.ap < C.PLAYER_SCOUT_COST ? 'disabled' : ''}>Scout him · ${C.PLAYER_SCOUT_COST} AP</button>
    <div class="note">${known ? 'You scouted him as a recruit, so you know his ceiling.' : 'Ceiling and potential stay hidden until you scout him.'} Scouting reveals his ceiling, potential and every skill rating.</div>`;
  if (!mine) return head + `<div class="sec">Scouting report · current / 100 (ceiling in brackets)</div>
    ${SKILLS.map((k) => rateRow(k, [p.skills[k].cur, p.skills[k].cur]).replace('<small>/100</small>', `<small>/100 (${p.skills[k].cap})</small>`)).join('')}
    ${PHYS.map((k) => rateRow(k, [p.phys[k].cur, p.phys[k].cur], 'phys').replace('<small>/100</small>', `<small>/100 (${p.phys[k].cap})</small>`)).join('')}`;
  const tv = ctx.state.tactics.shotTend?.[p.id] || 0;
  const tend = `<div class="sec">Shot tendency</div>
    <div class="tendrow"><button data-tend="-1" data-id="${p.id}" aria-label="Shoot less" ${tv <= -5 ? 'disabled' : ''}>−</button><b class="${tv > 0 ? 'up' : tv < 0 ? 'down' : ''}">${tv > 0 ? '+' : ''}${tv}</b><button data-tend="1" data-id="${p.id}" aria-label="Shoot more" ${tv >= 5 ? 'disabled' : ''}>+</button><span>${TEND_LABEL(tv)}</span></div>
    <div class="note">0 lets the game decide from his ratings. +5 makes him the main scorer, around 20 shots a game as a starter. −5 means he almost never looks for his shot.</div>`;
  return head + tend + `<div class="sec">Ratings · current / 100 (ceiling in brackets)</div>
    <div style="margin-top:8px">${ethicTag(p)} <span class="muted">${xpMult(p).toFixed(2)}x training XP</span></div>
    ${SKILLS.map((k) => rateRow(k, [p.skills[k].cur, p.skills[k].cur]).replace('<small>/100</small>', `<small>/100 (${p.skills[k].cap})</small>`) + xpBar(p, k)).join('')}
    ${PHYS.map((k) => rateRow(k, [p.phys[k].cur, p.phys[k].cur], 'phys').replace('<small>/100</small>', `<small>/100 (${p.phys[k].cap})</small>`) + xpBar(p, k)).join('')}`;
}
const TEND_LABEL = (v) => v >= 5 ? 'Go-to scorer' : v >= 3 ? 'Looks for his shot' : v >= 1 ? 'Slightly aggressive' : v === 0 ? 'Auto' : v >= -2 ? 'Slightly passive' : v >= -4 ? 'Passer first' : 'Never shoots';
const tendTag = (p) => { const v = ctx.state.tactics.shotTend?.[p.id] || 0; return v ? ` <span class="tend ${v > 0 ? 'up' : 'down'}">Shots ${v > 0 ? '+' : ''}${v}</span>` : ''; };
// Career: HS senior year, every college season (per game), and a career line.
function careerTable(pid) {
  const rows = C.careerFor(ctx, pid);
  if (!rows.length) return '';
  const pct = (m, a) => (a ? `${Math.round((m / a) * 100)}` : '-');
  const pg = (v, n) => (n ? (v / n).toFixed(1) : '-');
  const head = '<tr><th>Season</th><th>GP</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>FG%</th><th>3P%</th><th>FT%</th></tr>';
  const yr = (y) => `${y}-${String(y + 1).slice(2)}`;
  const col = (r) => r.filter((x) => x[0] !== C.CAREER_HS);
  let body = '';
  for (const r of rows) {
    if (r[0] === C.CAREER_HS) {
      const t = (v) => (v / 10).toFixed(1);
      body += `<tr class="hs"><td>HS senior</td><td>${r[1]}</td><td>-</td><td>${t(r[2])}</td><td>${t(r[3])}</td><td>${t(r[4])}</td><td>${t(r[5])}</td><td>${t(r[6])}</td><td>${r[7]}</td><td>${r[8] < 0 ? '-' : r[8]}</td><td>${r[9]}</td></tr>`;
      continue;
    }
    const [y, GP, MIN, PTS, REB, AST, STL, BLK, FGM, FGA, TPM, TPA, FTM, FTA, mine, live] = r;
    body += `<tr class="${mine ? 'mine' : ''}"><td>${yr(y)}${live ? ' <small>now</small>' : ''}</td><td>${GP}</td><td>${pg(MIN, GP)}</td><td><b>${pg(PTS, GP)}</b></td><td>${pg(REB, GP)}</td><td>${pg(AST, GP)}</td><td>${pg(STL, GP)}</td><td>${pg(BLK, GP)}</td><td>${pct(FGM, FGA)}</td><td>${pct(TPM, TPA)}</td><td>${pct(FTM, FTA)}</td></tr>`;
  }
  const cr = col(rows);
  if (cr.length > 1) {
    const sum = (i) => cr.reduce((a, r) => a + r[i], 0);
    const GP = sum(1);
    body += `<tr class="tot"><td>Career</td><td>${GP}</td><td>${pg(sum(2), GP)}</td><td>${pg(sum(3), GP)}</td><td>${pg(sum(4), GP)}</td><td>${pg(sum(5), GP)}</td><td>${pg(sum(6), GP)}</td><td>${pg(sum(7), GP)}</td><td>${pct(sum(8), sum(9))}</td><td>${pct(sum(10), sum(11))}</td><td>${pct(sum(12), sum(13))}</td></tr>`;
  }
  return `<div class="sec">Career · per game</div><div class="scroll"><table class="box career">${head}${body}</table></div>`;
}
// Any player name anywhere: tap to open his card.
const pname = (pid, label) => `<button class="pname" data-pcard="${pid}">${label}</button>`;
function openPlayerCard(pid) {
  ui.player = pid;
  document.body.classList.toggle('sheet-over-live', !$('live').classList.contains('hidden'));
  openSheet('player', 'full');
}

// ---------- live game ----------
const live = { gm: null, speed: 1, timer: null, done: false, view: 'pbp', hot: {}, faces: {}, pick: null };
function startLive(gmIn = null, kind = 'game') {
  const gm = gmIn || (ctx.state.over ? C.prepareMMGame(ctx) : C.prepareUserGame(ctx));
  Object.assign(live, { gm, kind, speed: 1, done: false, view: 'pbp', hot: {}, faces: {}, pick: null });
  gm.interactive = true;
  $('live').classList.remove('hidden');
  $('feed').innerHTML = '';
  renderLive();
  tickLive();
}
// scorers flash in the live box score for a couple of seconds
function markHot(evs) {
  const now = Date.now();
  for (const e of evs) if ((e.type === 'score' || e.type === 'ft') && e.pid) live.hot[e.pid] = now;
}
function renderLiveBox() {
  if (live.view !== 'box') return;
  const gm = live.gm;
  const now = Date.now();
  const cols = [['PTS', (l) => l.PTS], ['REB', (l) => l.ORB + l.DRB], ['AST', (l) => l.AST], ['FG', (l) => `${l.FGM}-${l.FGA}`], ['3P', (l) => `${l.TPM}-${l.TPA}`], ['FT', (l) => `${l.FTM}-${l.FTA}`], ['MIN', (l) => Math.round(l.SEC / 60)], ['PF', (l) => l.PF]];
  const sideHtml = (key) => {
    const sd = gm.sides[key];
    const tot = sd.players.reduce((t, ps) => { for (const k in ps.line) t[k] = (t[k] || 0) + ps.line[k]; return t; }, {});
    const rows = sd.order.map((ps) => {
      const hot = live.hot[ps.p.id] && now - live.hot[ps.p.id] < 2500;
      return `<tr class="${ps.on ? 'on' : ''} ${hot ? 'hot' : ''}"><td>${pname(ps.p.id, esc(ps.p.ln))} <span class="muted">${ps.p.pos}</span></td>${cols.map(([, f]) => `<td>${f(ps.line)}</td>`).join('')}</tr>`;
    }).join('');
    return `<div class="lbox-team ${key === gm.userSide ? 'me' : ''}">${esc(sd.team.school.name)} ${sd.score}</div>
      <div class="scroll"><table class="box live-box"><tr><th>Player</th>${cols.map(([h]) => `<th>${h}</th>`).join('')}</tr>${rows}
      <tr class="tot"><td>Team</td>${cols.map(([h, f]) => `<td>${h === 'MIN' ? '' : f(tot)}</td>`).join('')}</tr></table></div>`;
  };
  const other = gm.userSide === 'home' ? 'away' : 'home';
  const el = $('lbox');
  // Patch cells in place so a sideways scroll (or a finger mid-drag) is never reset by a basket.
  const sig = [gm.userSide, other].map((k) => gm.sides[k].order.map((ps) => ps.p.id).join(',')).join('|');
  if (el.dataset.sig === sig && el.firstChild) {
    const fresh = document.createElement('div');
    fresh.innerHTML = sideHtml(gm.userSide) + sideHtml(other);
    const oldRows = el.querySelectorAll('tr'), newRows = fresh.querySelectorAll('tr');
    newRows.forEach((nr, i) => {
      const or = oldRows[i]; if (!or) return;
      if (or.className !== nr.className) or.className = nr.className;
      for (let j = 0; j < nr.children.length; j++) if (or.children[j] && or.children[j].innerHTML !== nr.children[j].innerHTML) or.children[j].innerHTML = nr.children[j].innerHTML;
    });
    const oldT = el.querySelectorAll('.lbox-team'), newT = fresh.querySelectorAll('.lbox-team');
    newT.forEach((t, i) => { if (oldT[i] && oldT[i].textContent !== t.textContent) oldT[i].textContent = t.textContent; });
    return;
  }
  const lefts = [...el.querySelectorAll('.scroll')].map((d) => d.scrollLeft); const top = el.scrollTop;
  el.innerHTML = sideHtml(gm.userSide) + sideHtml(other);
  el.dataset.sig = sig;
  el.querySelectorAll('.scroll').forEach((d, i) => { d.scrollLeft = lefts[i] || 0; });
  el.scrollTop = top;
}
function tickLive() {
  clearTimeout(live.timer);
  const gm = live.gm;
  if (gm.done) return finishLive();
  if (gm.waiting) return renderCrit();
  if (live.speed === 0) return; // paused
  const evs = gm.step();
  if (gm.waiting) { addFeed(evs); renderScore(); renderLiveBox(); return renderCrit(); }
  markHot(evs);
  addFeed(evs);
  renderScore();
  renderLiveBox();
  live.timer = setTimeout(tickLive, live.speed === 16 ? 25 : 1100 / live.speed);
}
function addFeed(evs) {
  const gm = live.gm;
  const abbr = { home: gm.sides.home.team.school.abbr, away: gm.sides.away.team.school.abbr };
  const html = evs.map((e) => `<div class="ev ${e.type} ${e.team === gm.userSide && !gm.exhibition ? 'me' : ''}"><span class="c">${Math.floor(e.clock / 60)}:${String(e.clock % 60).padStart(2, '0')}<span class="tm">${esc(abbr[e.team] || '')}</span></span>${e.pid ? liveFace(e.team, e.pid, 30) : '<span></span>'}<span class="x">${esc(e.text)}${e.note ? ` <b class="nt">${esc(e.note)}</b>` : ''}</span></div>`).reverse().join('');
  $('feed').insertAdjacentHTML('afterbegin', html);
  const feed = $('feed');
  while (feed.children.length > 250) feed.lastChild.remove();
}
// Pixel face of a player in the live game, cached per size.
function liveFace(sideKey, pid, size) {
  const key = `${pid}:${size}`;
  if (live.faces[key]) return live.faces[key];
  const gm = live.gm;
  const sd = gm.sides[sideKey];
  const ps = sd && sd.players.find((x) => x.p.id === pid);
  if (!ps) return '<span></span>';
  const jersey = sideKey === gm.userSide && !gm.exhibition ? teamColor() : sd.team.school.color || '#5b6b7d';
  return (live.faces[key] = `<span class="lface">${faceSvg(ps.p, { size, jersey })}</span>`);
}
// Critical moment: the clock is low and the game is close. Pick the shooter, then the shot.
// k = the card skill shown on the button (the engine's own numbers sit on an older, 8-higher scale)
const SHOTS = [['three', 'Three', 'TPT'], ['mid', 'Midrange', 'MID'], ['rim', 'Drive', 'LAY'], ['post', 'Post up', 'INS']];
function renderCrit() {
  const gm = live.gm, el = $('crit');
  if (!gm.waiting) { el.classList.add('hidden'); return; }
  clearTimeout(live.timer);
  const me = gm.sides[gm.userSide], them = gm.sides[gm.userSide === 'home' ? 'away' : 'home'];
  const d = me.score - them.score;
  const clock = `${Math.floor(gm.clock / 60)}:${String(Math.round(gm.clock % 60)).padStart(2, '0')}`;
  const sit = d === 0 ? 'Tied' : d > 0 ? `Up ${d}` : `Down ${-d}`;
  const pick = live.pick && me.onCourt.find((ps) => ps.p.id === live.pick);
  const card = (ps) => `<button class="cpl ${pick === ps ? 'sel' : ''}" data-cpick="${ps.p.id}">${liveFace(gm.userSide, ps.p.id, 44)}<b>${esc(ps.p.ln)}</b><small>${ps.p.pos} · ${ps.line.PTS} pts · ${ps.line.FGM}-${ps.line.FGA}</small></button>`;
  el.innerHTML = `<div class="crit-head"><b>Critical moment</b> <span>${sit} · ${clock} left · your ball</span></div>
    <div class="note">${pick ? `Pick ${esc(pick.p.ln)}'s shot. Numbers are his card ratings (Drive uses his better of layup and dunk).` : 'Who takes the shot?'}</div>
    <div class="cpls">${me.onCourt.map(card).join('')}</div>
    ${pick ? `<div class="cshots">${SHOTS.map(([t, l, k]) => `<button class="btn" data-cshot="${t}">${l}<small>${k === 'LAY' ? Math.max(pick.p.skills.LAY.cur, pick.p.skills.DNK.cur) : pick.p.skills[k].cur}</small></button>`).join('')}<button class="btn" data-cshot="">His choice</button></div>` : ''}
    <button class="btn wide" data-cauto>Let the team run the play</button>`;
  el.classList.remove('hidden');
  el.querySelectorAll('[data-cpick]').forEach((b) => (b.onclick = () => { live.pick = b.dataset.cpick; renderCrit(); }));
  const go = (choice) => {
    gm.callPlay(choice);
    const ps = choice && me.onCourt.find((x) => x.p.id === choice.pid);
    addFeed([{ type: 'sub', team: gm.userSide, clock: Math.round(gm.clock), text: ps ? `Timeout. Play called for ${ps.name}${choice.type ? `: ${SHOTS.find((s) => s[0] === choice.type)[1].toLowerCase()}` : ''}.` : 'Timeout. The team runs its offense.' }]);
    live.pick = null;
    // run the called possession now, then reveal how it went
    const evs = gm.step();
    markHot(evs); addFeed(evs); renderScore(); renderLiveBox();
    showCallResult(evs, choice);
  };
  el.querySelectorAll('[data-cshot]').forEach((b) => (b.onclick = () => go({ pid: live.pick, type: b.dataset.cshot || null })));
  el.querySelector('[data-cauto]').onclick = () => go(null);
}
// After a called play: did he make it? Face, result, and his points now.
const SHOT_NAME = { three: 'three', mid: 'midrange jumper', rim: 'drive', post: 'post-up' };
function showCallResult(evs, choice) {
  const gm = live.gm, el = $('crit'), side = gm.userSide;
  const mine = evs.filter((e) => e.team === side);
  const first = mine.find((e) => ['score', 'miss', 'block', 'to'].includes(e.type));
  const fts = mine.filter((e) => e.type === 'ft' || e.type === 'ftmiss');
  const pid = first?.pid || fts[0]?.pid || choice?.pid;
  const ps = gm.sides[side].players.find((x) => x.p.id === pid);
  const putback = first && first.type !== 'score' && mine.find((e) => e.type === 'score' && e !== first);
  const ftLine = fts.length ? `${fts.filter((e) => e.type === 'ft').length} of ${fts.length} free throws` : '';
  let cls = 'miss', head = 'No good', line = '';
  if (!first && !fts.length) { head = 'No shot'; line = 'The possession ended before he got a look.'; }
  else if (first?.type === 'to') { head = 'Turnover'; line = esc(first.text); }
  else if (first?.type === 'score') { cls = 'make'; head = first.pts === 3 ? 'Splash! He hits the three' : 'Bucket!'; line = `${esc(first.text)}${ftLine ? ` And one: ${ftLine}.` : ''}`; }
  else if (!first && fts.length) { const m = fts.filter((e) => e.type === 'ft').length; cls = m ? 'make' : 'miss'; head = 'Fouled on the shot'; line = `He makes ${ftLine}.`; }
  else { head = first.type === 'block' ? 'Blocked!' : 'Missed'; line = esc(first.text) + (putback ? ` Second chance: ${esc(putback.text)}` : ''); if (putback) cls = 'make'; }
  const shot = choice?.type ? SHOT_NAME[choice.type] : first?.shot ? SHOT_NAME[first.shot] : '';
  el.innerHTML = `<div class="cres ${cls}">
      ${ps ? liveFace(side, ps.p.id, 64) : ''}
      <div><b class="ch">${head}</b><div class="cl">${line}</div>
      ${ps ? `<div class="cp"><b>${esc(ps.name)}</b>${shot ? ` · ${shot}` : ''}<span class="pts">${ps.line.PTS} pts</span><small>${ps.line.FGM}-${ps.line.FGA} FG</small></div>` : ''}</div>
    </div>
    <button class="btn primary wide" data-ccont>Continue</button>`;
  el.classList.remove('hidden');
  el.querySelector('[data-ccont]').onclick = () => { el.classList.add('hidden'); tickLive(); };
}
function renderScore() {
  const gm = live.gm;
  const h = gm.sides.home, a = gm.sides.away;
  const per = gm.done ? 'Final' : gm.period === 1 ? '1st half' : gm.period === 2 ? '2nd half' : `OT${gm.period - 2}`;
  const clock = `${Math.floor(gm.clock / 60)}:${String(Math.round(gm.clock % 60)).padStart(2, '0')}`;
  $('sb').innerHTML = `<div class="t ${gm.userSide === 'away' ? 'me' : ''}"><div class="a">${esc(a.team.school.abbr)}</div><div class="s">${a.score}</div></div>
    <div class="mid">${per}<b>${gm.done ? '' : clock}</b></div>
    <div class="t ${gm.userSide === 'home' ? 'me' : ''}"><div class="a">${esc(h.team.school.abbr)}</div><div class="s">${h.score}</div></div>`;
}
function renderLive() {
  const gm = live.gm;
  const tac = gm.sides[gm.userSide].tactics;
  renderScore();
  const views = [['pbp', 'Play-by-play'], ['box', 'Box score']].concat(live.done || gm.exhibition ? [] : [['coach', 'Coach']]);
  if (live.done && live.view === 'coach') live.view = 'box';
  $('liveCtrl').innerHTML = `${live.done ? '' : segHtml('speed', [[0, 'Pause'], [1, '1x'], [2, '2x'], [4, '4x'], [16, 'Fast']], live.speed, 'data-speed')}${segHtml('lv', views, live.view, 'data-lview')}`;
  $('lcoach').innerHTML = live.done ? '' : `<div class="sec">Tempo</div>${segHtml('tempo', TEMPO, tac.tempo, 'data-ltac')}<div class="sec">Defense</div>${segHtml('defense', DEF, tac.defense, 'data-ltac')}<div class="sec">Offense focus</div>${segHtml('focus', FOCUS, tac.focus, 'data-ltac')}<div class="note">Changes take effect on the next possession.</div>`;
  $('feed').classList.toggle('hidden', live.view !== 'pbp');
  $('lbox').classList.toggle('hidden', live.view !== 'box');
  $('lcoach').classList.toggle('hidden', live.view !== 'coach');
  renderLiveBox();
  $('liveCtrl').querySelectorAll('[data-lview]').forEach((b) => (b.onclick = () => { live.view = b.dataset.v; renderLive(); }));
  $('liveFoot').innerHTML = live.done
    ? (gm.exhibition ? '<button class="btn primary" id="lDone">Done</button>' : '<button class="btn" id="lBox">Box score</button><button class="btn primary" id="lDone">Done</button>')
    : '<button class="btn" id="lSkip">Sim to end</button>';
  $('liveCtrl').querySelectorAll('[data-speed]').forEach((b) => (b.onclick = () => { live.speed = Number(b.dataset.v); renderLive(); tickLive(); }));
  $('lcoach').querySelectorAll('[data-ltac]').forEach((b) => (b.onclick = () => {
    const k = b.dataset.ltac;
    gm.setTactics(gm.userSide, { [k]: b.dataset.v });
    addFeed([{ type: 'sub', team: gm.userSide, clock: Math.round(gm.clock), text: `Coach's adjustment: ${k} set to ${b.dataset.v}.` }]);
    renderLive();
  }));
  if ($('lSkip')) $('lSkip').onclick = () => { clearTimeout(live.timer); gm.interactive = false; if (gm.waiting) gm.callPlay(null); $('crit').classList.add('hidden'); const evs = []; while (!gm.done) evs.push(...gm.step()); live.hot = {}; addFeed(evs.filter((e) => e.type !== 'sub')); finishLive(); };
  if ($('lBox')) $('lBox').onclick = () => { $('live').classList.add('hidden'); ui.boxGi = gm.gi; ui.boxRes = ctx.lastGame; ui.boxSide = null; openSheet('box', 'full'); };
  if ($('lDone')) $('lDone').onclick = () => { $('live').classList.add('hidden'); closeSheet(); render(); };
}
function finishLive() {
  if (live.done) return;
  live.done = true;
  clearTimeout(live.timer);
  if (live.kind === 'mcd') C.finishMcdGame(ctx, live.gm);
  else if (ctx.state.over) C.finishMMGame(ctx, live.gm); else C.finishUserGame(ctx, live.gm);
  save();
  renderLive();
  render();
}

// ---------- end-of-day helpers ----------
function sheetUnplayed() {
  return `<h2>Tonight's game isn't played yet</h2><div class="note">Watch it, or let the staff sim it with your current coaching settings.</div>
    <div class="choice"><button class="btn primary" data-watchnow>Watch the game</button><button class="btn" data-endday>Sim it and end the day</button></div>`;
}

function openPreOff() { ui.cuts = []; ui.cutsTouched = false; openSheet('preoff', 'full'); }

// Before the new season: draft decisions, then walk-on cuts to fit signees under 12.
function sheetPreOff() {
  const draft = C.draftFor(ctx);
  if (!ui.cutsTouched) {
    const base = C.offseasonPreview(ctx, []);
    ui.cuts = base.walkOns.slice().sort((a, b) => ovr(a) - ovr(b)).slice(0, base.needCut).map((p) => p.id);
  }
  const pv = C.offseasonPreview(ctx, ui.cuts);
  const mini = (p) => `<span class="mface">${faceSvg(p, { size: 34, jersey: teamColor() })}</span>`;
  const draftRows = draft.map((d) => { const { p, status } = d; return `<div class="drow">${mini(p)}<div class="dn"><b>${nmB(p)}</b><div class="muted">${p.pos} · ${p.cls} · ${ovr(p)} OVR</div></div>
    ${status === 'declared' ? `<div class="dbtn"><button class="btn primary" data-stay="${p.id}">Talk him out of it · ${Math.round(C.stayChance(ctx, p.id) * 100)}%</button><button class="btn" data-letgo="${p.id}">Let go</button></div>`
      : dtag(d)}</div>`; }).join('');
  const walkRows = pv.walkOns.map((p) => { const cut = ui.cuts.includes(p.id); return `<div class="drow">${mini(p)}<div class="dn"><b>${nmB(p)}</b><div class="muted">${p.pos} · ${p.cls} · ${ovr(p)} OVR · walk-on</div></div>
    <button class="btn ${cut ? 'bad' : ''}" data-cut="${p.id}">${cut ? 'Cut ✓' : 'Keep'}</button></div>`; }).join('');
  const canCut = pv.walkOns.filter((p) => !ui.cuts.includes(p.id)).length;
  const blocked = pv.pending.length ? 'Decide on every draft declaration first.'
    : pv.needCut > canCut ? 'Too many players and no walk-ons left to cut.'
    : pv.needCut ? `Cut ${pv.needCut} more walk-on${pv.needCut > 1 ? 's' : ''} to fit your signees.` : '';
  return `<h2>Offseason</h2>
    <div class="note">${pv.seniors.length} senior${pv.seniors.length === 1 ? '' : 's'} graduating · ${pv.signees.length} signee${pv.signees.length === 1 ? '' : 's'} arriving</div>
    <div class="sec">Draft declarations</div>${draftRows || '<div class="note">Nobody declared. Your stars are all back.</div>'}
    <div class="sec">Walk-ons · no scholarship, cut them to make room</div>${walkRows || '<div class="note">No returning walk-ons.</div>'}
    <div class="needs-row" style="margin-top:12px"><span>Roster next year</span><b class="${pv.total > 12 ? 'neg' : ''}">${pv.total}/12</b></div>
    ${pv.total < 12 && !pv.pending.length ? `<div class="note">${12 - pv.total} open spot${12 - pv.total > 1 ? 's' : ''} will be filled by new walk-ons.</div>` : ''}
    ${blocked ? `<div class="note" style="color:var(--red)">${blocked}</div>` : ''}
    <button class="btn primary wide" data-advgo ${blocked ? 'disabled' : ''}>Start the ${ctx.state.year + 1}-${String(ctx.state.year + 2).slice(2)} season</button>`;
}

function advance() {
  const res = C.advanceSeason(ctx, { cuts: ui.cuts || [] });
  ui.cuts = []; ui.cutsTouched = false;
  if (!res.ok) return toast(res.msg, 'bad');
  ctx = res.ctx;
  ui.offseason = res.summary;
  ui.lastSeenLog = ctx.state.log.length;
  pinsReset();
  save();
  openSheet('offseason', 'full');
  setTab('today');
}
function pinsReset() { for (const k of Object.keys(pins)) delete pins[k]; buildMap(); }

function sheetOffseason() {
  const o = ui.offseason;
  const row = (p, extra = '') => `<div class="needs-row"><span>${nmB(p)} <span class="muted">${p.pos}</span></span><b>${extra}</b></div>`;
  return `<h2>Offseason</h2><div class="note">Welcome to ${ctx.state.year}-${String(ctx.state.year + 1).slice(2)}. Team OVR is now ${teamOvr(myTeam().roster)}.</div>
    <div class="sec">Graduated</div>${o.graduated.map((p) => row(p, `${ovr(p)} OVR`)).join('') || '<div class="note">None</div>'}
    <div class="sec">Left for the draft</div>${(o.drafted || []).map((p) => row(p, `${ovr(p)} OVR`)).join('') || '<div class="note">Nobody. Everyone came back.</div>'}
    ${(o.cutByYou || []).length ? `<div class="sec">Cut</div>${o.cutByYou.map((p) => row(p, `${ovr(p)} OVR`)).join('')}` : ''}
    <div class="sec">Your signees join</div>${o.signed.map((p) => row(p, `${ovr(p)} OVR · ${p.grade}`)).join('') || '<div class="note">Nobody. That hurts.</div>'}
    <div class="sec">Walk-ons added</div>${o.walkOns.map((p) => row(p, `${ovr(p)} OVR`)).join('') || '<div class="note">None needed.</div>'}
    <div class="sec">Player development</div>${o.progressed.map(({ p, before, after }) => row(p, `${before} → ${after} <span style="color:var(--green)">+${after - before}</span>`)).join('')}
    <button class="btn primary wide" data-close>Start the new season</button>`;
}

// test hook: lets automated playtests drive long seasons quickly
window.cbbmDebug = { get ctx() { return ctx; }, get live() { return live; }, openState: (c) => { ui.sel = c; ui.selRecruit = null; openSheet('state', 'half'); render(); }, endDay: (c) => { C.endDay(ctx, c); save(); render(); } };
startScreen();
