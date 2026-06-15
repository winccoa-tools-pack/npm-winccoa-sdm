"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateModel = validateModel;
// -----------------------------------------------------------------------------
// Model validator / linter — scans the whole ABox for consistency problems that
// are infeasible to spot by hand at scale. One sweep over the adjacency lists +
// class map (three dpQueries), then in-memory checks:
//
//   • unknownClass    – instance whose sem.classIri is not a known class
//   • orphanEdge      – edge endpoint data point does not exist
//   • adjacency       – out-edge without the matching in-edge on the target (or
//                       vice versa) — the bidirectional lists are out of sync
//   • cardinality     – functional / 0..1 / 1 relation with >1 outgoing edge
//   • domain / range  – edge endpoint's class violates the relation's domain/range
// -----------------------------------------------------------------------------
const oa_1 = require("../oa");
const constants_1 = require("../constants");
const instances_1 = require("./instances");
const ontology_1 = require("./ontology");
const MAX_FINDINGS = 1000;
async function dpStringMap(elem) {
    const tab = (await (0, oa_1.oa)().dpQuery(`SELECT '_online.._value' FROM '*.${elem}'`));
    const map = new Map();
    for (let i = 1; i < tab.length; i++) {
        const dpe = tab[i]?.[0];
        if (typeof dpe !== 'string')
            continue;
        map.set((0, oa_1.localName)(dpe).replace(/\.sem\..*$/, ''), tab[i]?.[1] == null ? '' : String(tab[i][1]));
    }
    return map;
}
async function dpEdgeMap(elem) {
    const tab = (await (0, oa_1.oa)().dpQuery(`SELECT '_online.._value' FROM '*.${elem}'`));
    const map = new Map();
    for (let i = 1; i < tab.length; i++) {
        const dpe = tab[i]?.[0];
        if (typeof dpe !== 'string')
            continue;
        map.set((0, oa_1.localName)(dpe).replace(/\.sem\..*$/, ''), (0, instances_1.parseEdges)(tab[i]?.[1]));
    }
    return map;
}
/** A class satisfies a domain/range list if the list is empty or the class (or
 *  any ancestor) is named in it. */
function classMatches(cls, list) {
    if (!list || list.length === 0)
        return true;
    if (!cls)
        return false;
    if (list.includes(cls))
        return true;
    for (const a of (0, ontology_1.ancestorsOf)(cls))
        if (list.includes(a))
            return true;
    return false;
}
const edgeKey = (e) => `${e.rel}|${(0, oa_1.localName)(e.src)}|${(0, oa_1.localName)(e.tgt)}`;
async function validateModel() {
    const classIri = await dpStringMap(constants_1.SEM.CLASS_IRI);
    const outMap = await dpEdgeMap(constants_1.SEM.EDGES_OUT);
    const inMap = await dpEdgeMap(constants_1.SEM.EDGES_IN);
    const dps = new Set(classIri.keys());
    const findings = [];
    let edges = 0;
    let truncated = false;
    const add = (severity, kind, subject, message) => {
        if (findings.length >= MAX_FINDINGS) {
            truncated = true;
            return;
        }
        findings.push({ severity, kind, subject, message });
    };
    // 1) unknown class on an instance
    for (const [dp, iri] of classIri) {
        if (iri && !(0, ontology_1.getClass)(iri))
            add('error', 'unknownClass', dp, `instance class is not in the model: ${iri}`);
    }
    // index incoming edges by key for the adjacency check
    const inKeys = new Set();
    for (const list of inMap.values())
        for (const e of list)
            inKeys.add(edgeKey(e));
    const outKeys = new Set();
    for (const list of outMap.values())
        for (const e of list)
            outKeys.add(edgeKey(e));
    // 2) per outgoing edge: orphan / adjacency / cardinality / domain+range
    for (const [dp, list] of outMap) {
        const perRel = new Map();
        for (const e of list) {
            edges++;
            const tgtDp = (0, oa_1.localName)(e.tgt);
            const rel = (0, ontology_1.getRelationType)(e.rel);
            perRel.set(e.rel, (perRel.get(e.rel) || 0) + 1);
            if (!dps.has(tgtDp))
                add('error', 'orphanEdge', dp, `${e.rel} → missing data point '${tgtDp}'`);
            if (!inKeys.has(edgeKey(e)))
                add('warning', 'adjacency', dp, `${e.rel} → ${tgtDp}: no matching incoming edge on target`);
            if (rel) {
                if (!classMatches(classIri.get(dp), rel.domain))
                    add('error', 'domain', dp, `${e.rel}: source class ${classIri.get(dp) || '∅'} not in domain [${rel.domain.join(', ')}]`);
                if (!classMatches(classIri.get(tgtDp), rel.range))
                    add('error', 'range', dp, `${e.rel} → ${tgtDp}: target class ${classIri.get(tgtDp) || '∅'} not in range [${rel.range.join(', ')}]`);
            }
            else {
                add('error', 'unknownRelation', dp, `edge uses unknown relation type: ${e.rel}`);
            }
        }
        for (const [relIri, n] of perRel) {
            const rel = (0, ontology_1.getRelationType)(relIri);
            const maxOne = rel && (rel.functional || rel.cardinality === '0..1' || rel.cardinality === '1');
            if (maxOne && n > 1)
                add('error', 'cardinality', dp, `${relIri}: ${n} outgoing edges but relation is single-valued (${rel?.cardinality}${rel?.functional ? ', functional' : ''})`);
        }
    }
    // 3) per incoming edge: orphan source / adjacency (missing out-edge)
    for (const [dp, list] of inMap) {
        for (const e of list) {
            const srcDp = (0, oa_1.localName)(e.src);
            if (!dps.has(srcDp))
                add('error', 'orphanEdge', dp, `incoming ${e.rel} ← missing data point '${srcDp}'`);
            if (!outKeys.has(edgeKey(e)))
                add('warning', 'adjacency', dp, `incoming ${e.rel} ← ${srcDp}: no matching outgoing edge on source`);
        }
    }
    const summary = {
        instances: dps.size,
        edges,
        errors: findings.filter((f) => f.severity === 'error').length,
        warnings: findings.filter((f) => f.severity === 'warning').length,
        info: findings.filter((f) => f.severity === 'info').length,
        checks: ['unknownClass', 'orphanEdge', 'adjacency', 'cardinality', 'domain', 'range']
    };
    return { findings, truncated, summary };
}
//# sourceMappingURL=validate.js.map