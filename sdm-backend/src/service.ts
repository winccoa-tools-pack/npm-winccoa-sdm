// -----------------------------------------------------------------------------
// API-agnostic service facade. The request handler calls only this module.
// Keeps orchestration (e.g. edge cleanup on delete) in one place.
// -----------------------------------------------------------------------------
import * as ontology from './model/ontology';
import * as instances from './model/instances';
import * as relations from './model/relations';
import * as views from './model/views';
import * as templates from './model/templates';
import * as bulk from './model/bulk';
import * as validate from './model/validate';
import * as oaImport from './model/oaImport';
import { oa } from './oa';
import { reduInfo } from './redu';

// ---- ontology ------------------------------------------------------------
export const createClass = ontology.createClass;
export const addClassProperty = ontology.addClassProperty;
export const adoptDpTypeAsClass = ontology.adoptDpTypeAsClass;
export const createRelationType = ontology.createRelationType;
export const createAspect = ontology.createAspect;

export async function deleteClass(iri: string, deleteInstances = false): Promise<boolean> {
  if (deleteInstances) {
    const cls = ontology.getClass(iri);
    if (cls?.mappedDpType) {
      const list = await instances.listInstances(iri, { limit: 1_000_000 });
      for (const i of list.items) await relations.detachAll(i.dp); // keep peers consistent
    }
  }
  return ontology.deleteClass(iri, deleteInstances);
}
export const listClasses = ontology.listClasses;
export const listRelationTypes = ontology.listRelationTypes;
export const listAspects = ontology.listAspects;
export const getClass = ontology.getClass;
export const effectiveProperties = ontology.effectiveProperties;
export const loadTBox = ontology.loadTBox;

// ---- instances -----------------------------------------------------------
export const createInstance = instances.createInstance;
export const getInstance = instances.getInstance;
export const setProperties = instances.setProperties;
export const updateInstance = instances.updateInstance;
export const listInstances = instances.listInstances;

export async function deleteInstance(ref: string): Promise<boolean> {
  await relations.detachAll(ref); // keep graph consistent
  return instances.deleteInstanceRaw(ref);
}

// ---- relations -----------------------------------------------------------
export const assertRelation = relations.assertRelation;
export const retractRelation = relations.retractRelation;
export const getNeighbors = relations.getNeighbors;

// ---- views ---------------------------------------------------------------
export const listViews = views.listViews;
export const createView = views.createView;
export const createTree = views.createTree;
export const addViewNode = views.addNode;
export const getViewRoots = views.getRoots;
export const getViewChildren = views.getChildren;
export const deleteView = views.deleteView;
export const buildHierarchyView = views.buildHierarchyView;
export const getViewTree = views.getViewTree;

/**
 * Live containment tree from `relIri` edges (default isa:partOf). Instances of
 * `memberClassIri` (+ its subclasses) are included even without an edge, so new
 * top-level nodes appear immediately. The asset management UI re-reads this
 * after every change — no CNS rebuild needed.
 */
function memberClosure(memberClassIri?: string): Set<string> | undefined {
  if (!memberClassIri) return undefined;
  const set = new Set<string>([memberClassIri]);
  for (const c of ontology.listClasses()) {
    if (ontology.ancestorsOf(c.iri).has(memberClassIri)) set.add(c.iri);
  }
  return set;
}

export function getHierarchy(relIri = 'isa:partOf', memberClassIri = 'isa:EquipmentElement'): Promise<views.ViewNode[]> {
  return views.getHierarchy(relIri, memberClosure(memberClassIri));
}

/** Lazy hierarchy: root nodes only (each with a hasChildren flag). */
export function getHierarchyRoots(relIri = 'isa:partOf', memberClassIri = 'isa:EquipmentElement'): Promise<views.ViewNode[]> {
  return views.getHierarchyRoots(relIri, memberClosure(memberClassIri));
}

/** Lazy hierarchy: direct children of one node (read from its in-edges, no scan). */
export function getHierarchyChildren(parentDp: string, relIri = 'isa:partOf'): Promise<views.ViewNode[]> {
  return views.getHierarchyChildren(parentDp, relIri);
}

// ---- templates / typicals ------------------------------------------------
export const createTemplate = templates.createTemplate;
export const listTemplates = templates.listTemplates;
export const getTemplate = templates.getTemplate;
export const deleteTemplate = templates.deleteTemplate;
export const instantiateTemplate = templates.instantiateTemplate;

// ---- bulk import / export ------------------------------------------------
export const exportInstances = bulk.exportInstances;
export const importPlan = bulk.importPlan;
export const importApply = bulk.importApply;

// ---- model validation / linting ------------------------------------------
export const validateModel = validate.validateModel;

// ---- WinCC OA → SDM migration --------------------------------------------
export const planOaImport = oaImport.planOaImport;
export const applyOaImport = oaImport.applyOaImport;

// ---- raw query (guarded passthrough) -------------------------------------
export async function query(sql: string): Promise<unknown> {
  if (typeof sql !== 'string' || !/^\s*SELECT\b/i.test(sql))
    throw new Error('only SELECT queries are allowed');
  return oa().dpQuery(sql);
}

// ---- health --------------------------------------------------------------
export function health(): object {
  const r = reduInfo();
  return {
    ok: true,
    redundant: r.redundant,
    active: r.active,
    classes: ontology.listClasses().length,
    relationTypes: ontology.listRelationTypes().length,
    aspects: ontology.listAspects().length
  };
}
