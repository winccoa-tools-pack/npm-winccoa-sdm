/**
 * Shared types for the Semantic Data Model (SDM) page. These mirror the
 * payloads of the backend `sdm.*` WebSocket commands (see javascript/sdm).
 */

export interface SdmPropertyDef {
  name: string;
  type: string;
  label?: string;
  unit?: string;
}

export interface SdmClass {
  iri: string;
  label: string;
  comment: string;
  superClasses: string[];
  aspects: string[];
  mappedDpType: string;
  isAbstract: boolean;
  ownProps: SdmPropertyDef[];
}

export interface SdmRelationType {
  iri: string;
  label: string;
  inverseIri: string;
  domain: string[];
  range: string[];
  cardinality: string;
  symmetric: boolean;
  transitive: boolean;
  functional: boolean;
  realization: string;
}

export interface SdmAspect {
  iri: string;
  label: string;
  mappedDpType: string;
  ownProps: SdmPropertyDef[];
}

export interface SdmInstanceListItem {
  dp: string;
  iri: string;
  classIri: string;
  label: string;
}

export interface SdmInstanceList {
  total: number;
  items: SdmInstanceListItem[];
}

export interface SdmInstance {
  dp: string;
  iri: string;
  classIri: string;
  label: string;
  createdAt: unknown;
  properties: Record<string, unknown>;
  edgesOut: unknown[];
  edgesIn: unknown[];
}

export interface SdmNeighbor {
  direction: 'out' | 'in';
  rel: string;
  neighbor: string;
  dp: string;
  edgeDp: string | null;
  props: Record<string, unknown> | null;
}

export interface SdmHealth {
  ok: boolean;
  redundant: boolean;
  active: boolean;
  classes: number;
  relationTypes: number;
  aspects: number;
}

/** A node in a CNS view tree (sdm.view.tree) — a materialized hierarchy. */
export interface SdmViewNode {
  path: string;
  name: string;
  dp?: string;
  classIri?: string;
  parentDp?: string;
  hasChildren?: boolean;
  children: SdmViewNode[];
}

/** Result of materializing a hierarchy view (sdm.view.build). */
export interface SdmHierarchyResult {
  view: string;
  relIri: string;
  roots: string[];
  nodes: number;
}

// ---- templates / typicals ----
export interface SdmTemplateNode {
  key: string;
  classIri: string;
  name: string;
  label?: string;
  properties?: Record<string, unknown>;
}
export interface SdmTemplateEdge {
  rel: string;
  src: string;
  tgt: string;
}
export interface SdmTemplate {
  id: string;
  label?: string;
  params?: string[];
  nodes: SdmTemplateNode[];
  edges?: SdmTemplateEdge[];
}
export interface SdmInstantiateResult {
  template: string;
  dryRun: boolean;
  summary: { rows: number; toCreate: number; conflicts: number; edges: number; errors: number };
  plan: {
    binding: Record<string, string>;
    instances: { key: string; dp: string; classIri: string; label: string; exists: boolean }[];
    edges: { rel: string; src: string; tgt: string }[];
    errors: string[];
  }[];
  applied?: { created: number; updated: number; skipped: number; edges: number; errors: string[] };
}

// ---- bulk import / export ----
export interface SdmExportResult {
  columns: string[];
  rows: Record<string, unknown>[];
}
export interface SdmImportDiff {
  creates: { dp: string; class: string; label: string; parent: string; properties: Record<string, unknown> }[];
  updates: { dp: string; changes: Record<string, { from: unknown; to: unknown }>; label?: string; parent?: string }[];
  unchanged: number;
  errors: { dp: string; msg: string }[];
  summary: { rows: number; creates: number; updates: number; unchanged: number; errors: number };
}
export interface SdmImportResult {
  created: number;
  updated: number;
  unchanged: number;
  errors: string[];
  summary: SdmImportDiff['summary'];
}

// ---- model validation ----
export interface SdmFinding {
  severity: 'error' | 'warning' | 'info';
  kind: string;
  subject: string;
  message: string;
}
export interface SdmValidationReport {
  findings: SdmFinding[];
  truncated: boolean;
  summary: { instances: number; edges: number; errors: number; warnings: number; info: number; checks: string[] };
}

// ---- WinCC OA → SDM migration ----
export interface SdmOaImportSummary {
  nodes: number;
  newNodes: number;
  dataPointClasses: number;
  newDataPointClasses: number;
  dataPoints: number;
  nodesWithSumAlert: number;
}
export interface SdmOaImportPlan {
  mode: 'adopt' | 'proxy' | 'topology-only';
  nodes: { dp: string; label: string; panelNumber: number; parentDp: string | null; sumAlertDp: string | null; exists: boolean }[];
  dataPointClasses: { dpType: string; classIri: string; exists: boolean }[];
  dataPoints: { instance: string; dp: string; dpType: string; classIri: string; nodeDp: string }[];
  summary: SdmOaImportSummary;
}
export interface SdmOaImportResult {
  mode: SdmOaImportPlan['mode'];
  createdNodes: number;
  dataPointClasses: number;
  createdDataPoints: number;
  edges: number;
  errors: string[];
  summary: SdmOaImportSummary;
}

/** Friendly datatype keys supported by the backend property mapping. */
export const SDM_DATATYPES = [
  'bool', 'int', 'uint', 'long', 'float', 'string', 'time', 'langString',
  'dyn_string', 'dyn_int', 'dyn_float', 'dyn_bool'
] as const;

/** Detail of the `wui:select` event emitted across SDM sub-components. */
export interface SdmSelectDetail {
  kind: 'class' | 'instance';
  iri: string;
  /** For instance selections (e.g. from the asset tree): the class + dp to focus. */
  classIri?: string;
  dp?: string;
}

/** Structural system event from OaRxJsApi.sysConnectDpDpt(). */
export interface SdmSysEvent {
  event: string; // 'dpCreated' | 'dpDeleted' | 'dpTypeCreated' | 'dpTypeDeleted' | 'dpTypeChanged' | ...
  area?: string;
  details?: { dpType?: string; dp?: string; [k: string]: unknown };
}
