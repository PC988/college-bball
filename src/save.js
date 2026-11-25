// Small saves, Blueblood style: schools are static data, the world is rebuilt from its seed,
// and only what diverged from the seed is written (rosters once they change, game scores).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createWorld } from './world.js';
import { STAT_KEYS, packPlayer, unpackPlayer } from './pack.js';
export { packPlayer, unpackPlayer };
import { newSeasonState } from './season.js';

export function serialize(state) {
  const { world, season, user } = state;
  const out = { v: 1, seed: world.seed, year: world.year, user };
  if (world.rostersModified) {
    out.rosters = Object.fromEntries(Object.entries(world.teams).map(([id, t]) => [id, t.roster.map(packPlayer)]));
  }
  if (season) out.results = season.results.map((r) => r || 0);
  if (season?.playerStats) out.playerStats = Object.fromEntries(Object.entries(season.playerStats).map(([id, st]) => [id, STAT_KEYS.map((k) => st[k])]));
  return JSON.stringify(out);
}

export function deserialize(json) {
  const d = JSON.parse(json);
  const world = createWorld(d.seed, d.year);
  if (d.rosters) {
    for (const [id, arr] of Object.entries(d.rosters)) if (world.teams[id]) world.teams[id].roster = arr.map(unpackPlayer);
    world.rostersModified = true;
  }
  world.year = d.year;
  let season = null;
  if (d.results) {
    season = newSeasonState(world, d.seed);
    season.results = d.results.map((r) => (r ? r : undefined));
    season.playedRounds = Math.max(0, ...season.games.map((g, gi) => (season.results[gi] ? g.round + 1 : 0)));
    season.playerStats = Object.fromEntries(Object.entries(d.playerStats || {}).map(([id, a]) => [id, Object.fromEntries(STAT_KEYS.map((k, i) => [k, a[i]]))]));
  }
  return { world, season, user: d.user };
}

export function saveTo(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  const s = serialize(state);
  const buf = path.endsWith('.gz') ? gzipSync(s) : Buffer.from(s);
  writeFileSync(path, buf);
  return buf.length;
}

export const loadFrom = (path) => {
  const buf = readFileSync(path);
  return deserialize(path.endsWith('.gz') ? gunzipSync(buf).toString('utf8') : buf.toString('utf8'));
};
