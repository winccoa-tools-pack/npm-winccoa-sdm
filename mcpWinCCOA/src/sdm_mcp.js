// -----------------------------------------------------------------------------
// SDM MCP server
// -----------------------------------------------------------------------------
// Exposes the Semantic Data Model (SDM) to AI as MCP tools. Runs as its own
// WinCC OA JavaScript Manager. It reuses the SDM model functions from the SDM
// project (javascript/sdm/dist) — the model takes an injected WinccoaManager,
// so the exact same code that backs the webserver.js sdm.* commands also backs
// these MCP tools (single source of truth; both stay in sync via OA events).
//
// Run via a JavaScript Manager with parameter: mcpWinCCOA/src/sdm_mcp.js
// HTTP (StreamableHTTP) endpoint: POST http://localhost:4995/mcp
// -----------------------------------------------------------------------------
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { z } from 'zod';
import { WinccoaManager } from 'winccoa-manager';

// SDM model (compiled CommonJS) — ESM imports its named exports.
import { setManager } from '../../sdm/dist/oa.js';
import { bootstrapSdm } from '../../sdm/dist/bootstrap.js';
import * as svc from '../../sdm/dist/service.js';

const PORT = 4995;
const RELOAD_DEBOUNCE_MS = 300;
const STRUCTURAL_EVENTS = ['dpCreated', 'dpDeleted', 'dpTypeCreated', 'dpTypeDeleted', 'dpTypeChanged'];

// ---- shared property schemas ------------------------------------------------
const propertyDef = z.object({
  name: z.string(),
  type: z.string().describe('bool|int|uint|long|float|string|time|langString|dyn_string|dyn_int|dyn_float|dyn_bool'),
  label: z.string().optional(),
  unit: z.string().optional()
});
const valueMap = z.record(z.any()).describe('property name -> value');

function ok(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

// The harness sometimes delivers object/array params as JSON strings — accept both.
function maybeParse(v) {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

// ---- tool registration ------------------------------------------------------
function buildServer() {
  const server = new McpServer({ name: 'winccoa-sdm', version: '0.1.0' });

  server.tool('sdm-health', 'SDM status: counts of classes/relations/aspects and redundancy state', {}, async () => ok(svc.health()));

  // -- ontology / classes --
  server.tool('sdm-class-list', 'List all semantic classes (TBox)', {}, async () => ok(svc.listClasses()));
  server.tool('sdm-class-get', 'Get one semantic class by IRI', { iri: z.string() }, async ({ iri }) => ok(svc.getClass(iri)));
  server.tool('sdm-class-properties', 'Get the effective (own + inherited + aspect) data properties of a class', { iri: z.string() }, async ({ iri }) => ok(svc.effectiveProperties(iri)));
  server.tool(
    'sdm-class-create',
    'Create a semantic class. Generates a dpType (unless abstract); inheritance is flattened from superClasses + aspects.',
    {
      iri: z.string(),
      label: z.string().optional(),
      comment: z.string().optional(),
      superClasses: z.array(z.string()).optional(),
      aspects: z.array(z.string()).optional(),
      properties: z.array(propertyDef).optional(),
      isAbstract: z.boolean().optional(),
      dpType: z.string().optional()
    },
    async (args) => ok(await svc.createClass(args))
  );
  server.tool(
    'sdm-class-delete',
    'Delete a class (its dpType + meta DP). With deleteInstances=true also deletes its instances. Delete concrete subclasses (leaves) before their abstract base.',
    { iri: z.string(), deleteInstances: z.boolean().optional() },
    async ({ iri, deleteInstances }) => ok({ deleted: await svc.deleteClass(iri, !!deleteInstances) })
  );
  server.tool(
    'sdm-class-add-property',
    'Add a data property to a class. Via type-in-type (DPT references) the new property propagates to all subclasses AND their existing instances.',
    { iri: z.string(), property: propertyDef },
    async ({ iri, property }) => ok(await svc.addClassProperty(iri, property))
  );

  // -- relation types --
  server.tool('sdm-relationtype-list', 'List all relation (object property) types', {}, async () => ok(svc.listRelationTypes()));
  server.tool(
    'sdm-relationtype-create',
    'Create a relation (edge) type with domain/range/cardinality.',
    {
      iri: z.string(),
      label: z.string().optional(),
      inverseIri: z.string().optional(),
      domain: z.array(z.string()).optional(),
      range: z.array(z.string()).optional(),
      cardinality: z.string().optional().describe("e.g. '0..*', '1', '0..1', '1..*'"),
      symmetric: z.boolean().optional(),
      transitive: z.boolean().optional(),
      functional: z.boolean().optional(),
      realization: z.string().optional().describe("'inline' (default) or 'edgeDp'")
    },
    async (args) => ok(await svc.createRelationType(args))
  );

  // -- aspects --
  server.tool('sdm-aspect-list', 'List all reusable aspects (mixins)', {}, async () => ok(svc.listAspects()));
  server.tool(
    'sdm-aspect-create',
    'Create a reusable aspect (a named set of properties to mix into classes).',
    { iri: z.string(), label: z.string().optional(), properties: z.array(propertyDef).optional() },
    async (args) => ok(await svc.createAspect(args))
  );

  // -- instances (ABox) --
  server.tool(
    'sdm-instance-list',
    'List instances of a class (paged). `search` filters by dp-name substring server-side (indexed) — use it instead of listing everything on large classes.',
    { classIri: z.string(), limit: z.number().optional(), offset: z.number().optional(), search: z.string().optional() },
    async ({ classIri, limit, offset, search }) => ok(await svc.listInstances(classIri, { limit, offset, search }))
  );
  server.tool('sdm-instance-get', 'Get a full instance (properties, neighbors, label) by id (dp name or IRI).', { id: z.string() }, async ({ id }) => ok(await svc.getInstance(id)));
  server.tool(
    'sdm-instance-create',
    'Create an instance of a class. Creates a DP of the class dpType and sets its properties.',
    { classIri: z.string(), name: z.string().optional().describe('dp name / key; auto-generated if omitted'), label: z.string().optional(), properties: valueMap.optional() },
    async (args) => ok(await svc.createInstance(args))
  );
  server.tool(
    'sdm-instance-update',
    'Update an existing instance: its label and/or data properties.',
    { id: z.string(), label: z.string().optional(), properties: valueMap.optional() },
    async ({ id, label, properties }) => ok(await svc.updateInstance(id, { label, properties }))
  );
  server.tool('sdm-instance-delete', 'Delete an instance and clean up its relations.', { id: z.string() }, async ({ id }) => ok({ deleted: await svc.deleteInstance(id) }));
  server.tool(
    'sdm-instance-neighbors',
    'Get the related instances (graph neighbors) of an instance.',
    { id: z.string(), direction: z.enum(['out', 'in', 'both']).optional(), rel: z.string().optional(), limit: z.number().optional() },
    async ({ id, direction, rel, limit }) => ok(await svc.getNeighbors(id, { direction, rel, limit }))
  );

  // -- relations (edges) --
  server.tool(
    'sdm-relation-assert',
    'Assert a typed relationship between two instances (validated against domain/range/cardinality).',
    { relIri: z.string(), source: z.string(), target: z.string(), props: z.record(z.any()).optional() },
    async (args) => ok(await svc.assertRelation(args))
  );
  server.tool(
    'sdm-relation-retract',
    'Remove a relationship between two instances.',
    { relIri: z.string(), source: z.string(), target: z.string() },
    async (args) => ok({ retracted: await svc.retractRelation(args) })
  );

  // -- CNS views / hierarchies --
  server.tool('sdm-view-list', 'List all CNS views (perspectives / hierarchies).', {}, async () => ok(svc.listViews()));
  server.tool(
    'sdm-view-build',
    'Materialize a containment hierarchy as a CNS view by scanning a (transitive part-of style) relation. Rebuilds the view from scratch. Returns roots and node count.',
    { view: z.string().describe('view name, e.g. "Plant"'), relIri: z.string().describe('the containment relation, e.g. "isa:partOf"'), displayName: z.string().optional() },
    async ({ view, relIri, displayName }) => ok(await svc.buildHierarchyView(view, relIri, displayName))
  );
  server.tool('sdm-view-roots', 'Get the root nodes of a CNS view.', { view: z.string() }, async ({ view }) => ok(svc.getViewRoots(view)));
  server.tool('sdm-view-tree', 'Get the whole CNS view as a nested tree (roots + recursive children, each with bound dp + class).', { view: z.string() }, async ({ view }) => ok(svc.getViewTree(view)));
  server.tool(
    'sdm-hierarchy-get',
    'Get the LIVE containment hierarchy (default isa:partOf) derived directly from edges — no CNS materialization. Instances of memberClassIri (default isa:EquipmentElement) + subclasses appear even without an edge. Reflects the current graph immediately.',
    { relIri: z.string().optional(), memberClassIri: z.string().optional() },
    async ({ relIri, memberClassIri }) => ok(await svc.getHierarchy(relIri, memberClassIri))
  );
  server.tool(
    'sdm-hierarchy-roots',
    'Lazy hierarchy: ROOT nodes only (each with a hasChildren flag). Pair with sdm-hierarchy-children to walk large trees without loading the whole thing.',
    { relIri: z.string().optional(), memberClassIri: z.string().optional() },
    async ({ relIri, memberClassIri }) => ok(await svc.getHierarchyRoots(relIri, memberClassIri))
  );
  server.tool(
    'sdm-hierarchy-children',
    'Lazy hierarchy: direct children of one node, read from its in-edges (no graph scan). O(children).',
    { parentDp: z.string(), relIri: z.string().optional() },
    async ({ parentDp, relIri }) => ok(await svc.getHierarchyChildren(parentDp, relIri))
  );
  server.tool('sdm-view-children', 'Get the child nodes (with bound instance + class) under a CNS node path.', { path: z.string() }, async ({ path }) => ok(await svc.getViewChildren(path)));
  server.tool('sdm-view-delete', 'Delete a CNS view.', { name: z.string() }, async ({ name }) => ok({ deleted: await svc.deleteView(name) }));

  // -- templates / typicals --
  server.tool('sdm-template-list', 'List all templates (reusable parametrized typicals / equipment modules).', {}, async () => ok(await svc.listTemplates()));
  server.tool('sdm-template-get', 'Get one template definition by id.', { id: z.string() }, async ({ id }) => ok(await svc.getTemplate(id)));
  server.tool(
    'sdm-template-create',
    'Create/replace a template: nodes (instances with {param} slots in name/label/props) + internal edges. Edge endpoints reference a node key, or "@param" for an external dp from the binding (e.g. attach module under an existing parent).',
    {
      id: z.string(),
      label: z.string().optional(),
      params: z.array(z.string()).optional(),
      nodes: z.array(z.any()).describe('[{key, classIri, name, label?, properties?}] — name/label/string-props support {param}'),
      edges: z.array(z.any()).optional().describe('[{rel, src, tgt}] — src/tgt = node key or "@param"')
    },
    async (args) => ok(await svc.createTemplate(maybeParse(args)))
  );
  server.tool('sdm-template-delete', 'Delete a template.', { id: z.string() }, async ({ id }) => ok({ deleted: await svc.deleteTemplate(id) }));
  server.tool(
    'sdm-template-instantiate',
    'Stamp a template out for one or more bindings. dryRun=true returns the plan (instances to create, conflicts, edges) WITHOUT writing. onConflict: skip|update|error (default error).',
    {
      id: z.string(),
      bindings: z.any().describe('a binding object {param: value} or an array of them (one structure per row)'),
      dryRun: z.boolean().optional(),
      onConflict: z.enum(['skip', 'update', 'error']).optional()
    },
    async ({ id, bindings, dryRun, onConflict }) => ok(await svc.instantiateTemplate(id, maybeParse(bindings), { dryRun, onConflict }))
  );

  // -- bulk import / export (spreadsheet round-trip) --
  server.tool(
    'sdm-bulk-export',
    'Export instances to a flat table (columns: dp, class, label, parent, + one per property). No classIri = every concrete class.',
    { classIri: z.string().optional(), relIri: z.string().optional() },
    async ({ classIri, relIri }) => ok(await svc.exportInstances(classIri, relIri))
  );
  server.tool(
    'sdm-bulk-import-plan',
    'Dry-run a bulk import: returns a DIFF (creates / updates / unchanged / errors) for the given rows WITHOUT writing. Rows: {dp, class, label, parent, <prop>...}. Key = dp.',
    { rows: z.any().describe('array of flat row objects'), relIri: z.string().optional() },
    async ({ rows, relIri }) => ok(await svc.importPlan(maybeParse(rows) || [], { relIri }))
  );
  server.tool(
    'sdm-bulk-import-apply',
    'Apply a bulk import: upsert instances by dp and reconcile parent (part-of) edges. Returns a summary.',
    { rows: z.any().describe('array of flat row objects'), relIri: z.string().optional() },
    async ({ rows, relIri }) => ok(await svc.importApply(maybeParse(rows) || [], { relIri }))
  );

  // -- model validation / linting --
  server.tool(
    'sdm-validate',
    'Lint the whole model: unknown classes, orphan edges, out/in adjacency mismatches, cardinality violations, domain/range violations. Returns findings + summary.',
    {},
    async () => ok(await svc.validateModel())
  );

  // -- WinCC OA → SDM migration --
  server.tool(
    'sdm-oa-import-plan',
    'Dry-run the WinCC OA → SDM migration: reads _PanelTopology (asset hierarchy) + per-node sum-alarm DPs (DP assignment) and returns the plan WITHOUT writing. One SDM class per member dpType. adoptDataPoints=true (default): adopt each dpType as a class (real DPs become instances). false: non-invasive per-dpType reference proxies.',
    {
      includeDataPoints: z.boolean().optional().describe('resolve sum-alarm members (default true)'),
      adoptDataPoints: z.boolean().optional().describe('adopt dpTypes as classes / real DPs as instances (default true); false = proxies')
    },
    async ({ includeDataPoints, adoptDataPoints }) => ok(await svc.planOaImport({ includeDataPoints, adoptDataPoints }))
  );
  server.tool(
    'sdm-oa-import-apply',
    'Apply the WinCC OA → SDM migration: oa:TopologyNode instances + isa:partOf hierarchy from _PanelTopology, plus one SDM class per member dpType and the data points attached per node. adoptDataPoints=true (default) adopts each dpType (augments it with a sem struct → its real DPs become instances); false creates per-dpType proxy classes + reference instances. Idempotent.',
    {
      includeDataPoints: z.boolean().optional(),
      adoptDataPoints: z.boolean().optional()
    },
    async ({ includeDataPoints, adoptDataPoints }) => ok(await svc.applyOaImport({ includeDataPoints, adoptDataPoints }))
  );

  // -- raw query --
  server.tool('sdm-query', 'Run a raw SELECT dpQuery (read-only) over the underlying data points.', { sql: z.string() }, async ({ sql }) => ok({ data: await svc.query(sql) }));

  return server;
}

// ---- bootstrap + HTTP server ------------------------------------------------
async function main() {
  const winccoa = new WinccoaManager();
  setManager(winccoa);

  await bootstrapSdm();
  await svc.loadTBox();

  // Event-driven TBox refresh (structural changes from anywhere).
  let reloadTimer = null;
  const scheduleReload = () => {
    if (reloadTimer) return;
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      svc.loadTBox().catch((e) => console.error('SDM-MCP TBox reload failed:', e));
    }, RELOAD_DEBOUNCE_MS);
  };
  try {
    const sys = winccoa.sysConnect;
    for (const ev of STRUCTURAL_EVENTS) sys.on(ev, scheduleReload);
  } catch (e) {
    console.error('SDM-MCP structural watch could not be established:', e);
  }

  const app = express();
  app.use(express.json({ limit: '20mb' }));

  app.post('/mcp', async (req, res) => {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('SDM-MCP request error:', error);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  });

  app.get('/', (_req, res) => res.status(200).end('WinCC OA SDM MCP Server'));

  app.listen(PORT, () => {
    console.log(`WinCC OA SDM MCP server listening on http://localhost:${PORT}/mcp`);
  });
}

main().catch((e) => {
  console.error(e);
  console.error('SDM-MCP failed to start');
});
