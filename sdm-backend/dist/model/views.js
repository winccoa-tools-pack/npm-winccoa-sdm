"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listViews = listViews;
exports.createView = createView;
exports.createTree = createTree;
exports.addNode = addNode;
exports.getRoots = getRoots;
exports.deleteView = deleteView;
exports.getHierarchy = getHierarchy;
exports.getHierarchyRoots = getHierarchyRoots;
exports.getHierarchyChildren = getHierarchyChildren;
exports.buildHierarchyView = buildHierarchyView;
exports.getChildren = getChildren;
exports.getViewTree = getViewTree;
// -----------------------------------------------------------------------------
// CNS perspective layer: multiple parallel hierarchies (asset / location /
// process ...) over the same instance DPs. One CNS view per perspective; an
// instance can appear in many views without duplication.
// -----------------------------------------------------------------------------
const winccoa_manager_1 = require("winccoa-manager");
const oa_1 = require("../oa");
const constants_1 = require("../constants");
const instances_1 = require("./instances");
function viewId(name) {
    return name.includes('.') ? name : `${(0, oa_1.localSystem)()}.${name}`;
}
function listViews() {
    try {
        return (0, oa_1.oa)().cnsGetViews((0, oa_1.localSystem)()) || [];
    }
    catch {
        return [];
    }
}
async function createView(name, displayName) {
    const path = viewId(name);
    await (0, oa_1.oa)().cnsCreateView(path, displayName || name);
    oa_1.log.info(`created CNS view ${path}`);
    return path;
}
/** Create a tree root node directly under a view. */
async function createTree({ view, nodeId, displayName, dp = '' }) {
    const path = viewId(view);
    const tree = new winccoa_manager_1.WinccoaCnsTreeNode(nodeId, displayName || nodeId, dp);
    await (0, oa_1.oa)().cnsAddTree(path, tree);
    return `${path}:${nodeId}`;
}
/** Add a child node under an existing node (full CNS parent path required). */
async function addNode({ parentPath, nodeId, displayName, dp = '', classIri = null }) {
    await (0, oa_1.oa)().cnsAddNode(parentPath, nodeId, displayName || nodeId, dp);
    const sep = parentPath.includes(':') ? '.' : ':';
    const cnsPath = `${parentPath}${sep}${nodeId}`;
    if (dp)
        await tagNode(cnsPath, dp, classIri);
    return cnsPath;
}
/** CNS binds *data point elements*: the root element of a DP needs a trailing dot. */
function bindRef(dp) {
    return dp.endsWith('.') ? dp : `${dp}.`;
}
async function tagNode(cnsPath, dp, classIri) {
    try {
        // store the logical dp (no trailing-dot element suffix) so the UI can map back
        await (0, oa_1.oa)().cnsSetProperty(cnsPath, constants_1.CNS_PROP.IRI, dp.replace(/\.$/, ''), winccoa_manager_1.WinccoaCtrlType.string);
        if (classIri)
            await (0, oa_1.oa)().cnsSetProperty(cnsPath, constants_1.CNS_PROP.CLASS, classIri, winccoa_manager_1.WinccoaCtrlType.string);
    }
    catch (e) {
        oa_1.log.warn(`could not tag node ${cnsPath}: ${e.message}`);
    }
}
function getRoots(view) {
    const path = viewId(view);
    try {
        return (0, oa_1.oa)().cnsGetTrees(`${path}:`) || (0, oa_1.oa)().cnsGetTrees(path) || [];
    }
    catch {
        return [];
    }
}
/** Delete a CNS view (and all its trees/nodes). Idempotent. */
async function deleteView(name) {
    const path = viewId(name);
    for (const target of [`${path}:`, path]) {
        try {
            await (0, oa_1.oa)().cnsDeleteView(target);
            oa_1.log.info(`deleted CNS view ${path}`);
            return true;
        }
        catch {
            /* try next form / not present */
        }
    }
    return false;
}
/** One-sweep read of all instances' part-of edges + labels + classes. */
async function scanHierarchy(relIri) {
    const edges = (await (0, oa_1.oa)().dpQuery(`SELECT '_online.._value' FROM '*.sem.edgesOut'`));
    const labels = await dpValueMap(`SELECT '_online.._value' FROM '*.sem.label'`);
    const classes = await dpValueMap(`SELECT '_online.._value' FROM '*.sem.classIri'`);
    const parentOf = new Map();
    const childrenOf = new Map();
    const all = new Set();
    for (let i = 1; i < edges.length; i++) {
        const arr = edges[i]?.[1];
        if (!Array.isArray(arr))
            continue;
        for (const raw of arr) {
            let rec;
            try {
                rec = JSON.parse(raw);
            }
            catch {
                continue;
            }
            if (rec.rel !== relIri || !rec.src || !rec.tgt)
                continue;
            const child = (0, oa_1.localName)(rec.src);
            const parent = (0, oa_1.localName)(rec.tgt);
            parentOf.set(child, parent);
            if (!childrenOf.has(parent))
                childrenOf.set(parent, []);
            childrenOf.get(parent).push(child);
            all.add(child);
            all.add(parent);
        }
    }
    return { parentOf, childrenOf, all, labels, classes };
}
/**
 * Live containment hierarchy derived directly from the `relIri` edges — no CNS
 * materialization, so it always reflects the current graph (the management UI
 * re-reads this after every change instead of rebuilding a view).
 *
 * `memberIris` (optional) is the set of class IRIs whose instances belong to the
 * hierarchy even with no edge yet — so freshly created, not-yet-attached nodes
 * (e.g. a new top-level Site) show up immediately. Edge participants are always
 * included on top of that.
 */
async function getHierarchy(relIri, memberIris) {
    const { parentOf, childrenOf, all, labels, classes } = await scanHierarchy(relIri);
    // membership = edge participants ∪ instances of member classes (parentless roots)
    const members = new Set(all);
    if (memberIris && memberIris.size) {
        for (const [dp, cls] of classes)
            if (memberIris.has(cls))
                members.add(dp);
    }
    const roots = [...members].filter((n) => !parentOf.has(n)).sort();
    const build = (dp, seen) => {
        seen.add(dp);
        const kids = (childrenOf.get(dp) ?? []).filter((c) => !seen.has(c)).sort();
        return {
            path: dp,
            name: labels.get(dp) || dp,
            dp,
            classIri: classes.get(dp) || undefined,
            parentDp: parentOf.get(dp),
            children: kids.map((c) => build(c, seen))
        };
    };
    const seen = new Set();
    return roots.map((r) => build(r, seen));
}
/**
 * Lazy hierarchy — root level only. Still does the one-sweep scan to determine
 * which member nodes have no parent, but returns a flat root list with a
 * `hasChildren` flag instead of the whole nested tree. Children are fetched
 * on demand via getHierarchyChildren (no scan), so the client never holds the
 * full tree and deep/wide hierarchies stay cheap.
 */
async function getHierarchyRoots(relIri, memberIris) {
    const { parentOf, childrenOf, all, labels, classes } = await scanHierarchy(relIri);
    const members = new Set(all);
    if (memberIris && memberIris.size) {
        for (const [dp, cls] of classes)
            if (memberIris.has(cls))
                members.add(dp);
    }
    return [...members]
        .filter((n) => !parentOf.has(n))
        .sort()
        .map((dp) => ({
        path: dp,
        name: labels.get(dp) || dp,
        dp,
        classIri: classes.get(dp) || undefined,
        hasChildren: (childrenOf.get(dp)?.length ?? 0) > 0,
        children: []
    }));
}
/**
 * Direct children of one node — read ONLY that node's incoming edges
 * (`sem.edgesIn`): a child points at its parent via `relIri`, so the parent's
 * in-edges are exactly its children. O(children), no graph scan. Each child
 * carries a `hasChildren` flag (from its own in-edges) so the UI can render a
 * twisty without pre-loading the grandchildren.
 */
async function getHierarchyChildren(parentDp, relIri) {
    const parent = (0, oa_1.localName)(parentDp);
    const edges = (0, instances_1.parseEdges)(await (0, oa_1.oa)().dpGet(`${parent}.${constants_1.SEM.EDGES_IN}`));
    const childDps = [...new Set(edges.filter((e) => e.rel === relIri).map((e) => (0, oa_1.localName)(e.src)))].sort();
    const out = [];
    for (const dp of childDps) {
        const [label, classIri, edgesIn] = (await (0, oa_1.oa)().dpGet([`${dp}.${constants_1.SEM.LABEL}`, `${dp}.${constants_1.SEM.CLASS_IRI}`, `${dp}.${constants_1.SEM.EDGES_IN}`]));
        const hasChildren = (0, instances_1.parseEdges)(edgesIn).some((e) => e.rel === relIri);
        // Adopted DP instances may have an empty sem.classIri value (only the dpType
        // carries the sem struct); fall back to deriving the class from the dpType so
        // the asset tree can switch the detail view to the right class on click.
        const cls = classIri || (0, instances_1.deriveClassIri)(dp) || undefined;
        out.push({ path: dp, name: label || dp, dp, classIri: cls, parentDp: parent, hasChildren, children: [] });
    }
    return out;
}
async function buildHierarchyView(viewName, relIri, displayName) {
    const { parentOf, childrenOf, all, labels, classes } = await scanHierarchy(relIri);
    const roots = [...all].filter((n) => !parentOf.has(n)).sort();
    await deleteView(viewName);
    const view = await createView(viewName, displayName || viewName);
    for (const root of roots) {
        const rootPath = await createTree({ view: viewName, nodeId: root, displayName: labels.get(root) || root, dp: bindRef((0, oa_1.qualify)(root)) });
        await tagNode(`${viewId(viewName)}:${root}`, (0, oa_1.qualify)(root), classes.get(root) || null);
        await addSubtree(rootPath, root, childrenOf, labels, classes);
    }
    oa_1.log.info(`built hierarchy view ${viewName} from ${relIri}: ${roots.length} root(s), ${all.size} node(s)`);
    return { view, relIri, roots, nodes: all.size };
}
async function addSubtree(parentPath, parentDp, childrenOf, labels, classes) {
    for (const child of childrenOf.get(parentDp) ?? []) {
        const childPath = await addNode({ parentPath, nodeId: child, displayName: labels.get(child) || child, dp: bindRef((0, oa_1.qualify)(child)), classIri: classes.get(child) || null });
        await addSubtree(childPath, child, childrenOf, labels, classes);
    }
}
/** Run a one-shot value query and map each DP (stripped of its `.sem.*` tail) to the value. */
async function dpValueMap(sql) {
    const table = (await (0, oa_1.oa)().dpQuery(sql));
    const map = new Map();
    for (let i = 1; i < table.length; i++) {
        const dpe = table[i]?.[0];
        if (typeof dpe !== 'string')
            continue;
        const dp = (0, oa_1.localName)(dpe).replace(/\.sem\..*$/, '');
        const val = table[i]?.[1];
        map.set(dp, val == null ? '' : String(val));
    }
    return map;
}
async function getChildren(cnsPath) {
    const children = (0, oa_1.oa)().cnsGetChildren(cnsPath) || [];
    const out = [];
    for (const path of children) {
        const entry = { path };
        try {
            entry.displayNames = (0, oa_1.oa)().cnsGetDisplayNames(path);
        }
        catch {
            /* ignore */
        }
        try {
            entry.iri = (0, oa_1.oa)().cnsGetProperty(path, constants_1.CNS_PROP.IRI);
            entry.classIri = (0, oa_1.oa)().cnsGetProperty(path, constants_1.CNS_PROP.CLASS);
        }
        catch {
            /* node may carry no binding */
        }
        if (entry.iri)
            entry.dp = (0, oa_1.localName)(entry.iri);
        out.push(entry);
    }
    return out;
}
/** The whole view as a nested tree (roots + recursive children) in one call. */
function getViewTree(viewName) {
    return getRoots(viewName).map((path) => nodeFrom(path));
}
function nodeFrom(path) {
    const node = { path, name: leafName(path), children: [] };
    try {
        const dn = displayNameOf((0, oa_1.oa)().cnsGetDisplayNames(path));
        if (dn)
            node.name = dn;
    }
    catch {
        /* keep leaf name */
    }
    try {
        const iri = (0, oa_1.oa)().cnsGetProperty(path, constants_1.CNS_PROP.IRI);
        if (iri)
            node.dp = (0, oa_1.localName)(iri);
        const cls = (0, oa_1.oa)().cnsGetProperty(path, constants_1.CNS_PROP.CLASS);
        if (cls)
            node.classIri = cls;
    }
    catch {
        /* unbound node */
    }
    for (const child of (0, oa_1.oa)().cnsGetChildren(path) || [])
        node.children.push(nodeFrom(child));
    return node;
}
function leafName(path) {
    const tail = path.split(/[.:]/).pop() || path;
    return tail;
}
function displayNameOf(dn) {
    if (dn == null)
        return '';
    if (typeof dn === 'string')
        return dn;
    if (typeof dn === 'object') {
        const vals = Object.values(dn).filter((v) => typeof v === 'string' && v);
        return vals[0] || '';
    }
    return String(dn);
}
//# sourceMappingURL=views.js.map