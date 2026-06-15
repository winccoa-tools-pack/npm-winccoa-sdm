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
import { oa, localSystem, localName, sanitizeName, exists, log } from '../oa';
import { getClass, getClassByDpType, adoptDpTypeAsClass, createClass, getRelationType, createRelationType } from './ontology';
import { createInstance } from './instances';
import { assertRelation } from './relations';

const TOPO_DP = '_PanelTopology';
const REL = 'isa:partOf';
const NODE_CLASS = 'oa:TopologyNode';
const BASE_CLASS = 'isa:EquipmentElement';
const SUM_LEVELS = ['Warning', 'Alert', 'Danger'];

export interface OaImportOptions {
  /** Resolve sum-alarm members and attach the referenced DPs (default true). */
  includeDataPoints?: boolean;
  /** Adopt each member dpType as an SDM class so the real DPs are the instances
   *  (default true). false → non-invasive per-dpType reference proxies. */
  adoptDataPoints?: boolean;
}

interface TopoNode {
  panelNumber: number;
  parentNumber: number;
  sumAlertNumber: number;
  nodeName: string;
  fileName: string;
  moduleName: string;
  panelType: number;
  description: string;
  locality: string;
  functionality: string;
  uuid: string;
}

function lstr(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    const vals = Object.values(v as Record<string, unknown>).filter((x) => typeof x === 'string' && x);
    return (vals[0] as string) || '';
  }
  return String(v);
}

/** Strip the system prefix and any element path → bare DP name. */
function dpOf(dpe: string): string {
  return localName(String(dpe)).split('.')[0];
}

function dpTypeOf(dp: string): string {
  try {
    return oa().dpTypeName(dp) || '';
  } catch {
    return '';
  }
}

/** Derive the per-node _SumAlertPanel DP name from its panel file + sumAlertNumber. */
export function sumAlertDpName(fileName: string, sumAlertNumber: number): string | null {
  if (!fileName || fileName.startsWith('EXECSCRIPT')) return null;
  const base = fileName.replace(/\.[^./\\]+$/, ''); // drop extension (.pnl)
  return `${base.replace(/[/\\]/g, '_')}_${sumAlertNumber}`;
}

// ---- source readers ---------------------------------------------------------
async function readTopology(): Promise<TopoNode[]> {
  const b = `${localSystem()}:${TOPO_DP}.`;
  const cols = ['panelNumber', 'parentNumber', 'sumAlertNumber', 'nodeName', 'fileName', 'moduleName', 'panelType', 'description', 'locality', 'functionality', 'uuid'];
  const v = (await oa().dpGet(cols.map((c) => b + c))) as unknown[];
  const [panel, parent, sumA, nodeName, fileName, moduleName, panelType, descr, loc, func, uuid] = v as unknown[][];
  const n = Array.isArray(panel) ? panel.length : 0;
  const nodes: TopoNode[] = [];
  for (let i = 0; i < n; i++) {
    nodes.push({
      panelNumber: Number(panel[i]),
      parentNumber: Number((parent as number[])?.[i] ?? 0),
      sumAlertNumber: Number((sumA as number[])?.[i] ?? 0),
      nodeName: lstr(nodeName?.[i]),
      fileName: String(fileName?.[i] ?? ''),
      moduleName: String(moduleName?.[i] ?? ''),
      panelType: Number((panelType as number[])?.[i] ?? 0),
      description: lstr(descr?.[i]),
      locality: lstr(loc?.[i]),
      functionality: lstr(func?.[i]),
      uuid: String(uuid?.[i] ?? '')
    });
  }
  return nodes;
}

/** Member data points of a node's sum-alarm DP (union over Warning/Alert/Danger). */
async function sumAlertMembers(dpName: string): Promise<string[]> {
  if (!(await exists(dpName))) return [];
  const dpes: string[] = [];
  for (const lv of SUM_LEVELS) dpes.push(`${dpName}.${lv}:_alert_hdl.._dp_list`, `${dpName}.${lv}:_alert_hdl.._dp_pattern`);
  let vals: unknown[];
  try {
    vals = (await oa().dpGet(dpes)) as unknown[];
  } catch {
    return [];
  }
  const members = new Set<string>();
  for (let i = 0; i < SUM_LEVELS.length; i++) {
    const list = vals[i * 2];
    const pattern = vals[i * 2 + 1];
    if (Array.isArray(list)) for (const m of list) if (m) members.add(dpOf(String(m)));
    const pat = lstr(pattern);
    if (pat) {
      try {
        for (const dpe of oa().dpNames(pat) || []) members.add(dpOf(dpe));
      } catch {
        /* invalid pattern — skip */
      }
    }
  }
  members.delete('');
  return [...members].sort();
}

// ---- data-point scan (shared by plan + apply) -------------------------------
const nodeDpName = (panelNumber: number): string => `oaNode_${panelNumber}`;
const proxyDpName = (dp: string): string => `oaDp_${sanitizeName(dp)}`;
const dpTypeClassIri = (dpType: string, adopt: boolean): string =>
  adopt ? getClassByDpType(dpType)?.iri || `oa:${dpType}` : `oa:dp:${dpType}`;

interface Scanned {
  classes: { dpType: string; classIri: string; exists: boolean }[];
  points: { instance: string; dp: string; dpType: string; classIri: string; nodeDp: string }[];
  nodesWithSumAlert: number;
}

async function scanDataPoints(topo: TopoNode[], adopt: boolean): Promise<Scanned> {
  const classes = new Map<string, { dpType: string; classIri: string; exists: boolean }>();
  const points: Scanned['points'] = [];
  const claimed = new Set<string>(); // a DP belongs to its first node (partOf is functional)
  let nodesWithSumAlert = 0;

  for (const t of topo) {
    const saDp = sumAlertDpName(t.fileName, t.sumAlertNumber);
    if (!saDp) continue;
    const members = await sumAlertMembers(saDp);
    if (members.length) nodesWithSumAlert++;
    for (const dp of members) {
      if (claimed.has(dp)) continue;
      claimed.add(dp);
      const dpType = dpTypeOf(dp);
      if (!dpType) continue;
      const classIri = dpTypeClassIri(dpType, adopt);
      if (!classes.has(dpType)) {
        const exists_ = adopt ? !!getClassByDpType(dpType) : !!getClass(classIri);
        classes.set(dpType, { dpType, classIri, exists: exists_ });
      }
      points.push({ instance: adopt ? dp : proxyDpName(dp), dp, dpType, classIri, nodeDp: nodeDpName(t.panelNumber) });
    }
  }
  return { classes: [...classes.values()], points, nodesWithSumAlert };
}

// ---- plan -------------------------------------------------------------------
export interface OaImportPlan {
  mode: 'adopt' | 'proxy' | 'topology-only';
  nodes: { dp: string; label: string; panelNumber: number; parentDp: string | null; sumAlertDp: string | null; exists: boolean }[];
  dataPointClasses: { dpType: string; classIri: string; exists: boolean }[];
  dataPoints: { instance: string; dp: string; dpType: string; classIri: string; nodeDp: string }[];
  summary: { nodes: number; newNodes: number; dataPointClasses: number; newDataPointClasses: number; dataPoints: number; nodesWithSumAlert: number };
}

export async function planOaImport(opts: OaImportOptions = {}): Promise<OaImportPlan> {
  const includeDataPoints = opts.includeDataPoints !== false;
  const adopt = opts.adoptDataPoints !== false;
  const topo = await readTopology();
  const byPanel = new Map<number, TopoNode>();
  for (const t of topo) byPanel.set(t.panelNumber, t);

  const nodes: OaImportPlan['nodes'] = [];
  for (const t of topo) {
    const dp = nodeDpName(t.panelNumber);
    const parent = t.parentNumber && byPanel.has(t.parentNumber) ? nodeDpName(t.parentNumber) : null;
    nodes.push({ dp, label: t.nodeName || dp, panelNumber: t.panelNumber, parentDp: parent, sumAlertDp: sumAlertDpName(t.fileName, t.sumAlertNumber), exists: await exists(dp) });
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

// ---- apply ------------------------------------------------------------------
export interface OaImportResult {
  mode: OaImportPlan['mode'];
  createdNodes: number;
  dataPointClasses: number;
  createdDataPoints: number;
  edges: number;
  errors: string[];
  summary: OaImportPlan['summary'];
}

async function ensurePrereqs(): Promise<void> {
  // The containment relation must exist before any partOf edge is asserted.
  if (!getRelationType(REL)) {
    await createRelationType({ iri: REL, label: 'part of', inverseIri: 'isa:hasPart', cardinality: '0..1', functional: true, transitive: true } as never);
    log.info(`created relation type ${REL}`);
  }
  if (!getClass(BASE_CLASS)) {
    await createClass({ iri: BASE_CLASS, label: 'Equipment Element', isAbstract: true, properties: [] } as never);
  }
  if (!getClass(NODE_CLASS)) {
    await createClass({
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
    } as never);
  }
}

export async function applyOaImport(opts: OaImportOptions = {}): Promise<OaImportResult> {
  const includeDataPoints = opts.includeDataPoints !== false;
  const adopt = opts.adoptDataPoints !== false;
  await ensurePrereqs();

  const topo = await readTopology();
  const byPanel = new Map<number, TopoNode>();
  for (const t of topo) byPanel.set(t.panelNumber, t);

  const result: OaImportResult = {
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
      if (!(await exists(dp))) {
        await createInstance({
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
    } catch (e) {
      result.errors.push(`node ${dp}: ${(e as Error).message}`);
    }
  }

  // pass 2: parent edges
  for (const t of topo) {
    if (!t.parentNumber || !byPanel.has(t.parentNumber)) continue;
    try {
      await assertRelation({ relIri: REL, source: nodeDpName(t.panelNumber), target: nodeDpName(t.parentNumber) });
      result.edges++;
    } catch (e) {
      result.errors.push(`partOf ${nodeDpName(t.panelNumber)}→${nodeDpName(t.parentNumber)}: ${(e as Error).message}`);
    }
  }

  // pass 3: data points — one class per dpType, then attach
  if (includeDataPoints) {
    const scan = await scanDataPoints(topo, adopt);

    for (const c of scan.classes) {
      try {
        if (adopt) {
          await adoptDpTypeAsClass(c.dpType, c.classIri, c.dpType);
        } else if (!getClass(c.classIri)) {
          await createClass({ iri: c.classIri, label: c.dpType, comment: `Reference to WinCC OA dpType ${c.dpType}`, properties: [{ name: 'dpRef', type: 'string' }] } as never);
        }
        result.dataPointClasses++;
      } catch (e) {
        result.errors.push(`class ${c.classIri} (${c.dpType}): ${(e as Error).message}`);
      }
    }

    for (const p of scan.points) {
      try {
        if (!adopt && !(await exists(p.instance))) {
          await createInstance({ classIri: p.classIri, name: p.instance, label: p.dp, properties: { dpRef: p.dp } });
          result.createdDataPoints++;
        }
        // adopt mode: the real DP IS the instance (its dpType is now an SDM class) — just link it.
        await assertRelation({ relIri: REL, source: p.instance, target: p.nodeDp });
        result.edges++;
      } catch (e) {
        result.errors.push(`dp ${p.instance}→${p.nodeDp}: ${(e as Error).message}`);
      }
    }
  }

  result.summary = (await planOaImport(opts)).summary;
  log.info(`OA import (${result.mode}): ${result.createdNodes} nodes, ${result.dataPointClasses} dp-classes, ${result.createdDataPoints} proxies, ${result.edges} edges, ${result.errors.length} errors`);
  return result;
}
