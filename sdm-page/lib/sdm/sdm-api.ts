/**
 * Thin client for the backend `sdm.*` WebSocket command family.
 *
 * It rides on the existing WinCC OA WebSocket connection via
 * `OaRxJsApi.customCommand(command, params)` — the same channel the WebUI uses
 * for dpConnect/dpGet/etc. Each SDM command is a one-shot request/response, so
 * the returned Observable emits the result `data` once and completes; we expose
 * it as a Promise.
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { Observable, firstValueFrom } from 'rxjs';
import { container } from 'tsyringe';

import {
  SdmAspect,
  SdmClass,
  SdmExportResult,
  SdmHealth,
  SdmImportDiff,
  SdmImportResult,
  SdmInstance,
  SdmInstanceList,
  SdmInstantiateResult,
  SdmNeighbor,
  SdmOaImportPlan,
  SdmOaImportResult,
  SdmHierarchyResult,
  SdmPropertyDef,
  SdmRelationType,
  SdmTemplate,
  SdmValidationReport,
  SdmViewNode
} from './sdm-types.js';

export interface CreateClassInput {
  iri: string;
  label?: string;
  comment?: string;
  superClasses?: string[];
  aspects?: string[];
  properties?: SdmPropertyDef[];
  isAbstract?: boolean;
}

export interface CreateRelationInput {
  iri: string;
  label?: string;
  inverseIri?: string;
  domain?: string[];
  range?: string[];
  cardinality?: string;
  symmetric?: boolean;
  realization?: string;
}

export interface CreateInstanceInput {
  classIri: string;
  name?: string;
  label?: string;
  properties?: Record<string, unknown>;
}

export class SdmApi {
  private readonly api = container.resolve<OaRxJsApi>(OaRxJsApi);

  private call<T>(command: string, params: Record<string, unknown> = {}): Promise<T> {
    return firstValueFrom(this.api.customCommand<T>(command, params));
  }

  // ---- live subscriptions (event-driven; WinCC OA is online-changeable) ----
  /**
   * Hotlink to a dpQuery scoped by dpType. Emits whenever a matching data point
   * is created or deleted (and on `_active` changes, which are rare). Used as a
   * change trigger; the actual data is re-read via sdm.*.
   *
   * Use the `_original.._active` column over `*.*` so the hotlink scopes to the
   * type (via WHERE _DPT) and fires on new/removed DPs without churning on every
   * process value update. Example:
   *   SELECT '_original.._active' FROM '*.*' WHERE _DPT = "C_Tank"
   */
  watch(query: string): Observable<unknown> {
    // answer=false: changes only (initial state is fetched explicitly via sdm.*).
    return this.api.dpQueryConnect(query, false) as unknown as Observable<unknown>;
  }

  /** Hotlink to specific DPE value(s) (e.g. an instance's live properties/edges). */
  connect(dpes: string[]): Observable<unknown> {
    return this.api.dpConnect(dpes, false) as unknown as Observable<unknown>;
  }

  // ---- ontology ----
  health(): Promise<SdmHealth> {
    return this.call<SdmHealth>('sdm.health');
  }
  listClasses(): Promise<SdmClass[]> {
    return this.call<SdmClass[]>('sdm.class.list');
  }
  getClass(iri: string): Promise<SdmClass | null> {
    return this.call<SdmClass | null>('sdm.class.get', { iri });
  }
  classProperties(iri: string): Promise<SdmPropertyDef[]> {
    return this.call<SdmPropertyDef[]>('sdm.class.properties', { iri });
  }
  createClass(input: CreateClassInput): Promise<SdmClass> {
    return this.call<SdmClass>('sdm.class.create', input as unknown as Record<string, unknown>);
  }
  listRelationTypes(): Promise<SdmRelationType[]> {
    return this.call<SdmRelationType[]>('sdm.relationType.list');
  }
  createRelationType(input: CreateRelationInput): Promise<SdmRelationType> {
    return this.call<SdmRelationType>('sdm.relationType.create', input as unknown as Record<string, unknown>);
  }
  listAspects(): Promise<SdmAspect[]> {
    return this.call<SdmAspect[]>('sdm.aspect.list');
  }

  // ---- instances ----
  listInstances(classIri: string, limit = 200, offset = 0, search?: string): Promise<SdmInstanceList> {
    return this.call<SdmInstanceList>('sdm.instance.list', { classIri, limit, offset, search });
  }
  getInstance(id: string): Promise<SdmInstance | null> {
    return this.call<SdmInstance | null>('sdm.instance.get', { id });
  }
  createInstance(input: CreateInstanceInput): Promise<SdmInstance> {
    return this.call<SdmInstance>('sdm.instance.create', input as unknown as Record<string, unknown>);
  }
  setProperties(id: string, properties: Record<string, unknown>): Promise<SdmInstance> {
    return this.call<SdmInstance>('sdm.instance.setProperties', { id, properties });
  }
  updateInstance(id: string, label: string, properties: Record<string, unknown>): Promise<SdmInstance> {
    return this.call<SdmInstance>('sdm.instance.update', { id, label, properties });
  }
  deleteInstance(id: string): Promise<{ deleted: boolean }> {
    return this.call<{ deleted: boolean }>('sdm.instance.delete', { id });
  }
  neighbors(id: string, direction: 'out' | 'in' | 'both' = 'both'): Promise<SdmNeighbor[]> {
    return this.call<SdmNeighbor[]>('sdm.instance.neighbors', { id, direction });
  }

  // ---- views (CNS hierarchies) ----
  listViews(): Promise<string[]> {
    return this.call<string[]>('sdm.view.list');
  }
  /** Materialize a containment hierarchy (e.g. isa:partOf) as a CNS view. Idempotent rebuild. */
  buildView(view: string, relIri: string, displayName?: string): Promise<SdmHierarchyResult> {
    return this.call<SdmHierarchyResult>('sdm.view.build', { view, relIri, displayName });
  }
  /** Whole view as a nested tree (each node bound to its instance dp + class). */
  viewTree(view: string): Promise<SdmViewNode[]> {
    return this.call<SdmViewNode[]>('sdm.view.tree', { view });
  }
  /**
   * LIVE containment hierarchy derived directly from the edges (default
   * isa:partOf) — no CNS rebuild. Instances of `memberClassIri` (+ subclasses)
   * appear even without an edge. Re-read this after every change.
   */
  getHierarchy(relIri?: string, memberClassIri?: string): Promise<SdmViewNode[]> {
    return this.call<SdmViewNode[]>('sdm.hierarchy.get', { relIri, memberClassIri });
  }
  /** Lazy hierarchy: root nodes only (each with hasChildren). */
  hierarchyRoots(relIri?: string, memberClassIri?: string): Promise<SdmViewNode[]> {
    return this.call<SdmViewNode[]>('sdm.hierarchy.roots', { relIri, memberClassIri });
  }
  /** Lazy hierarchy: direct children of one node (read from its in-edges, no scan). */
  hierarchyChildren(parentDp: string, relIri?: string): Promise<SdmViewNode[]> {
    return this.call<SdmViewNode[]>('sdm.hierarchy.children', { parentDp, relIri });
  }

  // ---- templates / typicals ----
  listTemplates(): Promise<SdmTemplate[]> {
    return this.call<SdmTemplate[]>('sdm.template.list');
  }
  getTemplate(id: string): Promise<SdmTemplate | null> {
    return this.call<SdmTemplate | null>('sdm.template.get', { id });
  }
  createTemplate(def: SdmTemplate): Promise<SdmTemplate> {
    return this.call<SdmTemplate>('sdm.template.create', def as unknown as Record<string, unknown>);
  }
  deleteTemplate(id: string): Promise<{ deleted: boolean }> {
    return this.call<{ deleted: boolean }>('sdm.template.delete', { id });
  }
  instantiateTemplate(
    id: string,
    bindings: Record<string, string>[],
    opts: { dryRun?: boolean; onConflict?: 'skip' | 'update' | 'error' } = {}
  ): Promise<SdmInstantiateResult> {
    return this.call<SdmInstantiateResult>('sdm.template.instantiate', { id, bindings, dryRun: opts.dryRun, onConflict: opts.onConflict });
  }

  // ---- bulk import / export (spreadsheet round-trip) ----
  exportInstances(classIri?: string, relIri?: string): Promise<SdmExportResult> {
    return this.call<SdmExportResult>('sdm.bulk.export', { classIri, relIri });
  }
  importPlan(rows: Record<string, unknown>[], relIri?: string): Promise<SdmImportDiff> {
    return this.call<SdmImportDiff>('sdm.bulk.importPlan', { rows, relIri });
  }
  importApply(rows: Record<string, unknown>[], relIri?: string): Promise<SdmImportResult> {
    return this.call<SdmImportResult>('sdm.bulk.importApply', { rows, relIri });
  }

  // ---- model validation / linting ----
  validateModel(): Promise<SdmValidationReport> {
    return this.call<SdmValidationReport>('sdm.validate');
  }

  // ---- WinCC OA → SDM migration ----
  oaImportPlan(includeDataPoints = true, adoptDataPoints = true): Promise<SdmOaImportPlan> {
    return this.call<SdmOaImportPlan>('sdm.oa.importPlan', { includeDataPoints, adoptDataPoints });
  }
  oaImportApply(includeDataPoints = true, adoptDataPoints = true): Promise<SdmOaImportResult> {
    return this.call<SdmOaImportResult>('sdm.oa.importApply', { includeDataPoints, adoptDataPoints });
  }

  // ---- relations ----
  assertRelation(relIri: string, source: string, target: string): Promise<unknown> {
    return this.call('sdm.relation.assert', { relIri, source, target });
  }
  retractRelation(relIri: string, source: string, target: string): Promise<unknown> {
    return this.call('sdm.relation.retract', { relIri, source, target });
  }
}
