// Bundles web/ + src/ into one self-contained HTML file: dist/recruiting.html
// Needs esbuild: npm i -D esbuild (or NODE_PATH pointing at an install).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const root = new URL('..', import.meta.url).pathname;
const out = await build({ entryPoints: [root + 'web/app.js'], bundle: true, format: 'esm', minify: true, write: false, target: 'es2020' });
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync(root + 'web/style.css', 'utf8');
let html = readFileSync(root + 'web/index.html', 'utf8');
html = html.replace('<link rel="stylesheet" href="style.css">', `<style>${css}</style>`);
html = html.replace('<script type="module" src="app.js"></script>', () => `<script type="module">${js}</script>`);
mkdirSync(root + 'dist', { recursive: true });
writeFileSync(root + 'dist/recruiting.html', html);
console.log(`dist/recruiting.html ${(html.length / 1024).toFixed(0)} KB`);
