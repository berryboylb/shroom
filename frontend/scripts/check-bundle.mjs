import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
const assets = join(dist, 'assets');
const scripts = readdirSync(assets).filter(name => name.endsWith('.js'));
const gzipBytes = path => gzipSync(readFileSync(path), { level: 9 }).length;
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const entry = html.match(/src="\/assets\/(index-[^"]+\.js)"/)?.[1];
const room = scripts.find(name => /^Room-.*\.js$/.test(name));
if (!entry || !room) throw new Error('Could not locate entry or room chunk');

const total = scripts.reduce((sum, name) => sum + gzipBytes(join(assets, name)), 0);
const initial = gzipBytes(join(dist, 'index.html')) + gzipBytes(join(assets, entry));
const roomBytes = gzipBytes(join(assets, room));
const kib = bytes => (bytes / 1024).toFixed(1);
console.log(`Bundle gzip: initial HTML + JS ${kib(initial)} KiB; room ${kib(roomBytes)} KiB; all JS ${kib(total)} KiB`);

if (initial > 90 * 1024 || roomBytes > 195 * 1024 || total > 320 * 1024) {
  throw new Error('Bundle budget exceeded; inspect added dependencies or chunks before deployment');
}
