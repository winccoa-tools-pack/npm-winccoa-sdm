/**
 * Shared utilities for the postinstall scripts.
 */

import fs from 'node:fs';
import path from 'node:path';

export function resolveHostRoot() {
  const hostArgIdx = process.argv.indexOf('--host');
  if (hostArgIdx !== -1 && process.argv[hostArgIdx + 1]) {
    return path.resolve(process.argv[hostArgIdx + 1]);
  }
  if (process.env.INIT_CWD) {
    return path.resolve(process.env.INIT_CWD);
  }
  return process.cwd();
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function readJsonOrJsonc(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(stripJsonComments(raw));
}

export function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

export function walkFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkFiles(full));
    else results.push(full);
  }
  return results;
}

export function mergeMenuEntries(menuconfigPath, menuEntries) {
  const menuconfig = readJsonOrJsonc(menuconfigPath);
  const entries = menuconfig.entries ?? [];
  let changed = false;

  for (const newEntry of menuEntries) {
    if (!newEntry.path) continue;

    const alreadyRegistered = entries.some(
      (e) => e.path === newEntry.path && e.module === newEntry.module
    );
    if (alreadyRegistered) {
      console.log(
        `[wui-page-manage] ${newEntry.path} already registered - skipping.`
      );
      continue;
    }

    const existing = entries.findIndex((e) => e.path === newEntry.path);
    if (existing !== -1) {
      console.log(
        `[wui-page-manage] Replacing existing entry for path "${newEntry.path}".`
      );
      entries.splice(existing, 1, newEntry);
    } else {
      entries.push(newEntry);
      console.log(`[wui-page-manage] Registered "${newEntry.path}".`);
    }
    changed = true;
  }

  if (changed) {
    menuconfig.entries = entries;
    writeJson(menuconfigPath, menuconfig);
    console.log(`[wui-page-manage] Updated ${menuconfigPath}`);
  }
}

export function mirrorDir(srcRoot, dstRoot, label) {
  if (!fs.existsSync(srcRoot)) return;
  for (const file of walkFiles(srcRoot)) {
    const rel = path.relative(srcRoot, file);
    const dst = path.join(dstRoot, rel);
    if (fs.existsSync(dst)) {
      console.log(`[wui-page-manage] ${label}/${rel} already exists - skipping.`);
      continue;
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(file, dst);
    console.log(`[wui-page-manage] Seeded ${label}/${rel}`);
  }
}

/**
 * Render the same banner format that printNextSteps prints, but
 * return it as a string instead of logging. Useful for writing the
 * hint to disk so it survives npm's postinstall stdout suppression.
 */
export function formatNextSteps(title, steps, footer = []) {
  const lines = [];
  steps.forEach((step, idx) => {
    if (Array.isArray(step)) {
      lines.push(`  ${idx + 1}. ${step[0]}`);
      for (const sub of step.slice(1)) lines.push(`       ${sub}`);
    } else {
      lines.push(`  ${idx + 1}. ${step}`);
    }
  });
  const footerLines = footer.map((f) => `  ${f}`);
  const width = Math.max(
    title.length + 4,
    ...lines.map((l) => l.length + 2),
    ...footerLines.map((l) => l.length + 2),
    62
  );
  const border = '='.repeat(width);
  const thin = '-'.repeat(width);

  const out = [];
  out.push(border);
  out.push(`  *** ACTION REQUIRED: ${title}`);
  out.push(border);
  for (const line of lines) out.push(line);
  if (footerLines.length) {
    out.push(thin);
    for (const line of footerLines) out.push(line);
  }
  out.push(border);
  return out.join('\n') + '\n';
}

/**
 * Print a visually prominent "next steps" banner so the manual
 * follow-up actions are not lost in npm's normal install output.
 *
 * `steps`: array of strings (numbered) or string-arrays (numbered head
 *          line + indented sub-lines).
 * `footer`: optional array of unnumbered prose lines printed below the
 *           steps with a thin separator - use it for "why" or warnings.
 *
 *   printNextSteps('Tunnel Demo - setup', [
 *     'Open the WinCC OA Console.',
 *     ['Append a manager:', 'Type = JavaScript Manager', '-jsdir _sim']
 *   ], [
 *     'Without this the page loads but no actual values move.'
 *   ]);
 */
export function printNextSteps(title, steps, footer = []) {
  const lines = [];
  steps.forEach((step, idx) => {
    if (Array.isArray(step)) {
      lines.push(`  ${idx + 1}. ${step[0]}`);
      for (const sub of step.slice(1)) lines.push(`       ${sub}`);
    } else {
      lines.push(`  ${idx + 1}. ${step}`);
    }
  });
  const footerLines = footer.map((f) => `  ${f}`);
  const width = Math.max(
    title.length + 4,
    ...lines.map((l) => l.length + 2),
    ...footerLines.map((l) => l.length + 2),
    62
  );
  const border = '='.repeat(width);
  const thin = '-'.repeat(width);
  const pad = (s) => s + ' '.repeat(Math.max(0, width - s.length));

  console.log('');
  console.log(border);
  console.log(pad(`  *** ACTION REQUIRED: ${title}`));
  console.log(border);
  for (const line of lines) console.log(pad(line));
  if (footerLines.length) {
    console.log(thin);
    for (const line of footerLines) console.log(pad(line));
  }
  console.log(border);
  console.log('');
}

function stripJsonComments(text) {
  let result = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '"') {
      result += text[i++];
      while (i < text.length) {
        if (text[i] === '\\') {
          result += text[i++];
          if (i < text.length) result += text[i++];
        } else if (text[i] === '"') {
          result += text[i++];
          break;
        } else {
          result += text[i++];
        }
      }
      continue;
    }
    if (text[i] === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (text[i] === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    result += text[i++];
  }
  return result;
}
