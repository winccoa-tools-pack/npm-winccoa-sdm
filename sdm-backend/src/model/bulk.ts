// -----------------------------------------------------------------------------
// Bulk import / export — the spreadsheet round-trip. Engineers export instances
// to a flat table, edit in Excel/CSV, and re-import. Import is computed as a
// DIFF first (creates / updates / unchanged / errors) so it can be previewed
// (dry-run) before anything is written; apply then upserts by `dp` key.
//
// Row schema (flat object / CSV columns):
//   dp     – data-point name (primary key, required)
//   class  – class IRI (required for new rows)
//   label  – display label
//   parent – parent dp via the containment relation (default isa:partOf)
//   <name> – one column per data property; foreign / empty columns are ignored
// -----------------------------------------------------------------------------
import { getClass, listClasses, effectiveProperties } from './ontology';
import { getInstance, listInstances, createInstance, updateInstance } from './instances';
import { assertRelation, retractRelation, getNeighbors } from './relations';
import { coerceValue } from './coerce';

type Row = { [k: string]: unknown };

const RESERVED = new Set(['dp', 'class', 'label', 'parent']);
const DEFAULT_REL = 'isa:partOf';

function normalize(v: unknown): string {
  if (Array.isArray(v)) return v.join(',');
  return v === null || v === undefined ? '' : String(v);
}

/** Read known, non-empty property columns from a row into `out` (coerced). */
function collectProps(row: Row, propMap: Map<string, { type: string }>, out: Row): void {
  for (const [k, v] of Object.entries(row)) {
    if (RESERVED.has(k)) continue;
    const ep = propMap.get(k);
    if (!ep) continue; // foreign column (e.g. union export) — ignore
    if (v === '' || v === null || v === undefined) continue; // empty — don't overwrite
    out[k] = coerceValue(ep.type, v);
  }
}

// ---- export -----------------------------------------------------------------
export interface ExportResult {
  columns: string[];
  rows: Row[];
}

/** Dump instances to a flat table. With no classIri: every concrete class. */
export async function exportInstances(classIri?: string, relIri: string = DEFAULT_REL): Promise<ExportResult> {
  const defs = classIri
    ? (getClass(classIri) ? [getClass(classIri)!] : [])
    : listClasses().filter((c) => c.mappedDpType && !c.isAbstract);

  const propNames = new Set<string>();
  const rows: Row[] = [];
  for (const cls of defs) {
    for (const ep of effectiveProperties(cls.iri)) propNames.add(ep.name);
    const list = await listInstances(cls.iri, { limit: 1_000_000 });
    for (const it of list.items) {
      const inst = await getInstance(it.dp);
      if (!inst) continue;
      const parent = (await getNeighbors(it.dp, { direction: 'out', rel: relIri, limit: 1 }))[0]?.dp || '';
      const row: Row = { dp: inst.dp, class: inst.classIri, label: inst.label, parent };
      for (const [k, v] of Object.entries(inst.properties)) row[k] = Array.isArray(v) ? v.join(',') : v;
      rows.push(row);
    }
  }
  return { columns: ['dp', 'class', 'label', 'parent', ...[...propNames].sort()], rows };
}

// ---- import (diff + apply) --------------------------------------------------
export interface CreatePlan {
  dp: string;
  class: string;
  label: string;
  parent: string;
  properties: Row;
}
export interface UpdatePlan {
  dp: string;
  changes: { [field: string]: { from: unknown; to: unknown } };
  label?: string;
  parent?: string;
  properties: Row;
}
export interface ImportDiff {
  creates: CreatePlan[];
  updates: UpdatePlan[];
  unchanged: number;
  errors: { dp: string; msg: string }[];
  summary: { rows: number; creates: number; updates: number; unchanged: number; errors: number };
}

export async function importPlan(rows: Row[], opts: { relIri?: string } = {}): Promise<ImportDiff> {
  const relIri = opts.relIri || DEFAULT_REL;
  const creates: CreatePlan[] = [];
  const updates: UpdatePlan[] = [];
  const errors: { dp: string; msg: string }[] = [];
  let unchanged = 0;
  const incomingDps = new Set(rows.map((r) => String(r.dp ?? '').trim()).filter(Boolean));

  for (const row of rows) {
    const dp = String(row.dp ?? '').trim();
    if (!dp) {
      errors.push({ dp: '', msg: 'missing dp' });
      continue;
    }
    const cls = String(row.class ?? '').trim();
    const label = row.label !== undefined ? String(row.label) : undefined;
    const parent = row.parent !== undefined ? String(row.parent).trim() : undefined;
    const inst = await getInstance(dp);

    if (!inst) {
      // --- create ---
      if (!cls) {
        errors.push({ dp, msg: 'new row needs a class' });
        continue;
      }
      const cd = getClass(cls);
      if (!cd) {
        errors.push({ dp, msg: `unknown class: ${cls}` });
        continue;
      }
      if (cd.isAbstract) {
        errors.push({ dp, msg: `class is abstract: ${cls}` });
        continue;
      }
      if (parent && !incomingDps.has(parent) && !(await getInstance(parent))) {
        errors.push({ dp, msg: `parent not found: ${parent}` });
        continue;
      }
      const properties: Row = {};
      collectProps(row, new Map(effectiveProperties(cls).map((p) => [p.name, p])), properties);
      creates.push({ dp, class: cls, label: label || dp, parent: parent || '', properties });
    } else {
      // --- update (diff) ---
      const propMap = new Map(effectiveProperties(inst.classIri).map((p) => [p.name, p]));
      const properties: Row = {};
      collectProps(row, propMap, properties);
      const changes: UpdatePlan['changes'] = {};
      if (label !== undefined && label !== inst.label) changes.label = { from: inst.label, to: label };
      for (const [k, v] of Object.entries(properties)) {
        if (normalize(inst.properties[k]) !== normalize(v)) changes[k] = { from: inst.properties[k], to: v };
      }
      if (parent !== undefined) {
        const curParent = (await getNeighbors(dp, { direction: 'out', rel: relIri, limit: 1 }))[0]?.dp || '';
        if (parent !== curParent) changes.parent = { from: curParent, to: parent };
      }
      if (Object.keys(changes).length) updates.push({ dp, changes, label, parent, properties });
      else unchanged++;
    }
  }

  return {
    creates,
    updates,
    unchanged,
    errors,
    summary: { rows: rows.length, creates: creates.length, updates: updates.length, unchanged, errors: errors.length }
  };
}

export interface ImportResult {
  created: number;
  updated: number;
  unchanged: number;
  errors: string[];
  summary: ImportDiff['summary'];
}

export async function importApply(rows: Row[], opts: { relIri?: string } = {}): Promise<ImportResult> {
  const relIri = opts.relIri || DEFAULT_REL;
  const plan = await importPlan(rows, { relIri });
  const result: ImportResult = {
    created: 0,
    updated: 0,
    unchanged: plan.unchanged,
    errors: plan.errors.map((e) => `${e.dp}: ${e.msg}`),
    summary: plan.summary
  };

  // pass 1: instances (no edges yet, so in-batch parents can be referenced)
  for (const c of plan.creates) {
    try {
      await createInstance({ classIri: c.class, name: c.dp, label: c.label, properties: c.properties });
      result.created++;
    } catch (e) {
      result.errors.push(`${c.dp}: ${(e as Error).message}`);
    }
  }
  for (const u of plan.updates) {
    try {
      const patch: { label?: string; properties: Row } = { properties: u.properties };
      if (u.changes.label) patch.label = u.label;
      await updateInstance(u.dp, patch);
      result.updated++;
    } catch (e) {
      result.errors.push(`${u.dp}: ${(e as Error).message}`);
    }
  }

  // pass 2: reconcile parent edges
  const reparent = [
    ...plan.creates.filter((c) => c.parent).map((c) => ({ dp: c.dp, parent: c.parent })),
    ...plan.updates.filter((u) => u.changes.parent).map((u) => ({ dp: u.dp, parent: u.parent || '' }))
  ];
  for (const r of reparent) {
    try {
      const cur = (await getNeighbors(r.dp, { direction: 'out', rel: relIri, limit: 1 }))[0]?.dp || '';
      if (r.parent === cur) continue;
      if (cur) await retractRelation({ relIri, source: r.dp, target: cur });
      if (r.parent) await assertRelation({ relIri, source: r.dp, target: r.parent });
    } catch (e) {
      result.errors.push(`${r.dp} parent: ${(e as Error).message}`);
    }
  }
  return result;
}
