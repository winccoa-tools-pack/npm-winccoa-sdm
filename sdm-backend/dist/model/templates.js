"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTemplate = createTemplate;
exports.listTemplates = listTemplates;
exports.getTemplate = getTemplate;
exports.deleteTemplate = deleteTemplate;
exports.instantiateTemplate = instantiateTemplate;
// -----------------------------------------------------------------------------
// Templates / typicals — reusable parametrized sub-networks (ISA-88 equipment
// modules). A template defines a set of instance nodes (with {param} slots in
// names / labels / property values) plus internal relations. Instantiating it
// with a list of bindings stamps the whole structure out N times — the core
// leverage for engineering large systems.
//
// Templates persist as _SemTemplate data points (one per template, full JSON in
// `defJson`) so they survive restarts and replicate via redundancy.
//
// Edge endpoints reference a node by its `key`, or an EXTERNAL data point via
// "@<param>" (the binding supplies the dp name) — e.g. attach the whole module
// under an existing parent: { rel: 'isa:partOf', src: 'unit', tgt: '@parent' }.
// -----------------------------------------------------------------------------
const oa_1 = require("../oa");
const constants_1 = require("../constants");
const ontology_1 = require("./ontology");
const instances_1 = require("./instances");
const relations_1 = require("./relations");
const coerce_1 = require("./coerce");
const TPL_PREFIX = '_tpl_';
const tplDp = (id) => TPL_PREFIX + (0, oa_1.sanitizeName)(id);
function subst(s, b) {
    return s.replace(/\{(\w+)\}/g, (_m, k) => (b[k] !== undefined ? String(b[k]) : `{${k}}`));
}
// ---- CRUD -------------------------------------------------------------------
async function createTemplate(def) {
    if (!def?.id)
        throw new Error('template id required');
    if (!Array.isArray(def.nodes) || def.nodes.length === 0)
        throw new Error('template needs at least one node');
    for (const n of def.nodes) {
        if (!n.key || !n.classIri || !n.name)
            throw new Error(`template node needs key, classIri and name (got ${JSON.stringify(n)})`);
    }
    const dp = tplDp(def.id);
    if (!(await (0, oa_1.exists)(dp)))
        await (0, oa_1.oa)().dpCreate(dp, constants_1.DPT.TEMPLATE);
    await (0, oa_1.oa)().dpSetWait([`${dp}.id`, `${dp}.label`, `${dp}.defJson`], [def.id, def.label || def.id, JSON.stringify(def)]);
    oa_1.log.info(`saved template ${def.id} (${def.nodes.length} nodes)`);
    return def;
}
async function listTemplates() {
    const dps = (0, oa_1.oa)().dpNames('*', constants_1.DPT.TEMPLATE).map(oa_1.localName).sort();
    const out = [];
    for (const dp of dps) {
        try {
            out.push(JSON.parse((await (0, oa_1.oa)().dpGet(`${dp}.defJson`))));
        }
        catch {
            /* skip malformed */
        }
    }
    return out;
}
async function getTemplate(id) {
    const dp = tplDp(id);
    if (!(await (0, oa_1.exists)(dp)))
        return null;
    try {
        return JSON.parse((await (0, oa_1.oa)().dpGet(`${dp}.defJson`)));
    }
    catch {
        return null;
    }
}
async function deleteTemplate(id) {
    const dp = tplDp(id);
    if (!(await (0, oa_1.exists)(dp)))
        return false;
    await (0, oa_1.oa)().dpDelete(dp);
    oa_1.log.info(`deleted template ${id}`);
    return true;
}
async function instantiateTemplate(id, bindings, opts = {}) {
    const tpl = await getTemplate(id);
    if (!tpl)
        throw new Error(`unknown template: ${id}`);
    const rows = Array.isArray(bindings) ? bindings : [bindings];
    const onConflict = opts.onConflict || 'error';
    const plan = [];
    for (const b of rows)
        plan.push(await planRow(tpl, b || {}));
    const summary = {
        rows: rows.length,
        toCreate: plan.reduce((a, p) => a + p.instances.filter((i) => !i.exists).length, 0),
        conflicts: plan.reduce((a, p) => a + p.instances.filter((i) => i.exists).length, 0),
        edges: plan.reduce((a, p) => a + p.edges.length, 0),
        errors: plan.reduce((a, p) => a + p.errors.length, 0)
    };
    const result = { template: id, dryRun: !!opts.dryRun, plan, summary };
    if (opts.dryRun)
        return result;
    result.applied = await applyPlan(plan, onConflict);
    return result;
}
async function planRow(tpl, b) {
    const errors = [];
    const keyToDp = new Map();
    const insts = [];
    for (const n of tpl.nodes) {
        const cls = (0, ontology_1.getClass)(n.classIri);
        const dp = (0, oa_1.sanitizeName)(subst(n.name, b));
        keyToDp.set(n.key, dp);
        if (!cls)
            errors.push(`node ${n.key}: unknown class ${n.classIri}`);
        else if (cls.isAbstract)
            errors.push(`node ${n.key}: class ${n.classIri} is abstract`);
        const propMap = cls ? new Map((0, ontology_1.effectiveProperties)(n.classIri).map((p) => [p.name, p])) : new Map();
        const properties = {};
        for (const [pk, pv] of Object.entries(n.properties || {})) {
            const ep = propMap.get(pk);
            if (!ep) {
                errors.push(`node ${n.key}: unknown property '${pk}'`);
                continue;
            }
            const sv = typeof pv === 'string' ? subst(pv, b) : pv;
            properties[pk] = (0, coerce_1.coerceValue)(ep.type, sv);
        }
        insts.push({ key: n.key, dp, classIri: n.classIri, label: subst(n.label || n.name, b), properties, exists: await (0, oa_1.exists)(dp) });
    }
    const edges = [];
    for (const e of tpl.edges || []) {
        const src = resolveEndpoint(e.src, keyToDp, b, errors);
        const tgt = resolveEndpoint(e.tgt, keyToDp, b, errors);
        if (src && tgt)
            edges.push({ rel: e.rel, src, tgt });
    }
    return { binding: b, instances: insts, edges, errors };
}
function resolveEndpoint(ref, keyToDp, b, errors) {
    if (ref.startsWith('@')) {
        const param = ref.slice(1);
        const dp = b[param];
        if (!dp) {
            errors.push(`edge endpoint @${param} not provided in binding`);
            return null;
        }
        return (0, oa_1.sanitizeName)(String(dp));
    }
    const dp = keyToDp.get(ref);
    if (!dp) {
        errors.push(`edge endpoint '${ref}' is not a node key`);
        return null;
    }
    return dp;
}
async function applyPlan(plan, onConflict) {
    const applied = { created: 0, updated: 0, skipped: 0, edges: 0, errors: [] };
    // pass 1: instances
    for (const p of plan) {
        if (p.errors.length) {
            applied.errors.push(...p.errors);
            continue;
        }
        for (const i of p.instances) {
            try {
                if (i.exists) {
                    if (onConflict === 'skip') {
                        applied.skipped++;
                        continue;
                    }
                    if (onConflict === 'update') {
                        await (0, instances_1.updateInstance)(i.dp, { label: i.label, properties: i.properties });
                        applied.updated++;
                        continue;
                    }
                    throw new Error(`instance already exists: ${i.dp}`);
                }
                await (0, instances_1.createInstance)({ classIri: i.classIri, name: i.dp, label: i.label, properties: i.properties });
                applied.created++;
            }
            catch (err) {
                applied.errors.push(`${i.dp}: ${err.message}`);
            }
        }
    }
    // pass 2: edges (after every instance exists)
    for (const p of plan) {
        if (p.errors.length)
            continue;
        for (const e of p.edges) {
            try {
                await (0, relations_1.assertRelation)({ relIri: e.rel, source: e.src, target: e.tgt });
                applied.edges++;
            }
            catch (err) {
                applied.errors.push(`edge ${e.rel} ${e.src}->${e.tgt}: ${err.message}`);
            }
        }
    }
    return applied;
}
//# sourceMappingURL=templates.js.map