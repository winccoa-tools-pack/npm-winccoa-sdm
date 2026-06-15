# WinCC OA → SDM: Project Migration

How to convert an existing WinCC OA project into the **Semantic Data Model (SDM)**.
The migration derives the **asset structure** from the panel topology
(`_PanelTopology`) and the **data-point assignment** from the associated
**sum-alarm configurations**.

> **Setting up from scratch?** If you still need to install the WebUI runtime + SDM
> into an existing project, see the end-to-end quickstart (using
> `DemoApplication_3.21`) in
> [`quickstart-existing-project.md`](./quickstart-existing-project.md).

> TL;DR: run a `Dry-run` → review the plan → `Apply`. Idempotent. A dpType becomes
> an SDM class and its DPs the instances. Default `adopt` (the real DPs are the
> instances; augments those dpTypes once with `sem`); `adoptDataPoints:false` =
> non-invasive proxy mode.

*(Deutsche Fassung: [`migration-guide.md`](./migration-guide.md).)*

> **Canonical source.** This file (`javascript/sdm/docs/`) is the authoritative
> version. A copy mirrored for the frontend docs lives at
> `frontend/docs/knowledge/sdm-migration-guide.md` — keep it in sync on changes.

---

## 1. What the migration produces

| Source in the OA project | Target in the SDM |
|---|---|
| `_PanelTopology` node | one instance of class `oa:TopologyNode` |
| `parentNumber` | `isa:partOf` edge (node → parent) |
| A node's sum-alarm DP's member DPEs | **one SDM class per dpType**; the data points as instances, attached under the node via `isa:partOf` |

Result: the project's **navigation / asset tree** becomes a live `isa:partOf`
hierarchy in the SDM and appears immediately in the WebUI **Asset tree**
(`/sdm` → *Assets* tab), with the data points assigned per area.

Created automatically (if not already present):

- the relation type **`isa:partOf`** (functional 0..1, transitive, inverse `isa:hasPart`)
- `isa:EquipmentElement` (abstract base)
- `oa:TopologyNode` (extends `isa:EquipmentElement`) — properties: `panelNumber`,
  `fileName`, `moduleName`, `panelType`, `nodeDescription`, `locality`,
  `functionality`, `uuid`
- **one class per used dpType** (default `adopt`: mapped to the **real** OA type;
  fallback `proxy`: `oa:dp:<type>` with property `dpRef`). In `adopt` mode the class
  takes over **all data point elements** of the type as properties (nested structs
  as dotted paths, e.g. `state.value`).

---

## 2. Prerequisites

1. **The importer must run inside the target project's manager.** The SDM backend
   (`javascript/sdm`) / SDM MCP server reads `_PanelTopology` and the sum-alarm DPs
   via the **local** manager's `dpGet`/`dpNames`. To migrate project *X*, the SDM
   manager must be running in project *X* (not pointed at a different project).
2. **The target project has a configured `_PanelTopology`** (navigation/topology
   editor) — otherwise there is only the default node and nothing to migrate.
3. **For the data-point assignment**: the per-area sum alarms are configured as
   `_SumAlertPanel` DPs (standard for topology/alarm-screen projects).
4. The SDM backend is built and running (see project README; `npm run build` in
   `javascript/sdm`).

---

## 3. The mapping in detail

### 3.1 Asset hierarchy from `_PanelTopology`

`_PanelTopology` is **one** DP holding parallel dynamic arrays; node *i* is formed
from index *i* across all arrays:

| Element | Use |
|---|---|
| `panelNumber[i]` | node id → instance name `oaNode_<panelNumber>` |
| `parentNumber[i]` | parent id; **`0` = root** → `isa:partOf` |
| `nodeName[i]` | display name (label) |
| `fileName[i]` | panel file → used to derive the sum-alarm DP |
| `description` / `locality` / `functionality` | properties on the node |
| `moduleName` / `panelType` / `uuid` | properties on the node |
| `sumAlertNumber[i]` | part of the sum-alarm DP derivation |

Nodes without a real panel file (`fileName` empty or `EXECSCRIPT …`) are still
created as nodes but get no data-point assignment.

### 3.2 Data-point assignment from the sum alarms

Each topology node owns its **own** sum-alarm DP. Its name is derived from
`fileName` and `sumAlertNumber`:

```
sumAlertPanelDp = stripExt(fileName).replace(/[/\\]/g, "_") + "_" + sumAlertNumber
```

- `stripExt` removes the file extension (e.g. `.pnl`)
- `/` and `\` become `_`
- suffix `_<sumAlertNumber>`

**Examples (from the WinCC OA demo project):**

| Node | `fileName` | `sumAlertNumber` | derived DP |
|---|---|---|---|
| Wasserversorgung | `mainpanels/water_supply.pnl` | 1 | `mainpanels_water_supply_1` |
| Produktion | `mainpanels/production.pnl` | 1 | `mainpanels_production_1` |
| Reaktionsbehälter | `mainpanels/reactor.pnl` | 1 | `mainpanels_reactor_1` |

> Note: even when several nodes share the same `sumAlertNumber` (in the demo all
> plant areas are `=1`), the DPs differ via `fileName` — i.e. one sum-alarm DP per
> area.

The sum-alarm DP is of type `_SumAlertPanel` with elements `Warning` / `Alert` /
`Danger`. Member data points are read from the alert configuration of all three
levels and unioned:

```
member DPEs = ⋃ over {Warning, Alert, Danger}:
                <dp>.<level>:_alert_hdl.._dp_list          (explicit DPE list)
              ∪ dpNames(<dp>.<level>:_alert_hdl.._dp_pattern)  (wildcard pattern)
```

Each member DPE is reduced to its bare DP name and deduplicated.

**The essential level: a dpType is a class, its data points are the instances.**
Exactly **one** SDM class is created per used **dpType**, and the DPs are its
instances — controlled by `adoptDataPoints`:

- **`adopt` (default):** the existing dpType is registered as an SDM class
  (`mappedDpType` = the **real** OA type) and augmented once via `dpTypeChange`
  with the embedded `sem` struct. The **real DPs then are the instances**
  (`getClassByDpType` / `listInstances` recognise them) and hang under their node
  via `isa:partOf`. → modifies those dpTypes (and thus all their DPs) once.
- **`proxy` (non-invasive):** one `oa:dp:<type>` class per dpType + one lightweight
  reference instance (`dpRef`) per DP. The real types/DPs stay untouched.

> Because `isa:partOf` is functional (0..1), a DP belongs to exactly **one** node:
> if a DP appears in several sum alarms, the first node processed claims it.

---

## 4. Running the migration

Three equivalent paths — each with **Dry-run** (plan, writes nothing) and
**Apply**. Always Dry-run first, review the plan, then Apply.

### 4.1 Via the WebUI (recommended)

1. Open `/sdm` → **“Mass engineering"** button (status bar).
2. Tab **“WinCC OA"**.
3. Set/keep the checkbox **“Include data-point assignment (sum-alarms)"**.
4. **Dry-run** → review the plan table (nodes, parents, derived sum-alarm DPs,
   number of referenced DPs).
5. **Apply** → result (created nodes / DPs / edges).
6. The page's *Assets* tab shows the imported tree (press “Reload" if needed).

### 4.2 Via the SDM MCP server (for AI / automation)

```text
sdm-oa-import-plan   { "includeDataPoints": true, "adoptDataPoints": true }   # dry-run
sdm-oa-import-apply  { "includeDataPoints": true, "adoptDataPoints": true }   # apply
```

### 4.3 Via the WebSocket API (frontend / custom clients)

```text
sdm.oa.importPlan    { includeDataPoints: true, adoptDataPoints: true }
sdm.oa.importApply   { includeDataPoints: true, adoptDataPoints: true }
```

- `includeDataPoints=false` migrates only the **asset hierarchy** (phase 1) without
  the data-point assignment.
- `adoptDataPoints=false` switches the data-point assignment to the **non-invasive
  proxy mode** (real dpTypes/DPs untouched). Default is `adopt`.

---

## 5. Recommended procedure

1. Ensure the **SDM manager runs in the target project**.
2. Run a **Dry-run** and review the plan:
   - Does the node count match the topology?
   - Are the `parentDp` links plausible (roots = `parentNumber 0`)?
   - Are sum-alarm DPs resolved per area (`nodesWithSumAlert > 0`,
     `dataPoints > 0`)? If 0: see section 7 (Troubleshooting).
3. Run **Apply**.
4. **Verify** (section 6).
5. Re-run if needed — the migration is **idempotent**: existing nodes/DPs are
   skipped, edges are idempotent anyway.

---

## 6. Verifying

- **WebUI**: `/sdm` → *Assets* tab → the tree matches the navigation/topology
  structure; the assigned data points hang under their areas.
- **MCP / programmatic**:
  - `sdm-hierarchy-roots` → the root nodes (e.g. “StartPanel").
  - `sdm-hierarchy-children { parentDp: "oaNode_<n>" }` → children, lazily.
  - `sdm-instance-get { id: "oaNode_<n>" }` → properties + neighbors.
- **Model linter**: `sdm-validate` → checks referential integrity, cardinality,
  adjacency; should report 0 errors after the import.

---

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Only 1–3 nodes, generic names | SDM manager points at the wrong project (e.g. default topology). Run the importer **in the target project**. |
| `dataPoints = 0`, `nodesWithSumAlert = 0` | Sum-alarm DPs not found. Check that nodes have real `fileName` (no `EXECSCRIPT`, not empty) and that the derived `_SumAlertPanel` DPs exist (plan column “sum-alarm DP"). |
| Individual DPs missing | Members come from `_dp_list` **and** `_dp_pattern`; an empty/invalid pattern is skipped. Check the pattern on the sum-alarm DP. |
| Nodes don't appear in the Asset tree | The Asset tree shows `isa:partOf` participants; root nodes appear because `oa:TopologyNode` extends `isa:EquipmentElement`. Press “Reload" / SW-reset the WebUI after apply. |
| Duplicate/stale instances after re-running | None — idempotent. **Careful resetting in `adopt` mode:** `deleteClass(adopted dpType class, deleteInstances=true)` would delete the **real** OA type and its DPs — instead remove only the class meta DP and optionally strip `sem` via `dpTypeChange`. `oa:TopologyNode` is safe to delete. |

> **MCP tool note:** the `get-value` MCP tool blocks the config-attribute syntax
> (`..`) as a presumed wildcard. That only affects the inspection tool — the
> importer (in-manager) uses `dpGet('dp:_alert_hdl.._dp_list')` directly and is
> unaffected.

---

## 8. Properties & limits

- **dpType = class, DP = instance:** exactly one SDM class per used dpType.
  - `adopt` (default): the real OA type becomes the class (a one-time `sem`
    augmentation of the type); the real DPs are the instances. Original values /
    config stay intact — only the type gains the `sem` struct.
  - `proxy`: fully non-invasive (reference instances with `dpRef`).
- **Idempotent:** applying repeatedly is safe (existing instances are skipped).
- **Redundancy:** writes only on the active peer (standby returns 503), like all
  SDM write operations.
- **Functional containment relation:** `isa:partOf` is 0..1 → a DP/node has exactly
  one parent.
- **Scale:** the topology is read in one `dpGet`; members per node in one `dpGet` +
  `dpNames(pattern)`. The Asset tree then loads lazily.

---

## 9. Customization / extension

Easily extended in the code (`javascript/sdm/src/model/oaImport.ts`):

- **Concrete subclasses** per `functionality`/`panelType` instead of a single
  `oa:TopologyNode` class (e.g. `oa:Area`, `oa:ProcessCell`).
- **Enrich property metadata**: pull unit / description / archive info per element
  from the adopted types' common/alert config (the element names are already taken
  over in full); more DP metadata (description, unit
  from the common config).
- **A dedicated containment relation** (`oa:monitoredBy`) instead of `isa:partOf`
  for the DP assignment, if DPs should also live in other hierarchies.
- **Multiple topology sources** (distributed systems) via a system-prefix
  parameter.

---

## 10. Reference: building blocks

| Layer | Artifact |
|---|---|
| Model | `javascript/sdm/src/model/oaImport.ts` (`planOaImport`, `applyOaImport`, `sumAlertDpName`) |
| Service | `service.planOaImport` / `service.applyOaImport` |
| WebSocket | `sdm.oa.importPlan` / `sdm.oa.importApply` |
| MCP | `sdm-oa-import-plan` / `sdm-oa-import-apply` |
| UI | Mass-engineering dialog, “WinCC OA" tab (`sdm-bulk-dialog.ts`) |
