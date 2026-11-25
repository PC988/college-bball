# College Basketball Manager: game engine (v0.1)

Plain JavaScript (ES modules), zero dependencies, Node 18+. Same code will run in a browser UI later.

## Try it
```
node cli/play-game.js duke north-carolina --pbp          # one game: play-by-play + box score
node cli/play-game.js butler xavier --home-defense zone --home-tempo fast --home-depth 9
node cli/simcast.js duke kentucky --speed 250 --halftime-defense zone   # watchable, same engine
node cli/roster.js gonzaga                               # roster with all 12 skills
node cli/sim-season.js --team duke --save saves/season.json.gz        # all 161 teams, 32 games each
node cli/offseason.js --load saves/season.json.gz --recruits 0 --save saves/next.json.gz  # graduation + walk-ons
node tools/validate.js 600                               # sim stats vs real D1 averages, tactic effects
node tools/build-schools.js                              # rebuild data/schools.json from the table
```
Coach flags (prefix `--home-` or `--away-`): `tempo slow|normal|fast`, `defense man|zone|press`, `focus inside|balanced|perimeter`, `depth 7-10`.

## Layout
- `data/schools.json`: 161 real D1 schools in 12 conferences (2025-26 alignment). Tier (BB/HM/MM/LM), prestige, NIL budget ($K), size, enrollment, public/private, religious affiliation, academic, party, facilities, coaching style, tempo, state. Built by `tools/build-schools.js`.
- `data/names.json`: name pools and hometown state weights.
- `src/rng.js`: seeded RNG. Same seed, same world.
- `src/player.js`: player generator. 12 Hoopland skills (LAY DNK INS MID TPT FTS DRB PAS ORE DRE STL BLK) 1-100 as `{cur, cap}`, physicals STR/SPD/STM, position, archetype (4 per position), height/weight, class, potential 1-100 + letter grade, hidden recruiting traits, `appearance.seed` hook for pixel art.
- `src/roster.js`: max 12, graduation, development, walk-on fill, placeholder AI recruiting.
- `src/engine/game.js`: possession engine. `new Game(home, away).step()` = one possession of events; `.sim()` = whole game; `.setTactics()` between steps.
- `src/engine/boxscore.js`: box score and play-by-play text.
- `src/season.js`: 32-game schedule (conference double round robin + non-conference, non-D1 fillers), standings, power ratings.
- `src/save.js`: saves store seed + only what changed (rosters after first offseason, scores, season stats). `.gz` paths are gzipped.

## Calibration (tools/validate.js, 600 random games)
PTS 72.2, poss 69, FG 44.3%, 3P 35%, 3PA 21.5, FT 71%, FTA 18.5, ORB 9.8, AST 13, STL 6.7, BLK 4.1, TO 11.6, PF 16.9, home win ~60%. Real D1 is ~72-74 PTS, 44% FG, 34% 3P, 72% FT.

## Not built yet
Recruiting + action points, NIL negotiation, training, coach creator, conference tournaments, March Madness, UI, pixel art.

## Recruiting War Room (scouting map)
- Play: https://claude.ai/artifact/Qf5fdiUKXt2KVsDk5JDpgY (private to you; built from `dist/recruiting.html`).
- Rebuild: `npm i -D esbuild && npm run build:web`. Local dev: serve the folder (`npx serve .`) and open `/web/`.
- Logic: `src/recruiting/` (recruits.js class generator, scouting.js rating ranges, campaign.js days/AP/scout/rivals/commits). UI: `web/`.
- Rules: 1 day per game (32 days), 20 AP per day. Travel AP by distance and scout speed. End day: stay overnight (2 AP lodging next day) or return home (free). Film 2 AP from anywhere (shooting skills), in-person HS game 2-8 AP in the scout's state (everything else, every recruit in that game, 1 per day), phone call 1 AP (1 trait, once per recruit per day, diminishing interest), home visit 5 AP in state (2-3 traits, max 2), offer 1 AP (max open slots + 4). Efficiency cuts action costs, speed cuts travel, accuracy narrows faster, charisma = more traits and bigger visit gains.
- Event days: Holiday Hoops Showcase (day 12, NV, top 60), All-American Game (day 26, TX, top 24).
- Rivals: every other school spends a hidden daily budget (2 + prestige/10) on targets near its level, offers, and competes. Recruits far above a school's prestige barely listen (prestigeGate).
- Bot test: `node tests/recruiting-sim.js butler focused 120` (school, strategy, first target rank).

## Full manager loop (web)
Tabs: Today (play or sim the day's game, coaching), Roster (rotation), Recruit (map), Season (schedule, standings, Top 25).
After signing day, "Start the offseason" graduates seniors, adds signees as freshmen, fills walk-ons, and begins the next year.
Test: `node tests/career-sim.js`.
