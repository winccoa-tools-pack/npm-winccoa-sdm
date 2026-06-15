/**
 * OA-project-mode install (the package is installed inside {OA}/data/WebUI/).
 *
 * Layout:
 *   {OA}/data/WebUI/                                              <- INIT_CWD
 *   {OA}/data/WebUI/node_modules/<this-package>/dist/pages/sdm.js
 *   {OA}/data/dashboard-wc/menuconfig.json                        <- target menu
 *
 * Actions:
 *   1. Merge wui-page.json#menu into ../dashboard-wc/menuconfig.json, rewriting
 *      each entry's `module` to point inside node_modules (no JS copy needed).
 *   2. Mirror oa-data/WebUI/msg/* into ./msg/.
 *   3. Mirror anything under oa-data/dashboard-wc/* into ../dashboard-wc/.
 *   4. Print the manifest's next-steps banner (SDM backend prerequisite).
 */
import fs from 'node:fs';
import path from 'node:path';
import { mergeMenuEntries, mirrorDir, printNextSteps, formatNextSteps, readJson } from './_helpers.mjs';

export function runOaProjectInstall({ hostRoot, packageRoot, manifest }) {
  const dataDir = path.dirname(hostRoot);
  const dashboardWcDir = path.join(dataDir, 'dashboard-wc');
  const menuconfigPath = path.join(dashboardWcDir, 'menuconfig.json');

  if (!fs.existsSync(menuconfigPath)) {
    printMissingDashboardWcHint(dashboardWcDir);
    return;
  }

  const pkgJson = readJson(path.join(packageRoot, 'package.json'));
  const entries = (manifest.menu ?? []).map((e) => rewriteModuleUrl(e, pkgJson.name));
  mergeMenuEntries(menuconfigPath, entries);

  mirrorDir(path.join(packageRoot, 'oa-data/WebUI/msg'), path.join(hostRoot, 'msg'), 'msg');
  mirrorDir(path.join(packageRoot, 'oa-data/dashboard-wc'), dashboardWcDir, 'dashboard-wc');

  showNextSteps(manifest, dashboardWcDir);
}

function rewriteModuleUrl(entry, packageName) {
  if (!entry.module) return entry;
  const pageName = path.basename(entry.module, '.js');
  return { ...entry, module: `/data/WebUI/node_modules/${packageName}/dist/pages/${pageName}.js` };
}

function showNextSteps(manifest, dashboardWcDir) {
  const ns = manifest.nextSteps;
  if (!ns) return;
  printNextSteps(ns.title, ns.steps ?? [], ns.footer ?? []);
  // Modern npm silences postinstall stdout — drop the banner on disk too.
  try {
    const banner = formatNextSteps(ns.title, ns.steps ?? [], ns.footer ?? []);
    fs.writeFileSync(path.join(dashboardWcDir, `${manifest.name}.NEXT_STEPS.txt`), banner, 'utf8');
  } catch {
    /* best-effort */
  }
}

function printMissingDashboardWcHint(dashboardWcDir) {
  console.log('');
  console.log('[wui-page-manage] data/dashboard-wc/menuconfig.json not found.');
  console.log('To install this page into your WinCC OA project:');
  console.log(`  1. mkdir ${dashboardWcDir}`);
  console.log(`  2. cp $WINCCOA_INSTALL/data/dashboard-wc/menuconfig.json ${dashboardWcDir}/`);
  console.log('  3. npm rebuild @martinkumhera/winccoa-sdm-page');
  console.log('');
}
