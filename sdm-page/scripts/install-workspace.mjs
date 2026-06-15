/**
 * Workspace-mode install (Vite-host monorepo).
 *
 * Layout at hostRoot:
 *   apps/dashboard-wc/config/menuconfig.jsonc
 *   libs/default-components/src/lib/standalone-pages/   (optional)
 *
 * Actions:
 *   1. Merge wui-page.json#menu into menuconfig.jsonc (paths unchanged).
 *   2. Mirror oa-data/ into hostRoot/oa-data/ (skip-if-exists).
 *   3. Create a shim standalone-pages/<name>.ts that side-effect imports the
 *      package's first export, so the workspace build bundles the page.
 */
import fs from 'node:fs';
import path from 'node:path';
import { mergeMenuEntries, mirrorDir, readJson } from './_helpers.mjs';

export function runWorkspaceInstall({ hostRoot, packageRoot, manifest, menuconfigPath }) {
  mergeMenuEntries(menuconfigPath, manifest.menu ?? []);
  mirrorDir(path.join(packageRoot, 'oa-data'), path.join(hostRoot, 'oa-data'), 'oa-data');
  registerStandalonePage({ hostRoot, packageRoot, manifest });
}

function registerStandalonePage({ hostRoot, packageRoot, manifest }) {
  const dir = path.join(hostRoot, 'libs/default-components/src/lib/standalone-pages');
  if (!fs.existsSync(dir)) {
    console.log(`[wui-page-manage] standalone-pages directory not found at ${dir} - skipping.`);
    return;
  }
  const targetFile = path.join(dir, `${manifest.name}.ts`);
  if (fs.existsSync(targetFile)) {
    console.log(`[wui-page-manage] ${manifest.name}.ts already exists - skipping page shim.`);
    return;
  }
  const pkgJson = readJson(path.join(packageRoot, 'package.json'));
  const firstExportKey = Object.keys(pkgJson.exports ?? {})[0];
  const importSpecifier = `${pkgJson.name}/${firstExportKey.replace(/^\.\//, '')}`;
  fs.writeFileSync(targetFile, `import '${importSpecifier}';\n`, 'utf8');
  console.log(`[wui-page-manage] Created ${path.relative(hostRoot, targetFile)}`);
}
