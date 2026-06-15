# Semantic Data Model (SDM) — WinCC OA WebUI page

A self-contained **WebUI page package** that delivers the **Semantic Data Model**
application for WinCC OA. It installs a standalone page (route `/sdm`,
menu entry *Semantic Model*) into a WinCC OA project or a WebUI workspace.

## What it does

The SDM page turns the WinCC OA object model into a managed semantic layer:

- **Ontology** — browse and create classes (with type-in-type inheritance),
  relation types and aspects.
- **Instances** — create / edit / delete instances; live property inspector;
  assert/retract typed relations; server-side search + paging.
- **Asset hierarchy** — ISA-95-style containment as a **live, lazy-loaded tree**
  (no rebuild); create / edit / move / delete nodes inline.
- **Graph canvas** — neighborhood graph (Cytoscape), coloured by class/relation.
- **Mass engineering** — templates/typicals, Excel/CSV round-trip (import with
  dry-run diff), model validator/linter.
- **Migration** — import an existing WinCC OA project (panel topology + sum
  alarms) into the SDM.

All data flows over the WinCC OA WebUI WebSocket via the `sdm.*` command family.

## Prerequisite: the SDM backend

> This package is the **page only**. It requires the **SDM backend** (the
> webserver.js customization that serves the `sdm.*` WebSocket commands) running
> in the same project. Without it the page loads but every call fails. The backend
> bootstraps its meta data point types on first start — no DPL import needed.

## Installation

The package auto-detects the install layout (postinstall).

### Option A — directly into a WinCC OA project

```bash
cd {OA-PROJECT}/data/WebUI
npm install @martinkumhera/winccoa-sdm-page --omit=peer --omit=dev --foreground-scripts
```

This merges the menu entry into `{OA-PROJECT}/data/dashboard-wc/menuconfig.json`
(the page `module` points into `node_modules`, so no JS is copied), seeds the
`msg/` translations, and prints a next-steps banner (also written to
`dashboard-wc/sdm.NEXT_STEPS.txt`). Then hard-reload the WebUI.

### Option B — into a WebUI workspace (Vite monorepo)

```bash
cd {WORKSPACE}
npm install @martinkumhera/winccoa-sdm-page
```

This merges the entry into `apps/dashboard-wc/config/menuconfig.jsonc`, mirrors
`oa-data/`, and creates a shim
`libs/default-components/src/lib/standalone-pages/sdm.ts` that side-effect-imports
the page so the workspace build bundles it.

> Re-run the registration manually any time with `npm run manifest` from the
> package directory.

## What's in the box

| Path | Purpose |
|---|---|
| `dist/pages/sdm.js` | the built standalone page bundle (loaded by the WebUI) |
| `wui-page.json` | manifest: menu entry + next-steps |
| `scripts/` | postinstall automation (workspace + OA-project modes) |
| `oa-data/WebUI/msg/` | translation catalogs (`WUI_SDM`) |
| `pages/`, `lib/sdm/` | page entry + component sources (reference) |

## Peer dependencies

Provided by the WebUI runtime (import-mapped at runtime; not bundled): `lit`,
`rxjs`, `tsyringe`, `@siemens/ix`, `@siemens/ix-icons`,
`@etm-professional-control/oa-rx-js-api`, `@wincc-oa/wui-shared`,
`@wincc-oa/wui-oarxjs-data`, `@wincc-oa/wui-oarxjs-context`,
`@wincc-oa/wui-ix-wrappers`. (Cytoscape and SheetJS/xlsx are bundled into the page.)

## Maintainer notes

The page bundle is built in the frontend workspace:

```bash
cd frontend && OUT_DIR=<proj>/data/dashboard-wc npm run build:pages
```

then refresh the shipped artifact before publishing:

```bash
cd javascript/sdm-page
npm run sync:dist     # copies the built sdm.js into dist/pages/
npm publish           # publishes @martinkumhera/winccoa-sdm-page (public)
```

See also the project migration guide: `javascript/sdm/docs/migration-guide.en.md`.
