"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportInstances = exportInstances;
exports.importPlan = importPlan;
exports.importApply = importApply;
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
const ontology_1 = require("./ontology");
const instances_1 = require("./instances");
const relations_1 = require("./relations");
const coerce_1 = require("./coerce");
const RESERVED = new Set(['dp', 'class', 'label', 'parent']);
const DEFAULT_REL = 'isa:partOf';
function normalize(v) {
    if (Array.isArray(v))
        return v.join(',');
    return v === null || v === undefined ? '' : String(v);
}
/** Read known, non-empty property columns from a row into `out` (coerced). */
function collectProps(row, propMap, out) {
    for (const [k, v] of Object.entries(row)) {
        if (RESERVED.has(k))
            continue;
        const ep = propMap.get(k);
        if (!ep)
            continue; // foreign column (e.g. union export) — ignore
        if (v === '' || v === null || v === undefined)
            continue; // empty — don't overwrite
        out[k] = (0, coerce_1.coerceValue)(ep.type, v);
    }
}
/** Dump instances to a flat table. With no classIri: every concrete class. */
async function exportInstances(classIri, relIri = DEFAULT_REL) {
    const defs = classIri
        ? ((0, ontology_1.getClass)(classIri) ? [(0, ontology_1.getClass)(classIri)] : [])
        : (0, ontology_1.listClasses)().filter((c) => c.mappedDpType && !c.isAbstract);
    const propNames = new Set();
    const rows = [];
    for (const cls of defs) {
        for (const ep of (0, ontology_1.effectiveProperties)(cls.iri))
            propNames.add(ep.name);
        const list = await (0, instances_1.listInstances)(cls.iri, { limit: 1_000_000 });
        for (const it of list.items) {
            const inst = await (0, instances_1.getInstance)(it.dp);
            if (!inst)
                continue;
            const parent = (await (0, relations_1.getNeighbors)(it.dp, { direction: 'out', rel: relIri, limit: 1 }))[0]?.dp || '';
            const row = { dp: inst.dp, class: inst.classIri, label: inst.label, parent };
            for (const [k, v] of Object.entries(inst.properties))
                row[k] = Array.isArray(v) ? v.join(',') : v;
            rows.push(row);
        }
    }
    return { columns: ['dp', 'class', 'label', 'parent', ...[...propNames].sort()], rows };
}
async function importPlan(rows, opts = {}) {
    const relIri = opts.relIri || DEFAULT_REL;
    const creates = [];
    const updates = [];
    const errors = [];
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
        const inst = await (0, instances_1.getInstance)(dp);
        if (!inst) {
            // --- create ---
            if (!cls) {
                errors.push({ dp, msg: 'new row needs a class' });
                continue;
            }
            const cd = (0, ontology_1.getClass)(cls);
            if (!cd) {
                errors.push({ dp, msg: `unknown class: ${cls}` });
                continue;
            }
            if (cd.isAbstract) {
                errors.push({ dp, msg: `class is abstract: ${cls}` });
                continue;
            }
            if (parent && !incomingDps.has(parent) && !(await (0, instances_1.getInstance)(parent))) {
                errors.push({ dp, msg: `parent not found: ${parent}` });
                continue;
            }
            const properties = {};
            collectProps(row, new Map((0, ontology_1.effectiveProperties)(cls).map((p) => [p.name, p])), properties);
            creates.push({ dp, class: cls, label: label || dp, parent: parent || '', properties });
        }
        else {
            // --- update (diff) ---
            const propMap = new Map((0, ontology_1.effectiveProperties)(inst.classIri).map((p) => [p.name, p]));
            const properties = {};
            collectProps(row, propMap, properties);
            const changes = {};
            if (label !== undefined && label !== inst.label)
                changes.label = { from: inst.label, to: label };
            for (const [k, v] of Object.entries(properties)) {
                if (normalize(inst.properties[k]) !== normalize(v))
                    changes[k] = { from: inst.properties[k], to: v };
            }
            if (parent !== undefined) {
                const curParent = (await (0, relations_1.getNeighbors)(dp, { direction: 'out', rel: relIri, limit: 1 }))[0]?.dp || '';
                if (parent !== curParent)
                    changes.parent = { from: curParent, to: parent };
            }
            if (Object.keys(changes).length)
                updates.push({ dp, changes, label, parent, properties });
            else
                unchanged++;
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
async function importApply(rows, opts = {}) {
    const relIri = opts.relIri || DEFAULT_REL;
    const plan = await importPlan(rows, { relIri });
    const result = {
        created: 0,
        updated: 0,
        unchanged: plan.unchanged,
        errors: plan.errors.map((e) => `${e.dp}: ${e.msg}`),
        summary: plan.summary
    };
    // pass 1: instances (no edges yet, so in-batch parents can be referenced)
    for (const c of plan.creates) {
        try {
            await (0, instances_1.createInstance)({ classIri: c.class, name: c.dp, label: c.label, properties: c.properties });
            result.created++;
        }
        catch (e) {
            result.errors.push(`${c.dp}: ${e.message}`);
        }
    }
    for (const u of plan.updates) {
        try {
            const patch = { properties: u.properties };
            if (u.changes.label)
                patch.label = u.label;
            await (0, instances_1.updateInstance)(u.dp, patch);
            result.updated++;
        }
        catch (e) {
            result.errors.push(`${u.dp}: ${e.message}`);
        }
    }
    // pass 2: reconcile parent edges
    const reparent = [
        ...plan.creates.filter((c) => c.parent).map((c) => ({ dp: c.dp, parent: c.parent })),
        ...plan.updates.filter((u) => u.changes.parent).map((u) => ({ dp: u.dp, parent: u.parent || '' }))
    ];
    for (const r of reparent) {
        try {
            const cur = (await (0, relations_1.getNeighbors)(r.dp, { direction: 'out', rel: relIri, limit: 1 }))[0]?.dp || '';
            if (r.parent === cur)
                continue;
            if (cur)
                await (0, relations_1.retractRelation)({ relIri, source: r.dp, target: cur });
            if (r.parent)
                await (0, relations_1.assertRelation)({ relIri, source: r.dp, target: r.parent });
        }
        catch (e) {
            result.errors.push(`${r.dp} parent: ${e.message}`);
        }
    }
    return result;
}
//# sourceMappingURL=bulk.js.map