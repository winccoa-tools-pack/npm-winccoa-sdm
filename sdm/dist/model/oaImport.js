"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sumAlertDpName = sumAlertDpName;
exports.planOaImport = planOaImport;
exports.applyOaImport = applyOaImport;
// -----------------------------------------------------------------------------
// WinCC OA → SDM migration. Converts an existing project's navigation + alarm
// structure into the semantic model:
//
//   • _PanelTopology  → asset hierarchy. Each topology node becomes an
//     `oa:TopologyNode` instance; `parentNumber` → `isa:partOf` (0 = root).
//
//   • Sum-alarm configs → DP assignment. Each node owns a `_SumAlertPanel` DP
//     whose name is derived from the node's `fileName`:
//         stripExt(fileName).replace(/[\/\\]/g,'_') + '_' + sumAlertNumber
//     Its member data points are read from the Warning/Alert/Danger elements'
//     `_alert_hdl.._dp_list` (explicit) ∪ `dpNames(_alert_hdl.._dp_pattern)`.
//
//     A WinCC OA data point TYPE is a class, and its data points are the
//     instances — so the migration creates ONE SDM class per member dpType.
//       - adoptDataPoints = true (default): the dpType is ADOPTED as an SDM
//         class (mappedDpType = the real OA type, augmented in place with the
//         `sem` struct). The existing data points then ARE the instances and
//         hang under their node via `isa:partOf`. (Modifies those dpTypes once.)
//       - adoptDataPoints = false: NON-INVASIVE fallback — one `oa:dp:<type>`
//         proxy class per dpType + one lightweight reference instance per DP
//         (`dpRef`); the real DPs are left untouched.
//
// Idempotent; plan first (dry-run diff), then apply.
// -----------------------------------------------------------------------------
const oa_1 = require("../oa");
const ontology_1 = require("./ontology");
const instances_1 = require("./instances");
const relations_1 = require("./relations");
const TOPO_DP = '_PanelTopology';
const REL = 'isa:partOf';
const NODE_CLASS = 'oa:TopologyNode';
const BASE_CLASS = 'isa:EquipmentElement';
const SUM_LEVELS = ['Warning', 'Alert', 'Danger'];
function lstr(v) {
    if (v == null)
        return '';
    if (typeof v === 'string')
        return v;
    if (typeof v === 'object') {
        const vals = Object.values(v).filter((x) => typeof x === 'string' && x);
        return vals[0] || '';
    }
    return String(v);
}
/** Strip the system prefix and any element path → bare DP name. */
function dpOf(dpe) {
    return (0, oa_1.localName)(String(dpe)).split('.')[0];
}
function dpTypeOf(dp) {
    try {
        return (0, oa_1.oa)().dpTypeName(dp) || '';
    }
    catch {
        return '';
    }
}
/** Derive the per-node _SumAlertPanel DP name from its panel file + sumAlertNumber. */
function sumAlertDpName(fileName, sumAlertNumber) {
    if (!fileName || fileName.startsWith('EXECSCRIPT'))
        return null;
    const base = fileName.replace(/\.[^./\\]+$/, ''); // drop extension (.pnl)
    return `${base.replace(/[/\\]/g, '_')}_${sumAlertNumber}`;
}
// ---- source readers ---------------------------------------------------------
async function readTopology() {
    const b = `${(0, oa_1.localSystem)()}:${TOPO_DP}.`;
    const cols = ['panelNumber', 'parentNumber', 'sumAlertNumber', 'nodeName', 'fileName', 'moduleName', 'panelType', 'description', 'locality', 'functionality', 'uuid'];
    const v = (await (0, oa_1.oa)().dpGet(cols.map((c) => b + c)));
    const [panel, parent, sumA, nodeName, fileName, moduleName, panelType, descr, loc, func, uuid] = v;
    const n = Array.isArray(panel) ? panel.length : 0;
    const nodes = [];
    for (let i = 0; i < n; i++) {
        nodes.push({
            panelNumber: Number(panel[i]),
            parentNumber: Number(parent?.[i] ?? 0),
            sumAlertNumber: Number(sumA?.[i] ?? 0),
            nodeName: lstr(nodeName?.[i]),
            fileName: String(fileName?.[i] ?? ''),
            moduleName: String(moduleName?.[i] ?? ''),
            panelType: Number(panelType?.[i] ?? 0),
            description: lstr(descr?.[i]),
            locality: lstr(loc?.[i]),
            functionality: lstr(func?.[i]),
            uuid: String(uuid?.[i] ?? '')
        });
    }
    return nodes;
}
/** Member data points of a node's sum-alarm DP (union over Warning/Alert/Danger). */
async function sumAlertMembers(dpName) {
    if (!(await (0, oa_1.exists)(dpName)))
        return [];
    const dpes = [];
    for (const lv of SUM_LEVELS)
        dpes.push(`${dpName}.${lv}:_alert_hdl.._dp_list`, `${dpName}.${lv}:_alert_hdl.._dp_pattern`);
    let vals;
    try {
        vals = (await (0, oa_1.oa)().dpGet(dpes));
    }
    catch {
        return [];
    }
    const members = new Set();
    for (let i = 0; i < SUM_LEVELS.length; i++) {
        const list = vals[i * 2];
        const pattern = vals[i * 2 + 1];
        if (Array.isArray(list))
            for (const m of list)
                if (m)
                    members.add(dpOf(String(m)));
        const pat = lstr(pattern);
        if (pat) {
            try {
                for (const dpe of (0, oa_1.oa)().dpNames(pat) || [])
                    members.add(dpOf(dpe));
            }
            catch {
                /* invalid pattern — skip */
            }
        }
    }
    members.delete('');
    return [...members].sort();
}
// ---- data-point scan (shared by plan + apply) -------------------------------
const nodeDpName = (panelNumber) => `oaNode_${panelNumber}`;
const proxyDpName = (dp) => `oaDp_${(0, oa_1.sanitizeName)(dp)}`;
const dpTypeClassIri = (dpType, adopt) => adopt ? (0, ontology_1.getClassByDpType)(dpType)?.iri || `oa:${dpType}` : `oa:dp:${dpType}`;
async function scanDataPoints(topo, adopt) {
    const classes = new Map();
    const points = [];
    const claimed = new Set(); // a DP belongs to its first node (partOf is functional)
    let nodesWithSumAlert = 0;
    for (const t of topo) {
        const saDp = sumAlertDpName(t.fileName, t.sumAlertNumber);
        if (!saDp)
            continue;
        const members = await sumAlertMembers(saDp);
        if (members.length)
            nodesWithSumAlert++;
        for (const dp of members) {
            if (claimed.has(dp))
                continue;
            claimed.add(dp);
            const dpType = dpTypeOf(dp);
            if (!dpType)
                continue;
            const classIri = dpTypeClassIri(dpType, adopt);
            if (!classes.has(dpType)) {
                const exists_ = adopt ? !!(0, ontology_1.getClassByDpType)(dpType) : !!(0, ontology_1.getClass)(classIri);
                classes.set(dpType, { dpType, classIri, exists: exists_ });
            }
            points.push({ instance: adopt ? dp : proxyDpName(dp), dp, dpType, classIri, nodeDp: nodeDpName(t.panelNumber) });
        }
    }
    return { classes: [...classes.values()], points, nodesWithSumAlert };
}
async function planOaImport(opts = {}) {
    const includeDataPoints = opts.includeDataPoints !== false;
    const adopt = opts.adoptDataPoints !== false;
    const topo = await readTopology();
    const byPanel = new Map();
    for (const t of topo)
        byPanel.set(t.panelNumber, t);
    const nodes = [];
    for (const t of topo) {
        const dp = nodeDpName(t.panelNumber);
        const parent = t.parentNumber && byPanel.has(t.parentNumber) ? nodeDpName(t.parentNumber) : null;
        nodes.push({ dp, label: t.nodeName || dp, panelNumber: t.panelNumber, parentDp: parent, sumAlertDp: sumAlertDpName(t.fileName, t.sumAlertNumber), exists: await (0, oa_1.exists)(dp) });
    }
    const scan = includeDataPoints ? await scanDataPoints(topo, adopt) : { classes: [], points: [], nodesWithSumAlert: 0 };
    return {
        mode: includeDataPoints ? (adopt ? 'adopt' : 'proxy') : 'topology-only',
        nodes,
        dataPointClasses: scan.classes,
        dataPoints: scan.points,
        summary: {
            nodes: nodes.length,
            newNodes: nodes.filter((n) => !n.exists).length,
            dataPointClasses: scan.classes.length,
            newDataPointClasses: scan.classes.filter((c) => !c.exists).length,
            dataPoints: scan.points.length,
            nodesWithSumAlert: scan.nodesWithSumAlert
        }
    };
}
async function ensurePrereqs() {
    // The containment relation must exist before any partOf edge is asserted.
    if (!(0, ontology_1.getRelationType)(REL)) {
        await (0, ontology_1.createRelationType)({ iri: REL, label: 'part of', inverseIri: 'isa:hasPart', cardinality: '0..1', functional: true, transitive: true });
        oa_1.log.info(`created relation type ${REL}`);
    }
    if (!(0, ontology_1.getClass)(BASE_CLASS)) {
        await (0, ontology_1.createClass)({ iri: BASE_CLASS, label: 'Equipment Element', isAbstract: true, properties: [] });
    }
    if (!(0, ontology_1.getClass)(NODE_CLASS)) {
        await (0, ontology_1.createClass)({
            iri: NODE_CLASS,
            label: 'Topology Node',
            comment: 'Imported from WinCC OA _PanelTopology',
            superClasses: [BASE_CLASS],
            properties: [
                { name: 'panelNumber', type: 'int' },
                { name: 'fileName', type: 'string' },
                { name: 'moduleName', type: 'string' },
                { name: 'panelType', type: 'int' },
                { name: 'nodeDescription', type: 'string' },
                { name: 'locality', type: 'string' },
                { name: 'functionality', type: 'string' },
                { name: 'uuid', type: 'string' }
            ]
        });
    }
}
async function applyOaImport(opts = {}) {
    const includeDataPoints = opts.includeDataPoints !== false;
    const adopt = opts.adoptDataPoints !== false;
    await ensurePrereqs();
    const topo = await readTopology();
    const byPanel = new Map();
    for (const t of topo)
        byPanel.set(t.panelNumber, t);
    const result = {
        mode: includeDataPoints ? (adopt ? 'adopt' : 'proxy') : 'topology-only',
        createdNodes: 0,
        dataPointClasses: 0,
        createdDataPoints: 0,
        edges: 0,
        errors: [],
        summary: { nodes: 0, newNodes: 0, dataPointClasses: 0, newDataPointClasses: 0, dataPoints: 0, nodesWithSumAlert: 0 }
    };
    // pass 1: node instances
    for (const t of topo) {
        const dp = nodeDpName(t.panelNumber);
        try {
            if (!(await (0, oa_1.exists)(dp))) {
                await (0, instances_1.createInstance)({
                    classIri: NODE_CLASS,
                    name: dp,
                    label: t.nodeName || dp,
                    properties: {
                        panelNumber: t.panelNumber,
                        fileName: t.fileName,
                        moduleName: t.moduleName,
                        panelType: t.panelType,
                        nodeDescription: t.description,
                        locality: t.locality,
                        functionality: t.functionality,
                        uuid: t.uuid
                    }
                });
                result.createdNodes++;
            }
        }
        catch (e) {
            result.errors.push(`node ${dp}: ${e.message}`);
        }
    }
    // pass 2: parent edges
    for (const t of topo) {
        if (!t.parentNumber || !byPanel.has(t.parentNumber))
            continue;
        try {
            await (0, relations_1.assertRelation)({ relIri: REL, source: nodeDpName(t.panelNumber), target: nodeDpName(t.parentNumber) });
            result.edges++;
        }
        catch (e) {
            result.errors.push(`partOf ${nodeDpName(t.panelNumber)}→${nodeDpName(t.parentNumber)}: ${e.message}`);
        }
    }
    // pass 3: data points — one class per dpType, then attach
    if (includeDataPoints) {
        const scan = await scanDataPoints(topo, adopt);
        for (const c of scan.classes) {
            try {
                if (adopt) {
                    await (0, ontology_1.adoptDpTypeAsClass)(c.dpType, c.classIri, c.dpType);
                }
                else if (!(0, ontology_1.getClass)(c.classIri)) {
                    await (0, ontology_1.createClass)({ iri: c.classIri, label: c.dpType, comment: `Reference to WinCC OA dpType ${c.dpType}`, properties: [{ name: 'dpRef', type: 'string' }] });
                }
                result.dataPointClasses++;
            }
            catch (e) {
                result.errors.push(`class ${c.classIri} (${c.dpType}): ${e.message}`);
            }
        }
        for (const p of scan.points) {
            try {
                if (!adopt && !(await (0, oa_1.exists)(p.instance))) {
                    await (0, instances_1.createInstance)({ classIri: p.classIri, name: p.instance, label: p.dp, properties: { dpRef: p.dp } });
                    result.createdDataPoints++;
                }
                // adopt mode: the real DP IS the instance (its dpType is now an SDM class) — just link it.
                await (0, relations_1.assertRelation)({ relIri: REL, source: p.instance, target: p.nodeDp });
                result.edges++;
            }
            catch (e) {
                result.errors.push(`dp ${p.instance}→${p.nodeDp}: ${e.message}`);
            }
        }
    }
    result.summary = (await planOaImport(opts)).summary;
    oa_1.log.info(`OA import (${result.mode}): ${result.createdNodes} nodes, ${result.dataPointClasses} dp-classes, ${result.createdDataPoints} proxies, ${result.edges} edges, ${result.errors.length} errors`);
    return result;
}
//# sourceMappingURL=oaImport.js.map