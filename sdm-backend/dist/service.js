"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyOaImport = exports.planOaImport = exports.validateModel = exports.importApply = exports.importPlan = exports.exportInstances = exports.instantiateTemplate = exports.deleteTemplate = exports.getTemplate = exports.listTemplates = exports.createTemplate = exports.getViewTree = exports.buildHierarchyView = exports.deleteView = exports.getViewChildren = exports.getViewRoots = exports.addViewNode = exports.createTree = exports.createView = exports.listViews = exports.getNeighbors = exports.retractRelation = exports.assertRelation = exports.listInstances = exports.updateInstance = exports.setProperties = exports.getInstance = exports.createInstance = exports.loadTBox = exports.effectiveProperties = exports.getClass = exports.listAspects = exports.listRelationTypes = exports.listClasses = exports.createAspect = exports.createRelationType = exports.adoptDpTypeAsClass = exports.addClassProperty = exports.createClass = void 0;
exports.deleteClass = deleteClass;
exports.deleteInstance = deleteInstance;
exports.getHierarchy = getHierarchy;
exports.getHierarchyRoots = getHierarchyRoots;
exports.getHierarchyChildren = getHierarchyChildren;
exports.query = query;
exports.health = health;
// -----------------------------------------------------------------------------
// API-agnostic service facade. The request handler calls only this module.
// Keeps orchestration (e.g. edge cleanup on delete) in one place.
// -----------------------------------------------------------------------------
const ontology = __importStar(require("./model/ontology"));
const instances = __importStar(require("./model/instances"));
const relations = __importStar(require("./model/relations"));
const views = __importStar(require("./model/views"));
const templates = __importStar(require("./model/templates"));
const bulk = __importStar(require("./model/bulk"));
const validate = __importStar(require("./model/validate"));
const oaImport = __importStar(require("./model/oaImport"));
const oa_1 = require("./oa");
const redu_1 = require("./redu");
// ---- ontology ------------------------------------------------------------
exports.createClass = ontology.createClass;
exports.addClassProperty = ontology.addClassProperty;
exports.adoptDpTypeAsClass = ontology.adoptDpTypeAsClass;
exports.createRelationType = ontology.createRelationType;
exports.createAspect = ontology.createAspect;
async function deleteClass(iri, deleteInstances = false) {
    if (deleteInstances) {
        const cls = ontology.getClass(iri);
        if (cls?.mappedDpType) {
            const list = await instances.listInstances(iri, { limit: 1_000_000 });
            for (const i of list.items)
                await relations.detachAll(i.dp); // keep peers consistent
        }
    }
    return ontology.deleteClass(iri, deleteInstances);
}
exports.listClasses = ontology.listClasses;
exports.listRelationTypes = ontology.listRelationTypes;
exports.listAspects = ontology.listAspects;
exports.getClass = ontology.getClass;
exports.effectiveProperties = ontology.effectiveProperties;
exports.loadTBox = ontology.loadTBox;
// ---- instances -----------------------------------------------------------
exports.createInstance = instances.createInstance;
exports.getInstance = instances.getInstance;
exports.setProperties = instances.setProperties;
exports.updateInstance = instances.updateInstance;
exports.listInstances = instances.listInstances;
async function deleteInstance(ref) {
    await relations.detachAll(ref); // keep graph consistent
    return instances.deleteInstanceRaw(ref);
}
// ---- relations -----------------------------------------------------------
exports.assertRelation = relations.assertRelation;
exports.retractRelation = relations.retractRelation;
exports.getNeighbors = relations.getNeighbors;
// ---- views ---------------------------------------------------------------
exports.listViews = views.listViews;
exports.createView = views.createView;
exports.createTree = views.createTree;
exports.addViewNode = views.addNode;
exports.getViewRoots = views.getRoots;
exports.getViewChildren = views.getChildren;
exports.deleteView = views.deleteView;
exports.buildHierarchyView = views.buildHierarchyView;
exports.getViewTree = views.getViewTree;
/**
 * Live containment tree from `relIri` edges (default isa:partOf). Instances of
 * `memberClassIri` (+ its subclasses) are included even without an edge, so new
 * top-level nodes appear immediately. The asset management UI re-reads this
 * after every change — no CNS rebuild needed.
 */
function memberClosure(memberClassIri) {
    if (!memberClassIri)
        return undefined;
    const set = new Set([memberClassIri]);
    for (const c of ontology.listClasses()) {
        if (ontology.ancestorsOf(c.iri).has(memberClassIri))
            set.add(c.iri);
    }
    return set;
}
function getHierarchy(relIri = 'isa:partOf', memberClassIri = 'isa:EquipmentElement') {
    return views.getHierarchy(relIri, memberClosure(memberClassIri));
}
/** Lazy hierarchy: root nodes only (each with a hasChildren flag). */
function getHierarchyRoots(relIri = 'isa:partOf', memberClassIri = 'isa:EquipmentElement') {
    return views.getHierarchyRoots(relIri, memberClosure(memberClassIri));
}
/** Lazy hierarchy: direct children of one node (read from its in-edges, no scan). */
function getHierarchyChildren(parentDp, relIri = 'isa:partOf') {
    return views.getHierarchyChildren(parentDp, relIri);
}
// ---- templates / typicals ------------------------------------------------
exports.createTemplate = templates.createTemplate;
exports.listTemplates = templates.listTemplates;
exports.getTemplate = templates.getTemplate;
exports.deleteTemplate = templates.deleteTemplate;
exports.instantiateTemplate = templates.instantiateTemplate;
// ---- bulk import / export ------------------------------------------------
exports.exportInstances = bulk.exportInstances;
exports.importPlan = bulk.importPlan;
exports.importApply = bulk.importApply;
// ---- model validation / linting ------------------------------------------
exports.validateModel = validate.validateModel;
// ---- WinCC OA → SDM migration --------------------------------------------
exports.planOaImport = oaImport.planOaImport;
exports.applyOaImport = oaImport.applyOaImport;
// ---- raw query (guarded passthrough) -------------------------------------
async function query(sql) {
    if (typeof sql !== 'string' || !/^\s*SELECT\b/i.test(sql))
        throw new Error('only SELECT queries are allowed');
    return (0, oa_1.oa)().dpQuery(sql);
}
// ---- health --------------------------------------------------------------
function health() {
    const r = (0, redu_1.reduInfo)();
    return {
        ok: true,
        redundant: r.redundant,
        active: r.active,
        classes: ontology.listClasses().length,
        relationTypes: ontology.listRelationTypes().length,
        aspects: ontology.listAspects().length
    };
}
//# sourceMappingURL=service.js.map