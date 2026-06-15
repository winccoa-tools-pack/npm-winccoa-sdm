// -----------------------------------------------------------------------------
// CNS perspective layer: multiple parallel hierarchies (asset / location /
// process ...) over the same instance DPs. One CNS view per perspective; an
// instance can appear in many views without duplication.
// -----------------------------------------------------------------------------
import { WinccoaCnsTreeNode, WinccoaCtrlType } from 'winccoa-manager';
import { oa, localSystem, localName, qualify, log } from '../oa';
import { CNS_PROP, SEM } from '../constants';
import { parseEdges, deriveClassIri } from './instances';

type LangName = string | { [lang: string]: string };

function viewId(name: string): string {
  return name.includes('.') ? name : `${localSystem()}.${name}`;
}

export function listViews(): string[] {
  try {
    return oa().cnsGetViews(localSystem()) || [];
  } catch {
    return [];
  }
}

export async function createView(name: string, displayName?: LangName): Promise<string> {
  const path = viewId(name);
  await oa().cnsCreateView(path, displayName || name);
  log.info(`created CNS view ${path}`);
  return path;
}

export interface CreateTreeInput {
  view: string;
  nodeId: string;
  displayName?: LangName;
  dp?: string;
}

/** Create a tree root node directly under a view. */
export async function createTree({ view, nodeId, displayName, dp = '' }: CreateTreeInput): Promise<string> {
  const path = viewId(view);
  const tree = new WinccoaCnsTreeNode(nodeId, displayName || nodeId, dp);
  await oa().cnsAddTree(path, tree);
  return `${path}:${nodeId}`;
}

export interface AddNodeInput {
  parentPath: string;
  nodeId: string;
  displayName?: LangName;
  dp?: string;
  classIri?: string | null;
}

/** Add a child node under an existing node (full CNS parent path required). */
export async function addNode({ parentPath, nodeId, displayName, dp = '', classIri = null }: AddNodeInput): Promise<string> {
  await oa().cnsAddNode(parentPath, nodeId, displayName || nodeId, dp);
  const sep = parentPath.includes(':') ? '.' : ':';
  const cnsPath = `${parentPath}${sep}${nodeId}`;
  if (dp) await tagNode(cnsPath, dp, classIri);
  return cnsPath;
}

/** CNS binds *data point elements*: the root element of a DP needs a trailing dot. */
function bindRef(dp: string): string {
  return dp.endsWith('.') ? dp : `${dp}.`;
}

async function tagNode(cnsPath: string, dp: string, classIri: string | null): Promise<void> {
  try {
    // store the logical dp (no trailing-dot element suffix) so the UI can map back
    await oa().cnsSetProperty(cnsPath, CNS_PROP.IRI, dp.replace(/\.$/, ''), WinccoaCtrlType.string);
    if (classIri) await oa().cnsSetProperty(cnsPath, CNS_PROP.CLASS, classIri, WinccoaCtrlType.string);
  } catch (e) {
    log.warn(`could not tag node ${cnsPath}: ${(e as Error).message}`);
  }
}

export function getRoots(view: string): string[] {
  const path = viewId(view);
  try {
    return oa().cnsGetTrees(`${path}:`) || oa().cnsGetTrees(path) || [];
  } catch {
    return [];
  }
}

export interface ViewChild {
  path: string;
  displayNames?: unknown;
  iri?: unknown;
  classIri?: unknown;
  dp?: string;
}

/** Delete a CNS view (and all its trees/nodes). Idempotent. */
export async function deleteView(name: string): Promise<boolean> {
  const path = viewId(name);
  for (const target of [`${path}:`, path]) {
    try {
      await oa().cnsDeleteView(target);
      log.info(`deleted CNS view ${path}`);
      return true;
    } catch {
      /* try next form / not present */
    }
  }
  return false;
}

export interface HierarchyResult {
  view: string;
  relIri: string;
  roots: string[];
  nodes: number;
}

/**
 * Materialize a containment hierarchy (e.g. ISA-95 part-of) as a CNS view.
 *
 * Reads every instance's outgoing edges in one sweep (dpQuery over
 * `*.sem.edgesOut`), keeps only edges of `relIri` (child --relIri--> parent),
 * builds the parent/child forest and writes it into a freshly (re)created CNS
 * view. Each node binds the instance DP and carries its class IRI, so the UI
 * tree can select the instance on click. Roots = nodes that are not a child of
 * anyone. Rebuilds from scratch each call (cheap for this scale).
 */
interface HierarchyScan {
  parentOf: Map<string, string>;
  childrenOf: Map<string, string[]>;
  all: Set<string>;
  labels: Map<string, string>;
  classes: Map<string, string>;
}

/** One-sweep read of all instances' part-of edges + labels + classes. */
async function scanHierarchy(relIri: string): Promise<HierarchyScan> {
  const edges = (await oa().dpQuery(`SELECT '_online.._value' FROM '*.sem.edgesOut'`)) as unknown[][];
  const labels = await dpValueMap(`SELECT '_online.._value' FROM '*.sem.label'`);
  const classes = await dpValueMap(`SELECT '_online.._value' FROM '*.sem.classIri'`);

  const parentOf = new Map<string, string>();
  const childrenOf = new Map<string, string[]>();
  const all = new Set<string>();
  for (let i = 1; i < edges.length; i++) {
    const arr = edges[i]?.[1];
    if (!Array.isArray(arr)) continue;
    for (const raw of arr) {
      let rec: { rel?: string; src?: string; tgt?: string };
      try {
        rec = JSON.parse(raw as string);
      } catch {
        continue;
      }
      if (rec.rel !== relIri || !rec.src || !rec.tgt) continue;
      const child = localName(rec.src);
      const parent = localName(rec.tgt);
      parentOf.set(child, parent);
      if (!childrenOf.has(parent)) childrenOf.set(parent, []);
      childrenOf.get(parent)!.push(child);
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
export async function getHierarchy(relIri: string, memberIris?: Set<string>): Promise<ViewNode[]> {
  const { parentOf, childrenOf, all, labels, classes } = await scanHierarchy(relIri);

  // membership = edge participants ∪ instances of member classes (parentless roots)
  const members = new Set(all);
  if (memberIris && memberIris.size) {
    for (const [dp, cls] of classes) if (memberIris.has(cls)) members.add(dp);
  }
  const roots = [...members].filter((n) => !parentOf.has(n)).sort();

  const build = (dp: string, seen: Set<string>): ViewNode => {
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
  const seen = new Set<string>();
  return roots.map((r) => build(r, seen));
}

/**
 * Lazy hierarchy — root level only. Still does the one-sweep scan to determine
 * which member nodes have no parent, but returns a flat root list with a
 * `hasChildren` flag instead of the whole nested tree. Children are fetched
 * on demand via getHierarchyChildren (no scan), so the client never holds the
 * full tree and deep/wide hierarchies stay cheap.
 */
export async function getHierarchyRoots(relIri: string, memberIris?: Set<string>): Promise<ViewNode[]> {
  const { parentOf, childrenOf, all, labels, classes } = await scanHierarchy(relIri);
  const members = new Set(all);
  if (memberIris && memberIris.size) {
    for (const [dp, cls] of classes) if (memberIris.has(cls)) members.add(dp);
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
export async function getHierarchyChildren(parentDp: string, relIri: string): Promise<ViewNode[]> {
  const parent = localName(parentDp);
  const edges = parseEdges(await oa().dpGet(`${parent}.${SEM.EDGES_IN}`));
  const childDps = [...new Set(edges.filter((e) => e.rel === relIri).map((e) => localName(e.src)))].sort();
  const out: ViewNode[] = [];
  for (const dp of childDps) {
    const [label, classIri, edgesIn] = (await oa().dpGet([`${dp}.${SEM.LABEL}`, `${dp}.${SEM.CLASS_IRI}`, `${dp}.${SEM.EDGES_IN}`])) as unknown[];
    const hasChildren = parseEdges(edgesIn).some((e) => e.rel === relIri);
    // Adopted DP instances may have an empty sem.classIri value (only the dpType
    // carries the sem struct); fall back to deriving the class from the dpType so
    // the asset tree can switch the detail view to the right class on click.
    const cls = (classIri as string) || deriveClassIri(dp) || undefined;
    out.push({ path: dp, name: (label as string) || dp, dp, classIri: cls, parentDp: parent, hasChildren, children: [] });
  }
  return out;
}

export async function buildHierarchyView(viewName: string, relIri: string, displayName?: LangName): Promise<HierarchyResult> {
  const { parentOf, childrenOf, all, labels, classes } = await scanHierarchy(relIri);
  const roots = [...all].filter((n) => !parentOf.has(n)).sort();

  await deleteView(viewName);
  const view = await createView(viewName, displayName || viewName);
  for (const root of roots) {
    const rootPath = await createTree({ view: viewName, nodeId: root, displayName: labels.get(root) || root, dp: bindRef(qualify(root)) });
    await tagNode(`${viewId(viewName)}:${root}`, qualify(root), classes.get(root) || null);
    await addSubtree(rootPath, root, childrenOf, labels, classes);
  }
  log.info(`built hierarchy view ${viewName} from ${relIri}: ${roots.length} root(s), ${all.size} node(s)`);
  return { view, relIri, roots, nodes: all.size };
}

async function addSubtree(parentPath: string, parentDp: string, childrenOf: Map<string, string[]>, labels: Map<string, string>, classes: Map<string, string>): Promise<void> {
  for (const child of childrenOf.get(parentDp) ?? []) {
    const childPath = await addNode({ parentPath, nodeId: child, displayName: labels.get(child) || child, dp: bindRef(qualify(child)), classIri: classes.get(child) || null });
    await addSubtree(childPath, child, childrenOf, labels, classes);
  }
}

/** Run a one-shot value query and map each DP (stripped of its `.sem.*` tail) to the value. */
async function dpValueMap(sql: string): Promise<Map<string, string>> {
  const table = (await oa().dpQuery(sql)) as unknown[][];
  const map = new Map<string, string>();
  for (let i = 1; i < table.length; i++) {
    const dpe = table[i]?.[0];
    if (typeof dpe !== 'string') continue;
    const dp = localName(dpe).replace(/\.sem\..*$/, '');
    const val = table[i]?.[1];
    map.set(dp, val == null ? '' : String(val));
  }
  return map;
}

export async function getChildren(cnsPath: string): Promise<ViewChild[]> {
  const children = oa().cnsGetChildren(cnsPath) || [];
  const out: ViewChild[] = [];
  for (const path of children) {
    const entry: ViewChild = { path };
    try {
      entry.displayNames = oa().cnsGetDisplayNames(path);
    } catch {
      /* ignore */
    }
    try {
      entry.iri = oa().cnsGetProperty(path, CNS_PROP.IRI);
      entry.classIri = oa().cnsGetProperty(path, CNS_PROP.CLASS);
    } catch {
      /* node may carry no binding */
    }
    if (entry.iri) entry.dp = localName(entry.iri as string);
    out.push(entry);
  }
  return out;
}

export interface ViewNode {
  path: string;
  name: string;
  dp?: string;
  classIri?: string;
  parentDp?: string;
  hasChildren?: boolean;
  children: ViewNode[];
}

/** The whole view as a nested tree (roots + recursive children) in one call. */
export function getViewTree(viewName: string): ViewNode[] {
  return getRoots(viewName).map((path) => nodeFrom(path));
}

function nodeFrom(path: string): ViewNode {
  const node: ViewNode = { path, name: leafName(path), children: [] };
  try {
    const dn = displayNameOf(oa().cnsGetDisplayNames(path));
    if (dn) node.name = dn;
  } catch {
    /* keep leaf name */
  }
  try {
    const iri = oa().cnsGetProperty(path, CNS_PROP.IRI);
    if (iri) node.dp = localName(iri as string);
    const cls = oa().cnsGetProperty(path, CNS_PROP.CLASS);
    if (cls) node.classIri = cls as string;
  } catch {
    /* unbound node */
  }
  for (const child of oa().cnsGetChildren(path) || []) node.children.push(nodeFrom(child));
  return node;
}

function leafName(path: string): string {
  const tail = path.split(/[.:]/).pop() || path;
  return tail;
}

function displayNameOf(dn: unknown): string {
  if (dn == null) return '';
  if (typeof dn === 'string') return dn;
  if (typeof dn === 'object') {
    const vals = Object.values(dn as Record<string, unknown>).filter((v) => typeof v === 'string' && v);
    return (vals[0] as string) || '';
  }
  return String(dn);
}
