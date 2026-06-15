/**
 * Refresh dist/pages/sdm.js from the monorepo build output.
 *
 * The page bundle is produced by the frontend workspace (`npm run build:pages`
 * with OUT_DIR=<proj>/data/dashboard-wc). This copies that artifact into the
 * package's dist/ before publishing. Run from the package directory:
 *
 *     npm run sync:dist
 *
 * Override the source with: node scripts/sync-dist.mjs <path-to-sdm.js>
 */
import fs from 'node:fs';
import path from 'node:path';

const packageRoot = path.resolve(import.meta.dirname, '..');
// package lives at <proj>/javascript/sdm-page → project root is two levels up.
const projectRoot = path.resolve(packageRoot, '../..');
const src = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(projectRoot, 'data/dashboard-wc/pages/sdm.js');
const dst = path.join(packageRoot, 'dist/pages/sdm.js');

if (!fs.existsSync(src)) {
  console.error(`[sync:dist] Source not found: ${src}`);
  console.error('[sync:dist] Build it first: (frontend) OUT_DIR=<proj>/data/dashboard-wc npm run build:pages');
  process.exit(1);
}
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.copyFileSync(src, dst);
const kb = (fs.statSync(dst).size / 1024).toFixed(0);
console.log(`[sync:dist] Copied ${src} → ${path.relative(packageRoot, dst)} (${kb} kB)`);
