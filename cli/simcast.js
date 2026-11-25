// Watchable simcast: same Game engine as the instant sim, stepped one possession at a time.
// node cli/simcast.js duke north-carolina [--speed 300] [--seed 7] [--halftime-defense zone]
// --speed = ms per possession (0 = instant). Coaching changes apply between possessions via game.setTactics.
import { parseArgs, tacticsFrom } from './args.js';
import { createWorld, getSchool } from '../src/world.js';
import { Game } from '../src/engine/game.js';
import { clockStr, renderBoxScore } from '../src/engine/boxscore.js';

const args = parseArgs();
const [h = 'duke', a = 'north-carolina'] = args._;
const world = createWorld(Number(args.world || 2026));
const hs = getSchool(h), as = getSchool(a);
const game = new Game({ ...world.teams[hs.id], tactics: tacticsFrom(args, 'home') }, { ...world.teams[as.id], tactics: tacticsFrom(args, 'away') }, { seed: args.seed ?? Date.now() });
const speed = Number(args.speed ?? 250);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let halftimeDone = false;
while (!game.done) {
  const evs = game.step();
  for (const e of evs) {
    if (e.type === 'sub') continue;
    const ab = e.team === 'home' ? hs.abbr : as.abbr;
    console.log(`${clockStr(e.clock).padStart(5)} ${ab.padEnd(5)} [${as.abbr} ${e.score[1]} - ${hs.abbr} ${e.score[0]}] ${e.text}`);
  }
  if (!halftimeDone && game.period === 2) {
    halftimeDone = true;
    if (args['halftime-defense']) {
      game.setTactics('home', { defense: args['halftime-defense'] });
      console.log(`>>> Halftime adjustment: ${hs.abbr} switches to ${args['halftime-defense']} defense`);
    }
  }
  if (speed) await sleep(speed);
}
console.log('\n' + renderBoxScore(game.result()));
