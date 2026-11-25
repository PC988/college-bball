// Pixel-art faces built from Preston's drawings (31x32, layers in assets/faces/src).
// A face = hair top (rows 0-5) + brows (6-8) + nose and mouth (9-17) + body (18-31), mixed by seed,
// then recolored: skin, hair (brows match), shirt = team color. Eyes are always black on white.
// Same appearance.seed => same face from high school to senior year.
import { makeRng } from './rng.js';

const W = 31, H = 32;
// Keys: . clear  # outline  s skin  F feature (nose/mouth, darker skin)  H hair  D hair shade  B brow  w eye white  J shirt  j shirt shade
const TOPS = [["...............................", ".............#####.............", "...........##sssss##...........", "..........#sssssssss#..........", ".........#sssssssssss#.........", ".........#sssssssssss#........."], ["..........HHHHHHHHHH...........", ".........HHHHHHHHHHHH..........", ".........HHHHHHHHHHHHH.........", "........HHHHsssHssHHHHH........", "........HHHssssssssHHHH........", ".........#sssssssssss#........."], ["...............................", ".............HHHHH.............", "...........HHHHHHHHH...........", "..........HsssssssssH..........", ".........#sssssssssss#.........", ".........#sssssssssss#........."], ["...............................", "..........HHHHHHHHHHH..........", ".........HHHHHHHHHHHHH.........", ".........HHHHHHHHHHHHH.........", ".........#sssssssssss#.........", ".........#sssssssssss#........."], ["...........#########...........", "..........#HHHHHHHHH#..........", ".........#HHHHHHHHHHH#.........", "........#HHHHHHHHHHHHH#........", "........#H##H##H##H##H#........", ".........#ss#ss#ss#ss#........."]];
const BROWS = [["........#sssssssssssss#........", "........#ssBBsssssBBss#........", "........#sswwssssswwss#........"], ["........#sssssssssssss#........", "........#ssBBsssssBBss#........", "........#sswwBsssBwwss#........"], ["........#sssssssssssss#........", "........#sBBBBsssBBBBs#........", "........#sswwssssswwss#........"], ["........#sBBBBsssBBBBs#........", "........#sBBBBsssBBBBs#........", "........#sswwssssswwss#........"], ["........#ssBBsssssBBss#........", "........#sBssBsssBssBs#........", "........#sswwssssswwss#........"]];
const FACES = [["........#ssw#sssss#wss#........", "........#ssw#sssss#wss#........", "........#ssssssFssssss#........", "........#ssssssFssssss#........", "........#sssssFsFsssss#........", ".........#sssssFsssss#.........", ".........#sssssssssss#.........", "..........#ssFFFFFss#..........", "...........#ssFFFss#..........."], ["........#ssw#sssss#wss#........", "........#ssw#sssss#wss#........", "........#sssssssssssss#........", "........#sssssssssssss#........", "........#sssssssssssss#........", ".........#ssssFFFssss#.........", ".........#sssssssssss#.........", "..........#sssssssss#..........", "...........#sFFFFFs#..........."], ["........#ssw#sssss#wss#........", "........#ssw#sssss#wss#........", "........#ssssssFssssss#........", "........#sssssFsFsssss#........", "........#sssssFsFsssss#........", ".........#sssssFsssss#.........", ".........#sssssssssss#.........", "..........#ssssssFss#..........", "...........#ssFFFss#..........."], ["........#ssw#sssss#wss#........", "........#ssw#sssss#wss#........", "........#sssssssssssss#........", "........#sssssssssssss#........", "........#sssssFsFsssss#........", ".........#sssssFsssss#.........", ".........#sssssssssss#.........", "..........#ssFsssFss#..........", "...........#ssFFFss#..........."], ["........#ssw#sssss#wss#........", "........#ssw#sssss#wss#........", "........#ssssssFssssss#........", "........#ssssssFssssss#........", "........#sssssFsssssss#........", ".........#sssssFsssss#.........", ".........#sssssssssss#.........", "..........#sssssssss#..........", "...........#ssFFFss#..........."]];
const BODY = ["..........#s#sssss#s#..........", "..........#ss#####ss#..........", ".........#sssssssssss#.........", ".........#sssssssssss#.........", "......###sssssssssssss###......", "....##jjj##sssssssss##jjj##....", "...#jjJJJjj##sssss##jjJJJjj#...", "..#jJJJJJJJjj##s##jjJJJJJJJj#..", ".#jJJJJJJJJJJjj#jjJJJJJJJJJJj#.", ".#JJJJJJJJJJJJJjJJJJJJJJJJJJJ#.", ".#JJJJJJJJJJJJJJJJJJJJJJJJJJJ#.", ".#JJJJJJJJJJJJJJJJJJJJJJJJJJJ#.", ".#JJJJJJJJJJJJJJJJJJJJJJJJJJJ#.", ".#JJJJJJJJJJJJJJJJJJJJJJJJJJJ#."];
const BALD = TOPS[0];
// Extra hair styles drawn over the bald head (rows 0-13; rows 6+ only paint outside the face).
const OVER = {"afro": ["........HHHHHHHHHHHHHHH........", ".......HHHHHHHHHHHHHHHHH.......", "......HHHHHHHHHHHHHHHHHHH......", "......HHHHHHHHHHHHHHHHHHH......", "......HHHHHHHHHHHHHHHHHHH......", "......HHHHHHHHHHHHHHHHHHH......", "......HH...............HH......", ".......H...............H.......", "...............................", "...............................", "...............................", "...............................", "...............................", "..............................."], "curly": ["............H.H.H.H............", ".............HHHHH.............", "...........HHHHHHHHH...........", "..........HHHHHHHHHHH..........", ".........HHHHHHHHHHHHH.........", ".........H..D..D..D..H.........", "...............................", "...............................", "...............................", "...............................", "...............................", "...............................", "...............................", "..............................."], "mohawk": [".............HHHHH.............", ".............HHHHH.............", "...........D.HHHHH.D...........", "............DHHHHHD............", "...........D.HHHHH.D...........", "...............................", "...............................", "...............................", "...............................", "...............................", "...............................", "...............................", "...............................", "..............................."], "waves": ["...............................", ".............HDHHD.............", "...........HHDHHDHHD...........", "..........HHDHHDHHDHH..........", ".........HHDHHDHHDHHDH.........", "...............................", "...............................", "...............................", "...............................", "...............................", "...............................", "...............................", "...............................", "..............................."], "long": ["............HHHHHHH............", ".............HHHHH.............", "...........HHHHHHHHH...........", "..........HHHHHHHHHHH..........", ".........HHHHHHHHHHHHH.........", ".......HH.HHHHHH......HH.......", ".......HH.............HH.......", ".......HH.............HH.......", ".......HH.............HH.......", ".......HH.............HH.......", ".......HH.............HH.......", ".......HH.............HH.......", ".......HH.............HH.......", "..............................."]};
// Preston's facial hair (drawn in yellow; any mustache mixes with any beard), as [x, y] pixels painted in hair color.
const MUSTACHES = [[[13, 15], [14, 15], [15, 15], [16, 15], [17, 15]], [[12, 15], [13, 15], [14, 15], [15, 15], [16, 15], [17, 15], [18, 15]]];
const BEARDS = [[[12, 18], [18, 18], [12, 19], [13, 19], [14, 19], [15, 19], [16, 19], [17, 19], [18, 19], [13, 20], [14, 20], [15, 20], [16, 20], [17, 20]], [[13, 19], [14, 19], [15, 19], [16, 19], [17, 19], [13, 20], [14, 20], [15, 20], [16, 20], [17, 20]], [[10, 16], [20, 16], [10, 17], [11, 17], [19, 17], [20, 17], [11, 18], [12, 18], [18, 18], [19, 18], [12, 19], [13, 19], [14, 19], [15, 19], [16, 19], [17, 19], [18, 19], [13, 20], [14, 20], [15, 20], [16, 20], [17, 20]]];
const STYLES = [['bald', 0, 6], ['spiky', 1, 12], ['short', 2, 14], ['flat', 3, 14], ['bangs', 4, 10], ['afro', 'afro', 8], ['curly', 'curly', 12], ['mohawk', 'mohawk', 3], ['waves', 'waves', 12], ['long', 'long', 4]];

const SKIN = ['#f6d3b3', '#efbf96', '#e5aa7a', '#d79a68', '#c08051', '#a3673d', '#85502c', '#6a3d21', '#4f2c18'];
const HAIR = [['#17110d', 40], ['#3b2417', 20], ['#6b4226', 12], ['#9c5a3c', 8], ['#b8904a', 7], ['#e2c068', 7], ['#f0e2a8', 2], ['#b5482a', 3], ['#9a9a9a', 1]];
const BANDS = ['#ffffff', '#d33a35', '#17110d', '#f5c542', '#2f6fd6'];

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (a) => '#' + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const shade = (h, f) => toHex(hex(h).map((v) => v * f));
const lift = (h, f) => toHex(hex(h).map((v) => v + (255 - v) * f));
const pick = (rng, list) => rng.weighted(list.map((x) => x[0]), list.map((x) => x[1]));

export function faceTraits(seed) {
  const rng = makeRng(`face2:${seed}`);
  const si = rng.int(0, SKIN.length - 1);
  // lighter skin can be blond or red; darker skin leans black and dark brown
  const hairList = HAIR.map(([c, w], i) => [c, si >= 5 && i >= 3 && i <= 7 ? w * 0.08 : w]);
  const styleList = STYLES.map(([n, , w]) => [n, ['afro', 'waves'].includes(n) ? w * (si >= 4 ? 1.8 : 0.25) : n === 'long' || n === 'bangs' ? w * (si >= 5 ? 0.5 : 1.2) : w]);
  const style = pick(rng, styleList);
  const r = rng.next();
  return {
    skin: SKIN[si], hair: pick(rng, hairList), style,
    brows: rng.int(0, BROWS.length - 1), face: rng.int(0, FACES.length - 1),
    mustache: rng.chance(0.2) ? rng.int(0, MUSTACHES.length - 1) : null,
    beard: rng.chance(0.2) ? rng.int(0, BEARDS.length - 1) : null,
    accessory: r < 0.12 ? 'headband' : null,
    band: BANDS[rng.int(0, BANDS.length - 1)],
  };
}

function compose(t) {
  const st = STYLES.find((s) => s[0] === t.style) || STYLES[0];
  const top = typeof st[1] === 'number' ? TOPS[st[1]] : BALD;
  const g = [...top, ...BROWS[t.brows], ...FACES[t.face], ...BODY].map((row) => row.split(''));
  if (typeof st[1] === 'string') {
    OVER[st[1]].forEach((row, y) => [...row].forEach((c, x) => {
      if (c === '.') return;
      if (y < 6 || g[y][x] === '.' || g[y][x] === '#') g[y][x] = c;
    }));
  }
  if (t.mustache != null) for (const [x, y] of MUSTACHES[t.mustache]) g[y][x] = 'B';
  if (t.beard != null) for (const [x, y] of BEARDS[t.beard]) g[y][x] = 'B';
  if (t.accessory === 'headband') for (let x = 0; x < W; x++) { if ('sHD'.includes(g[4][x])) g[4][x] = 'A'; if ('sHD'.includes(g[5][x])) g[5][x] = 'A'; }
  return g;
}

export function faceSvg(player, { jersey = '#2a4a73', size = 84 } = {}) {
  const seed = player?.appearance?.seed ?? 1;
  const t = faceTraits(seed);
  const g = compose(t);
  const light = hex(t.hair).reduce((a, b) => a + b) > 450;
  const pal = {
    '#': '#000000', w: '#ffffff', s: t.skin, F: shade(t.skin, 0.68), H: t.hair,
    D: light ? shade(t.hair, 0.78) : t.hair === '#17110d' ? lift(t.hair, 0.12) : shade(t.hair, 0.7),
    B: light ? shade(t.hair, 0.72) : t.hair, J: jersey, j: shade(jersey, 0.6), A: t.band,
  };
  let rects = '';
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      const c = g[y][x];
      if (c === '.') { x++; continue; }
      let x2 = x + 1;
      while (x2 < W && g[y][x2] === c) x2++;
      rects += `<rect x="${x}" y="${y}" width="${x2 - x}" height="1" fill="${pal[c]}"/>`;
      x = x2;
    }
  }
  return `<svg class="face" viewBox="0 0 ${W} ${H}" width="${size}" height="${Math.round((size * H) / W)}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}
