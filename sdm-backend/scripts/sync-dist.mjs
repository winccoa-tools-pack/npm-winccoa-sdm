/**
 * Refresh this publish package from the canonical SDM backend project
 * (`javascript/sdm`): copies dist/, src/, run.js and tsconfig.json.
 *
 * The canonical project keeps its `file:` dev dependencies (winccoa-manager /
 * webserver-js / @types) for building with tsc; this package ships only the
 * compiled artifact. Run from the package directory before publishing:
 *
 *     (cd ../sdm && npm run build)   # build the canonical project first
 *     npm run sync:dist
 *
 * Override the source project with: node scripts/sync-dist.mjs <path-to-sdm>
 */
import fs from 'node:fs';
import path from 'node:path';

const packageRoot = path.resolve(import.meta.dirname, '..');
const srcRoot = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(packageRoot, '../sdm');

function copyRecursive(src, dst) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src)) copyRecursive(path.join(src, entry), path.join(dst, entry));
  } else {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}

const distSrc = path.join(srcRoot, 'dist');
if (!fs.existsSync(distSrc)) {
  console.error(`[sync:dist] ${distSrc} not found — build the canonical project first: (cd ${srcRoot} && npm run build)`);
  process.exit(1);
}

for (const dir of ['dist', 'src']) {
  fs.rmSync(path.join(packageRoot, dir), { recursive: true, force: true });
  copyRecursive(path.join(srcRoot, dir), path.join(packageRoot, dir));
}
for (const file of ['run.js', 'tsconfig.json']) {
  fs.copyFileSync(path.join(srcRoot, file), path.join(packageRoot, file));
}

const n = (() => {
  let c = 0;
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : c++));
  walk(path.join(packageRoot, 'dist'));
  return c;
})();
console.log(`[sync:dist] Synced dist/ (${n} files), src/, run.js, tsconfig.json from ${srcRoot}`);
