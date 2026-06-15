#!/usr/bin/env node
/**
 * postinstall — print how to register the SDM backend as a JavaScript Manager.
 *
 * A WinCC OA manager cannot be auto-registered reliably (config/progs location
 * and indices vary), so we print the exact steps and also drop them on disk
 * (modern npm silences postinstall stdout).
 */
import fs from 'node:fs';
import path from 'node:path';

const PKG = '@martinkumhera/winccoa-sdm-backend';
const hostRoot = process.env.INIT_CWD ? path.resolve(process.env.INIT_CWD) : process.cwd();
// Manager parameter is resolved relative to the project's javascript/ directory.
const managerParam = `node_modules/${PKG}/run.js`;

const title = 'Semantic Data Model backend — register the JavaScript Manager';
const steps = [
  `Install location: ${path.join(hostRoot, 'node_modules', PKG)}`,
  'Install this package inside your WinCC OA project\'s javascript/ directory so the manager resolves it.',
  [
    'Open the WinCC OA Console for this project and append a JavaScript Manager:',
    'Manager   = WCCOAjavascript  (Node.js JavaScript Manager)',
    `Parameter = ${managerParam}`,
    'Start mode = manual (or always)',
  ],
  [
    'It replaces the standard webserver (serves all standard handlers + sdm.*) on the',
    'configured httpsPort (8443). To run it ADDITIONALLY instead, set on the manager:',
    'SDM_PORT=8444   SDM_WSS=/winccoa',
  ],
  'On first start it bootstraps its meta data point types automatically (no DPL import).',
];
const footer = [
  'OA libs (webserver-js, winccoa-manager) are resolved at runtime via the manager\'s',
  'NODE_PATH (= <WinCC-OA-install>/javascript) — they are NOT installed from npm.',
  'Frontend page (route /sdm): @martinkumhera/winccoa-sdm-page.',
];

function banner() {
  const lines = [];
  steps.forEach((s, i) => {
    if (Array.isArray(s)) {
      lines.push(`  ${i + 1}. ${s[0]}`);
      for (const sub of s.slice(1)) lines.push(`       ${sub}`);
    } else lines.push(`  ${i + 1}. ${s}`);
  });
  const foot = footer.map((f) => `  ${f}`);
  const width = Math.max(title.length + 24, ...lines.map((l) => l.length + 2), ...foot.map((l) => l.length + 2), 70);
  const bar = '='.repeat(width);
  const thin = '-'.repeat(width);
  return ['', bar, `  *** ACTION REQUIRED: ${title}`, bar, ...lines, thin, ...foot, bar, ''].join('\n');
}

const text = banner();
console.log(text);
try {
  fs.writeFileSync(path.join(hostRoot, 'SDM_BACKEND.NEXT_STEPS.txt'), text + '\n', 'utf8');
} catch {
  /* best-effort */
}
