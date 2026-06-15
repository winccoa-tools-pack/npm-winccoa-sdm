# Semantic Data Model (SDM) — WinCC OA backend

The **backend** for the Semantic Data Model on WinCC OA **3.21**: a
**webserver.js dashboard-server customization** that exposes the `sdm.*`
WebSocket command family. It turns the OA object model (DPT / DP / CNS) into a
managed semantic layer — classes with type-in-type inheritance, instances, typed
relations (a graph), ISA-95 asset hierarchy, CNS views, templates, Excel/CSV bulk
import, model validation and WinCC OA project migration — stored in **pure OA
primitives**, hence covered by redundancy and distribution automatically.

It runs as a **Node.js JavaScript Manager** and includes all standard dashboard
handlers, so it can **replace** the standard `webserver-js` manager.

> Frontend counterpart (the `/sdm` page): **`@martinkumhera/winccoa-sdm-page`**.
> The page talks to this backend over the WebUI WebSocket.

## Install

Install inside your WinCC OA project's `javascript/` directory (so the manager
resolves the package and the OA libraries via `NODE_PATH`):

```bash
cd {OA-PROJECT}/javascript
npm install @martinkumhera/winccoa-sdm-backend
```

The postinstall prints the manager-registration steps and writes them to
`SDM_BACKEND.NEXT_STEPS.txt`. Then, in the WinCC OA **Console**, append a
JavaScript Manager:

| Field | Value |
|---|---|
| Manager | `WCCOAjavascript` (Node.js JavaScript Manager) |
| Parameter | `node_modules/@martinkumhera/winccoa-sdm-backend/run.js` |
| Start mode | `manual` (or `always`) |

By default it serves on the configured `httpsPort` (8443, from
`config/config` `[webserverjs]`) and **replaces** the standard webserver. To run
it **additionally** alongside the standard webserver, set on the manager:

```
SDM_PORT=8444
SDM_WSS=/winccoa
```

On first start it **bootstraps its meta data point types** automatically — no DPL
import needed.

## Runtime dependencies (provided by the OA install)

`webserver-js` and `winccoa-manager` are **not** installed from npm — they ship
with WinCC OA and are resolved at runtime via the JavaScript Manager's
`NODE_PATH` (`<WinCC-OA-install>/javascript`). They are declared as optional peer
dependencies for documentation only.

## What's in the box

| Path | Purpose |
|---|---|
| `dist/` | compiled backend (the runtime; `run.js` loads it) |
| `run.js` | JavaScript Manager entry point |
| `src/` | TypeScript sources (reference) |
| `tsconfig.json` | build config (reference) |

## Command surface (prefix `sdm.`)

Ontology (`class.*`, `relationType.*`, `aspect.*`), instances (`instance.*`,
incl. server-side `search`), relations (`relation.assert/retract`), hierarchy
(`hierarchy.get/roots/children` — lazy), views (`view.*`), templates
(`template.*`), bulk (`bulk.export/importPlan/importApply`), validation
(`validate`), migration (`oa.importPlan/importApply`), plus `query`, `health`,
and live `connect/disconnect`. See the project docs for details.

## Migration

To bootstrap the SDM from an existing project (panel topology + sum alarms), see
`javascript/sdm/docs/migration-guide.en.md` (Deutsch: `migration-guide.md`).

## Maintainer notes

The canonical project is `javascript/sdm` (kept with its `file:` dev deps for
building with `tsc`). This package ships the prebuilt artifact. Before publishing:

```bash
cd ../sdm && npm run build      # compile dist/
cd ../sdm-backend
npm run sync:dist               # copy dist/ + src/ + run.js + tsconfig.json here
npm publish                     # @martinkumhera/winccoa-sdm-backend (public)
```
