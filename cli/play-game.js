// Play one game and print the box score (and optionally play-by-play).
// node cli/play-game.js duke unc [--pbp] [--seed 7] [--neutral]
//   [--home-tempo slow|normal|fast] [--home-defense man|zone|press] [--home-focus inside|balanced|perimeter] [--home-depth 7-10]
//   (same flags with --away-...)
import { parseArgs, tacticsFrom } from './args.js';
import { createWorld, getSchool } from '../src/world.js';
import { Game } from '../src/engine/game.js';
import { renderBoxScore, renderPlayByPlay } from '../src/engine/boxscore.js';

const args = parseArgs();
const [h = 'duke', a = 'north-carolina'] = args._;
const hs = getSchool(h), as = getSchool(a);
if (!hs || !as) { console.error(`Unknown school: ${!hs ? h : a}`); process.exit(1); }
const world = createWorld(Number(args.world || 2026));
const home = { ...world.teams[hs.id], tactics: tacticsFrom(args, 'home') };
const away = { ...world.teams[as.id], tactics: tacticsFrom(args, 'away') };
const game = new Game(home, away, { seed: args.seed ?? Date.now(), neutral: !!args.neutral });
const res = game.sim();
if (args.pbp) { console.log(renderPlayByPlay(res, { skipSubs: !args.subs })); console.log(''); }
console.log(renderBoxScore(res));
