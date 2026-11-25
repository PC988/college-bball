// Builds data/us-states.json (SVG paths + centroids). Needs: npm i -D d3-geo topojson-client us-atlas
// Run: node tools/build-map.mjs data/us-states.json
import { geoAlbersUsa, geoPath, geoCentroid } from 'd3-geo';
import { feature } from 'topojson-client';
import us from 'us-atlas/states-10m.json' with { type: 'json' };
import fs from 'fs';
const FIPS = {"01":"AL","02":"AK","04":"AZ","05":"AR","06":"CA","08":"CO","09":"CT","10":"DE","11":"DC","12":"FL","13":"GA","15":"HI","16":"ID","17":"IL","18":"IN","19":"IA","20":"KS","21":"KY","22":"LA","23":"ME","24":"MD","25":"MA","26":"MI","27":"MN","28":"MS","29":"MO","30":"MT","31":"NE","32":"NV","33":"NH","34":"NJ","35":"NM","36":"NY","37":"NC","38":"ND","39":"OH","40":"OK","41":"OR","42":"PA","44":"RI","45":"SC","46":"SD","47":"TN","48":"TX","49":"UT","50":"VT","51":"VA","53":"WA","54":"WV","55":"WI","56":"WY"};
const proj = geoAlbersUsa().scale(1280).translate([480, 300]);
const path = geoPath(proj);
const fc = feature(us, us.objects.states);
const out = {};
for (const f of fc.features) {
  const code = FIPS[f.id]; if (!code) continue;
  const d = path(f); if (!d) continue;
  const c = geoCentroid(f); const [x, y] = path.centroid(f);
  // round coordinates to 1 decimal to keep file small
  out[code] = { name: f.properties.name, d: d.replace(/(\d+\.\d)\d+/g, '$1'), lonlat: [+c[0].toFixed(3), +c[1].toFixed(3)], label: [+x.toFixed(1), +y.toFixed(1)] };
}
fs.writeFileSync(process.argv[2], JSON.stringify({ viewBox: '0 0 960 600', states: out }));
console.log(Object.keys(out).length, 'states', (fs.statSync(process.argv[2]).size/1024).toFixed(0)+'KB');
