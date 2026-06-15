"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveClassIri = deriveClassIri;
exports.resolveDp = resolveDp;
exports.parseEdges = parseEdges;
exports.createInstance = createInstance;
exports.getInstance = getInstance;
exports.setProperties = setProperties;
exports.updateInstance = updateInstance;
exports.listInstances = listInstances;
exports.deleteInstanceRaw = deleteInstanceRaw;
// -----------------------------------------------------------------------------
// ABox / instance lifecycle. Each instance is one DP of the class' mapped
// dpType. The DP name is the primary key; its IRI defaults to "System:dpName".
// Property values are plain DPE values and carry the full OA config power
// (archive / alert / address).
// -----------------------------------------------------------------------------
const oa_1 = require("../oa");
const constants_1 = require("../constants");
const ontology_1 = require("./ontology");
const redu_1 = require("../redu");
/** Derive the semantic class IRI of a data point from its dpType. */
function deriveClassIri(dp) {
    try {
        return (0, ontology_1.getClassByDpType)((0, oa_1.oa)().dpTypeName(dp))?.iri || '';
    }
    catch {
        return '';
    }
}
function resolveDp(ref) {
    return (0, oa_1.localName)(ref);
}
function parseEdges(dynStr) {
    if (!Array.isArray(dynStr))
        return [];
    const out = [];
    for (const s of dynStr) {
        try {
            out.push(JSON.parse(s));
        }
        catch {
            /* skip malformed */
        }
    }
    return out;
}
async function createInstance(def) {
    const cls = (0, ontology_1.getClass)(def.classIri);
    if (!cls)
        throw new Error(`unknown class: ${def.classIri}`);
    if (cls.isAbstract)
        throw new Error(`class is abstract, cannot instantiate: ${def.classIri}`);
    const dp = (0, oa_1.sanitizeName)(def.name || def.iri || `${(0, ontology_1.localname)(def.classIri)}_${Date.now()}`);
    if (await (0, oa_1.exists)(dp))
        throw new Error(`instance already exists: ${dp}`);
    await (0, oa_1.oa)().dpCreate(dp, cls.mappedDpType);
    const iri = (0, oa_1.qualify)(dp);
    const dpes = [`${dp}.${constants_1.SEM.IRI}`, `${dp}.${constants_1.SEM.CLASS_IRI}`, `${dp}.${constants_1.SEM.LABEL}`];
    const vals = [iri, def.classIri, def.label || dp];
    const propMap = new Map((0, ontology_1.effectiveProperties)(def.classIri).map((p) => [p.name, p]));
    for (const [k, v] of Object.entries(def.properties || {})) {
        const ep = propMap.get(k);
        if (!ep)
            throw new Error(`unknown property '${k}' on class ${def.classIri}`);
        dpes.push(`${dp}.${ep.path}`);
        vals.push(v);
    }
    await (0, oa_1.oa)().dpSetWait(dpes, vals);
    try {
        await (0, oa_1.oa)().dpSet(`${dp}.${constants_1.SEM.CREATED}`, new Date());
    }
    catch {
        /* createdAt is best-effort */
    }
    oa_1.log.info(`created instance ${dp} of ${def.classIri}`);
    return getInstance(dp);
}
/**
 * Read an instance's property values resiliently. A single dpGet over all DPEs is
 * the fast path, but an adopted dpType may expose elements that are not directly
 * addressable as a value (e.g. an unexpanded type reference or a container node),
 * which makes the whole batch dpGet reject. In that case fall back to reading each
 * DPE on its own so a couple of bad paths don't blank the entire inspector.
 */
async function readProps(dp, propDefs) {
    const properties = {};
    if (!propDefs.length)
        return properties;
    const names = propDefs.map((p) => `${dp}.${p.path}`);
    try {
        const values = (await (0, oa_1.oa)().dpGet(names));
        propDefs.forEach((p, i) => (properties[p.name] = values[i]));
    }
    catch {
        for (const p of propDefs) {
            try {
                properties[p.name] = await (0, oa_1.oa)().dpGet(`${dp}.${p.path}`);
            }
            catch {
                properties[p.name] = null;
            }
        }
    }
    return properties;
}
async function getInstance(ref) {
    const dp = resolveDp(ref);
    if (!(await (0, oa_1.exists)(dp)))
        return null;
    const head = (await (0, oa_1.oa)().dpGet([
        `${dp}.${constants_1.SEM.IRI}`, `${dp}.${constants_1.SEM.CLASS_IRI}`, `${dp}.${constants_1.SEM.LABEL}`,
        `${dp}.${constants_1.SEM.EDGES_OUT}`, `${dp}.${constants_1.SEM.EDGES_IN}`, `${dp}.${constants_1.SEM.CREATED}`
    ]));
    // Reconstruct semantic metadata from the data point itself when the sem.*
    // fields were not populated (e.g. the DP was created externally in PARA / via
    // a raw dpCreate). The dpType is the ground truth for the class.
    const iri = head[0] || (0, oa_1.qualify)(dp);
    const classIri = head[1] || deriveClassIri(dp);
    const label = head[2] || dp;
    await healSem(dp, head, iri, classIri, label);
    const properties = await readProps(dp, (0, ontology_1.effectiveProperties)(classIri));
    return {
        dp,
        iri,
        classIri,
        label,
        createdAt: head[5],
        properties,
        edgesOut: parseEdges(head[3]),
        edgesIn: parseEdges(head[4])
    };
}
/** Persist derived semantic fields that were missing, so the DP becomes a full
 *  semantic citizen. No-op on the standby peer or when nothing is missing. */
async function healSem(dp, head, iri, classIri, label) {
    if (!(0, redu_1.mayWrite)())
        return;
    const dpes = [];
    const vals = [];
    if (!head[0] && iri) {
        dpes.push(`${dp}.${constants_1.SEM.IRI}`);
        vals.push(iri);
    }
    if (!head[1] && classIri) {
        dpes.push(`${dp}.${constants_1.SEM.CLASS_IRI}`);
        vals.push(classIri);
    }
    if (!head[2] && label) {
        dpes.push(`${dp}.${constants_1.SEM.LABEL}`);
        vals.push(label);
    }
    if (dpes.length) {
        try {
            await (0, oa_1.oa)().dpSetWait(dpes, vals);
            oa_1.log.info(`reconciled semantic fields of external instance ${dp}`);
        }
        catch {
            /* best-effort */
        }
    }
}
async function setProperties(ref, properties) {
    const dp = resolveDp(ref);
    if (!(await (0, oa_1.exists)(dp)))
        throw new Error(`instance not found: ${dp}`);
    const classIri = (await (0, oa_1.oa)().dpGet(`${dp}.${constants_1.SEM.CLASS_IRI}`));
    const propMap = new Map((0, ontology_1.effectiveProperties)(classIri).map((p) => [p.name, p]));
    const dpes = [];
    const vals = [];
    for (const [k, v] of Object.entries(properties || {})) {
        const ep = propMap.get(k);
        if (!ep)
            throw new Error(`unknown property '${k}' on class ${classIri}`);
        dpes.push(`${dp}.${ep.path}`);
        vals.push(v);
    }
    if (dpes.length)
        await (0, oa_1.oa)().dpSetWait(dpes, vals);
    return getInstance(dp);
}
/** Edit an existing instance: its display label and/or data properties. */
async function updateInstance(ref, def) {
    const dp = resolveDp(ref);
    if (!(await (0, oa_1.exists)(dp)))
        throw new Error(`instance not found: ${dp}`);
    const classIri = (await (0, oa_1.oa)().dpGet(`${dp}.${constants_1.SEM.CLASS_IRI}`)) || deriveClassIri(dp);
    const propMap = new Map((0, ontology_1.effectiveProperties)(classIri).map((p) => [p.name, p]));
    const dpes = [];
    const vals = [];
    if (typeof def.label === 'string') {
        dpes.push(`${dp}.${constants_1.SEM.LABEL}`);
        vals.push(def.label);
    }
    for (const [k, v] of Object.entries(def.properties || {})) {
        const ep = propMap.get(k);
        if (!ep)
            throw new Error(`unknown property '${k}' on class ${classIri}`);
        dpes.push(`${dp}.${ep.path}`);
        vals.push(v);
    }
    if (dpes.length)
        await (0, oa_1.oa)().dpSetWait(dpes, vals);
    oa_1.log.info(`updated instance ${dp}`);
    return getInstance(dp);
}
async function listInstances(classIri, opts = {}) {
    const limit = opts.limit ?? 100;
    const offset = opts.offset ?? 0;
    const cls = (0, ontology_1.getClass)(classIri);
    if (!cls)
        throw new Error(`unknown class: ${classIri}`);
    if (!cls.mappedDpType)
        return { total: 0, items: [] };
    // OA already indexes DPs by type -> no custom instance index needed.
    // Server-side name filter via the dpNames pattern (indexed) keeps large
    // classes from ever materializing in full on the client.
    const search = (opts.search || '').trim();
    const pattern = search ? `*${search}*` : '*';
    const all = (0, oa_1.oa)().dpNames(pattern, cls.mappedDpType).map(oa_1.localName).sort();
    const slice = all.slice(offset, offset + limit);
    const items = [];
    for (const dp of slice) {
        const v = (await (0, oa_1.oa)().dpGet([`${dp}.${constants_1.SEM.IRI}`, `${dp}.${constants_1.SEM.LABEL}`]));
        items.push({ dp, iri: v[0] || (0, oa_1.qualify)(dp), classIri, label: v[1] || dp });
    }
    return { total: all.length, items };
}
/** Raw delete of the instance DP. Edge cleanup is done by the relations layer. */
async function deleteInstanceRaw(ref) {
    const dp = resolveDp(ref);
    if (!(await (0, oa_1.exists)(dp)))
        return false;
    await (0, oa_1.oa)().dpDelete(dp);
    oa_1.log.info(`deleted instance ${dp}`);
    return true;
}
//# sourceMappingURL=instances.js.map