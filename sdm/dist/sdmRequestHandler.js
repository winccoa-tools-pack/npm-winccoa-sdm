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
exports.SdmRequestHandler = void 0;
// -----------------------------------------------------------------------------
// SdmRequestHandler
// -----------------------------------------------------------------------------
// WebSocket request handler for the Semantic Data Model. All SDM operations are
// exposed as WebSocket commands prefixed with "sdm." (NOT as REST). A WebUI
// client sends e.g. { command: "sdm.instance.create", params: {...} } and the
// framework routes the stripped command ("instance.create") to handleRequest().
//
// Live data: "sdm.connect" / "sdm.disconnect" reuse the framework's
// per-connection dpConnect plumbing (context.dpConnect) exactly like the
// standard handlers, so value updates stream over the same WebSocket.
// -----------------------------------------------------------------------------
const webserver_js_1 = require("webserver-js");
const constants_1 = require("./constants");
const redu_1 = require("./redu");
const svc = __importStar(require("./service"));
// Commands that mutate the model -> only allowed on the active redundancy peer.
const WRITE_COMMANDS = new Set([
    'class.create', 'class.delete', 'class.addProperty', 'relationType.create', 'aspect.create',
    'instance.create', 'instance.setProperties', 'instance.update', 'instance.delete',
    'relation.assert', 'relation.retract',
    'view.create', 'view.createTree', 'view.addNode', 'view.build', 'view.delete',
    'template.create', 'template.delete', 'template.instantiate', 'bulk.importApply',
    'oa.importApply'
]);
class SdmRequestHandler extends webserver_js_1.WsjRequestHandlerBase {
    get prefix() {
        return constants_1.SDM_PREFIX;
    }
    async handleRequest(command, params, result, context) {
        // Live-data subscription commands are handled separately because they set
        // special result flags (keep listening) instead of returning plain data.
        if (command === 'connect')
            return this.connect(params, result, context);
        if (command === 'disconnect')
            return this.disconnect(params, result, context);
        if (WRITE_COMMANDS.has(command) && !(0, redu_1.mayWrite)())
            throw new webserver_js_1.WsjError(webserver_js_1.WsjErrorCode.AuthorizationFailed, 'this peer is on standby (redundancy); send writes to the active host', 503);
        try {
            const data = await this.dispatch(command, params);
            if (data === undefined)
                return await super.handleRequest(command, params, result, context); // unknown command
            result.setSuccess(data ?? null);
            return result;
        }
        catch (err) {
            if (err instanceof webserver_js_1.WsjError)
                throw err;
            throw new webserver_js_1.WsjError(webserver_js_1.WsjErrorCode.InternalError, err.message, 400);
        }
    }
    /** Maps a command to a service call. Returns `undefined` for unknown commands. */
    async dispatch(command, p) {
        switch (command) {
            // ---- ontology ----
            case 'class.create':
                return svc.createClass(p);
            case 'class.list':
                return svc.listClasses();
            case 'class.get':
                return svc.getClass(this.str(p, 'iri'));
            case 'class.properties':
                return svc.effectiveProperties(this.str(p, 'iri'));
            case 'class.delete':
                return { deleted: await svc.deleteClass(this.str(p, 'iri'), !!p.deleteInstances) };
            case 'class.addProperty':
                return svc.addClassProperty(this.str(p, 'iri'), p.property);
            case 'relationType.create':
                return svc.createRelationType(p);
            case 'relationType.list':
                return svc.listRelationTypes();
            case 'aspect.create':
                return svc.createAspect(p);
            case 'aspect.list':
                return svc.listAspects();
            // ---- instances ----
            case 'instance.create':
                return svc.createInstance(p);
            case 'instance.get':
                return svc.getInstance(this.str(p, 'id'));
            case 'instance.list':
                return svc.listInstances(this.str(p, 'classIri'), {
                    limit: p.limit,
                    offset: p.offset,
                    search: p.search
                });
            case 'instance.setProperties':
                return svc.setProperties(this.str(p, 'id'), p.properties || {});
            case 'instance.update':
                return svc.updateInstance(this.str(p, 'id'), {
                    label: p.label,
                    properties: p.properties || {}
                });
            case 'instance.delete':
                return { deleted: await svc.deleteInstance(this.str(p, 'id')) };
            case 'instance.neighbors':
                return svc.getNeighbors(this.str(p, 'id'), {
                    direction: p.direction || 'out',
                    rel: p.rel || null,
                    limit: p.limit
                });
            // ---- relations ----
            case 'relation.assert':
                return svc.assertRelation(p);
            case 'relation.retract':
                return { retracted: await svc.retractRelation(p) };
            // ---- views ----
            case 'view.list':
                return svc.listViews();
            case 'view.create':
                return { view: await svc.createView(this.str(p, 'name'), p.displayName) };
            case 'view.createTree':
                return { path: await svc.createTree(p) };
            case 'view.addNode':
                return { path: await svc.addViewNode(p) };
            case 'view.roots':
                return svc.getViewRoots(this.str(p, 'view'));
            case 'view.children':
                return svc.getViewChildren(this.str(p, 'path'));
            case 'view.tree':
                return svc.getViewTree(this.str(p, 'view'));
            case 'hierarchy.get':
                return svc.getHierarchy(p.relIri || undefined, p.memberClassIri);
            case 'hierarchy.roots':
                return svc.getHierarchyRoots(p.relIri || undefined, p.memberClassIri);
            case 'hierarchy.children':
                return svc.getHierarchyChildren(this.str(p, 'parentDp'), p.relIri || undefined);
            // ---- templates / typicals ----
            case 'template.create':
                return svc.createTemplate(p);
            case 'template.list':
                return svc.listTemplates();
            case 'template.get':
                return svc.getTemplate(this.str(p, 'id'));
            case 'template.delete':
                return { deleted: await svc.deleteTemplate(this.str(p, 'id')) };
            case 'template.instantiate':
                return svc.instantiateTemplate(this.str(p, 'id'), p.bindings, {
                    dryRun: !!p.dryRun,
                    onConflict: p.onConflict
                });
            // ---- bulk import / export ----
            case 'bulk.export':
                return svc.exportInstances(p.classIri, p.relIri);
            case 'bulk.importPlan':
                return svc.importPlan(p.rows || [], { relIri: p.relIri });
            case 'bulk.importApply':
                return svc.importApply(p.rows || [], { relIri: p.relIri });
            // ---- validation ----
            case 'validate':
                return svc.validateModel();
            // ---- WinCC OA → SDM migration ----
            case 'oa.importPlan':
                return svc.planOaImport({ includeDataPoints: p.includeDataPoints, adoptDataPoints: p.adoptDataPoints });
            case 'oa.importApply':
                return svc.applyOaImport({ includeDataPoints: p.includeDataPoints, adoptDataPoints: p.adoptDataPoints });
            case 'view.build':
                return svc.buildHierarchyView(this.str(p, 'view'), this.str(p, 'relIri'), p.displayName);
            case 'view.delete':
                return { deleted: await svc.deleteView(this.str(p, 'name')) };
            // ---- misc ----
            case 'query':
                return { data: await svc.query(this.str(p, 'sql')) };
            case 'health':
                return svc.health();
            default:
                return undefined;
        }
    }
    // ---------------------------------------------------------------------------
    // live data subscription (delegates to the framework's dpConnect plumbing)
    // ---------------------------------------------------------------------------
    connect(params, result, context) {
        this.assertRequiredParameters(params, 'dpNames');
        this.assertNotEmpty(params, 'dpNames');
        let names = params.dpNames;
        if (!Array.isArray(names))
            names = [names];
        const answer = params.answer !== undefined ? params.answer : true;
        context.dpConnect(result.uuid, names, answer);
        // keep listening: more responses (value updates) will follow on this uuid
        result.setSuccess(true, false, false);
        return result;
    }
    disconnect(params, result, context) {
        this.assertRequiredParameters(params, 'connectUuid');
        context.dpDisconnect(params.connectUuid);
        result.setSuccess(true);
        return result;
    }
    str(p, key) {
        const v = p[key];
        if (typeof v !== 'string' || v.length === 0)
            throw new webserver_js_1.WsjError(webserver_js_1.WsjErrorCode.MissingParameter, `missing/invalid parameter '${key}'`, 400);
        return v;
    }
}
exports.SdmRequestHandler = SdmRequestHandler;
//# sourceMappingURL=sdmRequestHandler.js.map