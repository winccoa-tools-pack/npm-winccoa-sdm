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
import {
  WsjConnectionContext,
  WsjError,
  WsjErrorCode,
  WsjRequestHandlerBase,
  WsjRequestResult
} from 'webserver-js';

import { SDM_PREFIX } from './constants';
import { mayWrite } from './redu';
import * as svc from './service';

type Params = { [k: string]: unknown };

// Commands that mutate the model -> only allowed on the active redundancy peer.
const WRITE_COMMANDS = new Set<string>([
  'class.create', 'class.delete', 'class.addProperty', 'relationType.create', 'aspect.create',
  'instance.create', 'instance.setProperties', 'instance.update', 'instance.delete',
  'relation.assert', 'relation.retract',
  'view.create', 'view.createTree', 'view.addNode', 'view.build', 'view.delete',
  'template.create', 'template.delete', 'template.instantiate', 'bulk.importApply',
  'oa.importApply'
]);

export class SdmRequestHandler extends WsjRequestHandlerBase {
  get prefix(): string {
    return SDM_PREFIX;
  }

  async handleRequest(
    command: string,
    params: object,
    result: WsjRequestResult,
    context: WsjConnectionContext
  ): Promise<WsjRequestResult> {
    // Live-data subscription commands are handled separately because they set
    // special result flags (keep listening) instead of returning plain data.
    if (command === 'connect') return this.connect(params as Params, result, context);
    if (command === 'disconnect') return this.disconnect(params as Params, result, context);

    if (WRITE_COMMANDS.has(command) && !mayWrite())
      throw new WsjError(
        WsjErrorCode.AuthorizationFailed,
        'this peer is on standby (redundancy); send writes to the active host',
        503
      );

    try {
      const data = await this.dispatch(command, params as Params);
      if (data === undefined)
        return await super.handleRequest(command, params, result, context); // unknown command
      result.setSuccess(data ?? null);
      return result;
    } catch (err) {
      if (err instanceof WsjError) throw err;
      throw new WsjError(WsjErrorCode.InternalError, (err as Error).message, 400);
    }
  }

  /** Maps a command to a service call. Returns `undefined` for unknown commands. */
  private async dispatch(command: string, p: Params): Promise<unknown> {
    switch (command) {
      // ---- ontology ----
      case 'class.create':
        return svc.createClass(p as never);
      case 'class.list':
        return svc.listClasses();
      case 'class.get':
        return svc.getClass(this.str(p, 'iri'));
      case 'class.properties':
        return svc.effectiveProperties(this.str(p, 'iri'));
      case 'class.delete':
        return { deleted: await svc.deleteClass(this.str(p, 'iri'), !!p.deleteInstances) };
      case 'class.addProperty':
        return svc.addClassProperty(this.str(p, 'iri'), p.property as never);
      case 'relationType.create':
        return svc.createRelationType(p as never);
      case 'relationType.list':
        return svc.listRelationTypes();
      case 'aspect.create':
        return svc.createAspect(p as never);
      case 'aspect.list':
        return svc.listAspects();

      // ---- instances ----
      case 'instance.create':
        return svc.createInstance(p as never);
      case 'instance.get':
        return svc.getInstance(this.str(p, 'id'));
      case 'instance.list':
        return svc.listInstances(this.str(p, 'classIri'), {
          limit: p.limit as number | undefined,
          offset: p.offset as number | undefined,
          search: p.search as string | undefined
        });
      case 'instance.setProperties':
        return svc.setProperties(this.str(p, 'id'), (p.properties as Params) || {});
      case 'instance.update':
        return svc.updateInstance(this.str(p, 'id'), {
          label: p.label as string | undefined,
          properties: (p.properties as Params) || {}
        });
      case 'instance.delete':
        return { deleted: await svc.deleteInstance(this.str(p, 'id')) };
      case 'instance.neighbors':
        return svc.getNeighbors(this.str(p, 'id'), {
          direction: (p.direction as 'out' | 'in' | 'both') || 'out',
          rel: (p.rel as string) || null,
          limit: p.limit as number | undefined
        });

      // ---- relations ----
      case 'relation.assert':
        return svc.assertRelation(p as never);
      case 'relation.retract':
        return { retracted: await svc.retractRelation(p as never) };

      // ---- views ----
      case 'view.list':
        return svc.listViews();
      case 'view.create':
        return { view: await svc.createView(this.str(p, 'name'), p.displayName as never) };
      case 'view.createTree':
        return { path: await svc.createTree(p as never) };
      case 'view.addNode':
        return { path: await svc.addViewNode(p as never) };
      case 'view.roots':
        return svc.getViewRoots(this.str(p, 'view'));
      case 'view.children':
        return svc.getViewChildren(this.str(p, 'path'));
      case 'view.tree':
        return svc.getViewTree(this.str(p, 'view'));
      case 'hierarchy.get':
        return svc.getHierarchy((p.relIri as string) || undefined, p.memberClassIri as string | undefined);
      case 'hierarchy.roots':
        return svc.getHierarchyRoots((p.relIri as string) || undefined, p.memberClassIri as string | undefined);
      case 'hierarchy.children':
        return svc.getHierarchyChildren(this.str(p, 'parentDp'), (p.relIri as string) || undefined);

      // ---- templates / typicals ----
      case 'template.create':
        return svc.createTemplate(p as never);
      case 'template.list':
        return svc.listTemplates();
      case 'template.get':
        return svc.getTemplate(this.str(p, 'id'));
      case 'template.delete':
        return { deleted: await svc.deleteTemplate(this.str(p, 'id')) };
      case 'template.instantiate':
        return svc.instantiateTemplate(this.str(p, 'id'), p.bindings as never, {
          dryRun: !!p.dryRun,
          onConflict: p.onConflict as 'skip' | 'update' | 'error' | undefined
        });

      // ---- bulk import / export ----
      case 'bulk.export':
        return svc.exportInstances(p.classIri as string | undefined, p.relIri as string | undefined);
      case 'bulk.importPlan':
        return svc.importPlan((p.rows as never) || [], { relIri: p.relIri as string | undefined });
      case 'bulk.importApply':
        return svc.importApply((p.rows as never) || [], { relIri: p.relIri as string | undefined });

      // ---- validation ----
      case 'validate':
        return svc.validateModel();

      // ---- WinCC OA → SDM migration ----
      case 'oa.importPlan':
        return svc.planOaImport({ includeDataPoints: p.includeDataPoints as boolean | undefined, adoptDataPoints: p.adoptDataPoints as boolean | undefined });
      case 'oa.importApply':
        return svc.applyOaImport({ includeDataPoints: p.includeDataPoints as boolean | undefined, adoptDataPoints: p.adoptDataPoints as boolean | undefined });
      case 'view.build':
        return svc.buildHierarchyView(this.str(p, 'view'), this.str(p, 'relIri'), p.displayName as never);
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
  private connect(params: Params, result: WsjRequestResult, context: WsjConnectionContext): WsjRequestResult {
    this.assertRequiredParameters(params, 'dpNames');
    this.assertNotEmpty(params, 'dpNames');
    let names = params.dpNames as string | string[];
    if (!Array.isArray(names)) names = [names];
    const answer = params.answer !== undefined ? (params.answer as boolean) : true;
    context.dpConnect(result.uuid, names, answer);
    // keep listening: more responses (value updates) will follow on this uuid
    result.setSuccess(true, false, false);
    return result;
  }

  private disconnect(params: Params, result: WsjRequestResult, context: WsjConnectionContext): WsjRequestResult {
    this.assertRequiredParameters(params, 'connectUuid');
    context.dpDisconnect(params.connectUuid as number | string);
    result.setSuccess(true);
    return result;
  }

  private str(p: Params, key: string): string {
    const v = p[key];
    if (typeof v !== 'string' || v.length === 0)
      throw new WsjError(WsjErrorCode.MissingParameter, `missing/invalid parameter '${key}'`, 400);
    return v;
  }
}
