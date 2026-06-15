# WinCC OA — Semantic Data Model (SDM) Backend

A WinCC OA **3.21** backend that turns the OA object model (DPT / DP / CNS) into
a **semantic data model**: classes, inheritance, typed relationships (a graph)
and multiple parallel hierarchies — stored in pure OA primitives, hence covered
by **redundancy** and **distribution** automatically, and designed to scale to
**millions of DPEs**.

It is built as a **customization of the webserver.js dashboard server**
(`@winccoa/backend` / `webserver-js`), exactly like the
`customer-webserver-example`. SDM functionality is exposed as **WebSocket
request-handler commands** (prefix `sdm.`), **not** as REST. The standard
dashboard handlers (connections, models, live data, …) remain fully available.

## How it maps to OA

| Semantic concept | OA realization |
| --- | --- |
| Class (TBox) | meta DP of `_SemClass` + a generated class **dpType** |
| Inheritance | **flattened** at class creation (own + super + aspect properties) |
| Aspect / mixin | `_SemAspect` (reusable property set) |
| Instance (ABox) | one **DP** of the class' dpType |
| Data property | **DPE** (full OA config: archive / alert / address) |
| Relationship (edge) | inline adjacency lists on the DP (`sem.edgesOut/In`) — default; or reified `_SemEdge` DP for attributed edges |
| Perspective / hierarchy | **CNS view** (many views over the same DPs) |
| Identity (IRI) | `System:dpName` (the DP name is the primary key) |

## Architecture

```
sdm/
  run.js                     JavaScript-Manager entry (loads dist/, opens server, bootstraps)
  package.json / tsconfig.json
  src/
    index.ts                 exports for run.js
    sdmDashboardServer.ts     extends WsjDashboardServer, registers the SDM handler
    sdmRequestHandler.ts      WsjRequestHandlerBase, prefix "sdm.", command dispatch + live data
    service.ts                API-agnostic facade (orchestration)
    oa.ts                     WsjServerGlobal.winccoa accessor + helpers + log
    constants.ts              meta dpType names, type maps, prefix
    bootstrap.ts              idempotent meta-dpType + backbone-view creation (active peer)
    redu.ts                   redundancy gating (writes only on active host)
    model/
      ontology.ts             TBox: classes / relation types / aspects (+ in-memory cache)
      validation.ts           domain / range / cardinality checks
      instances.ts            ABox lifecycle
      relations.ts            edges (inline + reified), bidirectional, neighbor queries
      views.ts                CNS perspectives (views / trees / nodes)
      types.ts                shared domain types
```

Build output goes to `dist/`. Only `webserver-js` (the dashboard framework) and
`winccoa-manager` are runtime dependencies — both resolved from the WinCC OA
installation via the JavaScript Manager's `NODE_PATH` (no REST stack, no
WebSocket library of our own; live data uses the framework's `dpConnect`).

## Redundancy & scale

- The model **is** the DP/CNS data → replicated by OA redundancy. The server
  runs on both peers; structural/background writes are gated to the **active**
  host (`redu.ts`); mutating commands return an error on standby.
- The in-memory TBox cache is a pure performance mirror, always rebuildable.
- Instances are found via OA's native **type index** (`dpNames(type)`), no custom
  index. Edges are inline adjacency lists → no DP per edge, O(1) neighbor lookup
  in **both** directions (bidirectional maintenance). Reified `_SemEdge` DPs are
  reserved for "living"/attributed edges.

## Build & run

```bash
cd <project>/javascript/sdm
npm install          # links webserver-js + winccoa-manager (+ @types) from the OA install
npm run build        # tsc -> dist/
```

`config/progs` contains the manager entry (set to `manual`):

```
node | manual | 30 | 2 | 2 | sdm/run.js
```

Start it from the WinCC OA **Console**. Configuration via env (set on the
manager) — defaults avoid clashing with the standard webserver (8443):

- `SDM_PORT`  default **8444**
- `SDM_WSS`   default **/winccoa**

> Alternatively this server can **replace** the standard `webserver-js/run.js`
> manager (it includes all standard handlers plus `sdm.*`), serving everything
> on the configured 8443.

## WebSocket command API (prefix `sdm.`)

Clients send `{ command: "sdm.<cmd>", params: {...}, uuid: <n> }` over the
WebSocket endpoint; the result is returned correlated by `uuid` (same envelope
as all WinCC OA WebUI commands).

Ontology
- `sdm.class.create` `{ iri, label?, comment?, superClasses?, aspects?, properties?:[{name,type,label?,unit?}], isAbstract?, dpType? }`
- `sdm.class.list` · `sdm.class.get` `{iri}` · `sdm.class.properties` `{iri}`
- `sdm.relationType.create` `{ iri, label?, inverseIri?, domain?, range?, cardinality?, symmetric?, transitive?, functional?, realization? }`
- `sdm.relationType.list`
- `sdm.aspect.create` `{ iri, label?, properties? }` · `sdm.aspect.list`

Instances
- `sdm.instance.create` `{ classIri, name?, iri?, label?, properties? }`
- `sdm.instance.get` `{id}` · `sdm.instance.list` `{ classIri, limit?, offset? }`
- `sdm.instance.setProperties` `{ id, properties }` · `sdm.instance.delete` `{id}`
- `sdm.instance.neighbors` `{ id, direction?:out|in|both, rel?, limit? }`

Relations
- `sdm.relation.assert` `{ relIri, source, target, props? }`
- `sdm.relation.retract` `{ relIri, source, target }`

Views (CNS perspectives)
- `sdm.view.list` · `sdm.view.create` `{ name, displayName? }`
- `sdm.view.createTree` `{ view, nodeId, displayName?, dp? }`
- `sdm.view.addNode` `{ parentPath, nodeId, displayName?, dp?, classIri? }`
- `sdm.view.roots` `{view}` · `sdm.view.children` `{path}`

Migration (WinCC OA → SDM)
- `sdm.oa.importPlan` `{ includeDataPoints? }`  (dry-run; returns the plan, writes nothing)
- `sdm.oa.importApply` `{ includeDataPoints? }`  (idempotent apply)

Misc / live
- `sdm.query` `{ sql }`  (SELECT only)
- `sdm.health`
- `sdm.connect` `{ dpNames, answer? }` → subscribe; value updates stream on the same uuid
- `sdm.disconnect` `{ connectUuid }`

### Minimal smoke test (Node WS client)

```js
// node smoke.mjs  — run from a machine that can reach the SDM server
import WebSocket from 'ws';
const ws = new WebSocket('wss://<host>:8444/winccoa', { rejectUnauthorized: false });
let uuid = 1;
const send = (command, params) =>
  ws.send(JSON.stringify({ command, params, uuid: uuid++ }));
ws.on('open', () => send('sdm.health', {}));
ws.on('message', (m) => console.log(m.toString()));
// then: sdm.class.create, sdm.instance.create, sdm.relation.assert, sdm.instance.neighbors …
```

(The production frontend uses the Siemens iX UI + the WinCC OA WebUI JS client to
speak this same protocol — see the project plan.)

## Migrating an existing WinCC OA project

The SDM can be **bootstrapped from an existing project**: the asset structure is
derived from the panel topology (`_PanelTopology`) and the data-point assignment
from the associated sum-alarm configurations. Run a dry-run, review the plan, then
apply — idempotent and non-invasive (existing DPs are referenced, not modified).

- Commands: `sdm.oa.importPlan` / `sdm.oa.importApply` (MCP: `sdm-oa-import-plan` /
  `sdm-oa-import-apply`; UI: *Mass engineering* dialog → **“WinCC OA"** tab).
- Full guide: [`docs/migration-guide.en.md`](docs/migration-guide.en.md)
  (Deutsch: [`docs/migration-guide.md`](docs/migration-guide.md)).

> The importer reads via the **local** manager, so it must run **inside the target
> project's** manager to migrate that project.
