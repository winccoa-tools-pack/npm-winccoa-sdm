#!/usr/bin/env node
/**
 * wui-page-manage.mjs — dispatcher (generic; driven by wui-page.json)
 *
 * Detects the install environment and delegates:
 *   - Workspace mode (Vite-host monorepo)         -> install-workspace.mjs
 *   - OA-project mode (installed in data/WebUI/)  -> install-oa-project.mjs
 *
 * Runs automatically as `postinstall`, or manually via `npm run manifest`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { readJson, resolveHostRoot } from './_helpers.mjs';
import { runOaProjectInstall } from './install-oa-project.mjs';
import { runWorkspaceInstall } from './install-workspace.mjs';

const packageRoot = path.resolve(import.meta.dirname, '..');
const manifestPath = path.join(packageRoot, 'wui-page.json');
const hostRoot = resolveHostRoot();

run().catch((err) => {
  console.error('[wui-page-manage] Fatal:', err.message);
  process.exit(1);
});

async function run() {
  const manifest = readJson(manifestPath);
  const mode = detectMode(hostRoot);

  switch (mode) {
    case 'workspace': {
      const menuconfigPath = path.join(hostRoot, 'apps/dashboard-wc/config/menuconfig.jsonc');
      console.log(`[wui-page-manage] Workspace mode (${menuconfigPath})`);
      runWorkspaceInstall({ hostRoot, packageRoot, manifest, menuconfigPath });
      break;
    }
    case 'oa-project': {
      console.log(`[wui-page-manage] OA-project mode (${hostRoot})`);
      runOaProjectInstall({ hostRoot, packageRoot, manifest });
      break;
    }
    default: {
      console.log(`[wui-page-manage] Could not detect install mode from ${hostRoot}.`);
      console.log('[wui-page-manage] Looked for:');
      console.log(`  ${path.join(hostRoot, 'apps/dashboard-wc/config/menuconfig.jsonc')}  (workspace)`);
      console.log(`  a directory whose basename is "WebUI"  (oa-project)`);
      return;
    }
  }

  console.log('[wui-page-manage] Done.');
}

function detectMode(initCwd) {
  if (fs.existsSync(path.join(initCwd, 'apps/dashboard-wc/config/menuconfig.jsonc'))) return 'workspace';
  if (path.basename(initCwd) === 'WebUI') return 'oa-project';
  return 'unknown';
}
